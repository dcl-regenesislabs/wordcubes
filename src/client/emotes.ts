// Hold / throw scene emotes, reused from the MyDearPet scene (egg carry + ball throw).
// Scene emote files must end in `_emote.glb`. Masked upper-body so the player can still walk.
import { AvatarMask } from '@dcl/sdk/ecs'
import { triggerSceneEmote, stopEmote } from '~system/RestrictedActions'
import { HOLD_EMOTE, THROW_EMOTE } from '../config'

export function playHoldEmote(): void {
  void triggerSceneEmote({ src: HOLD_EMOTE, loop: true, mask: AvatarMask.AM_UPPER_BODY }).catch(() => {})
}

// Ends the carry pose. stopEmote isn't callable on every client build, so it is guarded. A masked one-shot
// ends the masked carry loop for good once it finishes, so the short throw clip is played as the way out
// (re-playing the carry clip itself with loop:false showed the whole 2s carry pose again).
export function stopHoldEmote(): void {
  if (typeof stopEmote === 'function') void stopEmote({}).catch(() => {})
  playThrowEmote()
}

// A masked one-shot replaces the masked hold loop and ends it when it finishes.
export function playThrowEmote(): void {
  void triggerSceneEmote({ src: THROW_EMOTE, loop: false, mask: AvatarMask.AM_UPPER_BODY }).catch(() => {})
}
