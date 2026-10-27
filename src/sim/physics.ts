// Pure cube-pile physics. No SDK imports so it can move to an authoritative server later.
// Cubes are simulated as upright boxes (yaw spin only) inside a circular arena.

export interface Body {
  id: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number // radians
  yawRate: number
  active: boolean // false = not simulated (held / placed)
  asleep: boolean
  sleepTime: number
}

export interface WorldParams {
  centerX: number
  centerZ: number
  arenaRadius: number
  floorY: number // top of floor
  stageRadius: number
  stageTop: number
  stageUpperRadius: number
  stageUpperTop: number
  cubeRadius: number
  cubeHalf: number
  gravity: number
  restitution: number
  floorFriction: number
  airDrag: number
  pusherRadius: number // the player is treated as an upright cylinder that shoves cubes
  pusherHeight: number
}

export interface Pusher {
  x: number
  y: number // feet
  z: number
  vx: number
  vz: number
}

export interface World {
  params: WorldParams
  bodies: Body[]
  nextId: number
  pushers: Pusher[]
}

export function createWorld(params: WorldParams): World {
  return { params, bodies: [], nextId: 1, pushers: [] }
}

export function setPushers(world: World, pushers: Pusher[]) {
  world.pushers = pushers
}

export function addBody(world: World, x: number, y: number, z: number): Body {
  const b: Body = {
    id: world.nextId++,
    x, y, z,
    vx: 0, vy: 0, vz: 0,
    yaw: Math.random() * Math.PI * 2,
    yawRate: 0,
    active: true,
    asleep: false,
    sleepTime: 0
  }
  world.bodies.push(b)
  return b
}

export function removeBody(world: World, body: Body) {
  const i = world.bodies.indexOf(body)
  if (i >= 0) world.bodies.splice(i, 1)
}

export function clearBodies(world: World) {
  world.bodies.length = 0
}

export function wake(b: Body) {
  b.asleep = false
  b.sleepTime = 0
}

// Wake sleeping bodies around a point (e.g. when a cube is grabbed out of the pile).
export function wakeNear(world: World, x: number, y: number, z: number, radius: number) {
  const r2 = radius * radius
  for (const b of world.bodies) {
    if (!b.asleep) continue
    const dx = b.x - x
    const dy = b.y - y
    const dz = b.z - z
    if (dx * dx + dy * dy + dz * dz < r2) wake(b)
  }
}

export function applyImpulse(b: Body, vx: number, vy: number, vz: number) {
  b.vx += vx
  b.vy += vy
  b.vz += vz
  b.yawRate += (Math.random() - 0.5) * 8
  wake(b)
}

const PUSH_MAX_CORRECTION = 0.12 // m per step a cube can be moved out of the pusher
const PUSH_MAX_SPEED = 4.5
const MAX_SPEED = 7 // no cube ever moves faster than this (keeps pile chaos from flinging cubes)
const MAX_CORRECTION = 0.15 // m per step two overlapping cubes can be separated
const SETTLED_OVERLAP = 0.02 // m: cubes overlapping more than this do not fall asleep
const TIP_OFFSET = 0.5 // half-faces: a cube resting further off-centre than this on another slides off it
const TIP_ACCEL = 6 // m/s² of that slide
const SUPPORT_SLACK = 0.03 // m: a cube this close above another still rests on it
const RESTING_DEPTH = 0.04 // m: a vertical overlap shallower than this always lifts the top cube
const SLEEP_SPEED = 0.12
const SLEEP_AFTER = 0.6
const MAX_STEP = 1 / 30


