// Cubby's first visit: cinematics alternate with single-player actions owned entirely by this client.
import {
  engine, Entity, Transform, MainCamera, VirtualCamera, InputModifier, PointerLock,
  GltfContainer, TextShape, Billboard, BillboardMode, MeshRenderer, Material,
  AvatarModifierArea, AvatarModifierType, ColliderLayer, AvatarShape, PointerEvents, UiTransform, RealmInfo
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import * as C from '../config'
import { PRACTICE_GAME, PRACTICE_WORDS, npcAvatarId, type PracticeStage } from '../shared/tutorial'
import { CubeData } from '../shared/schemas'
import { room } from '../shared/messages'
import { envOrigin } from '../shared/env'
import { cs } from './state'
import { serverReady, releaseTutorialGate } from './connection'
import { t, uiLang } from './i18n'
import { LANG_NAMES, type Lang } from '../shared/lang'
import { cubbyEntity, cubbyEmote } from './npcs'
import { worldPosition, lobbyAnchors, requestPractice, returnToLobby, createPadSign, setPadTour } from './lobby'
import { slotPosition, getSlotEntities, startArrowEntity } from './arena'
import { cubeEntity, cubeGuessPending, myHeldCubeId } from './cubenet'
import { myState } from './gamestate'
import { talkSfx } from './audio'
import { mobile, S, Sbtn, EDGE, RIGHT_RESERVE, TOP_RESERVE, BOTTOM_RESERVE, LEFT_RESERVE, dialogScale, view } from './ui/platform'
import { state as overlay } from '../ui/TutorialOverlay'
import { localPracticeAction, localPracticeStage, stopLocalPractice } from './practice'

type Step =
  | 'countdown' | 'off' | 'welcome' | 'rooms' | 'pad' | 'walk' | 'create' | 'waiting' | 'arrow' | 'clue'
  | 'grab' | 'throw' | 'place' | 'team' | 'helping' | 'lastGrab' | 'lastThrow' | 'lastPlace'
  | 'win' | 'warning' | 'mistake' | 'collapse' | 'rebuilding' | 'retryGrab' | 'retryThrow'
  | 'retryPlace' | 'complete' | 'outro'
let step: Step = 'off'
let age = 0
let checked = false
let stage: PracticeStage = 'intro'
let lang: Lang = 'en'
let pad: Entity | undefined
let lights: Entity | undefined
let sign: Entity | undefined
let disposeSign: (() => void) | undefined
let marker: Entity | undefined
let isolation: Entity | undefined
let padPosition = Vector3.Zero()
let camera: Entity | undefined
const cameras: Entity[] = []
let cameraStart = Vector3.Zero()
let cameraEnd = Vector3.Zero()
let cameraLook = Vector3.Zero()
let previousCamera: Entity | undefined
let previousInput: ReturnType<typeof InputModifier.get> | undefined
let previousPointer = true
let cinematic = false
let sinceSave = 0
let pendingEntry = false

// The trigger matches the visible pad; the welcome position is outside its footprint.
const LAB_PAD_RADIUS = C.PAD_RADIUS

const interactive = new Set<Step>(['walk', 'create', 'grab', 'place', 'lastGrab', 'lastPlace', 'retryGrab', 'retryPlace'])
const waiting = new Set<Step>(['countdown', 'waiting', 'helping', 'rebuilding'])
const practiceSteps = new Set<Step>(['arrow', 'clue', 'grab', 'throw', 'place', 'team', 'helping', 'lastGrab', 'lastThrow', 'lastPlace', 'win', 'warning', 'mistake', 'collapse', 'rebuilding', 'retryGrab', 'retryThrow', 'retryPlace', 'complete'])

// The mobile progress bars: one per chapter of the tutorial.
const CHAPTERS: Step[][] = [
  ['welcome', 'rooms', 'pad'], ['walk', 'create', 'countdown', 'waiting'], ['arrow', 'clue'], ['grab', 'throw', 'place'],
  ['team', 'helping', 'lastGrab', 'lastThrow', 'lastPlace', 'win'], ['warning', 'mistake', 'collapse'],
  ['rebuilding', 'retryGrab', 'retryThrow', 'retryPlace'], ['complete', 'outro']
]

const hiddenPointers = new Map<Entity, ReturnType<typeof PointerEvents.get>>()
function hideWorldPointers(onlyFrame?: Entity) {
  for (const [entity, data] of engine.getEntitiesWith(PointerEvents)) {
    if (UiTransform.has(entity) || !Transform.has(entity) || !data.pointerEvents.length) continue
    if (onlyFrame !== undefined && entity !== onlyFrame && Transform.get(entity).parent !== onlyFrame) continue
    if (data.pointerEvents.every(entry => entry.eventInfo?.showFeedback === false && entry.eventInfo?.maxDistance === 0)) continue
    // Suspend world targeting and feedback without removing registered event descriptors.
    hiddenPointers.set(entity, { pointerEvents: data.pointerEvents.map(entry => ({ ...entry, eventInfo: entry.eventInfo ? { ...entry.eventInfo } : undefined })) })
    PointerEvents.createOrReplace(entity, { pointerEvents: data.pointerEvents.map(entry => ({ ...entry, eventInfo: { ...entry.eventInfo, showFeedback: false, showHighlight: false, maxDistance: 0 } })) })
  }
}
function restoreWorldPointers() {
  for (const [entity, data] of hiddenPointers) {
    if (!Transform.has(entity) || !PointerEvents.has(entity)) continue
    PointerEvents.createOrReplace(entity, { pointerEvents: data.pointerEvents.map(entry => ({ ...entry, eventInfo: entry.eventInfo ? { ...entry.eventInfo } : undefined })) })
  }
  hiddenPointers.clear()
}
function releaseCamera() {
  restoreWorldPointers()
  if (!cinematic) return
  cinematic = false
  cs.tutorialCinematic = false
  const main = MainCamera.getMutableOrNull(engine.CameraEntity)
  if (main) main.virtualCameraEntity = previousCamera && VirtualCamera.has(previousCamera) ? previousCamera : undefined
  if (previousInput) InputModifier.createOrReplace(engine.PlayerEntity, previousInput)
  else InputModifier.deleteFrom(engine.PlayerEntity)
  if (!mobile()) PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: previousPointer })
  // Keep the reusable camera alive while the renderer blends back to the player.
}

