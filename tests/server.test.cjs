const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs, loadI18n } = require('./load-ts.cjs')

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
  const AvatarBase = component()
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
  const picks = [] // the language of every word the games picked
  const sent = []
  const room = { onMessage: (name, fn) => handlers.set(name, fn), send: (name, data, opts) => sent.push({ name, data, to: opts && opts.to }) }
  const ecs = { engine, Transform, PlayerIdentityData, AvatarBase, GltfContainer, ColliderLayer: { CL_NONE: 0 } }
  const math = { Vector3, Quaternion: { fromEulerDegrees: () => ({ x: 0, y: 0, z: 0, w: 1 }) } }
  const schemas = { CubeData, GameState, PlayerRanks, protectServerEntity: noop, modelFor: letter => letter }
  const common = loadTs('src/server/common.ts', {
    '@dcl/sdk/ecs': ecs, '@dcl/sdk/math': math, '../config': config, '../shared/messages': { room }, './profiles': profiles
  })
  const lang = loadTs('src/shared/lang.ts')
  const i18n = loadI18n()
  const say = loadTs('src/server/say.ts', { '../shared/i18n': i18n })
  const cubenet = loadTs('src/shared/cubenet.ts')
  const cubesync = loadTs('src/server/cubesync.ts', { '../config': config, '../shared/messages': { room }, '../shared/cubenet': cubenet })
  const game = loadTs('src/server/game.ts', {
    '@dcl/sdk/ecs': ecs, '@dcl/sdk/math': math,
    '../config': config, './words': { pickWord: (level, exclude, lang) => { picks.push(lang); return { answer: 'DOG', question: 'A pet?' } } },
    './profiles': profiles, '../shared/messages': { room }, '../shared/env': env, '../shared/schemas': schemas,
    '../shared/player-label': loadTs('src/shared/player-label.ts'),
    '../shared/world': world, './common': common,
    '../shared/pushers': { PusherTracker: class { update() { return { x: 0, y: 0, z: 0, vx: 0, vz: 0 } } prune() {} } },
    '../sim/physics': loadTs('src/sim/physics.ts'),
    '../shared/cubenet': cubenet, './cubesync': cubesync, '../shared/lang': lang, './say': say, '../shared/i18n': i18n
  })
  const server = loadTs('src/server/server.ts', {
    '@dcl/sdk/ecs': ecs, '@dcl/sdk/network': { syncEntity: noop }, '@dcl/sdk/server': { Storage },
    '../config': config, './profiles': profiles, '../shared/messages': { room }, '../shared/env': env,
    '../shared/schemas': schemas, './common': common, './game': game, '../shared/tutorial': loadTs('src/shared/tutorial.ts'), '../shared/lang': lang, './say': say, '../shared/i18n': i18n,
    './netstats': { setupNetStats: noop, recordTick: noop, netAccessTick: noop, forgetNetAccess: noop, isPreview: () => false } // the dev-only live monitor is not under test
  }, 'exports.games = games; exports.publishRanks = publishRanks')
  server.initServer()
  const g0 = server.games[0]
  server.testing = { cubes: g0.cubes, ...g0.testing, publishRanks: server.publishRanks, game: g0 }
  Transform.create(1, { position: Vector3.create(8, 0, 0), rotation: {} })
  PlayerIdentityData.create(1, { address: 'alice' })
  AvatarBase.create(1, { name: 'Alice' })
  const send = (name, data = {}, from = 'alice') => handlers.get(name)(data, { from })
  send('enter', { game: 0 }) // alice takes a seat in game 0 (the player stands in its arena)
  const fill = () => server.testing.settlePile()
  const grab = cube => {
    Transform.get(1).position = Vector3.create(cube.body.x, cube.body.y, cube.body.z)
    send('grab', { cubeId: cube.id })
  }
  return { config, profiles, server, Transform, Vector3, send, fill, grab, sent, systems, PlayerIdentityData, PlayerRanks, GameState, picks }
}

