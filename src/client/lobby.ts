import {
  Billboard,
  BillboardMode,
  engine,
  Entity,
  GltfContainer,
  Material,
  MaterialTransparencyMode,
  MeshRenderer,
  PlayerIdentityData,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import * as C from '../config'
import { isLang, LANG_NAMES, type Lang } from '../shared/lang'
import { t, uiLang } from './i18n'
import { FLAG_ATLAS, planeFlagUvs, flagAspect } from './ui/flags'
import { envOrigin, arenaAt } from '../shared/env'
import { room } from '../shared/messages'
import { cs, showMessage } from './state'
import { SFX, playSfx } from './audio'
import { BLOCK } from './ui/theme'
import { stateOf, serverNow } from './gamestate'
import { arenaReady, requestArena } from './arenas'
import { PRACTICE_GAME } from '../shared/tutorial'
import { startLocalPractice, stopLocalPractice } from './practice'

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
  if (game === PRACTICE_GAME) {
    void movePlayerTo({ newRelativePosition: Vector3.create(o.x - 5, o.y + C.FLOOR_Y + 0.5, o.z - 9), cameraTarget: Vector3.create(o.x, o.y + C.SLOT_Y, o.z) })
    return
  }
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
  if (game >= 0) showMessage(t('lobby.left', { n: game + 1 }), 3)
}

/** Button in the game HUD: back to the lobby island. Gives your seat up so someone else can take it. */
export function returnToLobby() {
  const origin = lobbyOrigin()
  if (!origin) return
  fallGrace = TELEPORT_LOCKOUT
  pendingTeleport = undefined
  if (cs.game === PRACTICE_GAME) stopLocalPractice()
  else if (cs.game >= 0 || waitingFor >= 0) leaveGame(cs.game)
  waitingFor = -1
  waitTimer = 0
  cs.game = -1
  cs.inGame = false
  teleportToLobby(origin, padPos)
  playSfx(SFX.teleport)
}

let waitingFor = -1 // the game a seat was requested for, until the server answers
let waitTimer = 0

export function requestPractice(lang: Lang) {
  startLocalPractice(lang)
  requestArena(PRACTICE_GAME)
  pendingTeleport = { game: PRACTICE_GAME, left: C.ARENA_LOAD_TIMEOUT }
  playSfx(SFX.teleport)
}

/** The server's answer to 'enter': teleport into the game, or tell the player it is full. */
export function onEntered(game: number, ok: boolean) {
  if (waitingFor !== game) return
  waitingFor = -1
  if (!ok) {
    showMessage(t('lobby.gameFull', { n: game + 1 }), 3)
    return
  }
  // The arena models are built on the spot: teleport once its floor and walls have loaded, or give up waiting
  cs.game = game
  requestArena(game)
  pendingTeleport = { game, left: C.ARENA_LOAD_TIMEOUT }
  playSfx(SFX.teleport)
  if (game !== PRACTICE_GAME) showMessage(t('lobby.starting', { n: game + 1 }), 4)
}

let pendingTeleport: { game: number; left: number } | undefined

/** The server found you in an arena without a seat. */
export function onEjected(game: number = cs.game) {
  if (cs.game === PRACTICE_GAME || cs.game < 0 || game !== cs.game) return // a delayed reply from a previous room is not an exit from this one
  if (waitingFor >= 0 || pendingTeleport) return // a seat was just requested: the answer is on its way
  const origin = lobbyOrigin()
  if (!origin) return
  fallGrace = TELEPORT_LOCKOUT
  cs.game = -1
  cs.inGame = false
  teleportToLobby(origin, padPos)
  showMessage(t('lobby.ejected'), 3)
}

interface PadView {
  game: number
  entity: Entity | undefined
  pos: Vector3
  lights: Entity | undefined
  baseScale: Vector3
  label: Entity // the spinning number cube's root (see makeNumberCube)
  info: Entity
  flag: Entity // the game's language flag beside the status line (makeFlag)
  flagLang: Lang | null
  labelShown: number
  size: number // spring: 0 hidden, 1 shown
  sizeV: number
  tall: number
  tallV: number
  spin: number
  angle: number
  localY: number
}