function shot(target: Vector3, offset: Vector3) {
  if (cameras.length === 0) {
    for (let i = 0; i < 2; i++) {
      const e = engine.addEntity()
      Transform.create(e, {})
      VirtualCamera.create(e, { fov: 60, defaultTransition: { transitionMode: VirtualCamera.Transition.Time(1.2) } })
      cameras.push(e)
    }
  }
  camera = camera === cameras[0] ? cameras[1] : cameras[0]
  if (!cinematic) {
    previousCamera = MainCamera.getOrNull(engine.CameraEntity)?.virtualCameraEntity as Entity | undefined
    previousInput = InputModifier.getOrNull(engine.PlayerEntity) ?? undefined
    previousPointer = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ?? true
  }
  cameraLook = target
  // Mobile has a fixed camera FOV. Gain room on narrow screens by raising the camera,
  // keeping its horizontal position inside the scene instead of relying on lens zoom.
  const aspect = view().w / view().h
  const fit = mobile() ? Math.max(1, Math.min(3, 1.75 / aspect)) : 1
  const mobileOffset = Vector3.create(offset.x, offset.y + (fit - 1) * Vector3.distance(Vector3.Zero(), offset), offset.z)
  cameraEnd = Vector3.add(target, mobileOffset)
  cameraStart = Vector3.add(cameraEnd, Vector3.create(0.5, 0.2, 0.3))
  Transform.getMutable(camera).position = cameraStart
  Transform.getMutable(camera).rotation = Quaternion.fromLookAt(cameraStart, target)
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: camera })
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard(mobile()
      ? { disableWalk: true, disableJog: true, disableRun: true, disableJump: true, disableDoubleJump: true, disableGliding: true }
      : { disableAll: true })
  })
  if (!mobile()) PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
  cinematic = true
  cs.tutorialCinematic = true
  hideWorldPointers()
}

function cubbyPosition(practice = false): Vector3 | undefined {
  const e = cubbyEntity(practice)
  return e === undefined ? undefined : Transform.getOrNull(e)?.position
}

function frameShot() {
  const p = slotPosition(1, 3)
  shot(p, Vector3.create(-3.5, 2, -7))
}

