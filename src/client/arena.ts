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
import { PRACTICE_GAME } from '../shared/tutorial'
import { t } from './i18n'
import { envOrigin } from '../shared/env'
import { cs } from './state'

// Apply on each client once the composite has loaded. Using GameEnv keeps the
// region centred on the arena when it moves, with enough height for stage jumps.
export function disableArenaPassports() {
  const arena = engine.getEntityOrNullByName(C.ARENA_TEMPLATE)
  if (!arena || !Transform.has(arena) || AvatarModifierArea.has(arena)) return
  addPassportBlocker(arena)
  addArenaFence(arena)
}

/** An invisible wall all the way round a game's island, too tall to jump: you can walk anywhere on it (the shop
 *  included) but not jump to another island or fall off, and the only way back to the lobby is the HUD button. A ring
 *  of FENCE_SEGMENTS physics-only boxes, children of the arena root (so they follow it and go with it), at the island's
 *  edge. Players only: cubes live in our own sim, and clicks (pointer layer) and teleports pass through. Returns the
 *  boxes (for teardown). */
export function addArenaFence(arena: Entity): Entity[] {
  const n = C.FENCE_SEGMENTS
  const r = C.FENCE_RADIUS + C.FENCE_THICKNESS / 2 // centre line of the boxes: their inner face sits at FENCE_RADIUS
  const width = 2 * r * Math.tan(Math.PI / n) + C.FENCE_THICKNESS // a little overlap at the corners, so no gaps
  const parts: Entity[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const box = engine.addEntity()
    Transform.create(box, {
      parent: arena,
      position: Vector3.create(Math.cos(a) * r, C.FLOOR_Y + C.FENCE_HEIGHT / 2 - 1, Math.sin(a) * r),
      // the box's local x runs along the ring: turn it to the tangent (yaw -a in this left-handed frame)
      rotation: Quaternion.fromEulerDegrees(0, 90 - (a * 180) / Math.PI, 0),
      scale: Vector3.create(width, C.FENCE_HEIGHT, C.FENCE_THICKNESS)
    })
    MeshCollider.setBox(box, ColliderLayer.CL_PHYSICS)
    parts.push(box)
  }
  return parts
}

/** No avatar passports inside an arena (the dynamic arenas call this for their own root, too). */
export function addPassportBlocker(arena: Entity) {
  const diameter = C.ARENA_RADIUS * 2
  AvatarModifierArea.create(arena, {
    area: Vector3.create(diameter, diameter, diameter),
    excludeIds: [],
    modifiers: [AvatarModifierType.AMT_DISABLE_PASSPORTS]
  })
}

const slots: { target: Entity; frame: Entity }[] = []
export const slotHitScale = Vector3.create(C.SLOT_HIT_WIDTH, C.SLOT_HIT_HEIGHT, C.SLOT_HIT_DEPTH)
let startArrow: Entity | null = null
let onSlotClick: (index: number) => void = () => {}
export function setSlotClickHandler(fn: (index: number) => void) {
  onSlotClick = fn
}

/** Same as clicking frame `index` in the world: used by the letter tiles in the HUD. */
export function clickSlot(index: number) {
  onSlotClick(index)
}

export function slotPosition(index: number, count: number): Vector3 {
  const offset = (index - (count - 1) / 2) * C.SLOT_SPACING
  const o = envOrigin(Math.max(0, cs.game))
  return Vector3.create(o.x + offset, o.y + C.SLOT_Y, o.z)
}

// Build the empty slot frames for the current word. One frame per letter.
export function buildSlots(count: number) {
  clearSlots()
  for (let i = 0; i < count; i++) {
    // Like Kickoff's dispensers, the pointer collider is the parent of the visible model.
    const target = engine.addEntity()
    Transform.create(target, { position: slotPosition(i, count), scale: slotHitScale })
    MeshCollider.setBox(target, ColliderLayer.CL_POINTER)
    const frame = engine.addEntity()
    Transform.create(frame, {
      parent: target,
      scale: Vector3.create(C.CUBE_SCALE / slotHitScale.x, C.CUBE_SCALE / slotHitScale.y, C.CUBE_SCALE / slotHitScale.z)
    })
    GltfContainer.create(frame, {
      src: 'assets/models/CubeFrame.glb',
      visibleMeshesCollisionMask: 0,
      invisibleMeshesCollisionMask: 0
    })
    pointerEventsSystem.onPointerDown(
      {
        entity: target,
        opts: {
          button: InputAction.IA_POINTER,
          hoverText: t('hover.place'),
          maxDistance: cs.game === PRACTICE_GAME ? 16 : C.INTERACT_DISTANCE,
          showHighlight: true
        }
      },
      () => {
        if (cs.tutorialActive && cs.practiceUiOnly) return
        onSlotClick(i)
      }
    )
    slots.push({ target, frame })
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

export function getSlots(): ReadonlyArray<{ target: Entity; frame: Entity }> {
  return slots
}

export function startArrowEntity(): Entity | null { return startArrow }

export function clearSlots() {
  for (const { target, frame } of slots) {
    pointerEventsSystem.removeOnPointerDown(target)
    engine.removeEntity(frame)
    engine.removeEntity(target)
  }
  slots.length = 0
  if (startArrow) engine.removeEntity(startArrow)
  startArrow = null
}
