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
    getEntityOrNullByName: () => null, addEntity: () => next++, removeEntity: entity => components.forEach(c => c.values.delete(entity)),
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
  const env = {
    envOrigin: () => Vector3.create(),
    // game 0 is the arena around the origin, like the old single GameEnv
    arenaAt: (x, y, z) => (x * x + z * z < (config.ARENA_RADIUS + 4) ** 2 && y > -2 ? 0 : -1)
  }
  const world = loadTs('src/shared/world.ts', { '../config': config, './env': env })
  const handlers = new Map()
  const sent = []
  const room = { onMessage: (name, fn) => handlers.set(name, fn), send: (name, data, opts) => sent.push({ name, data, to: opts && opts.to }) }
  const ecs = { engine, Transform, PlayerIdentityData, GltfContainer, ColliderLayer: { CL_NONE: 0 } }
  const math = { Vector3, Quaternion: { fromEulerDegrees: () => ({ x: 0, y: 0, z: 0, w: 1 }) } }
  const schemas = { CubeData, GameState, PlayerRanks, protectServerEntity: noop, modelFor: letter => letter }
  const common = loadTs('src/server/common.ts', {
    '@dcl/sdk/ecs': ecs, '@dcl/sdk/math': math, '../config': config, '../shared/messages': { room }, './profiles': profiles
  })
  const game = loadTs('src/server/game.ts', {
    '@dcl/sdk/ecs': ecs, '@dcl/sdk/math': math, '@dcl/sdk/network': { syncEntity: noop },
    '../config': config, './words': { pickWord: () => ({ answer: 'DOG', question: 'A pet?' }) },
    './profiles': profiles, '../shared/messages': { room }, '../shared/env': env, '../shared/schemas': schemas,
    '../shared/world': world, './common': common,
    '../shared/pushers': { PusherTracker: class { update() { return { x: 0, y: 0, z: 0, vx: 0, vz: 0 } } prune() {} } },
    '../sim/physics': loadTs('src/sim/physics.ts')
  })
  const server = loadTs('src/server/server.ts', {
    '@dcl/sdk/ecs': ecs, '@dcl/sdk/network': { syncEntity: noop }, '@dcl/sdk/server': { Storage },
    '../config': config, './profiles': profiles, '../shared/messages': { room }, '../shared/env': env,
    '../shared/schemas': schemas, './common': common, './game': game
  }, 'exports.games = games; exports.publishRanks = publishRanks')
  server.initServer()
  const g0 = server.games[0]
  server.testing = { cubes: g0.cubes, ...g0.testing, publishRanks: server.publishRanks, game: g0 }
  Transform.create(1, { position: Vector3.create(8, 0, 0), rotation: {} })
  PlayerIdentityData.create(1, { address: 'alice' })
  const send = (name, data = {}, from = 'alice') => handlers.get(name)(data, { from })
  send('enter', { game: 0 }) // alice takes a seat in game 0 (the player stands in its arena)
  const fill = () => { for (let i = 0; i < 8; i++) server.testing.spawnSome() }
  const grab = cube => {
    Transform.get(1).position = Vector3.create(cube.body.x, cube.body.y, cube.body.z)
    send('grab', { cubeId: cube.id })
  }
  return { config, profiles, server, Transform, Vector3, send, fill, grab, sent, systems, PlayerIdentityData, PlayerRanks, GameState }
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

test('rank publication includes 131 present players despite older cached profiles and removes departed pages', async () => {
  const h = harness()
  for (let i = 0; i < 70; i++) await h.profiles.retain(`departed-${i}`)
  await h.profiles.retain('alice')
  for (let i = 0; i < 130; i++) {
    const address = `present-${i}`
    const profile = await h.profiles.retain(address)
    profile.rating = 200 + i
    h.PlayerIdentityData.create(1000 + i, { address })
    h.Transform.create(1000 + i, { position: h.Vector3.create(8, 0, 0), rotation: {} })
  }
  h.server.testing.publishRanks()
  const entries = [...h.PlayerRanks.values.values()].flatMap(page => page.data.split(',').filter(Boolean))
  assert.equal(entries.length, 131)
  assert.equal(new Set(entries.map(entry => entry.split(':')[0])).size, 131)
  assert.ok(entries.includes('present-129:329'))
  assert.ok(entries.every(entry => !entry.startsWith('departed-')))
  assert.equal(h.PlayerRanks.values.size, 3, 'rank updates stay in small batches instead of dropping players')
  h.PlayerIdentityData.values.clear()
  h.server.testing.publishRanks()
  assert.equal(h.PlayerRanks.values.size, 1)
  assert.equal([...h.PlayerRanks.values.values()][0].data, '')
})

