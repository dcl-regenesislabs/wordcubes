// The synced GameState entities, one per game. Everything the client shows about "the game" is the state of cs.game.
import { engine } from '@dcl/sdk/ecs'
import { GameState } from '../shared/schemas'
import { cs } from './state'
import * as C from '../config'

type State = typeof GameState extends { get(e: never): infer R } ? R : never

export function stateOf(game: number): State | undefined {
  for (const [, g] of engine.getEntitiesWith(GameState)) if (g.game === game) return g
  return undefined
}

/** State of the game you sit in (undefined in the lobby). */
export function myState(): State | undefined {
  return cs.game >= 0 ? stateOf(cs.game) : undefined
}

/** The leaderboard text lives in every game's state; any of them will do. */
export function boardText(): string {
  for (const [, g] of engine.getEntitiesWith(GameState)) return g.board
  return ''
}

// ---- server clock: a freshly settled pile is stamped with server time (CubeData.born) and every client plays its fall
// from that moment. The server writes GameState.heartbeat (its Date.now()) every 2 s; the offset is taken when it
// changes, which is only one trip behind, never from the first value seen, which can be up to 2 s old. ----
let lastBeat = 0
let seenBeats = 0
let offset: number | null = null

/** Call once a frame. */
export function trackServerClock() {
  const beat = Number(myState()?.heartbeat ?? 0)
  if (!beat || beat === lastBeat) return
  lastBeat = beat
  seenBeats++
  if (seenBeats >= 2) offset = beat - Date.now()
}

/** Server time now (ms), or null until it is known. */
export function serverNow(): number | null {
  return offset === null ? null : Date.now() + offset
}

// The fall a client plays for a cube of a fresh pile: a start delay spread over the pile and a drop from the spawn
// heights, both picked from the cube id so they are the same on every client.
const frac = (x: number) => x - Math.floor(x)
export function dropPlan(id: number): { delay: number; height: number; fall: number } {
  const delay = frac(id * 0.618034) * C.DROP_SPREAD
  const height = C.SPAWN_MIN_Y + frac(id * 0.381966 + 0.5) * (C.SPAWN_MAX_Y - C.SPAWN_MIN_Y)
  return { delay, height, fall: Math.sqrt((2 * height) / -C.GRAVITY) }
}

/** Seconds since a fresh pile's cube was born, while its fall is still playing; null otherwise (not fresh, or done). */
export function dropAge(id: number, born: number): number | null {
  const now = serverNow()
  if (!born || now === null) return null
  const age = (now - Number(born)) / 1000
  const plan = dropPlan(id)
  return age >= 0 && age < plan.delay + plan.fall ? age : null
}
