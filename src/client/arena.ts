import {
  engine,
  Transform,
  GltfContainer,
  ColliderLayer,
  pointerEventsSystem,
  InputAction
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { envOrigin } from '../shared/env'

let slotEntities: Entity[] = []
let onSlotClick: (index: number) => void = () => {}
export function setSlotClickHandler(fn: (index: number) => void) {
  onSlotClick = fn
}

export function slotPosition(index: number, count: number): Vector3 {
  const offset = (index - (count - 1) / 2) * C.SLOT_SPACING
  const o = envOrigin()
  return Vector3.create(o.x + offset, o.y + C.SLOT_Y, o.z)
}

// Build the empty slot frames for the current word. One frame per letter.
export function buildSlots(count: number) {
  clearSlots()
  for (let i = 0; i < count; i++) {
    const e = engine.addEntity()
    Transform.create(e, { position: slotPosition(i, count), scale: Vector3.scale(Vector3.One(), C.CUBE_SCALE) })
    GltfContainer.create(e, {
      src: 'assets/models/CubeFrame.glb',
      // the frame GLB has no `_collider` node, so make the visible mesh clickable
      visibleMeshesCollisionMask: ColliderLayer.CL_POINTER
    })
    pointerEventsSystem.onPointerDown(
      { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: 'Place cube', maxDistance: C.INTERACT_DISTANCE } },
      () => onSlotClick(i)
    )
    slotEntities.push(e)
  }
}

export function getSlotEntities(): Entity[] {
  return slotEntities
}

export function clearSlots() {
  for (const e of slotEntities) {
    pointerEventsSystem.removeOnPointerDown(e)
    engine.removeEntity(e)
  }
  slotEntities = []
}
