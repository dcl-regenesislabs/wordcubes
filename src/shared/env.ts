import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import * as C from '../config'

// Everything gameplay-related (floor, walls, answer platform, slots, cube spawn) is positioned relative to a game's
// "GameEnv" entity in the composite (GameEnv, GameEnv_2, ... see GAME_ENV_NAMES). Move one in the Creator Hub and that
// whole game follows.
const FALLBACK_FIRST = Vector3.create(56.5, 160, 60.5)

export function envOrigin(game = 0): Vector3 {
  const e = engine.getEntityOrNullByName(C.GAME_ENV_NAMES[game] ?? C.GAME_ENV_NAMES[0])
  const t = e ? Transform.getOrNull(e) : null
  if (t) return Vector3.create(t.position.x, t.position.y, t.position.z)
  // missing arena: stack the fallbacks 100 m apart so games never share a floor
  return Vector3.create(FALLBACK_FIRST.x, FALLBACK_FIRST.y, FALLBACK_FIRST.z + 100 * game)
}

/** Which game's arena a point is standing in (inside the walls and not far below the floor), or -1. */
export function arenaAt(x: number, y: number, z: number): number {
  for (let g = 0; g < C.GAME_COUNT; g++) {
    const o = envOrigin(g)
    const dx = x - o.x
    const dz = z - o.z
    if (dx * dx + dz * dz < (C.ARENA_RADIUS + 4) ** 2 && y > o.y - 2) return g
  }
  return -1
}
