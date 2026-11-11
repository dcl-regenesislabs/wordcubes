// The cubes of the game you play in, built from the server's cubeState / cubeMoves messages (server/cubesync.ts).
// Each cube becomes a local entity with CubeData + Transform, the same components the rest of the client (cubes.ts,
// predict.ts, ranktags.ts) used to read from synced entities, so it works on them unchanged.
//
// Positions are absolute, so every message stands on its own. A gap in cubeState's sequence (a lost message), or
// entering a game, asks the server for the full state (cubeSync).
//
// Your own grab and throw at a frame are guessed (guessMode): the cube goes to your hands, or flies, the moment you
// click, instead of a round trip later. The server's word always wins: its confirmation changes nothing, anything else
// it says replaces the guess, and a guess it never confirms is undone after GUESS_CONFIRM_SECONDS.
import { engine, Transform } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { room } from '../shared/messages'
import { CubeData } from '../shared/schemas'
import { STATE_FIELDS, MOVE_FIELDS, unpackPos, unpackYawDeg, unpackLetter, unpackMode } from '../shared/cubenet'
import { cs } from './state'

interface Target {
  pos: Vector3
  yaw: number // degrees
}

const entities = new Map<number, Entity>() // cube id -> local entity
const targets = new Map<number, Target>()
let game = -1 // the game these cubes belong to
let lastSeq = -1 // last cubeState sequence number applied (-1: no full state yet)
let wantSync = false
let sinceAsk = Infinity
let fullSet: Set<number> | null = null // ids listed so far by a full state that is still arriving

interface Guess {
  mode: string
  slot: number
  left: number // seconds until it is given up
  age: number
  // a throw away (F): the server's free cube, once it said so, and where it is now (it takes over after TOSS_SHOW_SECONDS)
  landed?: Target
  base: { mode: string; slot: number; holder: string; pos: Vector3; rot: Quaternion } // the server's state before it
}
const guesses = new Map<number, Guess>()
const undone = new Set<number>() // guesses just given up: cubes.ts ends the carry pose quietly (takeUndone)

/** DEV ONLY (NET_STATS): what the live monitor shows about your game's cubes. */
export const cubeNetStats = { gaps: 0, syncAsks: 0, fulls: 0, states: 0, moves: 0, lastMoveAt: 0, moveGap: 0 }
export const cubeNetView = () => ({ game, seq: lastSeq, cubes: entities.size, gliding: targets.size, waitingFull: lastSeq < 0 || wantSync })

const rot = (yawDeg: number) => Quaternion.fromEulerDegrees(0, yawDeg, 0)

function clear() {
  for (const e of entities.values()) engine.removeEntity(e)
  entities.clear()
  targets.clear()
  guesses.clear()
  undone.clear()
  fullSet = null
}

function remove(id: number) {
  const e = entities.get(id)
  if (e !== undefined) engine.removeEntity(e)
  entities.delete(id)
  targets.delete(id)
  guesses.delete(id)
}

/** Show your own grab ('held'), throw at a frame ('flying', slot) or throw away ('tossing') now, before the server
 *  confirms it. */
export function guessMode(id: number, mode: 'held' | 'flying' | 'tossing', slot: number): boolean {
  const e = entities.get(id)
  if (e === undefined || !cs.myAddress) return false
  const data = CubeData.getMutable(e)
  const tr = Transform.getMutable(e)
  const base = guesses.get(id)?.base ?? { mode: data.mode, slot: data.slot, holder: data.holder, pos: Vector3.create(tr.position.x, tr.position.y, tr.position.z), rot: tr.rotation }
  guesses.set(id, { mode, slot, left: C.GUESS_CONFIRM_SECONDS + (mode === 'tossing' ? C.TOSS_SHOW_SECONDS : 0), age: 0, base })
  data.mode = mode
  data.slot = slot
  data.holder = cs.myAddress
  // the real cube goes where the server will park it (cubes.ts draws a copy in your hands or in flight)
  tr.position = Vector3.create(tr.position.x, C.GUESS_PARK_Y, tr.position.z)
  targets.delete(id)
  return true
}

