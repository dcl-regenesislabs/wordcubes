// Public games use server prediction; the single-player laboratory handles grabs and throws locally.
// Cube actions: grab and throw at a frame, and the two that also exist as
// keys (E / F) and, on phones, as HUD buttons.
import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { room } from '../shared/messages'
import { CubeData } from '../shared/schemas'
import { envOrigin } from '../shared/env'
import { isHolding } from './cubes'
import { cubeEntity, guessMode, myHeldCubeId, slotTaken } from './cubenet'
import { myState } from './gamestate'
import { cs } from './state'
import { SFX, playSfx } from './audio'
import { playThrowEmote } from './emotes'
import { lockoutLeft, showMessage, pingLockout } from './state'
import { t } from './i18n'
import { mobile } from './ui/platform'
import { PRACTICE_GAME } from '../shared/tutorial'
import { grabLocalCube, placeLocalCube, localLetterCube } from './practice'

/**
 * Most of the checks the server makes before a grab (game.ts on_grab), so a guessed grab is rarely refused. Not full
 * parity: the server also wants you standing in the arena (canPlay) and measures the reach from your last position it
 * received, while this uses your live one, so a grab while running can still be refused (and undone after
 * GUESS_CONFIRM_SECONDS). Holding is read from the live cube state guessMode writes, not from cubes.ts's per-frame view,
 * so two clicks in one frame cannot both guess a grab.
 */
function grabLooksOk(id: number): boolean {
  if (!cs.inGame || cs.game < 0 || myState()?.phase !== 'playing' || lockoutLeft() > 0 || myHeldCubeId() >= 0) return false
  const e = cubeEntity(id)
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (e === undefined || !me || CubeData.get(e).mode !== 'free') return false
  const o = envOrigin(cs.game)
  if (Math.hypot(me.x - o.x, me.z - o.z) <= C.STAGE_RADIUS && me.y >= o.y + C.STAGE_TOP - 0.1) return false // on the platform
  return Vector3.distance(me, Transform.get(e).position) <= C.PICKUP_CENTER_DISTANCE
}

/** The tutorial's touch button targets the highlighted cube, without requiring a precise world ray. */
export function grabTutorialCube() {
  if (!mobile() || !cs.tutorialActive || cs.tutorialCinematic || cs.practiceTouchReady === false) return
  const id = cs.practiceCubeId >= 0 ? cs.practiceCubeId : localLetterCube(cs.practiceLetter)
  if (id >= 0) grabCube(id)
}

/** Click on a cube: ask the server, and put it in your hands right away when it should say yes. */
export function grabCube(id: number) {
  if (mobile() && cs.tutorialActive && cs.practiceTouchReady === false) return
  if (cs.tutorialCinematic) return
  if (cs.tutorialActive) {
    const e = cubeEntity(id)
    if (e === undefined || !cs.practiceLetter || CubeData.get(e).letter !== cs.practiceLetter) return showMessage(t('tutorial.needed', { letter: cs.practiceLetter }), 2)
  }
  if (cs.game === PRACTICE_GAME) { grabLocalCube(id); return }
  // locked out: the banner hops (it already says why and for how long); no need to ask the server to refuse it
  if (lockoutLeft() > 0) return pingLockout()
  room.send('grab', { cubeId: id })
  if (grabLooksOk(id)) guessMode(id, 'held', -1)
}

/** Click on a frame (or its tile in the HUD) while holding a cube: the throw starts now, the server checks it. */
export function throwAtFrame(slot: number) {
  if (mobile() && cs.tutorialActive && cs.practiceTouchReady === false) return
  if (cs.tutorialCinematic) return
  if (cs.tutorialActive && slot !== cs.practiceSlot) return showMessage(t('tutorial.useMarkedFrame'), 2)
  playThrowEmote()
  playSfx(SFX.throw)
  if (cs.game === PRACTICE_GAME) { placeLocalCube(slot); return }
  room.send('place', { slot })
  const id = myHeldCubeId()
  const g = myState()
  // the server refuses a frame with a cube in it or on its way to it; GameState only shows the placed ones, the cubes of
  // your game (cubenet.ts) show the ones in flight too
  const free = g && g.phase === 'playing' && (g.masked[slot] ?? '_') === '_' && !slotTaken(slot, id)
  if (id >= 0 && free) guessMode(id, 'flying', slot)
}

/** Break the cube you hold for coins (E). */
export function breakHeld() {
  if (cs.tutorialActive) return
  if (!isHolding()) return showMessage(t('msg.nothingToBreak'), 2)
  if (lockoutLeft() > 0) return pingLockout()
  room.send('breakCube', { n: 0 })
}

/** Throw the cube you hold away (F). */
export function tossHeld() {
  if (cs.game === PRACTICE_GAME) return
  if (cs.tutorialCinematic) return
  if (!isHolding()) return
  playThrowEmote()
  playSfx(SFX.drop)
  const id = myHeldCubeId()
  room.send('toss', { n: 0 })
  if (id >= 0) guessMode(id, 'tossing', -1) // it leaves your hands now; the server's cube takes over when it answers
}
