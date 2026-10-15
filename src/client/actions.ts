// Keyboard, native mobile controls and HUD buttons share the same game actions.
import { isStateSyncronized } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { isHolding } from './cubes'
import { playThrowEmote, stopHoldEmote } from './emotes'
import { showMessage } from './state'

function canSend() {
  if (isStateSyncronized()) return true
  showMessage('Connecting. Please try again in a moment.', 2)
  return false
}

export function useHint() {
  if (canSend()) room.send('hint', { n: 0 })
}

export function breakHeldCube() {
  if (!canSend()) return
  if (!isHolding()) return showMessage('Grab a cube first.', 2)
  stopHoldEmote()
  room.send('breakCube', { n: 0 })
}

export function tossHeldCube() {
  if (!canSend() || !isHolding()) return
  playThrowEmote()
  room.send('toss', { n: 0 })
}
