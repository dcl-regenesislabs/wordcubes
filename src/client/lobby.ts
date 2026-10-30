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
import { envOrigin, arenaAt } from '../shared/env'
import { room } from '../shared/messages'
import { cs, showMessage } from './state'
import { stateOf } from './gamestate'
import { arenaReady, requestArena } from './arenas'

const SCALE_STIFFNESS = 90
const SCALE_DAMPING = 9 // under-damped: the lights overshoot a little and settle (soft bounce)
const SPIN_EASE = 2
const TELEPORT_LOCKOUT = 4 // s after teleporting before the pad can start another countdown

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

let padPos = Vector3.Zero() // the first pad: the lobby NPCs and the fall respawn face it
let fallGrace = 0

const flat = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)

function teleportToGame(game: number) {
  const o = envOrigin(game)
  const a = Math.random() * Math.PI * 2
  const x = o.x + Math.cos(a) * C.GAME_SPAWN_RADIUS
  const z = o.z + Math.sin(a) * C.GAME_SPAWN_RADIUS
  movePlayerTo({
    newRelativePosition: Vector3.create(x, o.y + C.FLOOR_Y + 0.5, z),
    cameraTarget: Vector3.create(o.x, o.y + 1.5, o.z)
  })
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

/** Tell the server you left (it frees the seat) and say so on screen. */
function leaveGame(game: number) {
  room.send('leave', { n: 0 })
  if (game >= 0) showMessage(`You left game ${game + 1}`, 3)
}

/** Button in the game HUD: back to the lobby island. Gives your seat up so someone else can take it. */
export function returnToLobby() {
  const origin = lobbyOrigin()
  if (!origin) return
  fallGrace = TELEPORT_LOCKOUT
  pendingTeleport = undefined
  if (cs.game >= 0) leaveGame(cs.game)
  cs.game = -1
  cs.inGame = false
  teleportToLobby(origin, padPos)
}

let waitingFor = -1 // the game a seat was requested for, until the server answers
let waitTimer = 0

/** The server's answer to 'enter': teleport into the game, or tell the player it is full. */
export function onEntered(game: number, ok: boolean) {
  if (waitingFor !== game) return
  waitingFor = -1
  if (!ok) {
    showMessage(`Game ${game + 1} is full. Try another pad.`, 3)
    return
  }
  // The arena models are built on the spot: teleport once its floor and walls have loaded, or give up waiting
  cs.game = game
  requestArena(game)
  pendingTeleport = { game, left: C.ARENA_LOAD_TIMEOUT }
  showMessage(`Preparing game ${game + 1}...`, 4)
}

let pendingTeleport: { game: number; left: number } | undefined

/** The server found you in an arena without a seat. */
export function onEjected() {
  if (waitingFor >= 0 || pendingTeleport) return // a seat was just requested: the answer is on its way
  const origin = lobbyOrigin()
  if (!origin) return
  fallGrace = TELEPORT_LOCKOUT
  cs.game = -1
  cs.inGame = false
  teleportToLobby(origin, padPos)
  showMessage('That game is full or not yours. Pick a pad in the lobby.', 3)
}

interface PadView {
  game: number
  entity: Entity | undefined
  pos: Vector3
  lights: Entity | undefined
  baseScale: Vector3
  label: Entity
  info: Entity
  labelShown: number
  size: number // spring: 0 hidden, 1 shown
  sizeV: number
  tall: number
  tallV: number
  spin: number
  angle: number
}

function makeText(text: string, fontSize: number, color: Color4): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.Zero(), scale: Vector3.Zero() })
  TextShape.create(e, {
    text,
    fontSize,
    textColor: color,
    outlineColor: Color4.create(0.1, 0.1, 0.1, 1),
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(e, { billboardMode: BillboardMode.BM_Y })
  return e
}

/** What the small line under a pad says about its game. */
function padInfo(game: number): string {
  const g = stateOf(game)
  if (!g || g.active === 0 || g.players === 0) return 'Empty  -  start a game'
  const full = g.players >= C.MAX_PLAYERS_PER_GAME
  return `Level ${g.difficulty}  -  ${g.players}/${C.MAX_PLAYERS_PER_GAME}${full ? '  FULL' : ''}`
}

/**
 * The lobby start pads, client only. There is one pad per game. Standing on one starts a 10 second countdown, then the
 * server gives you a seat (at most MAX_PLAYERS_PER_GAME per game) and you are teleported into that game's arena;
 * stepping off cancels it. The lights over a pad (StartPadLight.glb) pop up while anyone is on it, spin faster as your
 * countdown runs out and stretch for the final 3-2-1.
 */
export function setupLobby() {
  const pads: PadView[] = []
  for (let game = 0; game < C.GAME_COUNT; game++) {
    pads.push({
      game,
      entity: undefined,
      pos: Vector3.Zero(),
      lights: undefined,
      baseScale: Vector3.One(),
      // Floating "Join game" text over the pad, always facing the player, bobbing gently
      label: makeText(`GAME ${game + 1}`, 6, Color4.White()),
      // Smaller line under it: the game's level and how many are playing
      info: makeText('', 3, Color4.create(1, 0.95, 0.6, 1)),
      labelShown: 0,
      size: 0,
      sizeV: 0,
      tall: 0,
      tallV: 0,
      spin: 0,
      angle: 0
    })
  }
  let time = 0

  let onPad = -1 // the pad you stand on
  let counting = false
  let timer = 0
  let lockout = 0

  engine.addSystem((dt: number) => {
    let ready = false
    for (const pad of pads) {
      if (pad.entity === undefined) {
        const e = engine.getEntityOrNullByName(C.LOBBY_PAD_NAMES[pad.game]) ?? undefined
        if (e === undefined || !Transform.getOrNull(e)) continue
        pad.entity = e
        pad.pos = worldPosition(e)
        if (pad.game === 0) padPos = pad.pos
        // The lights are created here (not in the editor) so the Creator Hub can't drop them. Same size as the pad.
        const pt = Transform.get(e)
        pad.baseScale = Vector3.create(pt.scale.x, pt.scale.y, pt.scale.z)
        pad.lights = engine.addEntity()
        Transform.create(pad.lights, { position: pad.pos, scale: Vector3.create(pad.baseScale.x, 0, pad.baseScale.z) })
        GltfContainer.create(pad.lights, {
          src: C.LOBBY_LIGHTS_MODEL,
          visibleMeshesCollisionMask: 0,
          invisibleMeshesCollisionMask: 0
        })
      }
      ready = true
    }
    if (!ready) return

    const onPadNow = (pad: PadView, p: Vector3, leaving: boolean) =>
      pad.entity !== undefined &&
      Math.abs(p.y - pad.pos.y) < C.PAD_HEIGHT_RANGE &&
      flat(p, pad.pos) <= C.PAD_RADIUS + (leaving ? C.PAD_LEAVE_MARGIN : 0)

    // Anyone on a pad lights it up (remote avatars included); only you start your own countdown
    const lit = new Set<number>()
    for (const [entity] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
      const p = Transform.get(entity).position
      for (const pad of pads) if (onPadNow(pad, p, false)) lit.add(pad.game)
    }
    const me = Transform.getOrNull(engine.PlayerEntity)?.position
    const before = onPad
    onPad = -1
    if (me) for (const pad of pads) if (onPadNow(pad, me, before === pad.game)) onPad = pad.game
    if (onPad >= 0) lit.add(onPad)

    // Falling off the floating islands sends you back to where you came from (your game if you were in it, else the lobby)
    if (fallGrace > 0) fallGrace -= dt
    const origin = lobbyOrigin()
    const home = Math.max(0, cs.game)
    const env = envOrigin(home)
    if (me && origin && fallGrace <= 0) {
      const floorY = Math.min(origin.y, env.y + C.FLOOR_Y)
      if (me.y < floorY - C.FALL_RESPAWN_DEPTH) {
        fallGrace = TELEPORT_LOCKOUT
        if (cs.inGame && cs.game >= 0) teleportToGame(cs.game)
        else teleportToLobby(origin, padPos)
      } else if (!pendingTeleport && flat(me, origin) < C.LOBBY_RADIUS && Math.abs(me.y - origin.y) < C.PAD_HEIGHT_RANGE * 3) {
        if (cs.game >= 0 || cs.inGame) leaveGame(cs.game)
        cs.game = -1
        cs.inGame = false
      } else if (cs.game >= 0 && arenaAt(me.x, me.y, me.z) === cs.game) {
        cs.inGame = true
      }
    }

    if (pendingTeleport) {
      pendingTeleport.left -= dt
      if (arenaReady(pendingTeleport.game) || pendingTeleport.left <= 0) {
        const game = pendingTeleport.game
        pendingTeleport = undefined
        fallGrace = TELEPORT_LOCKOUT
        cs.inGame = true
        teleportToGame(game)
      }
    }

    // Countdown
    if (waitingFor >= 0) {
      waitTimer -= dt
      if (waitTimer <= 0) {
        waitingFor = -1 // no answer: let the player try again
        showMessage('The game server did not answer. Is the multiplayer server running? Try again.', 4)
      }
    }
    if (lockout > 0) lockout -= dt
    if (onPad >= 0 && lockout <= 0 && waitingFor < 0 && !pendingTeleport) {
      if (!counting) {
        counting = true
        timer = C.LOBBY_COUNTDOWN_SECONDS
      }
      timer -= dt
      if (timer <= 0) {
        counting = false
        const game = onPad
        const g = stateOf(game)
        if (g && g.active !== 0 && g.players >= C.MAX_PLAYERS_PER_GAME) {
          lockout = 2
          showMessage(`Game ${game + 1} is full. Try another pad.`, 3)
        } else {
          // the server decides (seats can be taken a moment before this reaches us); we teleport when it says yes
          waitingFor = game
          waitTimer = 4
          lockout = TELEPORT_LOCKOUT
          showMessage(`Joining game ${game + 1}...`, 4)
          room.send('enter', { game })
        }
      }
    } else {
      counting = false
    }
    cs.lobbyCountdown = counting ? Math.max(1, Math.ceil(timer)) : 0

    time += dt
    for (const pad of pads) {
      if (!pad.entity || !pad.lights) continue
      const mine = onPad === pad.game
      // Floating label: hidden while you stand on the pad or after you left for the game
      const labelTarget = !mine && !cs.inGame && waitingFor < 0 ? 1 : 0
      pad.labelShown += (labelTarget - pad.labelShown) * Math.min(1, 4 * dt)
      const lt = Transform.getMutable(pad.label)
      const ls = pad.labelShown < 0.02 ? 0 : pad.labelShown
      lt.position = Vector3.create(pad.pos.x, pad.pos.y + C.PAD_LABEL_HEIGHT + Math.sin(time * 2 + pad.game) * 0.2, pad.pos.z)
      lt.scale = Vector3.create(ls, ls, ls)

      const roomText = padInfo(pad.game)
      const ts = TextShape.getMutable(pad.info)
      if (ts.text !== roomText) ts.text = roomText
      const it = Transform.getMutable(pad.info)
      it.position = Vector3.create(pad.pos.x, lt.position.y - 1.6, pad.pos.z)
      it.scale = Vector3.create(ls, ls, ls)

      // Lights
      const anyone = lit.has(pad.game)
      const counting_ = mine && counting
      const finalSeconds = counting_ && timer <= 3
      const sizeTarget = anyone && (!mine || lockout <= 0) ? 1 : 0
      const tallTarget = finalSeconds ? 1 : 0
      const progress = counting_ ? Math.min(1, Math.max(0, 1 - timer / C.LOBBY_COUNTDOWN_SECONDS)) : 0
      const spinTarget =
        C.LOBBY_LIGHTS_SPIN_SLOW + (C.LOBBY_LIGHTS_SPIN_FAST - C.LOBBY_LIGHTS_SPIN_SLOW) * progress * progress
      pad.spin += ((sizeTarget ? spinTarget : 0) - pad.spin) * Math.min(1, SPIN_EASE * dt)
      pad.angle = (pad.angle + pad.spin * dt) % 360

      const steps = Math.max(1, Math.ceil(dt / 0.016))
      const h = dt / steps
      for (let i = 0; i < steps; i++) {
        pad.sizeV += ((sizeTarget - pad.size) * SCALE_STIFFNESS - pad.sizeV * SCALE_DAMPING) * h
        pad.size += pad.sizeV * h
        pad.tallV += ((tallTarget - pad.tall) * SCALE_STIFFNESS - pad.tallV * SCALE_DAMPING) * h
        pad.tall += pad.tallV * h
      }

      const t = Transform.getMutable(pad.lights)
      const sc = Math.max(0, pad.size)
      // Appearing and disappearing is vertical only: width and depth stay put
      const stretch = 1 + (C.LOBBY_LIGHTS_TALL - 1) * pad.tall
      t.scale =
        sc < 0.001 && sizeTarget === 0
          ? Vector3.create(pad.baseScale.x, 0, pad.baseScale.z)
          : Vector3.create(pad.baseScale.x, pad.baseScale.y * sc * stretch, pad.baseScale.z)
      t.rotation = Quaternion.fromEulerDegrees(0, pad.angle, 0)
    }
  })
}
