// Local push prediction. The server owns the cube pile, so a cube you walk into only moves once the server has seen
// you move, which feels laggy. Here the client runs the same sim (sim/physics.ts) on a local copy of the free cubes
// around the local player, with the player as a zero-latency pusher:
//
// - A cube the local sim moves becomes "predicted": its real (synced) entity is hidden and a pooled local copy is
//   drawn where the local sim says it is.
// - Once you have stopped touching it and it has settled, it glides to the position the server sent, and when it
//   gets there the real cube is shown again and the copy goes back to the pool.
//
// Other players are unaffected: they still see your pushes through the server, exactly as before. Cubes pushed by
// other players are mirrored from the server and act as obstacles in the local sim.
import {
  engine,
  Transform,
  GltfContainer,
  GltfContainerLoadingState,
  VisibilityComponent,
  ColliderLayer,
  pointerEventsSystem,
  InputAction
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { CubeData, modelFor } from '../shared/schemas'
import { room } from '../shared/messages'
import { worldParams } from '../shared/world'
import { createWorld, addBody, removeBody, setPushers, step } from '../sim/physics'
import type { Body } from '../sim/physics'

const LOADING_FINISHED = 4 // LoadingState.FINISHED
const POOL_Y = -40 // pooled copies wait underground (visible, so their model stays loaded)
const SETTLED_SPEED = 0.5 // m/s: below this a cube counts as settled for the handoff
const ARRIVED = 0.04 // m: close enough to the server position to swap back to the real cube
const MOVED = 0.02 // m: a woken cube that has not moved this far keeps showing the real cube
const SPARES = 2 // loaded idle copies kept per letter near the player

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

let lastPlayer: Vector3 | null = null
let playerVx = 0
let playerVz = 0

/** True while the local copy is drawn instead of the real cube (cubes.ts skips its own smoothing then). */
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
  return GltfContainerLoadingState.getOrNull(copy.entity)?.currentState === LOADING_FINISHED
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
  Transform.getMutable(copy.entity).position = Vector3.create(C.CENTER.x, POOL_Y, C.CENTER.z)
  pool.get(copy.letter)!.push(copy)
}

// ---------- predicted cubes ----------

function startPredicting(l: Local): boolean {
  const copy = takeCopy(l.letter)
  if (!copy) return false
  copy.cubeId = l.id
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

function touching(b: Body, px: number, py: number, pz: number): boolean {
  if (b.y + C.CUBE_HALF < py || b.y - C.CUBE_HALF > py + C.PLAYER_HEIGHT) return false
  const reach = C.PLAYER_RADIUS + C.CUBE_RADIUS + 0.05
  const dx = b.x - px
  const dz = b.z - pz
  return dx * dx + dz * dz < reach * reach
}

// ---------- per frame ----------

export function predictSystem(dt: number) {
  if (!C.PREDICT_PUSHES || dt <= 0) return
  const pt = Transform.getOrNull(engine.PlayerEntity)
  if (!pt) return
  const pp = pt.position

  // the local player's real speed (no network in between), lightly smoothed
  if (lastPlayer) {
    const dx = pp.x - lastPlayer.x
    const dz = pp.z - lastPlayer.z
    if (dx * dx + dz * dz > 6 * 6) {
      playerVx = playerVz = 0 // teleport
    } else {
      const k = Math.min(1, dt / 0.08)
      playerVx += (dx / dt - playerVx) * k
      playerVz += (dz / dt - playerVz) * k
    }
  }
  lastPlayer = Vector3.create(pp.x, pp.y, pp.z)

  // 1. mirror the free cubes around the player into the local world
  const r2 = C.PREDICT_RADIUS * C.PREDICT_RADIUS
  const seen = new Set<Entity>()
  for (const [entity, data, tr] of engine.getEntitiesWith(CubeData, Transform)) {
    const l = locals.get(entity)
    if (data.mode !== 'free') {
      if (l) forget(entity, l) // grabbed, thrown or placed: the server and cubes.ts take it from here
      continue
    }
    const pos = tr.position
    const dx = pos.x - pp.x
    const dz = pos.z - pp.z
    const inRange = dx * dx + dz * dz < r2
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
    const rOut = C.PREDICT_RADIUS + 1
    if (dx * dx + dz * dz > rOut * rOut) {
      forget(entity, l)
      continue
    }
    mirror(l, pos, tr.rotation)
  }
  for (const [entity, l] of Array.from(locals.entries())) if (!seen.has(entity)) forget(entity, l)
  if (locals.size === 0) return

  // 2. run the shared sim with the local player as the only pusher
  setPushers(world, [{ x: pp.x, y: pp.y, z: pp.z, vx: playerVx, vz: playerVz }])
  let left = dt
  while (left > 1e-4) {
    const h = Math.min(left, STEP_MAX)
    step(world, h)
    left -= h
  }

  // 3. cubes the local sim moved are drawn locally; settled ones glide back to the server's position
  const blend = 1 - Math.exp(-dt * C.PREDICT_BLEND_RATE)
  for (const l of locals.values()) {
    const b = l.body
    if (touching(b, pp.x, pp.y, pp.z)) l.sinceTouch = 0
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
