// The model of a synced cube lives on a local child entity, not on the synced entity itself: a renderer that got the
// synced entity's Transform long before the model was added (you joined a game whose pile was already lying there)
// kept it invisible until the cube next moved. A fresh child brings its own Transform along with the model.
import { engine, Transform, GltfContainer, VisibilityComponent } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { modelFor } from '../shared/schemas'

const models = new Map<Entity, Entity>()

export function addCubeModel(cube: Entity, letter: string) {
  removeCubeModel(cube)
  const model = engine.addEntity()
  Transform.create(model, { parent: cube }) // the cube already carries CUBE_SCALE
  GltfContainer.create(model, { src: modelFor(letter), invisibleMeshesCollisionMask: 0, visibleMeshesCollisionMask: 0 })
  models.set(cube, model)
}

export function removeCubeModel(cube: Entity) {
  const model = models.get(cube)
  if (model === undefined) return
  engine.removeEntity(model)
  models.delete(cube)
}

/** Hide the real cube while a copy draws it (a predicted push, a fall, a smoothed glide), or show it again. */
export function setCubeHidden(cube: Entity, hidden: boolean) {
  const model = models.get(cube)
  if (model === undefined) return
  if (hidden) VisibilityComponent.createOrReplace(model, { visible: false })
  else VisibilityComponent.deleteFrom(model)
}
