// Short 3D effects that are not part of the synced game state. Each one is a throw-away entity with a one-shot
// ParticleSystem that removes itself after a moment.
import { engine, Transform, ParticleSystem, PBParticleSystem_BlendMode, PBParticleSystem_SimulationSpace } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { room } from '../shared/messages'

const LIFETIME = 2 // seconds an effect entity stays around (its particles live under 1.2 s)
const live: { entity: Entity; left: number }[] = []

// kind 1: gold sparks (a cube was broken for coins); 0: grey puff (a letter the word needs was broken); 2: bomb blast.
function breakBurst(x: number, y: number, z: number, kind: number) {
  const gold = kind !== 0
  const blast = kind === 2
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, z) })
  ParticleSystem.create(e, {
    rate: 0,
    maxParticles: blast ? 90 : 40,
    lifetime: gold ? 1 : 1.2,
    gravity: gold ? 0.8 : -0.1,
    initialSize: blast ? { start: 0.2, end: 0.5 } : gold ? { start: 0.1, end: 0.22 } : { start: 0.25, end: 0.45 },
    sizeOverTime: { start: 1, end: 0.1 },
    initialVelocitySpeed: blast ? { start: 6, end: 11 } : gold ? { start: 3, end: 6 } : { start: 1, end: 2.5 },
    initialColor: blast
      ? { start: Color4.create(1, 0.55, 0.1, 1), end: Color4.create(1, 0.2, 0.1, 1) }
      : gold
      ? { start: Color4.create(1, 0.9, 0.3, 1), end: Color4.create(1, 0.65, 0.15, 1) }
      : { start: Color4.create(0.75, 0.72, 0.85, 0.9), end: Color4.create(0.5, 0.48, 0.6, 0.9) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },
    shape: ParticleSystem.Shape.Sphere({ radius: 0.25 }),
    loop: false,
    blendMode: gold ? PBParticleSystem_BlendMode.PSB_ADD : PBParticleSystem_BlendMode.PSB_ALPHA,
    simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD,
    bursts: { values: [{ time: 0, count: blast ? 80 : gold ? 30 : 18, cycles: 1, interval: 0.01, probability: 1 }] }
  })
  live.push({ entity: e, left: LIFETIME })
}

function fxSystem(dt: number) {
  for (let i = live.length - 1; i >= 0; i--) {
    live[i].left -= dt
    if (live[i].left <= 0) {
      engine.removeEntity(live[i].entity)
      live.splice(i, 1)
    }
  }
}

export function setupFx() {
  room.onMessage('burst', (d) => breakBurst(d.x, d.y, d.z, d.gold))
  engine.addSystem(fxSystem, 1, 'word-cubes-fx')
}
