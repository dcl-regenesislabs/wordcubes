// Live monitor (config NET_STATS, wallets in NET_MONITOR_WALLETS): data for the monitor (ui/netstats.tsx). Counts the server messages this client
// receives over the last second and, while the monitor is open, asks the server for its numbers once a second.
import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { cs } from './state'
import { myState, serverNow } from './gamestate'
import { serverReady } from './connection'
import { cubeNetStats, cubeNetView } from './cubenet'

const SERVER_MESSAGES = ['entered', 'eject', 'toast', 'fx', 'coins', 'burst', 'result', 'profile', 'lockout', 'cubeState', 'cubeMoves', 'netStatsReply'] as const

type Count = { n: number; b: number }

export const netMon = {
  allowed: false, // the server says this wallet may open the monitor (env NET_MONITOR_WALLETS)
  open: false,
  server: null as any, // the server's last answer (server/netstats.ts)
  serverAge: Infinity, // seconds since it came
  recv: [] as { name: string; n: number; b: number }[], // last second, by message
  recvTotal: { n: 0, b: 0 } as Count, // since the scene started
  fps: 0
}

// Traffic limits per client for the traffic light (the monitor's own netStatsReply is left out of them).
const WARN_KBS = 20
const FAIL_KBS = 60
const WARN_MSGS = 60
const FAIL_MSGS = 150

export type Level = 'ok' | 'warn' | 'fail'

// Session history for the LOG button.
const session = {
  startedAt: Date.now(),
  seconds: { ok: 0, warn: 0, fail: 0 } as Record<Level, number>,
  reasons: new Map<string, number>(), // reason -> seconds it was shown
  peakKbs: 0,
  peakMsgs: 0,
  peakServerTickMs: 0,
  bytes: 0, // game traffic received (no monitor replies)
  msgs: 0
}
let lastGaps = 0
let gapsAt: number[] = [] // times of recent lost-message detections

let window = new Map<string, Count>()
let windowAcc = 0
let frames = 0
let askAcc = 0

/** Rough encoded size of a message payload (the same estimate as server/netstats.ts). */
function size(v: unknown): number {
  if (typeof v === 'number') return 4
  if (typeof v === 'string') return v.length + 4
  if (typeof v === 'boolean') return 1
  if (Array.isArray(v)) return 4 + v.reduce((s: number, x) => s + (typeof x === 'number' ? 2 : size(x)), 0)
  if (v && typeof v === 'object') return Object.values(v).reduce((s: number, x) => s + size(x), 0)
  return 0
}

export function setupNetStats() {
  for (const name of SERVER_MESSAGES) {
    room.onMessage(name, (data) => {
      const b = size(data) + name.length + 24
      const c = window.get(name) ?? { n: 0, b: 0 }
      c.n++
      c.b += b
      window.set(name, c)
      netMon.recvTotal.n++
      netMon.recvTotal.b += b
    })
  }
  room.onMessage('netAccess', (d) => {
    netMon.allowed = d.ok === 1
    if (!netMon.allowed) netMon.open = false
  })
  room.onMessage('netStatsReply', (d) => {
    try {
      netMon.server = JSON.parse(d.json)
      netMon.serverAge = 0
    } catch (e) {
      netMon.server = null
    }
  })
}

export function netStatsSystem(dt: number) {
  frames++
  windowAcc += dt
  netMon.serverAge += dt
  if (windowAcc >= 1) {
    netMon.fps = Math.round(frames / windowAcc)
    netMon.recv = Array.from(window.entries())
      .map(([name, c]) => ({ name, n: Math.round(c.n / windowAcc), b: Math.round(c.b / windowAcc) }))
      .sort((a, b) => b.b - a.b)
    window = new Map()
    windowAcc = 0
    frames = 0
    trackSession()
  }
  if (!netMon.open) return
  askAcc += dt
  if (askAcc >= 1) {
    askAcc = 0
    room.send('netStats', { n: 0 })
  }
}