test('pickup requires proximity in three dimensions, including requests sent directly to the server', () => {
  for (const offset of [
    { x: 6, y: 0, z: 0 }, // remote reach previously allowed from the platform
    { x: 2.71, y: 0, z: 0 },
    { x: 0, y: 2.71, z: 0 },
    { x: 2, y: 0, z: 2 }
  ]) {
    const h = harness()
    h.fill()
    const cube = [...h.server.testing.cubes.values()].find(c => c.mode === 'free')
    // Keep the player inside the arena for every case; only distance should reject the grab.
    Object.assign(cube.body, { x: 8, y: h.config.CUBE_RADIUS, z: 0 })
    h.Transform.get(1).position = h.Vector3.create(8 + offset.x, cube.body.y + offset.y, offset.z)
    h.send('grab', { cubeId: cube.id })
    assert.equal(cube.mode, 'free', `remote pickup must fail: ${JSON.stringify(offset)}`)
    // A rejected request must leave the cube available for a nearby player.
    h.Transform.get(1).position = h.Vector3.create(8 + h.config.PICKUP_CENTER_DISTANCE, cube.body.y, 0)
    h.send('grab', { cubeId: cube.id })
    assert.equal(cube.mode, 'held', 'pickup at the configured boundary succeeds')
    assert.equal(cube.holder, 'alice')
  }
})

test('server accepts the client surface reach plus the rotated collider corner margin', () => {
  const h = harness()
  h.fill()
  const cube = [...h.server.testing.cubes.values()].find(c => c.mode === 'free')
  Object.assign(cube.body, { x: 8, y: h.config.CUBE_HALF, z: 0 })
  const corner = Math.sqrt(3) * 0.25 * h.config.CUBE_SCALE
  h.Transform.get(1).position = h.Vector3.create(8 + h.config.PICKUP_DISTANCE + corner - 0.001, cube.body.y, 0)
  h.send('grab', { cubeId: cube.id })
  assert.equal(cube.mode, 'held')
})

test('platform edge cannot grab a cube resting against the pedestal, but nearby ground can', () => {
  const h = harness()
  h.fill()
  const cube = [...h.server.testing.cubes.values()].find(c => c.mode === 'free')
  Object.assign(cube.body, { x: h.config.STAGE_RADIUS + h.config.CUBE_RADIUS, y: h.config.CUBE_HALF, z: 0 })
  h.Transform.get(1).position = h.Vector3.create(h.config.STAGE_RADIUS, h.config.STAGE_TOP, 0)
  h.send('grab', { cubeId: cube.id })
  assert.equal(cube.mode, 'free')
  assert.ok(h.sent.some(m => m.name === 'toast' && /Step off/.test(m.data.text)))
  h.Transform.get(1).position = h.Vector3.create(cube.body.x + 1, h.config.FLOOR_Y, 0)
  h.send('grab', { cubeId: cube.id })
  assert.equal(cube.mode, 'held')
})

test('each successful power-up sends one toast to every game member only', async () => {
  for (const item of loadTs('src/config.ts').ITEMS) {
    const h = harness()
    const profile = await h.profiles.retain('alice')
    profile.items[item.id] = 2
    h.fill()
    for (const [entity, address] of [[2, 'bob'], [3, 'outsider']]) {
      h.PlayerIdentityData.create(entity, { address })
      h.Transform.create(entity, { position: h.Vector3.create(8, 0, 0), rotation: {} })
    }
    h.send('enter', { game: 0 }, 'bob')
    h.sent.length = 0
    h.send('useItem', { item: item.id })
    assert.equal(profile.items[item.id], 1)
    const toasts = h.sent.filter(m => m.name === 'toast')
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].data.kind, 'powerup')
    assert.ok(toasts[0].data.text.startsWith(`Alice#lice used ${item.name}!`))
    if (item.id === 'freeze') assert.match(toasts[0].data.text, /20s of Time Freeze/)
    if (item.id === 'reroll') assert.match(toasts[0].data.text, /A fresh pile of cubes/)
    assert.deepEqual(Array.from(toasts[0].to), ['alice', 'bob'])

    h.sent.length = 0
    h.send('useItem', { item: item.id })
    assert.equal(profile.items[item.id], 1, 'rejected repeat use consumes nothing')
    assert.ok(h.sent.filter(m => m.name === 'toast').every(m =>
      m.data.text !== `Alice#lice used ${item.name}!` && m.to.length === 1 && m.to[0] === 'alice'
    ), 'rejection feedback stays private')

    h.sent.length = 0
    h.send('useItem', { item: item.id }, 'outsider')
    assert.equal(h.sent.length, 0, 'unseated players cannot announce a power-up')
  }
})

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