/** The local cube entity of an id in your game. */
export const cubeEntity = (id: number): Entity | undefined => entities.get(id)

/** The id of the cube in your hands (guessed or confirmed), -1 if none. */
export function myHeldCubeId(): number {
  for (const [id, e] of entities) {
    const d = CubeData.get(e)
    if (d.mode === 'held' && d.holder === cs.myAddress) return id
  }
  return -1
}

/** True once for a cube whose guess was just given up (no throw animation for a grab that never happened). */
export function takeUndone(id: number): boolean {
  return undone.delete(id)
}

/** A state record for a guessed cube: true when it should not overwrite the guess. */
function keepsGuess(id: number, mode: string, slot: number, holder: string, t: Target): boolean {
  const g = guesses.get(id)
  if (!g) return false
  if (mode === g.mode && slot === g.slot && holder === cs.myAddress) {
    guesses.delete(id) // confirmed
    return false
  }
  // thrown away: the server's cube is free now; yours keeps flying a moment, then glides over to it (cubeNetSystem)
  if (g.mode === 'tossing' && mode === 'free') {
    g.landed = t
    return true
  }
  // you threw it before your grab's confirmation came back: that one is now the state to fall back to
  if ((g.mode === 'flying' || g.mode === 'tossing') && mode === 'held' && holder === cs.myAddress) {
    g.base = { mode, slot, holder, pos: t.pos, rot: rot(t.yaw) }
    return true
  }
  guesses.delete(id) // anything else: the server's state replaces the guess
  return false
}

function at(o: Vector3, d: number[], i: number): Target {
  return {
    pos: Vector3.create(o.x + unpackPos(d[i]), o.y + unpackPos(d[i + 1]), o.z + unpackPos(d[i + 2])),
    yaw: unpackYawDeg(d[i + 3])
  }
}

function applyState(o: Vector3, born: number, holders: string[], d: number[]) {
  for (let i = 0; i + STATE_FIELDS <= d.length; i += STATE_FIELDS) {
    const id = d[i]
    const letter = unpackLetter(d[i + 1])
    const { mode, fresh } = unpackMode(d[i + 2])
    const slot = d[i + 3]
    const holder = d[i + 4] >= 0 ? holders[d[i + 4]] ?? '' : ''
    const t = at(o, d, i + 5)
    fullSet?.add(id)
    if (keepsGuess(id, mode, slot, holder, t)) continue
    let e = entities.get(id)
    if (e === undefined) {
      e = engine.addEntity()
      Transform.create(e, { position: t.pos, rotation: rot(t.yaw), scale: Vector3.scale(Vector3.One(), C.CUBE_SCALE) })
      CubeData.create(e, { game, id, letter, mode, slot, holder, born: fresh ? born : 0 })
      entities.set(id, e)
    } else {
      const data = CubeData.getMutable(e)
      data.mode = mode
      data.slot = slot
      data.holder = holder
      if (fresh) data.born = born
      // a mode change jumps: the cube leaves the pile for a hand or a frame, or drops back into it
      const tr = Transform.getMutable(e)
      tr.position = t.pos
      tr.rotation = rot(t.yaw)
    }
    targets.set(id, t)
  }
}

function applyMoves(o: Vector3, d: number[]) {
  for (let i = 0; i + MOVE_FIELDS <= d.length; i += MOVE_FIELDS) {
    if (!entities.has(d[i])) continue
    const g = guesses.get(d[i])
    if (g) {
      if (g.landed) g.landed = at(o, d, i + 1) // a thrown-away cube: where the server's one is now
      continue // a guessed cube waits for the server's state
    }
    targets.set(d[i], at(o, d, i + 1))
  }
}

