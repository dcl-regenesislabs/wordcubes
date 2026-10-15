import {
  Billboard,
  BillboardMode,
  engine,
  Entity,
  GltfContainer,
  PlayerIdentityData,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import * as C from '../config'
import { envOrigin } from '../shared/env'
import { cs } from './state'

const SCALE_STIFFNESS = 90
const SCALE_DAMPING = 9 // under-damped: the lights overshoot a little and settle (soft bounce)
const SPIN_EASE = 2
const TELEPORT_LOCKOUT = 4 // s after teleporting before the pad can start another countdown

/** World position of an entity, following its parent chain (the pad is a child of "Lobby"). */
function worldPosition(entity: Entity): Vector3 {
  const t = Transform.get(entity)
  let pos = Vector3.create(t.position.x, t.position.y, t.position.z)
  let parent = t.parent
  while (parent !== undefined && parent !== engine.RootEntity) {
    const pt = Transform.getOrNull(parent)
    if (!pt) break
    pos = Vector3.add(pt.position, Vector3.rotate(Vector3.multiply(pos, pt.scale), pt.rotation))
    parent = pt.parent
  }
  return pos
}

let padPos = Vector3.Zero()
let fallGrace = 0

const flat = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)

function teleportToGame() {
  const o = envOrigin()
  const a = Math.random() * Math.PI * 2
  const x = o.x + Math.cos(a) * C.GAME_SPAWN_RADIUS
  const z = o.z + Math.sin(a) * C.GAME_SPAWN_RADIUS
  movePlayerTo({
    newRelativePosition: Vector3.create(x, o.y + C.FLOOR_Y + 0.5, z),
    cameraTarget: Vector3.create(o.x, o.y + 1.5, o.z)
  })
}

function lobbyOrigin(): Vector3 | undefined {
  const e = engine.getEntityOrNullByName(C.LOBBY_ENTITY_NAME)
  return e !== null && Transform.getOrNull(e) ? worldPosition(e) : undefined
}

function teleportToLobby(origin: Vector3, lookAt: Vector3) {
  movePlayerTo({
    newRelativePosition: Vector3.create(origin.x, origin.y + C.LOBBY_RESPAWN_HEIGHT, origin.z),
    cameraTarget: Vector3.create(lookAt.x, origin.y + C.LOBBY_RESPAWN_HEIGHT, lookAt.z)
  })
}

/** Button in the game HUD: back to the lobby island. */
export function returnToLobby() {
  const origin = lobbyOrigin()
  if (!origin) return
  fallGrace = TELEPORT_LOCKOUT
  cs.inGame = false
  teleportToLobby(origin, padPos)
}

/**
 * The lobby start pad, client only. Standing on it starts a 10 second countdown and then teleports you into the game;
 * stepping off cancels it. The lights over the pad (StartPadLight.glb) pop up while anyone is on the pad, spin faster
 * as your countdown runs out and stretch for the final 3-2-1.
 */
