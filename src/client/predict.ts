// Local push prediction. The server owns the cube pile, so a cube you walk into only moves once the server has seen
// you move, which feels laggy. Here the client runs the same sim (sim/physics.ts) on a local copy of the free cubes
// around the players, with every player as a pusher *where this client sees them*:
//
// - A cube the local sim moves becomes "predicted": its real (synced) entity is hidden and a pooled local copy is
//   drawn where the local sim says it is.
// - Once you have stopped touching it and it has settled, it glides to the position the server sent, and when it
//   gets there the real cube is shown again and the copy goes back to the pool.
//
// - You push with your real position, so your own pushes react on the same frame.
// - Other players push with the position their avatar is drawn at here. Their avatar reaches us through comms
//   faster than the server's cube updates do, so without this you would see them walk through the pile and the cubes
//   react a moment later. Now the cubes move when their avatar touches them on your screen.
//
// The server stays the only truth: every predicted cube ends up where the server put it.
import {
  engine,
  Transform,
  GltfContainer,
  GltfContainerLoadingState,
  VisibilityComponent,
  ColliderLayer,
  pointerEventsSystem,
  InputAction,
  PlayerIdentityData,
  LoadingState
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { CubeData, modelFor } from '../shared/schemas'
import { room } from '../shared/messages'
import { worldParams } from '../shared/world'
import { PusherTracker } from '../shared/pushers'
import { createWorld, addBody, removeBody, setPushers, step } from '../sim/physics'
import type { Body, Pusher } from '../sim/physics'
import { cs } from './state'

const POOL_Y = -40 // pooled copies wait hidden, underground
const SETTLED_SPEED = 0.5 // m/s: below this a cube counts as settled for the handoff
const ARRIVED = 0.04 // m: close enough to the server position to swap back to the real cube
const MOVED = 0.02 // m: a woken cube that has not moved this far keeps showing the real cube
const SPARES = 2 // loaded idle copies kept per letter near the player; extras are freed when they come back
const MAX_STEPS = 3 // sim sub-steps per frame, like the server (a long frame drops the rest instead of spiralling)

interface Copy {
  entity: Entity
  letter: string
  cubeId: number // cube currently drawn by this copy, -1 while pooled
}

interface Local {
  entity: Entity // the real, synced cube
  id: number
  letter: string
  body: Body
  copy: Copy | null // set while predicted
  sinceTouch: number
  age: number // seconds predicted
}

const world = createWorld(worldParams())
const locals = new Map<Entity, Local>()
const pool = new Map<string, Copy[]>() // letter -> idle copies
const STEP_MAX = 1 / 30

/** Same pusher construction as the server (speed smoothing + PUSH_LOOKAHEAD), so the local sim shoves cubes the way
 *  the server will and the hand-off back to the server's position has as little error as possible. */
const pusherTracker = new PusherTracker()

function playerPushers(dt: number, self: Vector3): Pusher[] {
  const present = new Set<string>(['self'])
  const out: Pusher[] = [pusherTracker.update('self', self.x, self.y, self.z, dt)]
  if (C.PREDICT_REMOTE_PUSHES) {
    // other players push from where their avatar is drawn on this screen
    for (const [entity, identity, t] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
      if (entity === engine.PlayerEntity) continue
      const address = identity.address.toLowerCase()
      if (address === cs.myAddress) continue
      present.add(address)
      out.push(pusherTracker.update(address, t.position.x, t.position.y, t.position.z, dt))
    }
  }
  pusherTracker.prune(present)
  return out
}

/** True while the local copy is drawn instead of the real cube. cubes.ts then switches off the real cube's click
 *  target (the copy carries its own) and skips its optional SMOOTH_FREE_CUBES smoothing. */
export function isPredicted(entity: Entity): boolean {
  return !!locals.get(entity)?.copy
}

// ---------- pooled copies ----------

function newCopy(letter: string): Copy {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(C.CENTER.x, POOL_Y, C.CENTER.z),
    scale: Vector3.scale(Vector3.One(), C.CUBE_SCALE)
  })
  GltfContainer.create(entity, {
    src: modelFor(letter),
    invisibleMeshesCollisionMask: ColliderLayer.CL_POINTER,
    visibleMeshesCollisionMask: 0
  })
  VisibilityComponent.create(entity, { visible: false }) // shown only while it draws a predicted cube
  const copy: Copy = { entity, letter, cubeId: -1 }
  // The copy is what you see, so it is also what you click to grab the cube.
  pointerEventsSystem.onPointerDown(
    { entity, opts: { button: InputAction.IA_POINTER, hoverText: `Grab ${letter}`, maxDistance: C.INTERACT_DISTANCE } },
    () => {
      if (copy.cubeId >= 0) room.send('grab', { cubeId: copy.cubeId })
    }
  )
  return copy
}