function setStep(next: Step) {
  step = next
  age = 0
  cs.practiceTouchReady = !mobile()
  cs.practiceUiOnly = mobile() && next === 'retryPlace'
  setPadTour(next === 'rooms' || next === 'outro' ? 0 : null)
  cs.dialog = null
  cs.shop = false
  cs.showHowTo = false
  cs.showSettings = false
  cs.message = ''
  cs.messageSticky = false
  cs.practiceLetter = ['grab', 'lastGrab', 'retryGrab'].includes(next) ? PRACTICE_WORDS[lang].answer[next === 'grab' ? 0 : 2] : ''
  cs.practiceCubeId = -1
  cs.practiceSlot = next === 'place' ? 0 : next === 'lastPlace' || next === 'retryPlace' ? 2 : -1
  if (interactive.has(next)) releaseCamera()
  talkSfx()
  if (next === 'welcome') {
    const p = cubbyPosition()!
    const toward = Vector3.subtract(lobbyAnchors()!.origin, p)
    const d = Math.hypot(toward.x, toward.z) || 1
    cubbyEmote('wave')
    shot(
      Vector3.add(p, Vector3.create(0, 1.2, 0)),
      Vector3.create((toward.x * 4 + toward.z * 2) / d, 1, (toward.z * 4 - toward.x * 2) / d)
    )
  } else if (next === 'rooms' || next === 'outro') {
    const positions = C.LOBBY_PAD_NAMES.flatMap((name) => {
      const e = engine.getEntityOrNullByName(name)
      return e === null ? [] : [worldPosition(e)]
    })
    const a = lobbyAnchors()!
    const center = positions.length ? Vector3.scale(positions.reduce((sum, p) => Vector3.add(sum, p), Vector3.Zero()), 1 / positions.length) : a.pad
    const radius = Math.max(14, ...positions.map((p) => Vector3.distance(p, center)))
    shot(center, Vector3.create(0, radius * 1.1, -radius * 1.9))
  } else if (next === 'pad') {
    spawnPad()
    shot(Vector3.add(padPosition, Vector3.create(0, 1.5, 0)), Vector3.create(7, 5, -10))
  } else if (next === 'arrow') {
    const e = startArrowEntity()
    const p = e === null ? slotPosition(0, 3) : Transform.get(e).position
    shot(p, Vector3.create(-3, 1.4, -5))
    cubbyEmote('wave', true)
  } else if (['clue', 'throw', 'lastThrow', 'retryThrow', 'win', 'warning', 'mistake', 'collapse', 'complete'].includes(next)) {
    frameShot()
    if (next === 'win' || next === 'complete') cubbyEmote('clap', true)
  } else if (next === 'team' || next === 'helping' || next === 'rebuilding') {
    const p = cubbyPosition(true)
    if (p) shot(Vector3.add(p, Vector3.create(2, 1.4, 1)), Vector3.create(-4, 3, -7))
  }
}

// After the pad shot hands the camera back, turn the player (and the camera behind them) toward the pad they must
// walk to, instead of wherever they happened to face. Only on that hand-off: stepping off the pad later
// (create -> walk) must not yank the camera around.
function facePad() {
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return
  const target = Vector3.add(padPosition, Vector3.create(0, 0.5, 0))
  void movePlayerTo({ newRelativePosition: me, cameraTarget: target, avatarTarget: target })
}