const PAD_TOUR_ORDER = [0, 1, 2, 3, 4, 5, 6]
let padTourTime: number | null = null
export function setPadTour(time: number | null) { padTourTime = time }
export function padTourReveal(game: number): number {
  if (padTourTime === null) return 0
  const progress = Math.max(0, Math.min(1, (padTourTime - 1.2 - PAD_TOUR_ORDER.indexOf(game) * 0.45) / 0.65))
  return 1 - Math.pow(1 - progress, 3)
}

// The status line under a pad's title: outlined in the panels' dark violet, with a soft drop shadow.
function makeText(text: string, fontSize: number, color: Color4): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.Zero(), scale: Vector3.Zero() })
  TextShape.create(e, {
    text,
    fontSize,
    textColor: color,
    outlineColor: Color4.create(0.16, 0.07, 0.3, 1),
    outlineWidth: 0.28,
    shadowColor: Color4.create(0, 0, 0, 1),
    shadowBlur: 0.4,
    shadowOffsetX: 0.08,
    shadowOffsetY: -0.08,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(e, { billboardMode: BillboardMode.BM_Y })
  return e
}

function withPlate(text: Entity): Entity {
  addPlate(text)
  return text
}

// The white plate behind the status line (assets/images/sign_plate.png): a plane child of the text, just behind it, so it
// turns to the camera and shows / hides with it. A little self-lit (PAD_PLATE_GLOW) so it does not go dark at night.
function addPlate(text: Entity): Entity {
  const plate = engine.addEntity()
  Transform.create(plate, {
    parent: text,
    position: Vector3.create(0, 0, C.PAD_PLATE_DEPTH), // behind the text, seen from the camera
    scale: Vector3.create(C.PAD_PLATE_WIDTH, C.PAD_PLATE_WIDTH / 4, 1) // the image is 4:1
  })
  MeshRenderer.setPlane(plate)
  const texture = Material.Texture.Common({ src: C.PAD_PLATE_IMAGE })
  Material.setPbrMaterial(plate, {
    texture,
    emissiveTexture: texture,
    emissiveColor: Color3.White(),
    emissiveIntensity: C.PAD_PLATE_GLOW,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    metallic: 0,
    roughness: 1,
    castShadows: false
  })
  return plate
}

/** A runtime pad sign with the same outlined text, billboard and white plate as public rooms. */
export function createPadSign(position: Vector3, text: string): { entity: Entity; dispose: () => void } {
  const entity = makeText(text, 3.5, BLOCK.green)
  const tr = Transform.getMutable(entity)
  tr.position = position
  tr.scale = Vector3.One()
  const plate = addPlate(entity)
  return { entity, dispose: () => { engine.removeEntity(plate); engine.removeEntity(entity) } }
}

// The language flag beside a pad's status line: a plane child of the line (so it turns to the camera with it), left of
// the plate, cut from the flag atlas (ui/flags.tsx). Its texture coords pick the flag; scale 0 hides it.
function makeFlag(flag: Entity, info: Entity) {
  Transform.create(flag, { parent: info, scale: Vector3.Zero() })
  const texture = Material.Texture.Common({ src: FLAG_ATLAS })
  Material.setPbrMaterial(flag, {
    texture,
    emissiveTexture: texture,
    emissiveColor: Color3.White(),
    emissiveIntensity: C.PAD_PLATE_GLOW,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    metallic: 0,
    roughness: 1,
    castShadows: false
  })
}

function showFlag(pad: PadView, lang: Lang | null) {
  if (lang === pad.flagLang) return
  pad.flagLang = lang
  const tr = Transform.getMutable(pad.flag)
  if (!lang) {
    tr.scale = Vector3.Zero()
    return
  }
  MeshRenderer.setPlane(pad.flag, planeFlagUvs(lang))
  const w = C.PAD_FLAG_HEIGHT * flagAspect(lang)
  tr.scale = Vector3.create(w, C.PAD_FLAG_HEIGHT, 1)
  tr.position = Vector3.create(-(C.PAD_PLATE_WIDTH / 2 + C.PAD_FLAG_GAP + w / 2), 0, 0)
}

// The big number cube floating over a pad (assets/models/Cube<n>.glb, one per game): a root that spins about Y, with the
// cube as its child turned so the number stands upright on its side faces.
function makeNumberCube(game: number): Entity {
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.Zero(), scale: Vector3.Zero() })
  const cube = engine.addEntity()
  Transform.create(cube, {
    parent: root,
    rotation: Quaternion.fromEulerDegrees(0, C.PAD_TITLE_YAW, C.PAD_TITLE_ROLL),
    scale: Vector3.scale(Vector3.One(), C.PAD_NUMBER_CUBE_SCALE)
  })
  GltfContainer.create(cube, { src: C.padNumberModel(game), visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  return root
}

/** The status line's colour: green to start, yellow while counting down, blue while it runs, red when full. */
function padColor(game: number): Color4 {
  const s = padState(game)
  if (s.kind === 'idle') return BLOCK.green
  if (s.kind === 'counting') return Color4.create(1, 0.85, 0.25, 1)
  if (s.kind === 'full') return BLOCK.red
  return BLOCK.blue
}

type PadState = { kind: 'idle' } | { kind: 'counting'; left: number } | { kind: 'running' } | { kind: 'full' }

/**
 * Where a game stands, seen from its pad. 'counting': someone pressed Start game and the shared countdown runs, with
 * `left` seconds to go on the server's clock (the server wrote only when it ends). 'running': players are in it, join now.
 */
function padState(game: number): PadState {
  const g = stateOf(game)
  if (!g) return { kind: 'idle' }
  if (g.active !== 0 && g.players >= C.MAX_PLAYERS_PER_GAME) return { kind: 'full' }
  // Checked before 'running': the first of the group to enter starts the game a moment before the others reach zero.
  const startAt = Number(g.startAt)
  if (startAt > 0) {
    const left = (startAt - (serverNow() ?? Date.now())) / 1000
    if (left > -1) return { kind: 'counting', left } // a second past the end still counts: the 'enter' is on its way
  }
  if (g.active !== 0 && g.players > 0) return { kind: 'running' }
  return { kind: 'idle' }
}

/** The language a game is played in (or about to be, during its start countdown), null while it is idle. */
export function gameLang(game: number): Lang | null {
  const lang = stateOf(game)?.lang ?? ''
  return isLang(lang) ? lang : null
}

/** What the small line under a pad says about its game: its language, level and how many play. */
function padInfo(game: number): string {
  const s = padState(game)
  const code = gameLang(game)
  const lang = code ? LANG_NAMES[code] : ''
  if (s.kind === 'counting') return `${t('sign.counting', { s: Math.max(1, Math.ceil(s.left)) })}${lang ? `  -  ${lang}` : ''}`
  if (s.kind === 'idle') return t('sign.idle')
  const g = stateOf(game)!
  const seats = `${g.players}/${C.MAX_PLAYERS_PER_GAME}`
  if (s.kind === 'full') return `${lang}  -  ${t('sign.level', { n: g.difficulty })}  -  ${seats}  ${t('sign.full')}`
  return `${lang}  -  ${t('sign.level', { n: g.difficulty })}  -  ${seats}`
}

let joinTimer = -1 // seconds left of your Join game countdown, -1 when none runs
let startPressed = -1 // the game you pressed Start game on, until its countdown shows up (or the press times out)
let startPressTimer = 0

/** HUD button on the pad of an idle game: ask the server to start the shared countdown. */
export function pressStart() {
  if (cs.padAction !== 'start' || cs.padGame < 0) return
  startPressed = cs.padGame
  startPressTimer = 4
  room.send('start', { game: cs.padGame, lang: cs.padLang })
}

/** HUD button on the pad of a running game: your own short countdown, then you go in. */
export function pressJoin() {
  if (cs.padAction !== 'join' || cs.padGame < 0) return
  joinTimer = C.JOIN_COUNTDOWN_SECONDS
}

/**
 * The lobby start pads, client only. There is one pad per game. On the pad of a game nobody plays, a Start game button
 * starts a countdown shared by everyone on that pad (the server writes once when it ends, each client counts on its own);
 * when it ends, everyone still on the pad asks for a seat and is teleported in. On the pad of a running game, a Join game
 * button runs a short countdown of your own and you join the round in progress. Stepping off cancels either for you.
 * The server gives at most MAX_PLAYERS_PER_GAME seats per game. The lights over a pad (StartPadLight.glb) pop up while
 * anyone is on it, spin faster as the countdown runs out and stretch for the final 3-2-1.
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
      // The game's number cube over the pad, spinning and bobbing gently
      label: makeNumberCube(game),
      // Smaller line under it: the game's level and how many are playing
      info: withPlate(makeText('', 3.5, BLOCK.green)),
      flag: engine.addEntity(),
      flagLang: null,
      labelShown: 0,
      size: 0,
      sizeV: 0,
      tall: 0,
      tallV: 0,
      spin: 0,
      angle: 0,
      localY: 0
    })
  }
  for (const pad of pads) makeFlag(pad.flag, pad.info)
  let time = 0

  let onPad = -1 // the pad you stand on
  let counting = false
  let timer = 0
  let total = C.LOBBY_COUNTDOWN_SECONDS // length of the countdown that runs (for the lights)
  let lockout = 0
  let entered = -1 // the start countdown (its startAt) you already asked a seat for

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
        pad.localY = pt.position.y
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
    if (cs.tutorialActive) onPad = -1
    if (onPad >= 0) lit.add(onPad)
    if (onPad >= 0 && onPad !== before) cs.padLang = uiLang() // a new pad starts on your own language; the buttons change it

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
        if (cs.game === PRACTICE_GAME) stopLocalPractice()
        else if (cs.game >= 0 || cs.inGame) leaveGame(cs.game)
        cs.game = -1
        cs.inGame = false
      } else if (cs.game >= 0 && arenaAt(me.x, me.y, me.z) === cs.game) {
        cs.inGame = true
      }
    }

    if (pendingTeleport) {
      pendingTeleport.left -= dt
      if (pendingTeleport.game === PRACTICE_GAME && pendingTeleport.left <= 0 && !arenaReady(PRACTICE_GAME)) {
        returnToLobby()
        showMessage(t('tutorial.loadFailed'), 8)
      }
    }
    if (pendingTeleport) {
      if (arenaReady(pendingTeleport.game) || pendingTeleport.left <= 0) {
        const game = pendingTeleport.game
        pendingTeleport = undefined
        fallGrace = TELEPORT_LOCKOUT
        cs.inGame = true
        teleportToGame(game)
      }
    }

    // The pad you stand on: its button, the countdowns and the seat request
    if (waitingFor >= 0) {
      waitTimer -= dt
      if (waitTimer <= 0) {
        waitingFor = -1 // no answer: let the player try again
        showMessage(t('lobby.noServer'), 4)
      }
    }
    if (lockout > 0) lockout -= dt
    if (startPressTimer > 0) {
      startPressTimer -= dt
      if (startPressTimer <= 0) startPressed = -1
    }

    // Ask the server for a seat in a game: we teleport when it says yes
    const enter = (game: number) => {
      waitingFor = game
      waitTimer = 4
      lockout = TELEPORT_LOCKOUT
      showMessage(t('lobby.starting', { n: game + 1 }), 4)
      room.send('enter', { game })
    }

    counting = false
    cs.padAction = ''
    cs.padGame = onPad
    const free = onPad >= 0 && lockout <= 0 && waitingFor < 0 && !pendingTeleport
    if (!free) joinTimer = -1
    if (free) {
      const state = padState(onPad)
      const startAt = Number(stateOf(onPad)?.startAt ?? 0)
      if (state.kind !== 'running') joinTimer = -1
      if (state.kind === 'counting') {
        // the shared start: everyone on this pad sees the same numbers and enters at zero
        startPressed = -1
        counting = true
        timer = state.left
        total = C.LOBBY_COUNTDOWN_SECONDS
        cs.countdownTitle = t('pad.startsIn')
        if (state.left <= 0 && entered !== startAt) {
          entered = startAt
          enter(onPad)
        }
      } else if (state.kind === 'running') {
        if (joinTimer >= 0) {
          joinTimer -= dt
          counting = true
          timer = joinTimer
          total = C.JOIN_COUNTDOWN_SECONDS
          cs.countdownTitle = t('pad.joiningIn')
          if (joinTimer <= 0) {
            joinTimer = -1
            enter(onPad)
          }
        } else cs.padAction = 'join'
      } else if (state.kind === 'full') {
        cs.padAction = 'full'
      } else if (startPressed !== onPad) {
        cs.padAction = 'start'
      }
    }
    const shown = counting ? Math.max(1, Math.ceil(timer)) : 0
    if (shown > 0 && shown !== cs.lobbyCountdown) playSfx(SFX.tick, 0.9, 2) // a tick for every number on the pad's countdown
    cs.lobbyCountdown = shown

    time += dt
    for (const pad of pads) {
      if (!pad.entity || !pad.lights) continue
      const tour = padTourTime !== null
      const reveal = padTourReveal(pad.game)
      Transform.getMutable(pad.entity).position.y = pad.localY + reveal * 1.2
      const mine = onPad === pad.game
      // Floating label: hidden while you stand on the pad or after you left for the game
      const labelTarget = tour ? (reveal > 0 ? 1 : 0) : !mine && !cs.inGame && waitingFor < 0 ? 1 : 0
      pad.labelShown += (labelTarget - pad.labelShown) * Math.min(1, 4 * dt)
      const lt = Transform.getMutable(pad.label)
      const ls = (pad.labelShown < 0.02 ? 0 : pad.labelShown) * (tour ? reveal : 1)
      lt.position = Vector3.create(pad.pos.x, pad.pos.y + C.PAD_LABEL_HEIGHT + reveal * 4 + Math.sin(time * 2 + pad.game) * 0.2, pad.pos.z)
      lt.scale = Vector3.create(ls, ls, ls)
      if (ls > 0) lt.rotation = Quaternion.fromEulerDegrees(0, (time * C.PAD_NUMBER_SPIN + pad.game * 50) % 360, 0)

      showFlag(pad, gameLang(pad.game))
      const roomText = padInfo(pad.game)
      const ts = TextShape.getMutable(pad.info)
      if (ts.text !== roomText) ts.text = roomText
      const color = padColor(pad.game)
      const tc = ts.textColor
      if (!tc || tc.r !== color.r || tc.g !== color.g || tc.b !== color.b) ts.textColor = color
      const it = Transform.getMutable(pad.info)
      it.position = Vector3.create(pad.pos.x, lt.position.y - C.PAD_INFO_GAP, pad.pos.z)
      it.scale = Vector3.create(ls, ls, ls)

      // Lights
      const anyone = lit.has(pad.game) || (tour && reveal > 0)
      const counting_ = mine && counting
      const finalSeconds = counting_ && timer <= 3
      const sizeTarget = anyone && (!mine || lockout <= 0) ? 1 : 0
      const tallTarget = finalSeconds ? 1 : 0
      const progress = counting_ ? Math.min(1, Math.max(0, 1 - timer / total)) : 0
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
      const stretch = 1 + (C.LOBBY_LIGHTS_TALL - 1) * pad.tall + reveal * 0.5
      t.scale =
        sc < 0.001 && sizeTarget === 0
          ? Vector3.create(pad.baseScale.x, 0, pad.baseScale.z)
          : Vector3.create(pad.baseScale.x, pad.baseScale.y * sc * stretch, pad.baseScale.z)
      t.rotation = Quaternion.fromEulerDegrees(0, pad.angle, 0)
    }
  })
}
