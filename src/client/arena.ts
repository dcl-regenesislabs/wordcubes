import {
  engine,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  GltfContainer,
  ColliderLayer,
  pointerEventsSystem,
  InputAction
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'

let slotEntities: Entity[] = []
let onSlotClick: (index: number) => void = () => {}
export function setSlotClickHandler(fn: (index: number) => void) {
  onSlotClick = fn
}

export function slotPosition(index: number, count: number): Vector3 {
  const offset = (index - (count - 1) / 2) * C.SLOT_SPACING
  return Vector3.create(C.CENTER.x + offset, C.SLOT_Y, C.CENTER.z)
}

function colored(entity: Entity, color: Color4) {
  Material.setPbrMaterial(entity, { albedoColor: color, metallic: 0, roughness: 1 })
}

export function buildArena() {
  // floor disc
  const floor = engine.addEntity()
  Transform.create(floor, {
    position: Vector3.create(C.CENTER.x, C.FLOOR_Y / 2 - 0.05, C.CENTER.z),
    scale: Vector3.create(C.ARENA_RADIUS * 2, C.FLOOR_Y + 0.1, C.ARENA_RADIUS * 2)
  })
  MeshRenderer.setCylinder(floor)
  MeshCollider.setCylinder(floor)
  colored(floor, Color4.create(0.22, 0.24, 0.3, 1))

  // central stage: two low tiers you can walk onto
  const tiers: [number, number, Color4][] = [
    [C.STAGE_RADIUS, C.STAGE_TOP, Color4.create(0.62, 0.45, 0.62, 1)],
    [C.STAGE_UPPER_RADIUS, C.STAGE_UPPER_TOP, Color4.create(0.85, 0.62, 0.7, 1)]
  ]
  for (const [radius, top, color] of tiers) {
    const tier = engine.addEntity()
    Transform.create(tier, {
      position: Vector3.create(C.CENTER.x, top / 2, C.CENTER.z),
      scale: Vector3.create(radius * 2, top, radius * 2)
    })
    MeshRenderer.setCylinder(tier)
    MeshCollider.setCylinder(tier)
    colored(tier, color)
  }

  // circular wall made of boxes
  const segW = ((2 * Math.PI * (C.ARENA_RADIUS + 0.5)) / C.WALL_SEGMENTS) * 1.05
  for (let i = 0; i < C.WALL_SEGMENTS; i++) {
    const a = (i / C.WALL_SEGMENTS) * Math.PI * 2
    const r = C.ARENA_RADIUS + 0.5
    const wall = engine.addEntity()
    Transform.create(wall, {
      position: Vector3.create(C.CENTER.x + Math.cos(a) * r, C.WALL_HEIGHT / 2, C.CENTER.z + Math.sin(a) * r),
      rotation: Quaternion.fromEulerDegrees(0, -(a * 180) / Math.PI + 90, 0),
      scale: Vector3.create(segW, C.WALL_HEIGHT, 1)
    })
    MeshRenderer.setBox(wall)
    MeshCollider.setBox(wall)
    colored(wall, i % 2 === 0 ? Color4.create(0.35, 0.4, 0.55, 1) : Color4.create(0.3, 0.35, 0.5, 1))
  }
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
