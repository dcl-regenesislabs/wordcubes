// Ready-made cube heaps. A new pile does not fall in a game's sim: every client plays the fall itself
// (client/gamestate.ts dropPlan), so the server only needs where the cubes come to rest. A few heaps are settled once,
// in a sim of their own, and each new pile takes one of them turned to a random angle (and maybe mirrored). A round
// start then costs no physics at all, however many games start at the same moment.
//
// Turning a heap around the arena's centre keeps it valid: the floor, the walls and the platform are all round, and
// positions and yaws turn together, so cubes that did not overlap still do not.
import * as C from '../config'
import { worldParams } from '../shared/world'
import { createWorld, addBody, step } from '../sim/physics'
import type { Body, World } from '../sim/physics'

/** Where one cube of a heap rests, local to GameEnv (x, z from its centre, y from its origin). */
export interface HeapSpot {
  x: number
  y: number
  z: number
  yaw: number // radians
  asleep: boolean // false: still moving when the settle time ran out; the game's sim finishes it
}

const HEAP_COUNT = 4 // distinct heaps kept; turning and mirroring make every pile look different anyway
const SETTLE_DT = 1 / 30
const MAX_STEPS = 600 // 20 s of sim time
const BACKGROUND_STEPS_PER_TICK = 3 // the heaps after the first are settled a little at a time (~2 ms a tick)

const heaps: HeapSpot[][] = []
let building: { world: World; bodies: Body[]; steps: number } | null = null

const rand = (min: number, max: number) => min + Math.random() * (max - min)

// The same drop as a real pile: random spots around the platform, from the spawn heights.
function begin() {
  const world = createWorld(worldParams())
  const bodies: Body[] = []
  for (let i = 0; i < C.CUBES_PER_ROUND; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(rand(C.SPAWN_MIN_RADIUS ** 2, C.SPAWN_MAX_RADIUS ** 2))
    bodies.push(addBody(world, Math.cos(a) * r, rand(C.SPAWN_MIN_Y, C.SPAWN_MAX_Y), Math.sin(a) * r))
  }
  building = { world, bodies, steps: 0 }
}

function advance(maxSteps: number) {
  const b = building
  if (!b) return
  for (let n = 0; n < maxSteps && b.steps < MAX_STEPS; n++) {
    step(b.world, SETTLE_DT)
    b.steps++
    if (b.bodies.every((x) => x.asleep)) break
  }
  if (b.steps < MAX_STEPS && !b.bodies.every((x) => x.asleep)) return
  heaps.push(b.bodies.map((x) => ({ x: x.x, y: x.y, z: x.z, yaw: x.yaw, asleep: x.asleep })))
  building = null
}

/** At server start, before anyone plays: the first heap, settled at once (a few hundred ms). */
export function prepareHeaps() {
  if (heaps.length > 0) return
  if (!building) begin()
  advance(Infinity)
}

/** Once a server tick: settle the remaining heaps in the background. */
export function heapTick() {
  if (heaps.length >= HEAP_COUNT) return
  if (!building) begin()
  advance(BACKGROUND_STEPS_PER_TICK)
}

/** A pile's resting spots: one of the heaps, turned by a random angle and mirrored half of the time. */
export function takeHeap(): HeapSpot[] {
  prepareHeaps()
  const base = heaps[Math.floor(Math.random() * heaps.length)]
  const turn = Math.random() * Math.PI * 2
  const mirror = Math.random() < 0.5 ? -1 : 1
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  // a box's local x axis at yaw a is (cos a, -sin a) (sim/physics.ts): turning a point by `turn` is the same map
  return base.map((p) => {
    const z = p.z * mirror
    return { x: p.x * c + z * s, y: p.y, z: -p.x * s + z * c, yaw: p.yaw * mirror + turn, asleep: p.asleep }
  })
}
