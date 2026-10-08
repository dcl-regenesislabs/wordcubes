// Client view of the server's cubes. Free cubes are rendered from their synced Transform. For every other mode the
// server parks the real cube underground and this module draws a local copy ("proxy"): carried on a player's head
// bone, flying to a frame, or sitting in a frame.
import {
  engine,
  Transform,
  GltfContainer,
  VisibilityComponent,
  AvatarAttach,
  AvatarAnchorPointType,
  PlayerIdentityData,
  pointerEventsSystem,
  InputAction,
  MeshCollider,
  ColliderLayer
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { CubeData, modelFor } from '../shared/schemas'
import { room } from '../shared/messages'
import { slotPosition } from './arena'
import { playHoldEmote } from './emotes'
import { cs } from './state'
import { isPredicted } from './predict'

interface ClientCube {
  mode: string
  holder: string
  slot: number
  letter: string
  proxy: Entity | null
  t: number // seconds since the mode started
  from: Vector3 // flight start
  length: number // word length when the flight started (frame layout)
  // smoothing of free cubes: the server's snapshots are interpolated into a local copy
  lastPos: Vector3 | null
  vel: Vector3
  sinceSnap: number
  idle: number
  smooth: Entity | null
  // Local click target riding on the synced cube (the server gives the cube no collider). Switched off while the
  // cube is drawn as a predicted copy (the copy carries its own click) so there is never a second, invisible target.
  hit: Entity
  hitOn: boolean
}

const known = new Map<Entity, ClientCube>()
const anchors = new Map<string, Entity>()
export const placedProxy = new Map<number, Entity>() // slot -> proxy entity of the cube placed there

export let wordLength = 0
export function setWordLength(n: number) {
  wordLength = n
}

export function isHolding(): boolean {
  for (const c of known.values()) if (c.mode === 'held' && c.holder === cs.myAddress) return true
  return false
}

export function heldLetter(): string {
  for (const c of known.values()) if (c.mode === 'held' && c.holder === cs.myAddress) return c.letter
  return ''
}

function anchorFor(address: string): Entity {
  const existing = anchors.get(address)
  if (existing !== undefined) return existing
  const e = engine.addEntity()
  Transform.create(e, {})
  // the local player's own anchor needs no avatarId
  if (address === cs.myAddress) AvatarAttach.create(e, { anchorPointId: AvatarAnchorPointType.AAPT_HEAD })
  else AvatarAttach.create(e, { avatarId: address, anchorPointId: AvatarAnchorPointType.AAPT_HEAD })
  anchors.set(address, e)
  return e
}

// Approximate world position of a player's hand (works for any player present in the scene).
function handPos(address: string): Vector3 {
  let t = address === cs.myAddress ? Transform.getOrNull(engine.PlayerEntity) : null
  if (!t) {
    for (const [e, id] of engine.getEntitiesWith(PlayerIdentityData)) {
      if (id.address.toLowerCase() === address) {
        t = Transform.getOrNull(e)
        break
      }
    }
  }
  if (!t) return Vector3.create(C.CENTER.x, C.HAND_HEIGHT, C.CENTER.z)
  const fwd = Vector3.rotate(Vector3.Forward(), t.rotation)
  const right = Vector3.rotate(Vector3.Right(), t.rotation)
  return Vector3.create(
    t.position.x + fwd.x * C.HAND_FORWARD + right.x * C.HAND_RIGHT,
    t.position.y + C.HAND_HEIGHT,
    t.position.z + fwd.z * C.HAND_FORWARD + right.z * C.HAND_RIGHT
  )
}

function makeProxy(letter: string): Entity {
  const e = engine.addEntity()
  Transform.create(e, { scale: Vector3.scale(Vector3.One(), C.CUBE_SCALE) })
  GltfContainer.create(e, { src: modelFor(letter), invisibleMeshesCollisionMask: 0, visibleMeshesCollisionMask: 0 })
  return e
}

function dropProxy(c: ClientCube) {
  if (!c.proxy) return
  for (const [slot, e] of placedProxy) if (e === c.proxy) placedProxy.delete(slot)
  engine.removeEntity(c.proxy)
  c.proxy = null
}

function removeSmooth(entity: Entity, c: ClientCube) {
  if (c.smooth) {
    engine.removeEntity(c.smooth)
    c.smooth = null
    VisibilityComponent.deleteFrom(entity)
  }
}

function enterMode(entity: Entity, c: ClientCube, mode: string, holder: string, slot: number) {
  removeSmooth(entity, c)
  c.lastPos = null
  dropProxy(c)
  c.mode = mode
  c.holder = holder
  c.slot = slot
  c.t = 0
  if (mode === 'held') {
    c.proxy = makeProxy(c.letter)
    const t = Transform.getMutable(c.proxy)
    t.parent = anchorFor(holder)
    t.position = Vector3.create(C.CARRY_OFFSET.x, C.CARRY_OFFSET.y, C.CARRY_OFFSET.z)
    t.scale = Vector3.scale(Vector3.One(), C.HOLD_SCALE)
    if (holder === cs.myAddress) playHoldEmote()
  } else if (mode === 'flying') {
    c.proxy = makeProxy(c.letter)
    c.from = handPos(holder)
    c.length = wordLength
    Transform.getMutable(c.proxy).position = anchorStart(c)
  } else if (mode === 'placed') {
    c.proxy = makeProxy(c.letter)
    placedProxy.set(slot, c.proxy)
    const t = Transform.getMutable(c.proxy)
    t.position = slotPosition(slot, wordLength)
    t.rotation = Quaternion.fromEulerDegrees(0, C.PLACED_YAW, C.PLACED_ROLL)
  }
}

function anchorStart(c: ClientCube): Vector3 {
  return Vector3.create(c.from.x, c.from.y, c.from.z)
}

// Free cubes arrive as sparse snapshots. While a cube is moving, show a local copy that chases the latest snapshot
// (plus a short extrapolation along its velocity) and hide the real one; when it settles, swap back.
function smoothFree(entity: Entity, c: ClientCube, dt: number) {
  const tr = Transform.getOrNull(entity)
  if (!tr) return
  const p = tr.position
  c.sinceSnap += dt
  if (!c.lastPos) {
    c.lastPos = Vector3.create(p.x, p.y, p.z)
    return
  }
  const dx = p.x - c.lastPos.x
  const dy = p.y - c.lastPos.y
  const dz = p.z - c.lastPos.z
  const moved = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (moved > 0.002) {
    const span = Math.max(c.sinceSnap, 1 / 60)
    c.vel = moved > 3 ? Vector3.Zero() : Vector3.create(dx / span, dy / span, dz / span)
    c.lastPos = Vector3.create(p.x, p.y, p.z)
    c.sinceSnap = 0
    c.idle = 0
    if (!c.smooth) {
      c.smooth = makeProxy(c.letter)
      const t = Transform.getMutable(c.smooth)
      t.position = Vector3.create(p.x - dx, p.y - dy, p.z - dz) // where the cube was a moment ago
      t.rotation = tr.rotation
      VisibilityComponent.createOrReplace(entity, { visible: false })
    } else if (moved > 3) {
      Transform.getMutable(c.smooth).position = Vector3.create(p.x, p.y, p.z) // teleport: no gliding
    }
  } else {
    c.idle += dt
  }
  if (!c.smooth) return
  if (c.idle > 0.5) {
    removeSmooth(entity, c)
    return
  }
  const lead = Math.min(c.sinceSnap, 0.15)
  const k = Math.min(1, dt * 18)
  const t = Transform.getMutable(c.smooth)
  t.position = Vector3.create(
    t.position.x + (c.lastPos.x + c.vel.x * lead - t.position.x) * k,
    t.position.y + (c.lastPos.y + c.vel.y * lead - t.position.y) * k,
    t.position.z + (c.lastPos.z + c.vel.z * lead - t.position.z) * k
  )
  t.rotation = Quaternion.slerp(t.rotation, tr.rotation, k)
}

export function cubesSystem(dt: number) {
  const seen = new Set<Entity>()
  for (const [entity, data] of engine.getEntitiesWith(CubeData)) {
    seen.add(entity)
    let c = known.get(entity)
    if (!c) {
      const hit = engine.addEntity()
      // Child of the cube: the GLB's collider is a 0.5 m box, the parent already carries CUBE_SCALE.
      Transform.create(hit, { parent: entity, scale: Vector3.create(0.5, 0.5, 0.5) })
      MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)
      c = { mode: 'free', holder: '', slot: -1, letter: data.letter, proxy: null, t: 0, from: Vector3.Zero(), length: wordLength, lastPos: null, vel: Vector3.Zero(), sinceSnap: 0, idle: 0, smooth: null, hit, hitOn: true }
      known.set(entity, c)
      const id = data.id
      const letter = data.letter
      pointerEventsSystem.onPointerDown(
        { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: `Grab ${letter}`, maxDistance: C.INTERACT_DISTANCE } },
        () => room.send('grab', { cubeId: id })
      )
    }
    if (data.mode !== c.mode || data.holder !== c.holder || data.slot !== c.slot) enterMode(entity, c, data.mode, data.holder, data.slot)

    c.t += dt
    const predicted = isPredicted(entity)
    const hitOn = c.mode === 'free' && !predicted
    if (hitOn !== c.hitOn) {
      c.hitOn = hitOn
      MeshCollider.setBox(c.hit, hitOn ? ColliderLayer.CL_POINTER : ColliderLayer.CL_NONE)
    }
    if (c.mode === 'free' && C.SMOOTH_FREE_CUBES && !predicted) smoothFree(entity, c, dt)
    if (c.mode === 'flying' && c.proxy) {
      const delay = C.THROW_RELEASE_DELAY
      const u = Math.max(0, Math.min(1, (c.t - delay) / C.THROW_FLIGHT_TIME))
      const to = slotPosition(c.slot, c.length || wordLength)
      const t = Transform.getMutable(c.proxy)
      if (c.t < delay) {
        t.position = handPos(c.holder) // still in the hand until the throw releases
        c.from = t.position
      } else {
        t.position = Vector3.create(
          c.from.x + (to.x - c.from.x) * u,
          c.from.y + (to.y - c.from.y) * u + Math.sin(Math.PI * u) * C.THROW_ARC_HEIGHT,
          c.from.z + (to.z - c.from.z) * u
        )
        t.rotation = Quaternion.fromEulerDegrees((1 - u) * 360, C.PLACED_YAW + (1 - u) * 360, C.PLACED_ROLL)
      }
    }
  }

  // cubes the server removed
  for (const [entity, c] of Array.from(known.entries())) {
    if (seen.has(entity)) continue
    if (c.smooth) engine.removeEntity(c.smooth)
    dropProxy(c)
    pointerEventsSystem.removeOnPointerDown(c.hit)
    engine.removeEntity(c.hit)
    known.delete(entity)
  }
}