function ready(copy: Copy): boolean {
  return GltfContainerLoadingState.getOrNull(copy.entity)?.currentState === LoadingState.FINISHED
}

/** Keep loaded spares for every letter near the player, so a push never waits on a model load. */
function warm(letter: string) {
  let list = pool.get(letter)
  if (!list) {
    list = []
    pool.set(letter, list)
  }
  while (list.length < SPARES) list.push(newCopy(letter))
}

function takeCopy(letter: string): Copy | null {
  const list = pool.get(letter)
  if (!list) return null
  const i = list.findIndex(ready)
  if (i < 0) return null
  const [copy] = list.splice(i, 1)
  while (list.length < SPARES) list.push(newCopy(letter)) // the next spare starts loading now
  return copy
}

function returnCopy(copy: Copy) {
  copy.cubeId = -1
  const list = pool.get(copy.letter)!
  if (list.length >= SPARES) {
    // enough spares of this letter already: free it instead of keeping it loaded forever
    pointerEventsSystem.removeOnPointerDown(copy.entity)
    engine.removeEntity(copy.entity)
    return
  }
  VisibilityComponent.getMutable(copy.entity).visible = false
  Transform.getMutable(copy.entity).position = Vector3.create(C.CENTER.x, POOL_Y, C.CENTER.z)
  list.push(copy)
}

// ---------- predicted cubes ----------

function startPredicting(l: Local): boolean {
  const copy = takeCopy(l.letter)
  if (!copy) return false
  copy.cubeId = l.id
  VisibilityComponent.getMutable(copy.entity).visible = true
  l.copy = copy
  l.age = 0
  VisibilityComponent.createOrReplace(l.entity, { visible: false })
  draw(l)
  return true
}

function stopPredicting(l: Local) {
  if (!l.copy) return
  returnCopy(l.copy)
  l.copy = null
  VisibilityComponent.deleteFrom(l.entity)
}

function draw(l: Local) {
  if (!l.copy) return
  const t = Transform.getMutable(l.copy.entity)
  t.position = Vector3.create(l.body.x, l.body.y, l.body.z)
  t.rotation = Quaternion.fromEulerDegrees(0, (l.body.yaw * 180) / Math.PI, 0)
}

function yawOf(rotation: Quaternion): number {
  return (Quaternion.toEulerAngles(rotation).y * Math.PI) / 180
}

/** Mirror the server's cube into the local body (not predicted: the server is the truth). */
function mirror(l: Local, pos: Vector3, rotation: Quaternion) {
  const b = l.body
  b.x = pos.x
  b.y = pos.y
  b.z = pos.z
  b.vx = b.vy = b.vz = 0
  b.yaw = yawOf(rotation)
  b.yawRate = 0
  b.asleep = true // an obstacle until something local wakes it
  b.sleepTime = 0
}

function forget(entity: Entity, l: Local) {
  stopPredicting(l)
  removeBody(world, l.body)
  locals.delete(entity)
}

function touching(b: Body, pushers: Pusher[]): boolean {
  const reach = C.PLAYER_RADIUS + C.CUBE_RADIUS + 0.05
  for (const pu of pushers) {
    if (b.y + C.CUBE_HALF < pu.y || b.y - C.CUBE_HALF > pu.y + C.PLAYER_HEIGHT) continue
    const dx = b.x - pu.x
    const dz = b.z - pu.z
    if (dx * dx + dz * dz < reach * reach) return true
  }
  return false
}

function nearAny(x: number, z: number, pushers: Pusher[], r2: number): boolean {
  for (const pu of pushers) {
    const dx = x - pu.x
    const dz = z - pu.z
    if (dx * dx + dz * dz < r2) return true
  }
  return false
}

// ---------- per frame ----------

