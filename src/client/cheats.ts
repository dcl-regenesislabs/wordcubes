// TESTING ONLY (CHEATS_ENABLED in config): the S cube of the lobby's "WORD CUBES" blocks is a hidden button that gives coins.
import { engine, GltfContainer, ColliderLayer, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import * as C from '../config'
import { room } from '../shared/messages'

export function setupCheats() {
  if (!C.CHEATS_ENABLED) return
  let done = false
  engine.addSystem(() => {
    if (done) return
    const cube = engine.getEntityOrNullByName(C.CHEAT_ENTITY)
    const gltf = cube !== null ? GltfContainer.getOrNull(cube) : null
    if (cube === null || !gltf) return // the composite has not loaded yet
    done = true
    // the decoration has no collider, so make its mesh clickable (no hover text: it is meant to stay hidden)
    GltfContainer.getMutable(cube).visibleMeshesCollisionMask = (gltf.visibleMeshesCollisionMask ?? 0) | ColliderLayer.CL_POINTER
    pointerEventsSystem.onPointerDown({ entity: cube, opts: { button: InputAction.IA_POINTER, maxDistance: 14 } }, () => room.send('cheat', { n: 0 }))
  }, 1, 'word-cubes-cheats')
}