test('a complete winning round awards the vote bonus only to actual contributors', async () => {
  const h = harness()
  const alice = await h.profiles.retain('alice')
  const bob = await h.profiles.retain('bob')
  h.PlayerIdentityData.create(2, { address: 'bob' })
  h.Transform.create(2, { position: h.Vector3.create(8, 0, 0), rotation: {} })
  h.fill()
  for (const [slot, letter] of [...'DOG'].entries()) {
    const cube = [...h.server.testing.cubes.values()].find(c => c.mode === 'free' && c.letter === letter)
    h.grab(cube)
    h.send('place', { slot })
    h.systems.get('word-cubes-server')(1)
  }
  const game = () => [...h.GameState.values.values()][0]
  assert.equal(game().phase, 'won')
  assert.equal(alice.coins, h.config.COINS_PER_WORD)
  assert.ok(alice.rating > 0)
  assert.equal(bob.coins, 0)
  h.systems.get('word-cubes-server')(h.config.NEXT_ROUND_DELAY)
  assert.equal(game().phase, 'vote')
  h.send('vote', { choice: 1 })
  h.send('vote', { choice: 1 }, 'bob')
  h.systems.get('word-cubes-server')(0.1)
  assert.equal(game().phase, 'playing')
  assert.equal(game().round, 2)
  assert.equal(game().difficulty, 2)
  assert.equal(alice.coins, h.config.COINS_PER_WORD + h.config.VOTE_BONUS_COINS)
  assert.equal(bob.coins, 0, 'voting without building the word does not earn passive coins')
})

test('needed letters cannot be destroyed and another player cannot steal a held or placed cube', async () => {
  const h = harness()
  await h.profiles.retain('alice')
  await h.profiles.retain('bob')
  h.PlayerIdentityData.create(2, { address: 'bob' })
  h.Transform.create(2, { position: h.Vector3.create(8, 0, 0), rotation: {} })
  h.fill()
  const needed = [...h.server.testing.cubes.values()].find(c => c.letter === 'D')
  h.grab(needed)
  h.send('breakCube')
  assert.equal(needed.mode, 'held')
  assert.ok(h.server.testing.cubes.has(needed.id))
  h.send('grab', { cubeId: needed.id }, 'bob')
  h.send('breakCube', {}, 'bob')
  assert.equal(needed.holder, 'alice')
  h.send('place', { slot: 0 })
  h.systems.get('word-cubes-server')(1)
  assert.equal(needed.mode, 'placed')
  h.send('grab', { cubeId: needed.id }, 'bob')
  h.send('breakCube', {}, 'bob')
  assert.equal(needed.mode, 'placed')
})

test('collapse blocks grabbing, breaking and power-ups and releases a cube held during the throw', async () => {
  const h = harness()
  const profile = await h.profiles.retain('alice')
  profile.coins = 100
  profile.items.bomb = 1
  h.fill()
  const wrong = [...h.server.testing.cubes.values()].find(c => !'DOG'.includes(c.letter))
  h.grab(wrong)
  h.send('place', { slot: 0 })
  const another = [...h.server.testing.cubes.values()].find(c => c.mode === 'free' && !'DOG'.includes(c.letter))
  h.grab(another)
  h.systems.get('word-cubes-server')(1)
  assert.equal(another.mode, 'free', 'the offender cannot hoard a second cube during the penalty')
  h.grab(another)
  h.send('breakCube')
  h.send('useItem', { item: 'bomb' })
  const coins = profile.coins
  h.send('hint')
  assert.equal(profile.coins, coins)
  assert.equal(another.mode, 'free')
  assert.equal(profile.items.bomb, 1)
  h.server.testing.advance(h.config.COLLAPSE_LOCKOUT_SECONDS)
  h.grab(another)
  h.send('breakCube')
  assert.equal(profile.coins, 105, 'normal interaction resumes after the penalty')
})

test('leaving releases a protected held letter and pauses the empty arena timer', async () => {
  const h = harness()
  await h.profiles.retain('alice')
  h.fill()
  const needed = [...h.server.testing.cubes.values()].find(c => c.letter === 'D')
  h.grab(needed)
  h.send('breakCube')
  assert.equal(needed.mode, 'held')
  const game = () => [...h.GameState.values.values()][0]
  const time = game().timeLeft
  h.PlayerIdentityData.values.delete(1)
  h.systems.get('word-cubes-server')(1)
  assert.equal(needed.mode, 'free')
  assert.equal(game().timeLeft, time)
  assert.equal(game().players, 0)
})

