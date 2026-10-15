import {
  engine,
  AvatarModifierArea,
  AvatarModifierType,
  Transform,
  GltfContainer,
  Animator,
  MeshCollider,
  ColliderLayer,
  pointerEventsSystem,
  InputAction
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { envOrigin } from '../shared/env'
import { EntityNames } from '../../assets/scene/entity-names'

// Apply on each client once the composite has loaded. Using GameEnv keeps the
// region centred on the arena when it moves, with enough height for stage jumps.
export function disableArenaPassports() {
  const arena = engine.getEntityOrNullByName(EntityNames.GameEnv)
  if (!arena || !Transform.has(arena) || AvatarModifierArea.has(arena)) return
  const diameter = C.ARENA_RADIUS * 2
  AvatarModifierArea.create(arena, {
    area: Vector3.create(diameter, diameter, diameter),
    excludeIds: [],
    modifiers: [AvatarModifierType.AMT_DISABLE_PASSPORTS]
  })
}

let slotEntities: Entity[] = []
let slotHits: Entity[] = []
let startArrow: Entity | null = null
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
    // Invisible box filling the frame's hole, so clicking the middle works too (not just the thin border).
    // Child of the frame: it follows the frame's pulse/shake/wave. Same 0.5 m size as the cube collider.
    const hit = engine.addEntity()
    Transform.create(hit, { parent: e, scale: Vector3.create(0.5, 0.5, 0.5) })
    MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)
    for (const target of [e, hit]) {
      pointerEventsSystem.onPointerDown(
        { entity: target, opts: { button: InputAction.IA_POINTER, hoverText: 'Place cube', maxDistance: C.INTERACT_DISTANCE } },
        () => onSlotClick(i)
      )
    }
    slotEntities.push(e)
    slotHits.push(hit)
  }
  buildStartArrow(count)
}

// Arrow beside the first frame, pointing along the word (+x), so you can tell where it starts and which
// way it reads from any side of the stage. The GLB is a flat arrow lying down, pointing along +z, and sits
// off its own origin (tip at ~(0, 0.72, 1.16)). Roll it 90° around its length so it stands upright,
// yaw it to +x, then place it so the tip lands START_ARROW_GAP before the first frame.
const ARROW_TIP = Vector3.create(0, 0.72, 1.16)
function buildStartArrow(count: number) {
  const first = slotPosition(0, count)
  const rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, 90, 0), Quaternion.fromEulerDegrees(0, 0, 90))
  const tip = Vector3.rotate(Vector3.scale(ARROW_TIP, C.START_ARROW_SCALE), rotation)
  const frameHalf = 0.255 * C.CUBE_SCALE
  startArrow = engine.addEntity()
  Transform.create(startArrow, {
    position: Vector3.create(first.x - frameHalf - C.START_ARROW_GAP - tip.x, first.y - tip.y, first.z - tip.z),
    rotation,
    scale: Vector3.scale(Vector3.One(), C.START_ARROW_SCALE)
  })
  GltfContainer.create(startArrow, { src: 'models/PathArrow.glb' })
  Animator.create(startArrow, { states: [{ clip: 'Cube.008Action', playing: true, loop: true }] })
}

export function getSlotEntities(): Entity[] {
  return slotEntities
}

export function clearSlots() {
  for (const e of [...slotHits, ...slotEntities]) {
    pointerEventsSystem.removeOnPointerDown(e)
    engine.removeEntity(e)
  }
  slotEntities = []
  slotHits = []
  if (startArrow) engine.removeEntity(startArrow)
  startArrow = null
}