// Cubes are upright boxes that only turn around Y, so two of them overlap when their squares overlap seen from above
// (separating-axis test on the 4 edge directions) and their heights overlap. They are pushed apart along the axis
// with the least overlap: sideways, or up / down when one sits on the other.
// Local axes of a box turned by `yaw` (same convention as Quaternion.fromEulerDegrees(0, yaw, 0)):
// x = (cos, -sin), z = (sin, cos) in the XZ plane.
// `slack` counts boxes that are up to that far apart vertically as touching (used to find what a cube rests on).
function boxOverlap(p: WorldParams, a: Body, b: Body, slack = 0): { nx: number; ny: number; nz: number; depth: number } | null {
  const h = p.cubeHalf
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  const oy = 2 * h - Math.abs(dy)
  if (oy + slack <= 0) return null
  const ca = Math.cos(a.yaw)
  const sa = Math.sin(a.yaw)
  const cb = Math.cos(b.yaw)
  const sb = Math.sin(b.yaw)
  const axes = [ca, -sa, sa, ca, cb, -sb, sb, cb]
  let best = Infinity
  let bx = 0
  let bz = 0
  for (let i = 0; i < 8; i += 2) {
    const ux = axes[i]
    const uz = axes[i + 1]
    // half extent of each square on this axis, and the distance between the centres along it
    const ra = h * (Math.abs(ux * ca - uz * sa) + Math.abs(ux * sa + uz * ca))
    const rb = h * (Math.abs(ux * cb - uz * sb) + Math.abs(ux * sb + uz * cb))
    const dist = dx * ux + dz * uz
    const o = ra + rb - Math.abs(dist)
    if (o <= 0) return null // a gap on this axis: no contact
    if (o < best) {
      best = o
      bx = dist < 0 ? -ux : ux // from a towards b
      bz = dist < 0 ? -uz : uz
    }
  }
  // A shallow vertical overlap is a cube resting on another: always lift it, even when the side overlap at an edge is
  // smaller still (pushed sideways, it would be pushed straight back by its neighbours and sink into its support).
  if (oy < best || oy < RESTING_DEPTH) return { nx: 0, ny: dy < 0 ? -1 : 1, nz: 0, depth: oy }
  return { nx: bx, ny: 0, nz: bz, depth: best }
}

function collide(p: WorldParams, a: Body, b: Body, reach2: number) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  const d2 = dx * dx + dy * dy + dz * dz
  if (d2 >= reach2 || d2 === 0) return // further apart than two corners can reach
  const hit = boxOverlap(p, a, b)
  if (!hit) return
  // still clearly inside each other: not settled yet (sleeping cubes are never checked against each other again), and
  // a sleeping one is woken so both can move apart (a sleeping cube never moves, so a cube wedged against it between
  // the platform or the wall would otherwise stay inside it, awake, forever)
  const deep = hit.depth > SETTLED_OVERLAP
  if (deep) {
    a.sleepTime = 0
    b.sleepTime = 0
  }
  const { nx, ny, nz } = hit
  const overlap = Math.min(hit.depth, MAX_CORRECTION)
  const resting = ny !== 0 // one cube sits on the other: treat the top face like the floor
  // asleep bodies act as immovable until hit hard enough from the side. Landing on top never wakes the cube below: it
  // is already supported, and waking it would let a stack's weight wake the whole stack every step.
  const below = resting ? (ny > 0 ? a : b) : null
  // A support never counts as moving down: it still carries this step's gravity until the floor (or the cube under it)
  // stops it, and handing that on would leave the top cube sinking and being lifted forever without falling asleep.
  const avy = a === below ? Math.max(0, a.vy) : a.vy
  const bvy = b === below ? Math.max(0, b.vy) : b.vy
  const relVn = (b.vx - a.vx) * nx + (bvy - avy) * ny + (b.vz - a.vz) * nz
  const hard = relVn < -0.6
  if (a.asleep && (hard || deep) && a !== below) wake(a)
  if (b.asleep && (hard || deep) && b !== below) wake(b)
  // the cube underneath acts as support, like the floor: only the one on top is moved (otherwise the push down goes
  // into the floor, the floor puts it back, and the top one never gets out)
  const aMoves = !a.asleep && a !== below
  const bMoves = !b.asleep && b !== below
  if (!aMoves && !bMoves) return
  const share = aMoves && bMoves ? 0.5 : 1
  if (aMoves) {
    a.x -= nx * overlap * share
    a.y -= ny * overlap * share
    a.z -= nz * overlap * share
  }
  if (bMoves) {
    b.x += nx * overlap * share
    b.y += ny * overlap * share
    b.z += nz * overlap * share
  }
  if (relVn < 0) {
    // like the floor: a slow landing does not bounce, so stacks settle instead of jittering
    const bounce = resting && -relVn < 1.2 ? 0 : p.restitution
    const j2 = -(1 + bounce) * relVn * (aMoves && bMoves ? 0.5 : 1)
    const spin = resting ? 0 : Math.min(3, -relVn * 1.2)
    if (aMoves) {
      a.vx -= nx * j2
      a.vy -= ny * j2
      a.vz -= nz * j2
      a.yawRate += (Math.random() - 0.5) * spin
    }
    if (bMoves) {
      b.vx += nx * j2
      b.vy += ny * j2
      b.vz += nz * j2
      b.yawRate += (Math.random() - 0.5) * spin
    }
  }
}

