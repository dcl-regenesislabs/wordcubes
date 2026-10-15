const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

function harness() {
  const config = loadTs('src/config.ts')
  const noop = () => {}
  function component() {
    const values = new Map()
    return { values, componentId: 1, create: (entity, value) => values.set(entity, value),
      getMutable: entity => values.get(entity), get: entity => values.get(entity),
      getOrNull: entity => values.get(entity) }
  }
  const Transform = component()
  const PlayerIdentityData = component()
  const CubeData = component()
  const GameState = component()
  const PlayerRanks = component()
  const GltfContainer = component()
  const components = [Transform, PlayerIdentityData, CubeData, GameState, PlayerRanks, GltfContainer]
  const systems = new Map()
  let next = 512
  const engine = {
    addEntity: () => next++, removeEntity: entity => components.forEach(c => c.values.delete(entity)),
    getEntitiesWith: c => c.values.entries(), addSystem: (fn, priority, name) => systems.set(name, fn)
  }
  const Vector3 = {
    create: (x = 0, y = 0, z = 0) => ({ x, y, z }), One: () => ({ x: 1, y: 1, z: 1 }),
    scale: (v, n) => ({ x: v.x * n, y: v.y * n, z: v.z * n }),
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
    Forward: () => ({ x: 0, y: 0, z: 1 }), Right: () => ({ x: 1, y: 0, z: 0 }), rotate: v => v
  }
  const Storage = { get: async () => undefined, set: async () => true,
    player: { get: async () => undefined, set: async () => true } }
  const profiles = loadTs('src/server/profiles.ts', { '@dcl/sdk/server': { Storage } })
  const env = { envOrigin: () => Vector3.create() }
  const world = loadTs('src/shared/world.ts', { '../config': config, './env': env })
  const handlers = new Map()
  const sent = []
  const room = { onMessage: (name, fn) => handlers.set(name, fn), send: (name, data) => sent.push({ name, data }) }
  const server = loadTs('src/server/server.ts', {
    '@dcl/sdk/ecs': { engine, Transform, PlayerIdentityData, GltfContainer, ColliderLayer: { CL_NONE: 0 } },
    '@dcl/sdk/math': { Vector3, Quaternion: { fromEulerDegrees: () => ({ x: 0, y: 0, z: 0, w: 1 }) } },
    '@dcl/sdk/network': { syncEntity: noop }, '@dcl/sdk/server': { Storage },
    '../config': config, './words': { pickWord: () => ({ answer: 'DOG', question: 'A pet?' }) },
    './profiles': profiles, '../shared/messages': { room }, '../shared/env': env,
    '../shared/schemas': { CubeData, GameState, PlayerRanks, protectServerEntity: noop, modelFor: letter => letter },
    '../shared/world': world,
    '../shared/pushers': { PusherTracker: class { update() { return { x: 0, y: 0, z: 0, vx: 0, vz: 0 } } prune() {} } },
    '../sim/physics': loadTs('src/sim/physics.ts')
  }, 'exports.testing = { cubes, spawnSome, startRound, advance: seconds => { clock += seconds } }')
  server.initServer()
  Transform.create(1, { position: Vector3.create(8, 0, 0), rotation: {} })
  PlayerIdentityData.create(1, { address: 'alice' })
  const send = (name, data = {}) => handlers.get(name)(data, { from: 'alice' })
  const fill = () => { for (let i = 0; i < 8; i++) server.testing.spawnSome() }
  const grab = cube => {
    Transform.get(1).position = Vector3.create(cube.body.x, cube.body.y, cube.body.z)
    send('grab', { cubeId: cube.id })
  }
  return { config, profiles, server, Transform, Vector3, send, fill, grab, sent, systems }
}

test('repeated paid rerolls cannot replenish break rewards, while a new round can', async () => {
  const h = harness()
  const profile = await h.profiles.retain('alice')
  profile.coins = 500
  h.fill()
  const decoy = () => [...h.server.testing.cubes.values()].find(c => !'DOG'.includes(c.letter))
  h.grab(decoy())
  h.send('breakCube')
  assert.equal(profile.coins, 505, 'original decoys still pay')
  for (let cycle = 0; cycle < 3; cycle++) {
    h.Transform.get(1).position = h.Vector3.create(8, 0, 0)
    h.send('buy', { item: 'reroll' })
    h.send('useItem', { item: 'reroll' })
    assert.equal(profile.items.reroll, 0, 'the purchased item was consumed')
    h.fill()
    const before = profile.coins
    for (const cube of [...h.server.testing.cubes.values()]) {
      if ('DOG'.includes(cube.letter)) continue
      h.grab(cube)
      h.send('breakCube')
    }
    assert.equal(profile.coins, before, 'breaking the whole rerolled pile mints no coins')
    h.server.testing.advance(h.config.ITEM_COOLDOWN)
  }
  assert.equal(profile.coins, 505 - 3 * 60)
  h.server.testing.startRound()
  h.fill()
  h.grab(decoy())
  h.send('breakCube')
  assert.equal(profile.coins, 330, 'the next actual round restores normal rewards')
})

test('reroll during the initial spawn keeps a held original reward without duplicating it into the new pile', async () => {
  const h = harness()
  const profile = await h.profiles.retain('alice')
  profile.coins = 100
  h.server.testing.spawnSome() // most of the initial pile is still queued
  const decoy = () => [...h.server.testing.cubes.values()].find(c => c.mode === 'free' && !'DOG'.includes(c.letter))
  h.grab(decoy())
  h.send('buy', { item: 'reroll' })
  h.send('useItem', { item: 'reroll' })
  assert.equal(profile.items.reroll, 0)
  h.send('breakCube')
  assert.equal(profile.coins, 45, 'the original held cube pays once')
  h.send('breakCube')
  assert.equal(profile.coins, 45, 'duplicate break messages cannot pay twice')
  h.fill()
  h.grab(decoy())
  h.send('breakCube')
  assert.equal(profile.coins, 45, 'the replacement queue cannot inherit original rewards')
})

test('a present player is loaded without a join message and stays live across saves', async () => {
  const h = harness()
  assert.equal(h.profiles.profileOf('alice'), undefined)
  h.systems.get('word-cubes-server')(1)
  await new Promise(setImmediate)
  const profile = h.profiles.profileOf('alice')
  assert.ok(profile)
  profile.coins = 50
  h.profiles.touch('alice')
  h.profiles.saveSome()
  await new Promise(setImmediate)
  assert.equal(h.profiles.profileOf('alice'), profile)
  assert.ok(h.sent.some(m => m.name === 'profile'))
})
