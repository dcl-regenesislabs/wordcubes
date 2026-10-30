// The two cube actions that also exist as keys (E / F) and, on phones, as HUD buttons.
import { room } from '../shared/messages'
import { isHolding } from './cubes'
import { playThrowEmote } from './emotes'
import { lockoutLeft, showMessage } from './state'

/** Break the cube you hold for coins (E). */
export function breakHeld() {
  if (!isHolding()) return showMessage('Nothing to break. Click a cube to grab it first.', 2)
  if (lockoutLeft() > 0) return showMessage(`Locked out: ${lockoutLeft()}s left.`, 2)
  room.send('breakCube', { n: 0 })
}

/** Throw the cube you hold away (F). */
export function tossHeld() {
  if (!isHolding()) return
  playThrowEmote()
  room.send('toss', { n: 0 })
}