function spawnPad() {
  if (pad !== undefined) return
  const cubby = cubbyPosition()!
  const anchors = lobbyAnchors()!
  const direction = Vector3.subtract(cubby, anchors.origin)
  const d = Math.hypot(direction.x, direction.z) || 1
  // Welcome is 3 m from Cubby along this path. Leave 7 m to the pad centre,
  // outside the full 4.4 m pad footprint, so the player visibly walks onto it.
  padPosition = Vector3.create(cubby.x - direction.x / d * 10, cubby.y, cubby.z - direction.z / d * 10)
  const source = engine.getEntityOrNullByName(C.LOBBY_PAD_NAMES[0])
  const scale = source === null ? Vector3.One() : Transform.get(source).scale
  pad = engine.addEntity()
  Transform.create(pad, { position: padPosition, scale: Vector3.create(scale.x, 0, scale.z) })
  GltfContainer.create(pad, {
    src: 'assets/models/environment/StartPad.glb', visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  })
  lights = engine.addEntity()
  Transform.create(lights, { position: padPosition, scale })
  GltfContainer.create(lights, { src: C.LOBBY_LIGHTS_MODEL, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  const plate = createPadSign(Vector3.add(padPosition, Vector3.create(0, C.PAD_LABEL_HEIGHT - C.PAD_INFO_GAP, 0)), t('tutorial.lab'))
  sign = plate.entity
  disposeSign = plate.dispose
}

function send(action: string) {
  localPracticeAction(action)
  stage = localPracticeStage()
}

export function startTutorial() {
  if (!serverReady() || !cubbyPosition() || !lobbyAnchors()) return
  if (cs.game >= 0) returnToLobby()
  checked = true
  cs.tutorialActive = true
  releaseTutorialGate()
  lang = uiLang()
  stage = 'intro'
  pendingEntry = false
  setPadTour(null)
  const p = cubbyPosition()!
  const origin = lobbyAnchors()!.origin
  const delta = Vector3.subtract(origin, p)
  const distance = Math.hypot(delta.x, delta.z) || 1
  void movePlayerTo({ newRelativePosition: Vector3.create(p.x + delta.x / distance * 3, p.y + 0.5, p.z + delta.z / distance * 3), cameraTarget: Vector3.add(p, Vector3.create(0, 1.2, 0)) })
  isolation = engine.addEntity()
  Transform.create(isolation, { position: Vector3.create(256, 160, 256) })
  const localNpcs = Array.from(engine.getEntitiesWith(AvatarShape), ([, npc]) => npc.id)
  AvatarModifierArea.create(isolation, { area: Vector3.create(1000, 1000, 1000), modifiers: [AvatarModifierType.AMT_HIDE_AVATARS], excludeIds: [cs.myAddress, npcAvatarId('cubby-coach'), ...localNpcs] })
  setStep('welcome')
}

// Cleanup after completion or an interruption; this never marks an unfinished tutorial complete.
export function stopTutorial() {
  if (!cs.tutorialActive) return
  releaseCamera()
  // Also cancel an entry in flight: a late seat reply is ignored by the lobby and cannot resurrect the tour.
  if (cs.game === PRACTICE_GAME || pendingEntry) returnToLobby()
  pendingEntry = false
  setPadTour(null)
  cs.tutorialActive = false
  cs.practiceLetter = ''
  cs.practiceSlot = -1
  cs.practiceUiOnly = false
  step = 'off'
  disposeSign?.()
  disposeSign = undefined
  for (const e of [pad, lights, marker, isolation]) if (e !== undefined) engine.removeEntity(e)
  pad = lights = sign = marker = isolation = undefined
  stopLocalPractice()
  overlay.display = 'none'
}

export function nextTutorial() {
  if (!cs.tutorialActive || age < 0.8) return
  if ((step === 'rooms' || step === 'outro') && age < 5.2) return
  switch (step) {
    case 'welcome': setStep('rooms'); break
    case 'rooms': setStep('pad'); break
    case 'pad': setStep('walk'); facePad(); break
    case 'create':
      lang = uiLang() // snapshot the phone's current language at creation, not at scene load
      pendingEntry = true
      setStep('countdown')
      shot(Vector3.add(padPosition, Vector3.create(0, 1, 0)), Vector3.create(5, 4, -7))
      break
    case 'waiting': requestPractice(lang); age = 0; break
    case 'arrow': setStep('clue'); break
    case 'clue': send('begin'); setStep('grab'); break
    case 'throw': setStep('place'); break
    case 'team': send('assist'); cubbyEmote('wave', true); setStep('helping'); break
    case 'lastThrow': setStep('lastPlace'); break
    case 'win': setStep('warning'); break
    case 'warning': send('mistake'); cubbyEmote('shrug', true); setStep('mistake'); break
    case 'mistake': if (stage === 'collapsed') setStep('collapse'); break
    case 'collapse': send('rebuild'); setStep('rebuilding'); break
    case 'retryThrow': setStep('retryPlace'); break
    case 'complete': returnToLobby(); setStep('outro'); break
    case 'outro': stopTutorial(); break
  }
}

function mark(p?: Vector3) {
  if (!marker && p) {
    marker = engine.addEntity()
    Transform.create(marker, {})
    MeshRenderer.setSphere(marker)
    Material.setPbrMaterial(marker, { albedoColor: Color4.create(0.3, 1, 0.65, 1), emissiveColor: Color3.create(0.2, 1, 0.5), emissiveIntensity: 2, metallic: 0, roughness: 1 })
  }
  if (!marker) return
  const tr = Transform.getMutable(marker)
  tr.scale = p ? Vector3.scale(Vector3.One(), 0.24 + Math.sin(age * 3) * 0.025) : Vector3.Zero()
  if (p) tr.position = Vector3.add(p, Vector3.create(0, 1.1 + Math.sin(age * 2) * 0.12, 0))
}

function goalLetter(): string { return PRACTICE_WORDS[lang].answer[step === 'grab' || step === 'place' || step === 'throw' ? 0 : 2] }

function updateOverlay() {
  const phone = mobile()
  const screen = view()
  const margin = EDGE()
  const available = screen.w - 2 * margin - (phone ? RIGHT_RESERVE() : 0)
  const w = Math.min(S(phone ? 1000 : 1100), available)
  overlay.display = 'flex'
  overlay.width = w
  overlay.left = phone ? margin + (available - w) / 2 : (screen.w - w) / 2
  overlay.font = Math.max(18, Math.min(S(phone ? 25 : 23), w / 25))
  overlay.titleFont = S(25)
  overlay.radius = S(28)
  overlay.border = S(6)
  overlay.padding = S(phone ? 16 : 22)
  overlay.titleHeight = S(36)
  overlay.title = t('npc.cubby.name')
  overlay.text = t(`tutorial.${step}`, { lang: LANG_NAMES[step === 'create' ? uiLang() : lang], letter: goalLetter(), word: PRACTICE_WORDS[lang].answer, count: Math.max(1, 3 - Math.floor(age)), clue: PRACTICE_WORDS[lang].question })
  overlay.next = t(step === 'create' ? 'tutorial.createButton' : step === 'waiting' ? 'tutorial.retry' : step === 'outro' ? 'common.done' : 'common.next')
  const noButton = (step === 'mistake' && stage !== 'collapsed') || interactive.has(step) && step !== 'create' || waiting.has(step) && !(step === 'waiting' && age > C.ARENA_LOAD_TIMEOUT + 3)
  const showNext = !noButton && !((step === 'rooms' || step === 'outro') && age < 5.2)
  overlay.primaryDisplay = showNext ? 'flex' : 'none'
  overlay.buttonWidth = Math.min(phone ? Sbtn(260) : S(220), w - 2 * (overlay.padding + overlay.border))
  overlay.buttonHeight = phone ? Sbtn(58) : S(43)
  overlay.buttonRowHeight = showNext ? overlay.buttonHeight : 0
  const innerWidth = w - 2 * (overlay.padding + overlay.border)
  // Allow translated text to wrap; reserve real line height rather than shrinking the font.
  const estimatedLines = Math.max(1, Math.ceil(overlay.text.length * overlay.font * 0.57 / innerWidth))
  overlay.lineHeight = phone ? Math.ceil(overlay.font * 1.35 * Math.max(2, estimatedLines)) : S(90)
  overlay.progress = cs.message || (practiceSteps.has(step) ? t('tutorial.practiceNote') : '')
  overlay.progressFont = phone ? S(17) : 16
  overlay.progressHeight = overlay.progress ? Math.ceil(overlay.progressFont * 1.3 * Math.max(1, Math.ceil(overlay.progress.length * overlay.progressFont * 0.55 / innerWidth))) : 0
  overlay.framesDisplay = step === 'retryPlace' ? 'flex' : 'none'
  overlay.tileSize = phone ? Sbtn(55) : S(55)
  overlay.framesHeight = overlay.framesDisplay === 'flex' ? overlay.tileSize : 0
  const masked = myState()?.masked ?? '___'
  overlay.letter0 = masked[0] === '_' ? '' : masked[0] ?? ''
  overlay.letter1 = masked[1] === '_' ? '' : masked[1] ?? ''
  overlay.letter2 = masked[2] === '_' ? '' : masked[2] ?? ''
  overlay.targetSlot = cs.practiceSlot
  overlay.height = overlay.titleHeight + overlay.lineHeight + overlay.buttonRowHeight + overlay.framesHeight + overlay.progressHeight + 2 * (overlay.padding + overlay.border)
  // Explanations sit above the home bar; playable prompts sit under the app's top bar,
  // leaving the joystick, crosshair, world targets and native action buttons unobstructed.
  overlay.bottom = phone
    ? cinematic ? BOTTOM_RESERVE() + S(12) : screen.h - TOP_RESERVE() - S(18) - overlay.height
    : S(cinematic ? 35 : 22)
  overlay.bottom = Math.max(BOTTOM_RESERVE(), overlay.bottom)
  overlay.barHeight = 0
  overlay.mobile = phone
  overlay.grabDisplay = phone && ['grab', 'lastGrab', 'retryGrab'].includes(step) ? 'flex' : 'none'
  overlay.grabLabel = t('tutorial.grabAction', { letter: goalLetter() })
  layoutDialog(screen, showNext, phone)
}

// Desktop and mobile share one look: the game's own art only, at its native proportions. Cubby's line sits in the word strip at the bottom
// (the camera already frames the real NPC) and stays there during the playable steps as the mission, the action
// is the cartoon button above the native buttons with a tapping hand, and the finished word is the cartoon panel.
// Sizes come from a 844x390 pt mockup, scaled so 390 pt = 720 virtual px on a phone. Desktop draws the same pieces a
// little smaller (its screen is larger) and, with no native buttons to avoid, keeps the action next to the strip.
function layoutDialog(screen: { w: number; h: number }, showNext: boolean, phone: boolean) {
  const o = overlay
  const px = (n: number) => Math.round(n * dialogScale(screen))
  const margin = EDGE()
  // the free band for the dialogue: right of the desktop chat column, inside the screen margins
  const areaL = Math.max(margin, LEFT_RESERVE())
  const areaW = screen.w - margin - areaL
  const party = step === 'win' || step === 'complete'
  o.mode = party ? 'party' : cinematic ? 'talk' : 'action'
  o.barHeight = 0
  o.progress = ''
  o.progressHeight = 0
  o.title = t('npc.cubby.short')
  o.tabName = o.title
  o.text = cs.message || o.text
  o.copy = o.text
  o.chapters = CHAPTERS.length
  o.chapter = Math.max(0, CHAPTERS.findIndex(group => group.includes(step)))
  o.stepLabel = `${o.chapter + 1}/${o.chapters}`
  o.framesDisplay = o.mode === 'action' ? o.framesDisplay : 'none'

  // pill buttons, 2.6:1 like the HUD's
  const button = (h: number) => { o.actionH = h; o.actionW = Math.round(h * 2.6) }
  o.actionGrab = o.grabDisplay === 'flex'
  o.actionLabel = o.actionGrab ? o.grabLabel : o.next
  o.actionDisplay = o.actionGrab || showNext ? 'flex' : 'none'
  // Cubby's strip (drawn in code, keeping the word-strip's 1024x150 proportions)
  const strip = (w: number) => {
    o.stripW = w
    o.stripH = Math.round(w * 150 / 1024)
    o.stripPadL = Math.round(w * 0.05)
    o.stripPadR = Math.round(w * 0.05)
  }

  if (o.mode === 'talk') {
    button(px(phone ? 84 : 94))
    const gap = px(18)
    // phones: a narrower strip (about half the screen) so the scene stays visible around it
    const stripMax = phone ? Math.min(px(860), Math.round(screen.w * 0.5)) : px(1034)
    // the hand reaches ~0.3 button-heights past the button's right edge: keep that on screen too
    const k = Math.min(1, areaW / (stripMax + gap + o.actionW + Math.round(o.actionH * 0.3)))
    strip(Math.round(stripMax * k))
    button(Math.round(px(phone ? 84 : 94) * k))
    const group = o.stripW + gap + o.actionW + Math.round(o.actionH * 0.3)
    o.stripLeft = areaL + Math.round((areaW - group) / 2)
    o.stripBottom = Math.max(px(24), BOTTOM_RESERVE() / 3)
    o.goalDisplay = 'none'
    o.chipW = 0
    o.stripTextW = o.stripW - o.stripPadL - o.stripPadR
    o.actionLeft = o.stripLeft + o.stripW + gap
    o.actionBottom = o.stripBottom + Math.round((o.stripH - o.actionH) / 2)
    o.dotW = px(26)
    o.dotH = px(9)
    o.dotGap = px(7)
    o.dotsLeft = o.stripLeft + o.stripW - Math.round(o.stripW * 0.08) - o.chapters * (o.dotW + o.dotGap)
    o.dotsBottom = o.stripBottom + o.stripH + px(4)
  } else if (o.mode === 'action') {
    // Cubby keeps talking from the bottom; on a phone the strip narrows to fit between the joystick and the
    // native jump / E buttons
    strip(phone ? Math.min(px(860), Math.round(screen.w * 0.5)) : Math.min(px(1034), Math.round(areaW * 0.62)))
    o.stripLeft = Math.round((screen.w - o.stripW) / 2)
    o.stripBottom = Math.max(px(24), BOTTOM_RESERVE() / 3)
    const letterSteps: Step[] = ['grab', 'throw', 'place', 'lastGrab', 'lastThrow', 'lastPlace', 'retryGrab', 'retryThrow', 'retryPlace']
    o.goalDisplay = letterSteps.includes(step) ? 'flex' : 'none'
    o.goalLetter = goalLetter()
    o.goalSize = Math.round(o.stripH * 0.5)
    o.chipH = Math.round(o.stripH * 0.32)
    o.chipW = Math.round(o.chipH * 2)
    o.chipFont = Math.round(o.chipH * 0.55)
    o.stripTextW = o.stripW - o.stripPadL - o.stripPadR - o.chipW - Math.round(o.chipH / 4) - (o.goalDisplay === 'flex' ? o.goalSize + Math.round(o.goalSize / 4) : 0)
    o.tileSize = px(104)
    if (phone) {
      // above the native jump / E cluster on the right
      button(px(107))
      o.actionLeft = screen.w - margin - px(30) - o.actionW
      o.actionBottom = Math.round(screen.h * 0.33)
    } else {
      // no native buttons: the action sits right of the strip, the strip shifts left to keep the pair centred
      button(Math.round(o.stripH * 0.62))
      const gap = px(18)
      o.stripLeft = areaL + Math.round((areaW - o.stripW - gap - o.actionW - Math.round(o.actionH * 0.3)) / 2)
      o.actionLeft = o.stripLeft + o.stripW + gap
      o.actionBottom = o.stripBottom + Math.round((o.stripH - o.actionH) / 2)
    }
    o.tileLeft = o.actionLeft + Math.round((o.actionW - o.tileSize) / 2)
    o.tileBottom = o.actionBottom
    if (o.framesDisplay === 'flex') o.actionDisplay = 'none'
  } else {
    o.bleed = Math.round(Math.max(screen.w, screen.h) * 0.25)
    o.dimW = screen.w + 2 * o.bleed
    o.dimH = screen.h + 2 * o.bleed
    o.panelW = Math.min(px(700), areaW)
    const k = o.panelW / px(700)
    const q = (n: number) => Math.round(px(n) * k)
    o.panelPadTop = q(30)
    o.panelPadSide = q(40)
    o.panelGap = q(18)
    o.partyTitle = t('tutorial.party')
    o.partyTitleFont = q(40)
    o.partyTitleH = q(54)
    o.partyTile = q(96)
    const word = PRACTICE_WORDS[lang].answer
    o.word0 = word[0] ?? ''
    o.word1 = word[1] ?? ''
    o.word2 = word[2] ?? ''
    const hop = (i: number) => Math.round(Math.max(0, Math.sin(age * 5.2 - i * 0.9)) * q(14))
    o.hop0 = hop(0)
    o.hop1 = hop(1)
    o.hop2 = hop(2)
    o.partyFont = q(24)
    o.partyTextH = q(64)
    o.panelH = o.panelPadTop + o.partyTitleH + o.partyTile + o.panelGap + Math.round(o.panelGap / 2) + o.partyTextH + q(26)
    o.panelLeft = areaL + Math.round((areaW - o.panelW) / 2)
    o.panelTop = Math.max(TOP_RESERVE(), Math.round((screen.h - o.panelH) / 2) - q(40))
    // the button sits on its own under the card, with the hand tapping it; lift the card if they would not fit
    button(q(84))
    const gap = q(22)
    const handRoom = Math.round(o.actionH * 0.66 * 216 / 184 * 0.62) + px(6)
    const below = gap + o.actionH + handRoom
    o.panelTop = Math.max(TOP_RESERVE(), Math.min(o.panelTop, screen.h - o.panelH - below))
    o.actionLeft = o.panelLeft + Math.round((o.panelW - o.actionW) / 2)
    o.actionBottom = screen.h - o.panelTop - o.panelH - gap - o.actionH
  }

  if (o.mode !== 'party') {
    // Cubby's name tab rides the strip's top edge in both talk and action
    o.tabH = px(44)
    o.tabFont = px(24)
    o.tabW = Math.round(o.tabName.length * o.tabFont * 0.62) + px(40)
    o.tabLeft = o.stripLeft + Math.round(o.stripW * 0.07)
    o.tabBottom = o.stripBottom + o.stripH - Math.round(o.tabH * 0.3)
    // two lines at most: shrink the copy a little instead of growing the art
    const max = px(o.mode === 'talk' ? 28 : 26)
    o.stripFont = Math.max(px(21), Math.min(max, Math.floor(2 * o.stripTextW / Math.max(1, o.text.length) / 0.56)))
    o.stripTextH = Math.ceil(2 * o.stripFont * 1.25)
  }
  o.actionFont = Math.min(Math.round(o.actionH * 0.32), Math.floor((o.actionW * 0.78) / Math.max(4, o.actionLabel.length) / 0.6))

  // the hand taps the button (or the dialogue frame) from below-right
  const press = Math.max(0, Math.sin(age * 5))
  o.handW = Math.round(o.actionH * 0.66)
  o.handH = Math.round(o.handW * 216 / 184)
  const target = o.framesDisplay === 'flex'
    ? { left: o.tileLeft, bottom: o.tileBottom, w: o.tileSize }
    : { left: o.actionLeft, bottom: o.actionBottom, w: o.actionW }
  o.handDisplay = o.actionDisplay === 'flex' || o.framesDisplay === 'flex' ? 'flex' : 'none'
  // the fingertip lands on the button's lower-right corner, clear of its label (at rest; the tap is added last)
  o.handLeft = target.left + Math.round(target.w * 0.84)
  o.handBottom = target.bottom - Math.round(o.handH * 0.62)

  // Lift the whole group when the resting hand (or the button) would run off the bottom edge. Only rest positions
  // count, so the layout never follows the hand's animation.
  if (o.mode !== 'party') {
    const lowest = Math.min(o.stripBottom, o.actionDisplay === 'flex' ? o.actionBottom : Infinity, o.handDisplay === 'flex' ? o.handBottom : Infinity)
    const lift = Math.max(0, px(10) - lowest)
    if (o.mode === 'action' && phone) {
      // the phone's action button floats on its own above the native buttons: only the strip moves with the hand rule
      o.stripBottom += Math.max(0, px(10) - o.stripBottom)
    } else {
      o.stripBottom += lift
      o.actionBottom += lift
      o.handBottom += lift
      o.tileBottom += lift
    }
    o.tabBottom = o.stripBottom + o.stripH - Math.round(o.tabH * 0.3)
    o.dotsBottom = o.stripBottom + o.stripH + px(4)
  }
  // only the hand moves: a small tap towards the button
  o.handLeft -= Math.round(press * px(6))
  o.handBottom += Math.round(press * px(8))

  // the box placement checks reason about
  if (o.mode === 'party') { o.left = o.panelLeft; o.width = o.panelW; o.height = o.panelH; o.bottom = screen.h - o.panelTop - o.panelH }
  else { o.left = o.stripLeft; o.width = o.stripW; o.height = o.stripH; o.bottom = o.stripBottom }
}

export function tutorialSystem(dt: number) {
  if (cs.tutorialSavePending && serverReady()) {
    sinceSave += dt
    if (sinceSave >= 2) { sinceSave = 0; room.send('setSetting', { key: 'tutorialComplete', value: 1 }) }
  }
  if (cs.game === PRACTICE_GAME) stage = localPracticeStage()
  if (!checked && cubbyPosition() && lobbyAnchors() && Transform.has(engine.PlayerEntity)) {
    // serverReady requires the player's profile reply and synced game states.
    // Never infer a first visit from default settings while the server is unavailable.
    if (!serverReady()) return
    checked = true
    // In the local preview the tutorial is not forced, so the game can be tested quickly (Cubby still offers it).
    // Deployed worlds always start it for new players.
    const preview = RealmInfo?.getOrNull?.(engine.RootEntity)?.isPreview === true
    if (cs.settings.tutorialComplete !== true && !preview) startTutorial()
  }
  if (!cs.tutorialActive) return
  age += dt
  if (cinematic) hideWorldPointers()
  if (cs.practiceUiOnly) {
    const frame = getSlotEntities()[2]
    if (frame !== undefined) hideWorldPointers(frame)
  }
  if (step === 'countdown' && age >= 3) { requestPractice(lang); setStep('waiting') }
  if (age >= 0.4) cs.practiceTouchReady = true
  if (step === 'rooms' || step === 'outro') setPadTour(age)
  const npc = cubbyPosition(true)
  if (npc) cs.cubbyHand = Vector3.add(npc, Vector3.create(0.3, 1.4, 0.4))
  if (cinematic && camera) {
    const tr = Transform.getMutable(camera)
    tr.position = Vector3.lerp(cameraStart, cameraEnd, Math.min(1, age / 4))
    tr.rotation = Quaternion.fromLookAt(tr.position, cameraLook)
  }
  if (pad !== undefined) {
    const tr = Transform.getMutable(pad)
    const source = engine.getEntityOrNullByName(C.LOBBY_PAD_NAMES[0])
    const sc = source === null ? Vector3.One() : Transform.get(source).scale
    tr.scale = Vector3.create(sc.x, sc.y * Math.min(1, step === 'pad' ? age / 1.2 : 1), sc.z)
    if (lights !== undefined) Transform.getMutable(lights).rotation = Quaternion.fromEulerDegrees(0, Date.now() / 30 % 360, 0)
    if (sign !== undefined) TextShape.getMutable(sign).text = t('tutorial.lab')
  }
  // An exit/ejection interrupts the practice and always restores camera and movement.
  if (practiceSteps.has(step) && cs.game !== PRACTICE_GAME) { stopTutorial(); return }
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (step === 'walk' && me && Math.hypot(me.x - padPosition.x, me.z - padPosition.z) < LAB_PAD_RADIUS && Math.abs(me.y - padPosition.y) < C.PAD_HEIGHT_RANGE) setStep('create')
  else if (step === 'create' && me && (Math.hypot(me.x - padPosition.x, me.z - padPosition.z) > LAB_PAD_RADIUS + 0.5 || Math.abs(me.y - padPosition.y) >= C.PAD_HEIGHT_RANGE)) setStep('walk')
  if (step === 'waiting' && cs.inGame && cs.game === PRACTICE_GAME && getSlotEntities().length === 3 && npc) {
    pendingEntry = false
    setStep('arrow')
  }
  if (['grab', 'lastGrab', 'retryGrab'].includes(step) && myHeldCubeId() >= 0 && !cubeGuessPending(myHeldCubeId())) {
    const held = cubeEntity(myHeldCubeId())
    // Only move on from server-confirmed progress; rejected speculative grabs may be undone.
    if (held !== undefined && CubeData.get(held).letter === goalLetter()) setStep(step === 'grab' ? 'throw' : step === 'lastGrab' ? 'lastThrow' : 'retryThrow')
  }
  if (step === 'place' && stage === 'assist') setStep('team')
  if (step === 'helping' && stage === 'last' && myState()?.masked[1] !== '_') setStep('lastGrab')
  if (step === 'lastPlace' && stage === 'won') setStep('win')
  if (step === 'rebuilding' && stage === 'retry' && myState()?.masked.startsWith(PRACTICE_WORDS[lang].answer.slice(0, 2))) setStep('retryGrab')
  if (step === 'retryPlace' && stage === 'complete') setStep('complete')
  // If a held cube was tossed or its optimistic grab was refused, resume the matching grab step.
  if (['place', 'lastPlace', 'retryPlace'].includes(step) && age > 2 && myHeldCubeId() < 0 && !Array.from(engine.getEntitiesWith(CubeData)).some(([, d]) => d.game === PRACTICE_GAME && d.mode === 'flying')) {
    if (step === 'place' && stage === 'first') setStep('grab')
    else if (step === 'lastPlace' && stage === 'last') setStep('lastGrab')
    else if (step === 'retryPlace' && stage === 'retry') setStep('retryGrab')
  }
  let target: Vector3 | undefined
  if (step === 'walk' || step === 'create') target = padPosition
  else if (['grab', 'lastGrab', 'retryGrab'].includes(step)) {
    let best = Infinity
    for (const [e, d] of engine.getEntitiesWith(CubeData)) {
      if (d.game !== PRACTICE_GAME || d.mode !== 'free' || d.letter !== goalLetter()) continue
      const p = Transform.getOrNull(e)?.position
      if (!p) continue
      const distance = me ? Vector3.distance(p, me) : 0
      if (distance < best) { best = distance; target = p; cs.practiceCubeId = d.id }
    }
  } else if (['place', 'lastPlace', 'retryPlace', 'arrow'].includes(step)) target = slotPosition(step === 'place' || step === 'arrow' ? 0 : 2, 3)
  mark(target)
  updateOverlay()
}

export function setupTutorial() {
  engine.addSystem(tutorialSystem, 2, 'word-cubes-tutorial')
}