test('a timeout settles contributors and returns to play through voting', async () => {
  const h = harness()
  const profile = await h.profiles.retain('alice')
  profile.rating = 400
  h.fill()
  const cube = [...h.server.testing.cubes.values()].find(c => c.letter === 'D')
  h.grab(cube)
  h.send('place', { slot: 0 })
  h.systems.get('word-cubes-server')(1)
  h.systems.get('word-cubes-server')(h.config.LEVELS[0].seconds - 2)
  h.systems.get('word-cubes-server')(1)
  const game = () => [...h.GameState.values.values()][0]
  assert.equal(game().phase, 'timeout')
  assert.equal(game().hint, 'DOG')
  assert.ok(profile.rating < 400)
  h.systems.get('word-cubes-server')(h.config.NEXT_ROUND_DELAY)
  assert.equal(game().phase, 'vote')
  h.send('vote', { choice: 0 })
  h.systems.get('word-cubes-server')(0.1)
  assert.equal(game().phase, 'playing')
  assert.equal(game().round, 2)
  assert.equal(profile.coins, h.config.VOTE_BONUS_COINS)
})

test('a game holds at most MAX_PLAYERS_PER_GAME seats and a full game says no', () => {
  const h = harness()
  const max = h.config.MAX_PLAYERS_PER_GAME
  for (let i = 1; i < max; i++) h.send('enter', { game: 0 }, `p${i}`) // alice already sits, so max-1 more fit
  const answers = h.sent.filter(m => m.name === 'entered')
  assert.equal(answers.length, max)
  assert.ok(answers.every(m => m.data.ok === 1), 'the first MAX players all get a seat')
  h.send('enter', { game: 0 }, 'late')
  const last = h.sent.filter(m => m.name === 'entered').pop()
  assert.equal(last.data.ok, 0, 'the next player is turned away')
  assert.equal(h.server.games[0].seats.size, max)
  h.send('leave', {}, 'p1')
  h.send('enter', { game: 0 }, 'late')
  assert.equal(h.sent.filter(m => m.name === 'entered').pop().data.ok, 1, 'a freed seat can be taken')
})

test('players without a seat cannot act in a game, and an idle game has no cubes', () => {
  const h = harness()
  assert.ok(h.server.games[1].cubes.size === 0 && !h.server.games[1].isActive(), 'game 2 has not been started')
  h.fill()
  const cube = [...h.server.testing.cubes.values()][0]
  h.send('grab', { cubeId: cube.id }, 'stranger')
  assert.equal(cube.mode, 'free', 'a stranger cannot grab')
  h.send('enter', { game: 1 })
  assert.ok(h.server.games[1].isActive(), 'the first seat wakes the game up')
  assert.ok(!h.server.games[0].hasSeat('alice'), 'taking a seat elsewhere gives the old one up')
})

test('asking for a full game keeps your current seat', () => {
  const h = harness()
  const max = h.config.MAX_PLAYERS_PER_GAME
  for (let i = 0; i < max; i++) h.send('enter', { game: 1 }, `q${i}`) // game 2 fills up
  h.send('enter', { game: 1 }) // alice, seated in game 1, tries the full one
  assert.equal(h.sent.filter(m => m.name === 'entered').pop().data.ok, 0)
  assert.ok(h.server.games[0].hasSeat('alice'), 'still seated where she was')
  assert.ok(!h.server.games[1].hasSeat('alice'))
})

test('re-sending enter cannot hold a seat you never arrive at', () => {
  const h = harness()
  const g = h.server.games[1]
  h.send('enter', { game: 1 }, 'squatter') // no avatar in the scene: never arrives
  const tick = g.tick
  const step = 1
  let seated = 0
  const span = 3 * h.config.SEAT_HOLD_SECONDS
  for (let t = 0; t < span; t += step) {
    h.send('enter', { game: 1 }, 'squatter') // keeps asking
    tick(step)
    if (g.hasSeat('squatter')) seated += step
  }
  // a seat for SEAT_HOLD_SECONDS, then twice that locked out: about a third of the time, not all of it
  assert.ok(seated <= span * 0.4, `held a seat ${seated}s of ${span}s`)
})
