import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { EntityNames } from '../../assets/scene/entity-names'

// Everything gameplay-related (floor, walls, answer platform, slots, cube spawn) is positioned relative to the
// "GameEnv" entity in the composite. Move that entity in the Creator Hub and the whole game follows.
const FALLBACK = Vector3.create(56.5, 8, 60.5)

export function envOrigin(): Vector3 {
  const e = engine.getEntityOrNullByName(EntityNames.GameEnv)
  const t = e ? Transform.getOrNull(e) : null
  return t ? Vector3.create(t.position.x, t.position.y, t.position.z) : FALLBACK
}