// What each awake cube rests on this step: how many cubes, and its offset from the first one. Filled and cleared within
// one step, so the server's several worlds can share it.
const supports = new Map<Body, { n: number; ox: number; oz: number }>()

// Before the cubes are pushed apart: note what each cube rests on (a box overlapping it from below, within a few mm,
// so the second support still counts after the first has lifted the cube clear of it).
function countSupport(p: WorldParams, a: Body, b: Body) {
  const dy = b.y - a.y
  if (Math.abs(dy) < p.cubeHalf) return // side by side, not one on the other
  if (!boxOverlap(p, a, b, SUPPORT_SLACK)) return
  const top = dy > 0 ? b : a
  const under = top === a ? b : a
  const s = supports.get(top)
  if (s) s.n++
  else supports.set(top, { n: 1, ox: top.x - under.x, oz: top.z - under.z })
}

// Cubes resting on other cubes: friction on the top face, like the floor's. A cube that rests on a single cube with its
// centre past the middle of it tips off (boxes do not stack into towers; the pile keeps a slope). One resting on two or
// more is supported and stays.
function supportStep(p: WorldParams, dt: number) {
  const f = Math.max(0, 1 - p.floorFriction * dt)
  for (const [top, s] of supports) {
    if (top.asleep) continue
    const off = Math.sqrt(s.ox * s.ox + s.oz * s.oz)
    if (s.n === 1 && off > TIP_OFFSET * p.cubeHalf) {
      top.vx += (s.ox / off) * TIP_ACCEL * dt
      top.vz += (s.oz / off) * TIP_ACCEL * dt
    } else {
      top.vx *= f
      top.vz *= f
    }
  }
  supports.clear()
}

