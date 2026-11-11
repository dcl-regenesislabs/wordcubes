// Hold / throw scene emotes, reused from the MyDearPet scene (egg carry + ball throw).
// Scene emote files must end in `_emote.glb`. Masked upper-body so the player can still walk.
import { AvatarMask, AssetLoad, engine } from '@dcl/sdk/ecs'
import { triggerSceneEmote, stopEmote } from '~system/RestrictedActions'
import { HOLD_EMOTE, THROW_EMOTE } from '../config'
import { modelFor } from '../shared/schemas'

/**
 * Ask the renderer to load what a grab and a throw use before the first one: the two emotes, every letter cube (the
 * copy in your hands, in flight and in the frame is a new entity of that model) and the frame. Otherwise the first
 * grab of a letter waits for its download, which reads as lag on Bevy.
 */
export function preloadGrabAssets(): void {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ*'.split('')
  AssetLoad.create(engine.addEntity(), {
    assets: [HOLD_EMOTE, THROW_EMOTE, 'assets/models/CubeFrame.glb', ...letters.map(modelFor)]
  })
}

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

/** Ends the carry pose without the throw clip: for a guessed grab the server refused. */
export function stopHoldEmoteQuietly(): void {
  if (typeof stopEmote === 'function') void stopEmote({}).catch(() => {})
}

// A masked one-shot replaces the masked hold loop and ends it when it finishes.
export function playThrowEmote(): void {
  void triggerSceneEmote({ src: THROW_EMOTE, loop: false, mask: AvatarMask.AM_UPPER_BODY }).catch(() => {})
}
