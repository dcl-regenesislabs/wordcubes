// The synced GameState entities, one per game. Everything the client shows about "the game" is the state of cs.game.
import { engine } from '@dcl/sdk/ecs'
import { GameState } from '../shared/schemas'
import { cs } from './state'

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
