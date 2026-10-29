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
import { isStateSyncronized } from '@dcl/sdk/network'
import { movePlayerTo } from '~system/RestrictedActions'
import * as C from '../config'
import { envOrigin } from '../shared/env'
import { room } from '../shared/messages'
import { GameState } from '../shared/schemas'
import { cs, showMessage } from './state'

const SCALE_STIFFNESS = 90
const SCALE_DAMPING = 9 // under-damped: the lights overshoot a little and settle (soft bounce)
const SPIN_EASE = 2
const TELEPORT_LOCKOUT = 4 // s after teleporting before the pad can start another countdown

type GameEntry = {
  x: number
  y: number
  z: number
  lookAtX: number
  lookAtY: number
  lookAtZ: number
}

/** World position of an entity, following its parent chain (the pad is a child of "Lobby"). */
export function worldPosition(entity: Entity): Vector3 {
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

function teleportToGameAt(position: Vector3, lookAt: Vector3) {
  movePlayerTo({ newRelativePosition: position, cameraTarget: lookAt })
}

/** Where the lobby island centre and the start pad are, once the scene has loaded (used to place the lobby NPCs). */
export function lobbyAnchors(): { origin: Vector3; pad: Vector3 } | undefined {
  const origin = lobbyOrigin()
  return origin && padPos.x !== 0 ? { origin, pad: padPos } : undefined
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

/** Request the server-owned start flow. The server rechecks that this player is actually on the pad. */
export function startGameFromLobbyPad() {
  if (!isStateSyncronized()) {
    showMessage('Connecting to the game server…', 2)
    return
  }
  room.send('startGame', { n: 0 })
}

/**
 * The lobby start pad displays the server-owned start flow. A player presses START GAME while standing on it; the
 * server snapshots everyone on the pad, sends them the same countdown, and teleports those who remain there. The
 * lights over the pad (StartPadLight.glb) pop up while anyone is on the pad and react to that shared countdown.
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
  // Smaller line under it: the room's difficulty level and how many are playing
  const info = engine.addEntity()
  Transform.create(info, { position: Vector3.Zero(), scale: Vector3.Zero() })
  TextShape.create(info, {
    text: '',
    fontSize: 3,
    textColor: Color4.create(1, 0.95, 0.6, 1),
    outlineColor: Color4.create(0.1, 0.1, 0.1, 1),
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(info, { billboardMode: BillboardMode.BM_Y })
  let labelShown = 0
  let time = 0

  let onPad = false
  let lockout = 0

  let size = 0 // spring: 0 hidden, 1 shown
  let sizeV = 0
  let tall = 0
  let tallV = 0
  let spin = 0
  let angle = 0

  room.onMessage('enterGame', (data: GameEntry) => {
    cs.lobbyCountdown = 0
    lockout = TELEPORT_LOCKOUT
    fallGrace = TELEPORT_LOCKOUT
    cs.inGame = true
    teleportToGameAt(
      Vector3.create(data.x, data.y, data.z),
      Vector3.create(data.lookAtX, data.lookAtY, data.lookAtZ)
    )
  })

  room.onMessage('lobbyCountdown', (data: { seconds: number }) => {
    // Values are never decremented locally: all selected clients render the server's current second.
    cs.lobbyCountdown = data.seconds
  })

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

    // A running room is safe to join at any point: its synchronized GameState and server-owned cubes already
    // describe the current round. The server decides whether a press is a new-game start or a late join.
    let gameInProgress = false
    for (const [, g] of engine.getEntitiesWith(GameState)) {
      gameInProgress = g.players > 0
      break
    }
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

    // The countdown is sent by the server only to the players it selected from the pad. Hide it immediately when
    // stepping off; the server also removes that player from the eventual teleport group.
    if (lockout > 0) lockout -= dt
    if (!onPad || lockout > 0 || cs.inGame) cs.lobbyCountdown = 0
    cs.onStartPad = onPad && lockout <= 0 && !cs.inGame
    cs.lobbyGameInProgress = gameInProgress

    // Floating label: hidden while you stand on the pad or after you left for the game
    time += dt
    const labelTarget = !onPad && lockout <= 0 && !cs.inGame ? 1 : 0
    labelShown += (labelTarget - labelShown) * Math.min(1, 4 * dt)
    const lt = Transform.getMutable(label)
    const ls = labelShown < 0.02 ? 0 : labelShown
    lt.position = Vector3.create(padPos.x, padPos.y + C.PAD_LABEL_HEIGHT + Math.sin(time * 2) * 0.2, padPos.z)
    lt.scale = Vector3.create(ls, ls, ls)
    const labelText = gameInProgress ? 'JOIN IN PROGRESS' : 'START GAME'
    const labelShape = TextShape.getMutable(label)
    if (labelShape.text !== labelText) labelShape.text = labelText

    let roomText = ''
    for (const [, g] of engine.getEntitiesWith(GameState)) {
      roomText = `Level ${g.difficulty}  -  ${g.players} playing`
      break
    }
    const ts = TextShape.getMutable(info)
    if (ts.text !== roomText) ts.text = roomText
    const it = Transform.getMutable(info)
    it.position = Vector3.create(padPos.x, lt.position.y - 1.6, padPos.z)
    it.scale = Vector3.create(ls, ls, ls)

    // Lights
    const countdown = cs.lobbyCountdown
    const finalSeconds = countdown > 0 && countdown <= 3
    const sizeTarget = anyone && lockout <= 0 ? 1 : 0
    const tallTarget = finalSeconds ? 1 : 0
    const progress = countdown > 0 ? Math.min(1, Math.max(0, 1 - countdown / C.LOBBY_COUNTDOWN_SECONDS)) : 0
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
