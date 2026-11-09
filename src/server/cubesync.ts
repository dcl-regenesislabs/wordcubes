// Sends one game's cubes to the players seated in it (and to nobody else), in place of syncEntity, which broadcasts
// to the whole scene. game.ts reports what changed; flush() runs once a tick and sends:
//   cubeState  cubes created, changed mode (held / flying / placed / free again) or removed, with a sequence number
//   cubeMoves  positions of the cubes that moved, at MOVE_SEND_INTERVAL, plus REFRESH_PER_SEND resting cubes in turn
// A client that sees a gap in the sequence, or enters the game, asks for the full state (sendFull).
import type { Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { room } from '../shared/messages'
import {
  STATE_FIELDS,
  MOVE_FIELDS,
  MAX_STATE_RECORDS,
  MAX_MOVE_RECORDS,
  packPos,
  packYaw,
  packLetter,
  packMode
} from '../shared/cubenet'

export interface NetCube {
  id: number
  letter: string
  mode: string
  slot: number
  holder: string
  born: number // server ms of the settled pile it belongs to, 0 otherwise
  pos: () => Vector3 // the position clients should draw (underground while held, flying or placed)
  yaw: () => number // radians
}

export interface CubeSync {
  added(cube: NetCube): void
  changed(cube: NetCube): void
  moved(cube: NetCube): void
  removed(id: number): void
  flush(dt: number): void
  sendFull(to: string): void
  /** DEV ONLY (NET_STATS): cube messages sent in the last second: deliveries and approximate bytes */
  sent(): { n: number; b: number }
  /** for tests */
  readonly seq: number
}

export function createCubeSync(game: number, opts: { members: () => string[]; cubes: () => Iterable<NetCube>; origin: () => Vector3 }): CubeSync {
  let seq = 0
  const dirty = new Map<number, NetCube>() // created or changed mode since the last flush
  const moved = new Map<number, NetCube>()
  const gone: number[] = []
  let moveAcc = 0
  let refreshAt = 0 // round-robin index over the cubes for the slow refresh
  // DEV ONLY (NET_STATS) counters: this second and the last one
  let count = { n: 0, b: 0, at: Date.now() }
  let lastCount = { n: 0, b: 0 }
  function counted(to: string[], fields: number) {
    const now = Date.now()
    if (now - count.at >= 1000) {
      lastCount = { n: count.n, b: count.b }
      count = { n: 0, b: 0, at: now }
    }
    count.n += to.length
    count.b += to.length * (fields * 2 + 80)
  }

  function stateRecords(list: NetCube[], o: Vector3) {
    const born = list.reduce((m, c) => Math.max(m, c.born), 0)
    const holders: string[] = []
    const d: number[] = []
    for (const c of list) {
      let h = -1
      if (c.holder) {
        h = holders.indexOf(c.holder)
        if (h < 0) h = holders.push(c.holder) - 1
      }
      const p = c.pos()
      d.push(c.id, packLetter(c.letter), packMode(c.mode, born > 0 && c.born === born), c.slot, h)
      d.push(packPos(p.x - o.x), packPos(p.y - o.y), packPos(p.z - o.z), packYaw(c.yaw()))
    }
    return { born, holders: holders.join(','), d }
  }

  function sendState(to: string[], list: NetCube[], removedIds: number[], full: boolean, s: number) {
    const o = opts.origin()
    // split into parts that stay under the message size limit; the removals ride on the first part
    const parts = Math.max(1, Math.ceil(list.length / MAX_STATE_RECORDS))
    for (let i = 0; i < parts; i++) {
      const slice = list.slice(i * MAX_STATE_RECORDS, (i + 1) * MAX_STATE_RECORDS)
      const { born, holders, d } = stateRecords(slice, o)
      const part = full ? s : ++seq
      counted(to, d.length + (i === 0 ? removedIds.length : 0))
      room.send(
        'cubeState',
        { g: game, s: part, full: full ? 1 : 0, end: full && i === parts - 1 ? 1 : 0, o, born, holders, d, gone: i === 0 ? removedIds : [] },
        { to }
      )
    }
  }

  function sendMoves(to: string[], list: NetCube[]) {
    const o = opts.origin()
    for (let i = 0; i < list.length; i += MAX_MOVE_RECORDS) {
      const d: number[] = []
      for (const c of list.slice(i, i + MAX_MOVE_RECORDS)) {
        const p = c.pos()
        d.push(c.id, packPos(p.x - o.x), packPos(p.y - o.y), packPos(p.z - o.z), packYaw(c.yaw()))
      }
      counted(to, d.length)
      room.send('cubeMoves', { g: game, s: seq, o, d }, { to })
    }
  }

  // A few resting cubes go out again with every moves message, so a lost one is put right within seconds.
  function refreshSome(into: Map<number, NetCube>) {
    const free = Array.from(opts.cubes()).filter((c) => c.mode === 'free')
    if (free.length === 0) return
    for (let n = 0; n < Math.min(C.REFRESH_PER_SEND, free.length); n++) {
      refreshAt = (refreshAt + 1) % free.length
      const c = free[refreshAt]
      if (!into.has(c.id)) into.set(c.id, c)
    }
  }

  return {
    get seq() {
      return seq
    },
    added(cube) {
      dirty.set(cube.id, cube)
    },
    changed(cube) {
      dirty.set(cube.id, cube)
    },
    moved(cube) {
      if (!dirty.has(cube.id)) moved.set(cube.id, cube)
    },
    removed(id) {
      dirty.delete(id)
      moved.delete(id)
      gone.push(id)
    },
    flush(dt) {
      const to = opts.members()
      moveAcc += dt
      if (to.length === 0) {
        // nobody to tell: whoever sits down next asks for the full state
        dirty.clear()
        moved.clear()
        gone.length = 0
        return
      }
      if (dirty.size > 0 || gone.length > 0) {
        const list = Array.from(dirty.values())
        for (const c of list) moved.delete(c.id) // the state record carries the position too
        sendState(to, list, gone.splice(0), false, 0)
        dirty.clear()
      }
      if (moveAcc < C.MOVE_SEND_INTERVAL) return
      moveAcc = 0
      refreshSome(moved)
      if (moved.size > 0) sendMoves(to, Array.from(moved.values()))
      moved.clear()
    },
    sent() {
      return Date.now() - count.at >= 2000 ? { n: 0, b: 0 } : lastCount
    },
    sendFull(to) {
      sendState([to], Array.from(opts.cubes()), [], true, seq)
    }
  }
}