export function setupLobby() {
  let pad: Entity | undefined
  let lights: Entity | undefined
  let baseScale = Vector3.One()
  let baseRotation = Quaternion.Identity()

  // Floating "Join game" text over the pad, always facing the player, bobbing gently
  const label = engine.addEntity()
  Transform.create(label, { position: Vector3.Zero(), scale: Vector3.Zero() })
  TextShape.create(label, {
    text: 'JOIN GAME',
    fontSize: 6,
    textColor: Color4.White(),
    outlineColor: Color4.create(0.1, 0.1, 0.1, 1),
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
  let labelShown = 0
  let time = 0

  let onPad = false
  let counting = false
  let timer = 0
  let lockout = 0

  let size = 0 // spring: 0 hidden, 1 shown
  let sizeV = 0
  let tall = 0
  let tallV = 0
  let spin = 0
  let angle = 0

  engine.addSystem((dt: number) => {
    if (pad === undefined) {
      pad = engine.getEntityOrNullByName(C.LOBBY_PAD_NAME) ?? undefined
      if (pad === undefined || !Transform.getOrNull(pad)) {
        pad = undefined
        return
      }
      padPos = worldPosition(pad)
      // The lights are created here (not in the editor) so the Creator Hub can't drop them. Same size as the pad.
      const pt = Transform.get(pad)
      baseScale = Vector3.create(pt.scale.x, pt.scale.y, pt.scale.z)
      baseRotation = Quaternion.Identity()
      lights = engine.addEntity()
      Transform.create(lights, { position: padPos, scale: Vector3.create(baseScale.x, 0, baseScale.z) })
      GltfContainer.create(lights, {
        src: C.LOBBY_LIGHTS_MODEL,
        visibleMeshesCollisionMask: 0,
        invisibleMeshesCollisionMask: 0
      })
    }
    if (lights === undefined) return

    const onPadNow = (p: Vector3, leaving: boolean) =>
      Math.abs(p.y - padPos.y) < C.PAD_HEIGHT_RANGE &&
      flat(p, padPos) <= C.PAD_RADIUS + (leaving ? C.PAD_LEAVE_MARGIN : 0)

    // Anyone on the pad lights it up (remote avatars included); only you start your own countdown
    let anyone = false
    for (const [entity] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
      if (onPadNow(Transform.get(entity).position, false)) {
        anyone = true
        break
      }
    }
    const me = Transform.getOrNull(engine.PlayerEntity)?.position
    onPad = me !== undefined && onPadNow(me, onPad)
    if (onPad) anyone = true

    // Falling off the floating islands sends you back to where you came from (the game if you were in it, else the lobby)
    if (fallGrace > 0) fallGrace -= dt
    const origin = lobbyOrigin()
    const env = envOrigin()
    if (me && origin && fallGrace <= 0) {
      const floorY = Math.min(origin.y, env.y + C.FLOOR_Y)
      if (me.y < floorY - C.FALL_RESPAWN_DEPTH) {
        fallGrace = TELEPORT_LOCKOUT
        if (cs.inGame) teleportToGame()
        else teleportToLobby(origin, padPos)
      } else if (flat(me, origin) < C.LOBBY_RADIUS && Math.abs(me.y - origin.y) < C.PAD_HEIGHT_RANGE * 3) {
        cs.inGame = false
      } else if (flat(me, env) < C.ARENA_RADIUS + 4 && me.y > env.y - 2) {
        cs.inGame = true
      }
    }

    // Countdown
    if (lockout > 0) lockout -= dt
    if (onPad && lockout <= 0) {
      if (!counting) {
        counting = true
        timer = C.LOBBY_COUNTDOWN_SECONDS
      }
      timer -= dt
      if (timer <= 0) {
        counting = false
        lockout = TELEPORT_LOCKOUT
        fallGrace = TELEPORT_LOCKOUT
        cs.inGame = true
        teleportToGame()
      }
    } else {
      counting = false
    }
    cs.lobbyCountdown = counting ? Math.max(1, Math.ceil(timer)) : 0

    // Floating label: hidden while you stand on the pad or after you left for the game
    time += dt
    const labelTarget = !onPad && lockout <= 0 && !cs.inGame ? 1 : 0
    labelShown += (labelTarget - labelShown) * Math.min(1, 4 * dt)
    const lt = Transform.getMutable(label)
    const ls = labelShown < 0.02 ? 0 : labelShown
    lt.position = Vector3.create(padPos.x, padPos.y + C.PAD_LABEL_HEIGHT + Math.sin(time * 2) * 0.2, padPos.z)
    lt.scale = Vector3.create(ls, ls, ls)

    // Lights
    const finalSeconds = counting && timer <= 3
    const sizeTarget = anyone && lockout <= 0 ? 1 : 0
    const tallTarget = finalSeconds ? 1 : 0
    const progress = counting ? Math.min(1, Math.max(0, 1 - timer / C.LOBBY_COUNTDOWN_SECONDS)) : 0
    const spinTarget =
      C.LOBBY_LIGHTS_SPIN_SLOW + (C.LOBBY_LIGHTS_SPIN_FAST - C.LOBBY_LIGHTS_SPIN_SLOW) * progress * progress
    spin += ((anyone && lockout <= 0 ? spinTarget : 0) - spin) * Math.min(1, SPIN_EASE * dt)
    angle = (angle + spin * dt) % 360

    const steps = Math.max(1, Math.ceil(dt / 0.016))
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      sizeV += ((sizeTarget - size) * SCALE_STIFFNESS - sizeV * SCALE_DAMPING) * h
      size += sizeV * h
      tallV += ((tallTarget - tall) * SCALE_STIFFNESS - tallV * SCALE_DAMPING) * h
      tall += tallV * h
    }

    const t = Transform.getMutable(lights)
    const s = Math.max(0, size)
    // Appearing and disappearing is vertical only: width and depth stay put
    const stretch = 1 + (C.LOBBY_LIGHTS_TALL - 1) * tall
    t.scale =
      s < 0.001 && sizeTarget === 0
        ? Vector3.create(baseScale.x, 0, baseScale.z)
        : Vector3.create(baseScale.x, baseScale.y * s * stretch, baseScale.z)
    t.rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, angle, 0), baseRotation)
  })
}