export function step(world: World, dtIn: number) {
  const dt = Math.min(dtIn, MAX_STEP)
  const p = world.params
  const r = p.cubeRadius
  const bodies = world.bodies

  // integrate
  for (const b of bodies) {
    if (!b.active || b.asleep) continue
    b.vy += p.gravity * dt
    const drag = Math.max(0, 1 - p.airDrag * dt)
    b.vx *= drag
    b.vz *= drag
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.z += b.vz * dt
    b.yaw += b.yawRate * dt
    b.yawRate *= Math.max(0, 1 - 1.5 * dt)
  }

  // pair collisions, found through a uniform grid so cost stays ~linear in cube count. Two boxes can touch while their
  // centres are two half-diagonals apart sideways and a full cube apart in height at the same time (one resting on the
  // other's corner): the early-out distance covers both, and the cells are as wide as the largest gap on any one axis.
  const reach = 2 * p.cubeHalf * Math.sqrt(3)
  const reach2 = reach * reach
  const cell = 2 * p.cubeHalf * Math.SQRT2
  const grid = new Map<number, Body[]>()
  const keyOf = (cx: number, cy: number, cz: number) => ((cx + 2048) * 4096 + (cz + 2048)) * 128 + (cy + 16)
  for (const b of bodies) {
    if (!b.active) continue
    const k = keyOf(Math.floor(b.x / cell), Math.floor(b.y / cell), Math.floor(b.z / cell))
    const list = grid.get(k)
    if (list) list.push(b)
    else grid.set(k, [b])
  }
  const pairs: Body[] = []
  for (const a of bodies) {
    if (!a.active || a.asleep) continue // every pair involves at least one awake body
    const cx = Math.floor(a.x / cell)
    const cy = Math.floor(a.y / cell)
    const cz = Math.floor(a.z / cell)
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const list = grid.get(keyOf(cx + ox, cy + oy, cz + oz))
          if (!list) continue
          for (const b of list) {
            if (b === a) continue
            // awake-awake pairs are visited from both sides, so only handle them once
            if (!b.asleep && b.id < a.id) continue
            pairs.push(a, b)
          }
        }
      }
    }
  }
  // first what rests on what (before anything is moved), then push the pairs apart, then friction / tipping on top faces
  for (let i = 0; i < pairs.length; i += 2) countSupport(p, pairs[i], pairs[i + 1])
  for (let i = 0; i < pairs.length; i += 2) collide(p, pairs[i], pairs[i + 1], reach2)
  supportStep(p, dt)

  // the player walks through cubes and shoves them aside: a capped correction plus a speed target,
  // never a teleport, so cubes glide away instead of popping out in front of the player
  for (const pu of world.pushers) {
    const reach = p.pusherRadius + r
    for (const b of bodies) {
      if (!b.active) continue
      if (b.y + p.cubeHalf < pu.y || b.y - p.cubeHalf > pu.y + p.pusherHeight) continue
      const dx = b.x - pu.x
      const dz = b.z - pu.z
      const d2 = dx * dx + dz * dz
      if (d2 >= reach * reach) continue
      const d = Math.sqrt(d2)
      let nx = d > 0.001 ? dx / d : pu.vx !== 0 || pu.vz !== 0 ? pu.vx : 1
      let nz = d > 0.001 ? dz / d : pu.vz
      const nl = Math.sqrt(nx * nx + nz * nz) || 1
      nx /= nl
      nz /= nl
      wake(b)
      // wake the cubes around it too, so a pushed cube shoves its neighbours instead of being squeezed out of the pile
      wakeNear(world, b.x, b.y, b.z, p.cubeRadius * 3.2)
      const overlap = reach - d
      const move = Math.min(overlap, PUSH_MAX_CORRECTION)
      b.x += nx * move
      b.z += nz * move
      const along = pu.vx * nx + pu.vz * nz
      const target = Math.min(PUSH_MAX_SPEED, Math.max(along, 0) * 0.6 + 0.5)
      const cur = b.vx * nx + b.vz * nz
      if (cur < target) {
        b.vx += nx * (target - cur) * 0.5
        b.vz += nz * (target - cur) * 0.5
      }
    }
  }

  // environment + sleeping
  const floorRest = p.floorY + p.cubeHalf
  const maxR = p.arenaRadius - r
  for (const b of bodies) {
    if (!b.active || b.asleep) continue

    // cap sideways and upward speed (falling is left alone: cubes drop from 20 m at spawn)
    const sp = Math.sqrt(b.vx * b.vx + b.vz * b.vz)
    if (sp > MAX_SPEED) {
      const k = MAX_SPEED / sp
      b.vx *= k
      b.vz *= k
    }
    if (b.vy > MAX_SPEED) b.vy = MAX_SPEED

    // circular wall
    let rx = b.x - p.centerX
    let rz = b.z - p.centerZ
    let rd = Math.sqrt(rx * rx + rz * rz)
    if (rd > maxR && rd > 0) {
      const nx = rx / rd
      const nz = rz / rd
      b.x = p.centerX + nx * maxR
      b.z = p.centerZ + nz * maxR
      const vn = b.vx * nx + b.vz * nz
      if (vn > 0) {
        b.vx -= nx * vn * (1 + p.restitution)
        b.vz -= nz * vn * (1 + p.restitution)
      }
      rx = b.x - p.centerX
      rz = b.z - p.centerZ
      rd = maxR
    }

    // stage pedestal: cubes above it land on it and slide off, cubes beside it are pushed away from it
    const stageR = p.stageRadius + r
    let floorY = floorRest
    if (rd < stageR) {
      const surface = rd < p.stageUpperRadius ? p.stageUpperTop : p.stageTop
      if (b.y - p.cubeHalf >= surface - 0.25) {
        floorY = surface + p.cubeHalf
        // gentle outward slope so nothing stays parked on the pedestal
        const ang = rd > 0.05 ? Math.atan2(rz, rx) : b.id * 2.399
        b.vx += Math.cos(ang) * 4 * dt
        b.vz += Math.sin(ang) * 4 * dt
      } else {
        const nx = rd > 0 ? rx / rd : 1
        const nz = rd > 0 ? rz / rd : 0
        b.x = p.centerX + nx * stageR
        b.z = p.centerZ + nz * stageR
        const vn = b.vx * nx + b.vz * nz
        if (vn < 0) {
          b.vx -= nx * vn * (1 + p.restitution)
          b.vz -= nz * vn * (1 + p.restitution)
        }
      }
    }

    // floor
    let grounded = false
    if (b.y < floorY) {
      b.y = floorY
      if (b.vy < 0) b.vy = Math.abs(b.vy) > 1.2 ? -b.vy * p.restitution : 0
      grounded = true
    }
    if (grounded) {
      const f = Math.max(0, 1 - p.floorFriction * dt)
      b.vx *= f
      b.vz *= f
    }

    // sleep detection
    const speed2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz
    if (speed2 < SLEEP_SPEED * SLEEP_SPEED && Math.abs(b.yawRate) < 0.5) {
      b.sleepTime += dt
      if (b.sleepTime > SLEEP_AFTER) {
        b.asleep = true
        b.vx = b.vy = b.vz = 0
        b.yawRate = 0
      }
    } else {
      b.sleepTime = 0
    }
  }
}
