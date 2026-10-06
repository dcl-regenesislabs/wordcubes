// Visual effects for the letter frames: translucent at rest, neon blue lock-in, red shake on a wrong cube,
// green wave when the word is complete. Nothing is added to the scene: the frame model itself is recoloured
// through a GltfNodeModifiers material override on the frame entity.
import {
  engine,
  Transform,
  MaterialTransparencyMode,
  GltfNodeModifiers
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { placedProxy } from './cubes'
import { getSlotEntities, slotPosition } from './arena'

type Status = 'idle' | 'locked' | 'fail' | 'win'

interface FrameFx {
  frame: Entity
  base: Vector3
  status: Status
  t: number // seconds since the status last changed
  lockT: number // seconds since the lock-in pulse started (large = finished)
}

const IDLE_ALPHA = 0.45 // frames start a bit transparent
const LOCK_PULSE = 0.4
const FAIL_TIME = 1.3
const SHAKE_TIME = 0.8
const WAVE_STEP = 0.12 // delay between neighbouring frames
const WAVE_LIFT = 0.55
const WAVE_LEN = 0.7

const BLUE = Color3.create(0.1, 0.5, 1)
const RED = Color3.create(1, 0.08, 0.08)
const GREEN = Color3.create(0.1, 1, 0.3)

let fx: FrameFx[] = []

// Recolour the frame model. color null = the resting translucent look.
function paint(frame: Entity, color: Color3 | null, alpha: number, intensity: number) {
  GltfNodeModifiers.createOrReplace(frame, {
    modifiers: [
      {
        path: '',
        material: {
          material: {
            $case: 'pbr',
            pbr: {
              albedoColor: color ? Color4.create(color.r, color.g, color.b, alpha) : Color4.create(0.85, 0.9, 1, alpha),
              emissiveColor: color ?? Color3.Black(),
              emissiveIntensity: intensity,
              transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
              metallic: 0,
              roughness: 1
            }
          }
        }
      }
    ]
  })
}

function setStatus(f: FrameFx, status: Status) {
  f.status = status
  f.t = 0
  if (status === 'idle') paint(f.frame, null, IDLE_ALPHA, 0)
}

export function resetFrames() {
  const frames = getSlotEntities()
  fx = frames.map((frame, i) => {
    const entry: FrameFx = {
      frame,
      base: slotPosition(i, frames.length),
      status: 'idle',
      t: 0,
      lockT: 999
    }
    paint(frame, null, IDLE_ALPHA, 0)
    return entry
  })
}

export function lockFrame(slot: number) {
  const f = fx[slot]
  if (!f) return
  setStatus(f, 'locked')
  f.lockT = 0
}

export function failFrames() {
  for (const f of fx) {
    setStatus(f, 'fail')
    f.lockT = 999
  }
}

export function winFrames() {
  for (const f of fx) setStatus(f, 'win')
}

function rand() {
  return (Math.random() - 0.5) * 2
}

export function framesSystem(dt: number) {
  const n = fx.length
  for (let i = 0; i < n; i++) {
    const f = fx[i]
    f.t += dt
    f.lockT += dt
    let off = Vector3.Zero()
    let scale = 1
    let intensity = 0
    let alpha = IDLE_ALPHA
    let color: Color3 | null = null

    if (f.status === 'locked') {
      color = BLUE
      const p = Math.min(1, f.lockT / LOCK_PULSE)
      scale = 1 + 0.3 * Math.sin(Math.PI * p) * (1 - p * 0.5)
      intensity = 3 + 7 * (1 - p)
      alpha = 0.7 + 0.3 * (1 - p)
    } else if (f.status === 'fail') {
      color = RED
      const shake = Math.max(0, 1 - f.t / SHAKE_TIME)
      off = Vector3.create(rand() * 0.1 * shake, rand() * 0.07 * shake, rand() * 0.1 * shake)
      const fade = Math.max(0, 1 - Math.max(0, f.t - SHAKE_TIME) / (FAIL_TIME - SHAKE_TIME))
      intensity = 6 * fade
      alpha = IDLE_ALPHA + (0.9 - IDLE_ALPHA) * fade
      if (f.t >= FAIL_TIME) {
        setStatus(f, 'idle')
        color = null
        intensity = 0
        alpha = IDLE_ALPHA
        off = Vector3.Zero()
      }
    } else if (f.status === 'win') {
      color = GREEN
      // a wave runs first -> last, then repeats while the win screen is up
      const period = n * WAVE_STEP + WAVE_LEN + 0.5
      const phase = (((f.t - i * WAVE_STEP) % period) + period) % period
      const w = phase < WAVE_LEN ? Math.sin(Math.PI * (phase / WAVE_LEN)) : 0
      off = Vector3.create(0, WAVE_LIFT * w, 0)
      scale = 1 + 0.2 * w
      intensity = 3 + 5 * w
      alpha = 0.7 + 0.3 * w
    }

    const t = Transform.getMutable(f.frame)
    t.position = Vector3.create(f.base.x + off.x, f.base.y + off.y, f.base.z + off.z)
    t.scale = Vector3.scale(Vector3.One(), C.CUBE_SCALE * scale)

    // the placed cube rides with its frame
    const cube = placedProxy.get(i)
    if (cube) {
      const ct = Transform.getMutable(cube)
      ct.position = Vector3.create(f.base.x + off.x, f.base.y + off.y, f.base.z + off.z)
      ct.scale = Vector3.scale(Vector3.One(), C.CUBE_SCALE * scale)
    }

    if (color) paint(f.frame, color, alpha, intensity)
  }
}
