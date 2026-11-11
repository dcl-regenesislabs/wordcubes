// Cube actions: grab and throw at a frame (shown at once, see guessMode in cubenet.ts), and the two that also exist as
// keys (E / F) and, on phones, as HUD buttons.
import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { room } from '../shared/messages'
import { CubeData } from '../shared/schemas'
import { envOrigin } from '../shared/env'
import { isHolding } from './cubes'
import { cubeEntity, guessMode, myHeldCubeId } from './cubenet'
import { myState } from './gamestate'
import { cs } from './state'
import { SFX, playSfx } from './audio'
import { playThrowEmote } from './emotes'
import { lockoutLeft, showMessage } from './state'
import { t } from './i18n'

/** The checks the server makes before a grab (game.ts on_grab), so a guessed grab is almost never refused. */
function grabLooksOk(id: number): boolean {
  if (!cs.inGame || cs.game < 0 || myState()?.phase !== 'playing' || lockoutLeft() > 0 || isHolding()) return false
  const e = cubeEntity(id)
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (e === undefined || !me || CubeData.get(e).mode !== 'free') return false
  const o = envOrigin(cs.game)
  if (Math.hypot(me.x - o.x, me.z - o.z) <= C.STAGE_RADIUS && me.y >= o.y + C.STAGE_TOP - 0.1) return false // on the platform
  return Vector3.distance(me, Transform.get(e).position) <= C.PICKUP_CENTER_DISTANCE
}

/** Click on a cube: ask the server, and put it in your hands right away when it should say yes. */
export function grabCube(id: number) {
  room.send('grab', { cubeId: id })
  if (grabLooksOk(id)) guessMode(id, 'held', -1)
}

/** Click on a frame (or its tile in the HUD) while holding a cube: the throw starts now, the server checks it. */
export function throwAtFrame(slot: number) {
  playThrowEmote()
  playSfx(SFX.throw)
  room.send('place', { slot })
  const id = myHeldCubeId()
  const g = myState()
  const free = g && g.phase === 'playing' && (g.masked[slot] ?? '_') === '_'
  if (id >= 0 && free) guessMode(id, 'flying', slot)
}

/** Break the cube you hold for coins (E). */
export function breakHeld() {
  if (!isHolding()) return showMessage(t('msg.nothingToBreak'), 2)
  if (lockoutLeft() > 0) return showMessage(t('msg.locked', { s: lockoutLeft() }), 2)
  room.send('breakCube', { n: 0 })
}

/** Throw the cube you hold away (F). */
export function tossHeld() {
  if (!isHolding()) return
  playThrowEmote()
  playSfx(SFX.drop)
  const id = myHeldCubeId()
  room.send('toss', { n: 0 })
  if (id >= 0) guessMode(id, 'tossing', -1) // it leaves your hands now; the server's cube takes over when it answers
}
