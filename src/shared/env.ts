import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import * as C from '../config'

// Everything gameplay-related (floor, walls, answer platform, slots, cube spawn) is positioned relative to a game's
// arena origin. Game 0 is the "GameEnv" entity in the composite; the other games' arenas are the same layout shifted by
// GAME_OFFSETS (the clients build their models on demand). Move GameEnv in the Creator Hub and every arena follows.
const FALLBACK = Vector3.create(56.5, 160, 60.5)

export function templateOrigin(): Vector3 {
  const e = engine.getEntityOrNullByName(C.ARENA_TEMPLATE)
  const t = e ? Transform.getOrNull(e) : null
  return t ? Vector3.create(t.position.x, t.position.y, t.position.z) : FALLBACK
}

export function envOrigin(game = 0): Vector3 {
  const o = templateOrigin()
  const off = C.GAME_OFFSETS[game] ?? C.GAME_OFFSETS[0]
  return Vector3.create(o.x + off[0], o.y + off[1], o.z + off[2])
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