export function predictSystem(dt: number) {
  if (!C.PREDICT_PUSHES || dt <= 0) return
  const pt = Transform.getOrNull(engine.PlayerEntity)
  if (!pt) return
  const pp = pt.position

  // every player pushes: you with your real position, the others where their avatar is drawn on this screen
  const pushers = playerPushers(dt, pp)

  // 1. mirror the free cubes around the players into the local world
  const r2 = C.PREDICT_RADIUS * C.PREDICT_RADIUS
  const rOut = C.PREDICT_RADIUS + 1
  const rOut2 = rOut * rOut
  const seen = new Set<Entity>()
  for (const [entity, data, tr] of engine.getEntitiesWith(CubeData, Transform)) {
    const l = locals.get(entity)
    if (data.mode !== 'free') {
      if (l) forget(entity, l) // grabbed, thrown or placed: the server and cubes.ts take it from here
      continue
    }
    const pos = tr.position
    const inRange = nearAny(pos.x, pos.z, pushers, r2)
    if (!l) {
      if (!inRange) continue
      const body = addBody(world, pos.x, pos.y, pos.z)
      const nl: Local = { entity, id: data.id, letter: data.letter, body, copy: null, sinceTouch: 99, age: 0 }
      mirror(nl, pos, tr.rotation)
      locals.set(entity, nl)
      warm(data.letter)
      seen.add(entity)
      continue
    }
    seen.add(entity)
    if (l.copy) {
      // predicted: drop it if the server's cube jumped somewhere else entirely (respawn, new round...)
      const ex = pos.x - l.body.x
      const ey = pos.y - l.body.y
      const ez = pos.z - l.body.z
      if (ex * ex + ey * ey + ez * ez > C.PREDICT_SNAP * C.PREDICT_SNAP) {
        stopPredicting(l)
        mirror(l, pos, tr.rotation)
      }
      continue
    }
    if (!nearAny(pos.x, pos.z, pushers, rOut2)) {
      forget(entity, l)
      continue
    }
    mirror(l, pos, tr.rotation)
  }
  for (const [entity, l] of Array.from(locals.entries())) if (!seen.has(entity)) forget(entity, l)
  if (locals.size === 0) return

  // 2. run the shared sim with every player as a pusher
  setPushers(world, pushers)
  let left = dt
  for (let n = 0; n < MAX_STEPS && left > 1e-4; n++) {
    const h = Math.min(left, STEP_MAX)
    step(world, h)
    left -= h
  }

  // 3. cubes the local sim moved are drawn locally; settled ones glide back to the server's position
  const blend = 1 - Math.exp(-dt * C.PREDICT_BLEND_RATE)
  for (const l of locals.values()) {
    const b = l.body
    if (touching(b, pushers)) l.sinceTouch = 0
    else l.sinceTouch += dt

    if (!l.copy) {
      if (b.asleep) continue // untouched: stays mirrored from the server
      const tr = Transform.get(l.entity)
      const mx = b.x - tr.position.x
      const my = b.y - tr.position.y
      const mz = b.z - tr.position.z
      // woken but not really moved (a neighbour of a pushed cube), or no loaded copy yet: keep the server's cube
      // (the body is re-mirrored every frame anyway, so nothing accumulates until it is predicted)
      if (mx * mx + my * my + mz * mz < MOVED * MOVED || !startPredicting(l)) {
        mirror(l, tr.position, tr.rotation)
        continue
      }
    }

    l.age += dt
    const server = Transform.get(l.entity)
    const s = server.position
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz)
    const settled = b.asleep || speed < SETTLED_SPEED
    if ((l.sinceTouch >= C.PREDICT_HANDOFF && settled) || l.age > C.PREDICT_MAX_TIME) {
      // follow the server: freeze the local body (still an obstacle) and glide it to the server's position
      b.vx = b.vy = b.vz = 0
      b.yawRate = 0
      b.asleep = true
      b.x += (s.x - b.x) * blend
      b.y += (s.y - b.y) * blend
      b.z += (s.z - b.z) * blend
      const sy = yawOf(server.rotation)
      let dyaw = sy - b.yaw
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw))
      b.yaw += dyaw * blend
      const ex = s.x - b.x
      const ey = s.y - b.y
      const ez = s.z - b.z
      if (ex * ex + ey * ey + ez * ez < ARRIVED * ARRIVED) {
        stopPredicting(l)
        mirror(l, s, server.rotation)
        continue
      }
    }
    draw(l)
  }
}
