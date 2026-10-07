// The cube-pile world parameters, shared by the server's authoritative sim and the client's local push prediction
// so both run exactly the same physics.
import * as C from '../config'
import type { WorldParams } from '../sim/physics'

export function worldParams(): WorldParams {
  return {
    centerX: C.CENTER.x,
    centerZ: C.CENTER.z,
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
