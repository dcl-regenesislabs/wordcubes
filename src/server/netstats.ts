// Live monitor (config NET_STATS): what the server sends, for the client's monitor (client/ui/netstats.tsx).
// Counts every room message per name and recipient, and the synced-state (CRDT) bytes it broadcasts, over the last
// second. A client with the monitor open asks once a second ('netStats') and gets the numbers back ('netStatsReply').
// Only wallets in the NET_MONITOR_WALLETS env var get it (everyone in the local preview); 'netAccess' tells each
// player whether to show the monitor's button.
import { engine, RealmInfo } from '@dcl/sdk/ecs'
import { syncFilter } from '@dcl/sdk/network/filter'
import { EnvVar } from '@dcl/sdk/server'
import * as C from '../config'
import { room } from '../shared/messages'
import { players } from './common'
import type { Game } from './game'

interface Bucket {
  n: number // deliveries (one message to 3 players = 3)
  b: number // approximate bytes delivered
}

let window: Map<string, Bucket> = new Map()
let last: Map<string, Bucket> = new Map()
let crdt = { n: 0, b: 0 }
let lastCrdt = { n: 0, b: 0 }
let windowAcc = 0
let ticks = 0
let tickMsSum = 0
let tickMsMax = 0
let lastTick = { fps: 0, avgMs: 0, maxMs: 0 }
const startedAt = Date.now()

// ---- who may open the monitor ----
const ENV_KEY = 'NET_MONITOR_WALLETS'
let allowed = new Set<string>()
let fetchedAt = -Infinity
let fetching = false
const told = new Map<string, boolean>() // address -> what the player was last told (netAccess)
let toldAt = 0

/** A JSON array of addresses, or addresses separated by commas / spaces. */
function parseWallets(raw: string): Set<string> {
  let list: unknown = []
  try {
    list = JSON.parse(raw)
  } catch (e) {
    list = raw.split(/[\s,;]+/)
  }
  if (!Array.isArray(list)) list = [list]
  return new Set(
    (list as unknown[])
      .map((a) => String(a).trim().toLowerCase())
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
  )
}

function refreshAllowed() {
  if (fetching || Date.now() - fetchedAt < C.NET_MONITOR_REFRESH_SECONDS * 1000) return
  fetching = true
  void EnvVar.get(ENV_KEY)
    .then((raw) => {
      const next = parseWallets(raw ?? '')
      if (next.size !== allowed.size || Array.from(next).some((a) => !allowed.has(a))) {
        console.log(`[NETMON] ${next.size} wallet(s) may open the monitor`)
      }
      allowed = next
    })
    .catch((e) => console.log('[NETMON] env read failed, keeping the last list', e))
    .finally(() => {
      fetchedAt = Date.now()
      fetching = false
    })
}

/** True in a local preview (npm run start), never on a deployed world. */
export const isPreview = () => RealmInfo.getOrNull(engine.RootEntity)?.isPreview === true

export function canMonitor(address: string): boolean {
  return isPreview() || allowed.has(address.toLowerCase())
}

/** Once a second from the server loop: keep the list fresh and tell each present player whether to show the button. */
export function netAccessTick(present: string[]) {
  refreshAllowed()
  // tell everyone again now and then, in case a message was lost
  if (Date.now() - toldAt > 30000) {
    told.clear()
    toldAt = Date.now()
  }
  const here = new Set(present)
  for (const addr of Array.from(told.keys())) if (!here.has(addr)) told.delete(addr)
  for (const addr of present) {
    const ok = canMonitor(addr)
    if (told.get(addr) === ok) continue
    told.set(addr, ok)
    room.send('netAccess', { ok: ok ? 1 : 0 }, { to: [addr] })
  }
}

/** A player (re)joined: tell them on the next tick. */
export function forgetNetAccess(address: string) {
  told.delete(address)
}

/** Rough encoded size of a message payload (Shorts in the cube arrays are 2 bytes). */
function size(v: unknown): number {
  if (typeof v === 'number') return 4
  if (typeof v === 'string') return v.length + 4
  if (typeof v === 'boolean') return 1
  if (Array.isArray(v)) return 4 + v.reduce((s: number, x) => s + (typeof x === 'number' ? 2 : size(x)), 0)
  if (v && typeof v === 'object') return Object.values(v).reduce((s: number, x) => s + size(x), 0)
  return 0
}

export function setupNetStats(games: Game[]) {
  // every room.send goes through here
  const send = room.send.bind(room) as (name: string, data: unknown, opts?: { to?: string[] }) => unknown
  ;(room as any).send = (name: string, data: unknown, opts?: { to?: string[] }) => {
    const to = opts?.to?.length ?? Math.max(1, players().length)
    const bucket = window.get(name) ?? { n: 0, b: 0 }
    bucket.n += to
    bucket.b += to * (size(data) + name.length + 24) // + envelope and comms header
    window.set(name, bucket)
    return send(name, data, opts)
  }

  // the synced state the SDK broadcasts (GameState, ranks): a transport that only counts what passes the same filter
  const filter = syncFilter(engine as any)
  engine.addTransport({
    type: 'net-stats',
    filter: (m: any) => filter(m),
    send: async (data: Uint8Array) => {
      if (data.byteLength === 0) return
      crdt.n++
      crdt.b += data.byteLength
    }
  } as any)

  room.onMessage('netStats', (_data, ctx) => {
    if (!ctx || !canMonitor(ctx.from)) return
    const per = games.map((g) => g.stats())
    const msgs = Array.from(last.entries())
      .sort((a, b) => b[1].b - a[1].b)
      .map(([name, s]) => ({ name, n: s.n, b: s.b }))
    const json = JSON.stringify({
      up: Math.round((Date.now() - startedAt) / 1000),
      players: players().length,
      tick: lastTick,
      crdt: lastCrdt,
      msgs,
      games: per
    })
    send('netStatsReply', { json }, { to: [ctx.from.toLowerCase()] })
  })
}

/** Called by the server loop once a tick with how long the games took. */
export function recordTick(dt: number, ms: number) {
  ticks++
  tickMsSum += ms
  tickMsMax = Math.max(tickMsMax, ms)
  windowAcc += dt
  if (windowAcc < 1) return
  last = window
  window = new Map()
  // per second, as each client receives it: every CRDT send goes to everyone in the scene
  lastCrdt = { n: Math.round(crdt.n / windowAcc), b: Math.round(crdt.b / windowAcc) }
  crdt = { n: 0, b: 0 }
  for (const s of last.values()) {
    s.n = Math.round(s.n / windowAcc)
    s.b = Math.round(s.b / windowAcc)
  }
  lastTick = { fps: Math.round(ticks / windowAcc), avgMs: Math.round((tickMsSum / ticks) * 10) / 10, maxMs: tickMsMax }
  ticks = 0
  tickMsSum = 0
  tickMsMax = 0
  windowAcc = 0
}