const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`

/** Game traffic received in the last second, without the monitor's own replies. */
function gameTraffic(): { b: number; n: number } {
  const game = netMon.recv.filter((r) => r.name !== 'netStatsReply')
  return { b: game.reduce((s, r) => s + r.b, 0), n: game.reduce((s, r) => s + r.n, 0) }
}

/** Green / yellow / red, and why. */
export function health(): { level: Level; reasons: string[] } {
  const fail: string[] = []
  const warn: string[] = []
  const t = gameTraffic()
  const view = cubeNetView()
  const recentGaps = gapsAt.filter((at) => Date.now() - at < 60000).length
  if (!serverReady()) fail.push('not connected to the server')
  if (netMon.open && netMon.serverAge > 3 && netMon.serverAge !== Infinity) fail.push(`server silent for ${Math.floor(netMon.serverAge)}s`)
  if (t.b / 1024 > FAIL_KBS) fail.push(`receiving ${kb(t.b)}/s (max ${FAIL_KBS})`)
  else if (t.b / 1024 > WARN_KBS) warn.push(`receiving ${kb(t.b)}/s (ok under ${WARN_KBS})`)
  if (t.n > FAIL_MSGS) fail.push(`${t.n} msgs/s (max ${FAIL_MSGS})`)
  else if (t.n > WARN_MSGS) warn.push(`${t.n} msgs/s (ok under ${WARN_MSGS})`)
  if (view.game >= 0 && view.waitingFull) (cubeNetStats.syncAsks > 2 ? fail : warn).push('waiting for the cubes from the server')
  if (recentGaps >= 3) fail.push(`${recentGaps} lost messages in the last minute`)
  else if (recentGaps > 0) warn.push(`${recentGaps} lost message(s) in the last minute`)
  const s = netMon.server
  if (s && netMon.serverAge <= 3) {
    if (s.tick.maxMs > 33) fail.push(`server tick took ${s.tick.maxMs} ms (max 33)`)
    else if (s.tick.avgMs > 10) warn.push(`server tick avg ${s.tick.avgMs} ms`)
    if (s.tick.fps > 0 && s.tick.fps < 25) warn.push(`server at ${s.tick.fps} ticks/s`)
  }
  if (netMon.fps > 0 && netMon.fps < 20) warn.push(`your fps ${netMon.fps}`)
  if (fail.length) return { level: 'fail', reasons: [...fail, ...warn] }
  if (warn.length) return { level: 'warn', reasons: warn }
  return { level: 'ok', reasons: [] }
}

function trackSession() {
  if (cubeNetStats.gaps > lastGaps) for (let i = lastGaps; i < cubeNetStats.gaps; i++) gapsAt.push(Date.now())
  lastGaps = cubeNetStats.gaps
  gapsAt = gapsAt.filter((at) => Date.now() - at < 60000)
  const h = health()
  session.seconds[h.level]++
  for (const r of h.reasons) {
    const key = r.replace(/[0-9.]+/g, '#') // group "receiving 21.3 KB/s" and "receiving 25.0 KB/s"
    session.reasons.set(key, (session.reasons.get(key) ?? 0) + 1)
  }
  const t = gameTraffic()
  session.peakKbs = Math.max(session.peakKbs, t.b / 1024)
  session.peakMsgs = Math.max(session.peakMsgs, t.n)
  session.bytes += t.b
  session.msgs += t.n
  const s = netMon.server
  if (s && netMon.serverAge <= 3) session.peakServerTickMs = Math.max(session.peakServerTickMs, s.tick.maxMs)
}

/** LOG button: the session so far, in the console. */
export function logSummary() {
  const secs = Math.max(1, Math.round((Date.now() - session.startedAt) / 1000))
  const pct = (n: number) => `${Math.round((n / Math.max(1, session.seconds.ok + session.seconds.warn + session.seconds.fail)) * 100)}%`
  const h = health()
  const reasons = Array.from(session.reasons.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `    ${n}s  ${r}`)
  const out = [
    '======== WORD CUBES NET SUMMARY ========',
    `now: ${h.level.toUpperCase()}${h.reasons.length ? ' - ' + h.reasons.join('; ') : ''}`,
    `session: ${Math.floor(secs / 60)}m ${secs % 60}s   green ${pct(session.seconds.ok)}  yellow ${pct(session.seconds.warn)}  red ${pct(session.seconds.fail)}`,
    `received (game traffic): ${kb(session.bytes)} in ${session.msgs} msgs, avg ${kb(session.bytes / secs)}/s, peak ${session.peakKbs.toFixed(1)} KB/s and ${session.peakMsgs} msgs/s`,
    `cubes: game ${cs.game < 0 ? 'lobby' : cs.game + 1}, ${cubeNetView().cubes} cubes, lost detected ${cubeNetStats.gaps}, full asks ${cubeNetStats.syncAsks}, fulls got ${cubeNetStats.fulls}`,
    `server: worst tick ${session.peakServerTickMs} ms`,
    reasons.length ? 'problems seen (seconds shown):' : 'problems seen: none',
    ...reasons,
    '--- current monitor ---',
    ...netLines(),
    '========================================'
  ]
  console.log(out.join('\n'))
}

/** The monitor's text, one line each. */
export function netLines(): string[] {
  const lines: string[] = []
  let players = 0
  for (const _ of engine.getEntitiesWith(PlayerIdentityData)) players++
  const g = myState()
  const view = cubeNetView()
  const st = cubeNetStats

  lines.push('== YOU ==')
  lines.push(`connected ${serverReady() ? 'yes' : 'NO'}  synced ${isStateSyncronized() ? 'yes' : 'NO'}  fps ${netMon.fps}  players in scene ${players}`)
  lines.push(`game ${cs.game < 0 ? 'lobby' : cs.game + 1}${g ? `  ${g.phase} round ${g.round} lvl ${g.difficulty} ${g.timeLeft}s  seats ${g.players}` : ''}`)
  lines.push(`server clock ${serverNow() === null ? 'unknown' : 'ok'}`)
  if (view.game >= 0) {
    lines.push(`cubes ${view.cubes} (${view.gliding} gliding)  seq ${view.seq}${view.waitingFull ? '  WAITING FULL STATE' : ''}`)
    lines.push(`moves every ${st.moveGap} ms  states ${st.states}  moves ${st.moves}`)
    lines.push(`lost detected ${st.gaps}  full asks ${st.syncAsks}  fulls got ${st.fulls}`)
  }
  const recvB = netMon.recv.reduce((s, r) => s + r.b, 0)
  lines.push(`received ${kb(recvB)}/s  total ${kb(netMon.recvTotal.b)} in ${netMon.recvTotal.n} msgs`)
  for (const r of netMon.recv.slice(0, 5)) lines.push(`  ${r.name} ${r.n}/s ${kb(r.b)}/s`)

  const s = netMon.server
  lines.push('== SERVER ==')
  if (!s || netMon.serverAge > 3) {
    lines.push(netMon.serverAge === Infinity ? 'asking...' : `NO ANSWER for ${Math.floor(netMon.serverAge)}s`)
    return lines
  }
  lines.push(`up ${Math.floor(s.up / 60)}m  players ${s.players}  tick ${s.tick.fps}/s avg ${s.tick.avgMs} ms max ${s.tick.maxMs} ms`)
  lines.push(`synced state to each client ${kb(s.crdt.b)}/s (${s.crdt.n} sends/s)`)
  const totalB = s.msgs.reduce((a: number, m: any) => a + m.b, 0)
  lines.push(`messages out ${kb(totalB)}/s, all players together`)
  for (const m of s.msgs.slice(0, 4)) lines.push(`  ${m.name} ${m.n}/s ${kb(m.b)}/s`)
  for (const x of s.games) {
    if (!x.active && x.seats === 0) continue
    const modes = Object.entries(x.modes)
      .filter(([k]) => k !== 'free')
      .map(([k, v]) => `${k} ${v}`)
      .join(' ')
    lines.push(`game ${x.game + 1}: ${x.active ? x.phase : 'idle'} r${x.round} lvl ${x.level} ${x.timeLeft}s  seats ${x.seats} in ${x.inArena}`)
    lines.push(`  cubes ${x.cubes}${x.settling ? ` (+${x.settling} settling)` : ''} awake ${x.awake}${modes ? ' ' + modes : ''}  out ${kb(x.sent.b)}/s ${x.sent.n} msgs/s`)
  }
  return lines
}
