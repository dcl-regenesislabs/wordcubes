import { engine, Transform, PlayerIdentityData } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { envOrigin } from '../shared/env'

// Decorative grass: tufts are children of the "Grass" entity in the composite. Each one gets a wind sway plus a
// spring-driven lean away from nearby players (like WoW foliage). Pure rotation around the model origin, so the
// tufts' pivot must sit at their base.

interface Tuft {
  entity: Entity
  base: Quaternion // rotation authored in the composite
  local: Vector3 // position relative to GameEnv (Grass sits at the GameEnv origin)
  leanAxis: Vector3 // world direction the tuft leans along for a positive lean
  phase: number
  angle: number // sprung push angle, degrees
  vel: number
  lastApplied: number
}

let tufts: Tuft[] = []
let time = 0
let searchIn = 0

function findTufts() {
  const grass = engine.getEntityOrNullByName(C.GRASS_ENTITY_NAME)
  if (!grass) return
  const found: Tuft[] = []
  for (const [entity, t] of engine.getEntitiesWith(Transform)) {
    if (t.parent !== grass) continue
    const base = Quaternion.create(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w)
    const local = Vector3.create(t.position.x, t.position.y, t.position.z)
    const axis = Vector3.rotate(C.GRASS_LEAN_AXIS === 'z' ? Vector3.Right() : Vector3.Forward(), base)
    found.push({
      entity,
      base,
      local,
      leanAxis: axis,
      phase: (local.x + local.z * 0.6) * ((Math.PI * 2) / C.GRASS_WIND_WAVELENGTH),
      angle: 0,
      vel: 0,
      lastApplied: 0
    })
  }
  tufts = found
}

function playerPositions(): Vector3[] {
  const out: Vector3[] = []
  for (const [e] of engine.getEntitiesWith(PlayerIdentityData)) {
    const t = Transform.getOrNull(e)
    if (t) out.push(t.position)
  }
  if (out.length === 0) {
    const t = Transform.getOrNull(engine.PlayerEntity)
    if (t) out.push(t.position)
  }
  return out
}

export function grassSystem(dt: number) {
  if (tufts.length === 0) {
    searchIn -= dt
    if (searchIn <= 0) {
      searchIn = 1
      findTufts()
    }
    if (tufts.length === 0) return
  }

  dt = Math.min(dt, 0.05)
  time += dt
  const origin = envOrigin()
  const players = playerPositions()
  const gust = 0.7 + 0.3 * Math.sin(time * 0.35)
  const r2 = C.GRASS_PUSH_RADIUS * C.GRASS_PUSH_RADIUS
  // leaning toward the axis: rotating around Z by -a leans toward +X, rotating around X by +a leans toward +Z
  const sign = C.GRASS_LEAN_AXIS === 'z' ? -1 : 1

  for (const tuft of tufts) {
    const wx = origin.x + tuft.local.x
    const wy = origin.y + tuft.local.y
    const wz = origin.z + tuft.local.z

    // push target: strongest at the nearest player, sign from which side of the tuft they're on
    let target = 0
    let best = 0
    for (const p of players) {
      const dx = wx - p.x
      const dz = wz - p.z
      const d2 = dx * dx + dz * dz
      if (d2 >= r2 || Math.abs(p.y - wy) > 2.5) continue
      const d = Math.sqrt(d2) || 0.001
      const strength = 1 - d / C.GRASS_PUSH_RADIUS
      if (strength <= best) continue
      best = strength
      const along = (dx / d) * tuft.leanAxis.x + (dz / d) * tuft.leanAxis.z // away-from-player vs lean axis, -1..1
      target = Math.max(-1, Math.min(1, along * 1.5)) * strength * strength * C.GRASS_PUSH_ANGLE
    }

    // spring toward the target (underdamped, so tufts wobble back)
    tuft.vel += (C.GRASS_SPRING * (target - tuft.angle) - C.GRASS_DAMPING * tuft.vel) * dt
    tuft.angle += tuft.vel * dt

    const wind =
      C.GRASS_WIND_AMPLITUDE *
      gust *
      (Math.sin(time * C.GRASS_WIND_SPEED + tuft.phase) + 0.5 * Math.sin(time * C.GRASS_WIND_SPEED * 2.3 + tuft.phase * 1.7))

    const total = (tuft.angle + wind) * sign
    if (Math.abs(total - tuft.lastApplied) < 0.02) continue
    tuft.lastApplied = total
    const lean =
      C.GRASS_LEAN_AXIS === 'z' ? Quaternion.fromEulerDegrees(0, 0, total) : Quaternion.fromEulerDegrees(total, 0, 0)
    // lean is in the tuft's own space (after its authored rotation): wind and push use the same model axis
    Transform.getMutable(tuft.entity).rotation = Quaternion.multiply(tuft.base, lean)
  }
}
