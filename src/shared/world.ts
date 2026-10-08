// The cube-pile world parameters, shared by the server's authoritative sim and the client's local push prediction
// so both run exactly the same physics.
import * as C from '../config'
import type { WorldParams } from '../sim/physics'
import { envOrigin } from './env'

/** Params with positions local to GameEnv (centre 0,0, floor y = FLOOR_Y). Call syncEnvParams() before stepping. */
export function worldParams(): WorldParams {
  return {
    centerX: 0,
    centerZ: 0,
    arenaRadius: C.ARENA_RADIUS,
    floorY: C.FLOOR_Y,
    stageRadius: C.STAGE_RADIUS,
    stageTop: C.STAGE_TOP,
    stageUpperRadius: C.STAGE_UPPER_RADIUS,
    stageUpperTop: C.STAGE_UPPER_TOP,
    cubeRadius: C.CUBE_RADIUS,
    cubeHalf: C.CUBE_HALF,
    gravity: C.GRAVITY,
    restitution: C.RESTITUTION,
    floorFriction: C.FLOOR_FRICTION,
    airDrag: C.AIR_DRAG,
    pusherRadius: C.PLAYER_RADIUS,
    pusherHeight: C.PLAYER_HEIGHT
  }
}

/** Move the params onto the GameEnv entity (re-read every tick, so moving GameEnv in the editor moves the sim). */
export function syncEnvParams(p: WorldParams): void {
  const o = envOrigin()
  p.centerX = o.x
  p.centerZ = o.z
  p.floorY = o.y + C.FLOOR_Y
  p.stageTop = o.y + C.STAGE_TOP
  p.stageUpperTop = o.y + C.STAGE_UPPER_TOP
}