test('a reroll keeps a held original reward without duplicating it into the new pile', async () => {
  const h = harness()
  const profile = await h.profiles.retain('alice')
  profile.coins = 100
  h.server.testing.settlePile()
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

test('disconnecting keeps the seat through the reconnect grace, then releases held letters', async () => {
  const h = harness()
  await h.profiles.retain('alice')
  h.fill()
  const needed = [...h.server.testing.cubes.values()].find(c => c.letter === 'D')
  h.grab(needed)
  h.send('breakCube')
  assert.equal(needed.mode, 'held')
  const game = () => [...h.GameState.values.values()][0]
  h.systems.get('word-cubes-server')(0.1) // record arrival before disconnecting
  const time = game().timeLeft
  h.PlayerIdentityData.values.delete(1)
  h.systems.get('word-cubes-server')(1)
  assert.equal(needed.mode, 'held', 'a transient presence gap must not drop the held cube')
  assert.equal(game().players, 1, 'the seat survives the first missing presence sample')
  for (let i = 0; i < h.config.SEAT_LEAVE_SECONDS; i++) h.systems.get('word-cubes-server')(1)
  assert.equal(needed.mode, 'free')
  assert.equal(game().timeLeft, time)
  assert.equal(game().players, 0)
})

test('a temporary missing player transform cannot clear the room or its clue', () => {
  const h = harness()
  h.fill()
  const state = () => h.GameState.get(h.server.games[0].stateEntity)
  const tick = h.systems.get('word-cubes-server')
  tick(0.1) // the player has arrived, so reconnect grace applies
  const transform = h.Transform.get(1)
  const question = state().question
  h.Transform.values.delete(1)
  tick(1)
  assert.equal(h.server.games[0].hasSeat('alice'), true)
  h.Transform.create(1, transform)
  for (let i = 0; i < 7; i++) tick(1)
  assert.equal(state().active, 1)
  assert.equal(state().question, question)
  assert.ok(!h.sent.some(m => m.name === 'eject'))
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

test('a new pile settles unseen and its cubes are created once, at rest, marked for the client fall', () => {
  const h = harness()
  const g = h.server.games[0]
  assert.equal(g.cubes.size, 0, 'nothing is created while the pile settles')
  let ticks = 0
  while (g.cubes.size === 0 && ticks < 60) { g.tick(1 / 30); ticks++ }
  assert.equal(g.cubes.size, h.config.CUBES_PER_ROUND, 'the whole pile appears at once')
  assert.ok(ticks > 1, 'settling is spread over several ticks')
  const cubes = [...g.cubes.values()]
  // The pile is random: now and then a cube or two still slides when the settle time runs out. Those are created awake
  // and keep being sent until they stop, like any moving cube; everything else needs no transform after its create.
  const awake = cubes.filter((c) => !c.body.asleep)
  assert.ok(awake.length <= 5, `created at rest (${awake.length} still moving)`)
  assert.ok(cubes.every((c) => c.sentAsleep === c.body.asleep), 'only the moving ones are sent again')
  const born = cubes.map((c) => h.server.testing.cubeData(c.entity).born)
  assert.ok(born.every((b) => b > 0 && b === born[0]), 'one birth time for the pile')
})

test('Start game runs one shared countdown: nobody enters early, everyone enters at the end', () => {
  const h = harness()
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  try {
    const state = () => h.GameState.get(h.server.games[1].stateEntity)
    h.send('start', { game: 1 }, 'bob')
    const startAt = Number(state().startAt)
    assert.equal(startAt, now + h.config.LOBBY_COUNTDOWN_SECONDS * 1000, 'the server writes only when it ends')
    now += 2000
    h.send('start', { game: 1 }, 'carol')
    assert.equal(Number(state().startAt), startAt, 'a second press joins the same countdown')
    const answers = () => h.sent.filter(m => m.name === 'entered' && m.data.game === 1)
    h.send('enter', { game: 1 }, 'bob')
    assert.equal(answers().length, 0, 'no seat before the countdown ends')
    assert.equal(h.server.games[1].hasSeat('bob'), false)
    now = startAt
    h.send('enter', { game: 1 }, 'bob')
    h.send('enter', { game: 1 }, 'carol')
    assert.deepEqual(answers().map(m => m.data.ok), [1, 1], 'the group enters together')
    assert.equal(state().active, 1, 'the first seat starts the game')
    // a finished countdown is cleared after the grace period
    now = startAt + (h.config.START_GRACE_SECONDS + 1) * 1000
    h.systems.get('word-cubes-server')(1)
    assert.equal(Number(state().startAt), 0)
  } finally {
    Date.now = realNow
  }
})

test('a running game cannot be restarted from its pad and takes players mid-round', () => {
  const h = harness()
  const g0 = h.GameState.get(h.server.games[0].stateEntity) // alice already plays game 0
  assert.equal(g0.active, 1)
  const round = g0.round
  h.send('start', { game: 0 }, 'bob')
  assert.equal(Number(g0.startAt), 0, 'no countdown on a running game')
  assert.match(h.sent.filter(m => m.name === 'toast').pop().data.text, /Join game/)
  h.send('enter', { game: 0 }, 'bob')
  assert.equal(h.sent.filter(m => m.name === 'entered').pop().data.ok, 1, 'joined straight into the running game')
  assert.equal(g0.round, round, 'joining does not restart the round')
})

test('player labels preserve wallet suffix and truncate long names', () => {
  const { playerLabel } = loadTs('src/shared/player-label.ts')
  assert.equal(playerLabel('Alice', '0x1234abcd'), 'Alice#abcd')
  assert.equal(playerLabel('ABCDEFGHIJKLMNOPQRST', '0x1234abcd'), 'ABCDEFGHIJKLM...#abcd')
  assert.equal(playerLabel('Alice#abcd', '0x1234abcd'), 'Alice#abcd')
})

// ---- cubes travel as per-game messages (server/cubesync.ts -> client/cubenet.ts), not as synced entities ----

// The client's cube mirror (client/cubenet.ts) on plain component doubles, fed with the server's messages.
function cubeClient(h) {
  let next = 100000
  const comp = () => {
    const values = new Map()
    return { values, create: (e, v) => values.set(e, { ...v }), get: e => values.get(e), getMutable: e => values.get(e) }
  }
  const Transform = comp()
  const CubeData = comp()
  const engine = { addEntity: () => next++, removeEntity: e => { Transform.values.delete(e); CubeData.values.delete(e) } }
  const handlers = new Map()
  const out = []
  const room = { onMessage: (name, fn) => handlers.set(name, fn), send: (name, data) => out.push({ name, data }) }
  const cs = { game: -1, myAddress: 'alice' }
  const Quaternion = { fromEulerDegrees: (x, y, z) => ({ y }), slerp: (a, b) => b }
  const mod = loadTs('src/client/cubenet.ts', {
    '@dcl/sdk/ecs': { engine, Transform }, '@dcl/sdk/math': { Vector3: h.Vector3, Quaternion }, '../config': h.config,
    '../shared/tutorial': loadTs('src/shared/tutorial.ts'), '../shared/messages': { room }, '../shared/schemas': { CubeData }, '../shared/cubenet': loadTs('src/shared/cubenet.ts'), './state': { cs }
  })
  mod.setupCubeNet()
  let read = 0
  return {
    cs, out, Transform, CubeData,
    system: dt => mod.cubeNetSystem(dt),
    guess: (id, mode, slot) => mod.guessMode(id, mode, slot),
    takeUndone: (id) => mod.takeUndone(id),
    slotTaken: (slot, except) => mod.slotTaken(slot, except),
    // hand the client every cube message the server sent to `addr` since last time (skip: drop some, like a lossy link)
    deliver(addr, skip = () => false) {
      for (; read < h.sent.length; read++) {
        const m = h.sent[read]
        if (!m.name.startsWith('cube') || !(m.to ?? []).includes(addr) || skip(m)) continue
        handlers.get(m.name)(m.data)
      }
    },
    cubes: () => [...CubeData.values.entries()].map(([e, d]) => ({ ...d, pos: Transform.get(e).position })),
    // the client's requests reach the server
    forward(addr) {
      for (const m of out.splice(0)) h.send(m.name, m.data, addr)
    }
  }
}

const tickServer = (h, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 30) h.systems.get('word-cubes-server')(1 / 30)
}

test('cube messages reach only the players seated in that game, and each one stays small', () => {
  const h = harness()
  h.send('enter', { game: 1 }, 'bob') // bob plays game 1, alice game 0
  tickServer(h, 3)
  const cubeMsgs = h.sent.filter(m => m.name === 'cubeState' || m.name === 'cubeMoves')
  assert.ok(cubeMsgs.length > 0)
  for (const m of cubeMsgs) {
    assert.deepEqual([...m.to], m.data.g === 0 ? ['alice'] : ['bob'], `${m.name} for game ${m.data.g} goes to its players only`)
    assert.ok(m.data.d.length * 2 < 8 * 1024, `${m.name} is ${m.data.d.length * 2} bytes`)
  }
  // every cube of game 0 reached alice in a cubeState
  const ids = new Set()
  for (const m of cubeMsgs) if (m.name === 'cubeState' && m.data.g === 0) for (let i = 0; i < m.data.d.length; i += 9) ids.add(m.data.d[i])
  assert.deepEqual([...ids].sort(), [...h.server.games[0].cubes.keys()].sort())
})

test('the client rebuilds its game from the messages and recovers from a lost one', () => {
  const h = harness()
  const c = cubeClient(h)
  c.cs.game = 0 // alice's seat in game 0
  c.system(1 / 30)
  assert.equal(c.out[0].name, 'cubeSync', 'entering a game asks for its cubes')
  c.forward('alice')
  tickServer(h, 3) // the pile settles and is created
  c.deliver('alice')
  c.system(1)
  const server = [...h.server.games[0].cubes.values()]
  const client = new Map(c.cubes().map(x => [x.id, x]))
  assert.equal(client.size, server.length, 'one local cube per server cube')
  for (const s of server) {
    const x = client.get(s.id)
    assert.equal(x.letter, s.letter)
    assert.equal(x.mode, 'free')
    if (!s.body.asleep) continue // a cube still sliding has moved on since the last send
    assert.ok(Math.abs(x.pos.x - s.body.x) < 0.01 && Math.abs(x.pos.z - s.body.z) < 0.01, 'same spot, to the cm')
  }
  assert.ok(c.cubes().every(x => x.born > 0), 'a fresh pile plays its fall')

  // alice grabs a cube, but that cubeState never arrives
  const cube = server.find(s => s.mode === 'free')
  h.grab(cube)
  tickServer(h, 0.5)
  c.deliver('alice', m => m.name === 'cubeState')
  assert.equal(client.get(cube.id).mode, 'free', 'the grab was lost on the way')
  tickServer(h, h.config.CUBE_SYNC_COOLDOWN + 0.5)
  c.deliver('alice')
  c.system(h.config.CUBE_SYNC_COOLDOWN + 0.1)
  assert.ok(c.out.some(m => m.name === 'cubeSync'), 'the gap in the sequence asks for the full state')
  c.forward('alice')
  c.deliver('alice')
  const held = c.cubes().find(x => x.id === cube.id)
  assert.equal(held.mode, 'held')
  assert.equal(held.holder, 'alice')
  assert.equal(c.cubes().length, h.server.games[0].cubes.size)
})

test('leaving the game drops its cubes on the client', () => {
  const h = harness()
  const c = cubeClient(h)
  c.cs.game = 0
  c.system(1 / 30)
  c.forward('alice')
  tickServer(h, 3)
  c.deliver('alice')
  assert.ok(c.cubes().length > 0)
  c.cs.game = -1
  c.system(1 / 30)
  assert.equal(c.cubes().length, 0)
})

test('the player who presses Start game picks the language the game is played in, until it goes idle', () => {
  const h = harness()
  const g = h.server.games[2]
  const state = () => h.GameState.get(g.stateEntity)
  assert.equal(state().lang, '', 'an idle game has no language yet')
  h.send('start', { game: 2, lang: 'es' }, 'bob')
  assert.equal(state().lang, 'es', 'the pad shows it during the countdown')
  h.send('start', { game: 2, lang: 'pt' }, 'carol')
  assert.equal(state().lang, 'es', 'a second press does not change it')
  g.requestSeat('bob') // the countdown ended: bob goes in
  assert.equal(state().active, 1)
  assert.equal(h.picks.pop(), 'es', 'the words come from the Spanish bank')
  g.leaveSeat('bob')
  for (let i = 0; i < 10; i++) g.tick(1) // empty long enough to go idle
  assert.equal(state().active, 0)
  assert.equal(state().lang, '', 'idle again: the next Start game picks again')
  h.send('start', { game: 3, lang: 'klingon' }, 'dave') // game 2's countdown still runs; try an untouched pad
  assert.equal(h.GameState.get(h.server.games[3].stateEntity).lang, 'en', 'an unknown language falls back to English')
})

test('your own grab and throw show at once, and the server word wins', () => {
  const h = harness()
  const c = cubeClient(h)
  c.cs.game = 0
  c.system(1 / 30)
  c.forward('alice')
  tickServer(h, 3)
  c.deliver('alice')
  c.system(1)
  const mine = (id) => c.cubes().find(x => x.id === id)
  const [a, b] = [...h.server.games[0].cubes.values()].filter(s => s.mode === 'free')

  // a grab the server accepts: in your hands at once, and its confirmation changes nothing
  c.guess(a.id, 'held', -1)
  assert.equal(mine(a.id).mode, 'held', 'shown before any answer')
  assert.equal(mine(a.id).holder, 'alice')
  assert.ok(mine(a.id).pos.y < -10, 'the real cube is hidden where the server will park it')
  h.grab(a)
  tickServer(h, 0.2)
  c.deliver('alice')
  c.system(h.config.GUESS_CONFIRM_SECONDS + 0.5) // long after the guess would have run out
  assert.equal(mine(a.id).mode, 'held', 'confirmed: it stays in your hands')

  // a throw at a frame before the grab's answer came back keeps flying when that old answer lands
  const slot = 0
  c.guess(a.id, 'flying', slot)
  h.send('place', { slot })
  tickServer(h, 0.2)
  c.deliver('alice')
  assert.equal(mine(a.id).mode, 'flying')

  // a grab the server refuses (someone else's cube, or too far): back where it was, without a throw
  const before = { ...mine(b.id).pos }
  c.guess(b.id, 'held', -1)
  c.system(h.config.GUESS_CONFIRM_SECONDS + 0.1)
  assert.equal(mine(b.id).mode, 'free', 'given up after the wait')
  assert.ok(Math.abs(mine(b.id).pos.x - before.x) < 1e-6 && Math.abs(mine(b.id).pos.y - before.y) < 1e-6, 'back in its spot')
  assert.equal(c.takeUndone(b.id), true, 'cubes.ts ends the carry pose quietly')
})

test('a cube thrown away flies at once and then hands over to the server cube', () => {
  const h = harness()
  const c = cubeClient(h)
  c.cs.game = 0
  c.system(1 / 30)
  c.forward('alice')
  tickServer(h, 3)
  c.deliver('alice')
  c.system(1)
  const mine = (id) => c.cubes().find(x => x.id === id)
  const a = [...h.server.games[0].cubes.values()].find(s => s.mode === 'free')
  h.grab(a)
  tickServer(h, 0.2)
  c.deliver('alice')
  assert.equal(mine(a.id).mode, 'held')

  c.guess(a.id, 'tossing', -1)
  assert.equal(mine(a.id).mode, 'tossing', 'leaves your hands before any answer')
  h.send('toss')
  tickServer(h, 0.5) // the server releases it and it flies
  c.deliver('alice')
  c.system(0.1)
  assert.equal(mine(a.id).mode, 'tossing', 'your copy keeps flying a moment after the server answered')
  c.system(h.config.TOSS_SHOW_SECONDS)
  assert.equal(mine(a.id).mode, 'free', 'then the server cube takes over')
  assert.equal(mine(a.id).holder, '')
})

test('a guess the server never answers asks for the full state, and a lost toss answer leaves the cube down', () => {
  const h = harness()
  const c = cubeClient(h)
  c.cs.game = 0
  c.system(1 / 30)
  c.forward('alice')
  tickServer(h, 3)
  c.deliver('alice')
  c.system(1)
  const mine = (id) => c.cubes().find(x => x.id === id)
  const [a, b] = [...h.server.games[0].cubes.values()].filter(s => s.mode === 'free')
  h.grab(a)
  tickServer(h, 0.2)
  c.deliver('alice')

  // a frame with someone else's cube on its way is taken; your own cube does not count
  assert.equal(c.slotTaken(0, a.id), false)
  c.guess(b.id, 'flying', 0) // stands in for another player's cube flying to frame 0
  assert.equal(c.slotTaken(0, a.id), true, 'a cube flying to the frame takes it')

  // the server's answer to the toss is lost: no jump back into your hands, and the full state is asked for
  c.out.length = 0
  c.guess(a.id, 'tossing', -1)
  c.system(h.config.GUESS_CONFIRM_SECONDS + h.config.TOSS_SHOW_SECONDS + 0.1)
  assert.equal(mine(a.id).mode, 'free', 'it stays where it fell on your screen')
  assert.ok(c.out.some(m => m.name === 'cubeSync'), 'the full state settles it')
})

test('server only persists the local tutorial completion flag, with no practice instance', async () => {
  const h=harness()
  await h.profiles.retain('alice')
  const before=h.server.games.length
  h.send('setSetting',{key:'tutorialComplete',value:1})
  assert.equal(h.profiles.profileOf('alice').settings.tutorialComplete,true)
  assert.equal(h.server.games.length,before)
  assert.ok(h.sent.filter(m=>m.name==='profile').some(m=>JSON.parse(m.data.settings).tutorialComplete===true))
})