export function setupCubeNet() {
  room.onMessage('cubeState', (m) => {
    if (m.g !== cs.game || m.g !== game) return
    if (m.full === 1) {
      if (!fullSet) fullSet = new Set()
      applyState(m.o, Number(m.born), m.holders ? m.holders.split(',') : [], m.d)
      if (m.end === 1) {
        for (const id of Array.from(entities.keys())) if (!fullSet.has(id)) remove(id)
        fullSet = null
        lastSeq = m.s
        wantSync = false
        cubeNetStats.fulls++
      }
      return
    }
    cubeNetStats.states++
    for (const id of m.gone) remove(id)
    applyState(m.o, Number(m.born), m.holders ? m.holders.split(',') : [], m.d)
    if (lastSeq >= 0 && m.s !== lastSeq + 1) {
      wantSync = true // missed one: ask for the lot
      cubeNetStats.gaps++
    }
    if (lastSeq >= 0) lastSeq = m.s
  })

  room.onMessage('cubeMoves', (m) => {
    if (m.g !== cs.game || m.g !== game) return
    if (lastSeq >= 0 && m.s !== lastSeq && !wantSync) {
      wantSync = true // a cubeState went missing
      cubeNetStats.gaps++
    }
    const now = Date.now()
    if (cubeNetStats.lastMoveAt > 0) cubeNetStats.moveGap = now - cubeNetStats.lastMoveAt
    cubeNetStats.lastMoveAt = now
    cubeNetStats.moves++
    applyMoves(m.o, m.d)
  })
}

/** Run before cubesSystem: follow the game you sit in, ask for its cubes when needed, glide them to their targets. */
export function cubeNetSystem(dt: number) {
  if (cs.game !== game) {
    clear()
    game = cs.game
    lastSeq = -1
    wantSync = game >= 0
    sinceAsk = Infinity
  }
  if (game < 0) return

  // guesses the server never confirmed: back to its state
  for (const [id, g] of Array.from(guesses.entries())) {
    g.left -= dt
    g.age += dt
    if (g.landed && g.age >= C.TOSS_SHOW_SECONDS) {
      // hand over to the server's cube: cubes.ts puts the real cube where your copy is, and it glides to the server's spot
      guesses.delete(id)
      const e = entities.get(id)
      if (e === undefined) continue
      const data = CubeData.getMutable(e)
      data.mode = 'free'
      data.slot = -1
      data.holder = ''
      targets.set(id, g.landed)
      continue
    }
    if (g.left > 0) continue
    guesses.delete(id)
    const e = entities.get(id)
    if (e === undefined) continue
    const data = CubeData.getMutable(e)
    if (data.mode === 'held' && g.base.mode === 'free') undone.add(id)
    data.mode = g.base.mode
    data.slot = g.base.slot
    data.holder = g.base.holder
    const tr = Transform.getMutable(e)
    tr.position = g.base.pos
    tr.rotation = g.base.rot
  }

  sinceAsk += dt
  if ((wantSync || lastSeq < 0) && sinceAsk >= C.CUBE_SYNC_COOLDOWN) {
    sinceAsk = 0
    cubeNetStats.syncAsks++
    room.send('cubeSync', { game })
  }

  const k = Math.min(1, dt * C.CUBE_SMOOTH_RATE)
  for (const [id, t] of targets) {
    const e = entities.get(id)
    if (e === undefined) continue
    const tr = Transform.getMutable(e)
    const p = tr.position
    const dx = t.pos.x - p.x
    const dy = t.pos.y - p.y
    const dz = t.pos.z - p.z
    if (dx * dx + dy * dy + dz * dz > C.CUBE_SNAP_DISTANCE ** 2 || CubeData.get(e).mode !== 'free') {
      tr.position = t.pos
      tr.rotation = rot(t.yaw)
      targets.delete(id)
      continue
    }
    tr.position = Vector3.create(p.x + dx * k, p.y + dy * k, p.z + dz * k)
    tr.rotation = Quaternion.slerp(tr.rotation, rot(t.yaw), k)
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 0.002) {
      tr.position = t.pos
      tr.rotation = rot(t.yaw)
      targets.delete(id) // arrived
    }
  }
}
