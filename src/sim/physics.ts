// Pure cube-pile physics. No SDK imports so it can move to an authoritative server later.
// Cubes are simulated as upright spheres (yaw spin only) inside a circular arena.

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
const SLEEP_SPEED = 0.12
const SLEEP_AFTER = 0.6
const MAX_STEP = 1 / 30


function collide(p: WorldParams, a: Body, b: Body, minDist: number, minDist2: number) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  const d2 = dx * dx + dy * dy + dz * dz
  if (d2 >= minDist2 || d2 === 0) return
  const d = Math.sqrt(d2)
  const nx = dx / d
  const ny = dy / d
  const nz = dz / d
  const overlap = Math.min(minDist - d, MAX_CORRECTION)
  // asleep bodies act as immovable until hit hard enough
  const relVn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz
  const hard = relVn < -0.6
  if (a.asleep && hard) wake(a)
  if (b.asleep && hard) wake(b)
  const aMoves = !a.asleep
  const bMoves = !b.asleep
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
    const j2 = -(1 + p.restitution) * relVn * (aMoves && bMoves ? 0.5 : 1)
    const spin = Math.min(3, -relVn * 1.2)
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

  // pair collisions, found through a uniform grid so cost stays ~linear in cube count
  const minDist = r * 2
  const minDist2 = minDist * minDist
  const cell = minDist
  const grid = new Map<number, Body[]>()
  const keyOf = (cx: number, cy: number, cz: number) => ((cx + 2048) * 4096 + (cz + 2048)) * 128 + (cy + 16)
  for (const b of bodies) {
    if (!b.active) continue
    const k = keyOf(Math.floor(b.x / cell), Math.floor(b.y / cell), Math.floor(b.z / cell))
    const list = grid.get(k)
    if (list) list.push(b)
    else grid.set(k, [b])
  }
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
            collide(p, a, b, minDist, minDist2)
          }
        }
      }
    }
  }

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
