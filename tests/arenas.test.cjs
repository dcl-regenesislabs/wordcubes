const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

// The real arena geometry: envOrigin / arenaAt over every GAME_OFFSETS entry, with the template ("GameEnv") at a
// known spot so the seven arenas really occupy different space.
const TEMPLATE = { x: 56.5, y: 160, z: 60.5 }
function env(template = TEMPLATE) {
  const config = loadTs('src/config.ts')
  const templateEntity = 1
  const engine = { getEntityOrNullByName: (name) => (template && name === config.ARENA_TEMPLATE ? templateEntity : null) }
  const Transform = { getOrNull: (e) => (e === templateEntity ? { position: template } : null) }
  const mod = loadTs('src/shared/env.ts', { '@dcl/sdk/ecs': { engine, Transform }, '@dcl/sdk/math': { Vector3: { create: (x, y, z) => ({ x, y, z }) } }, '../config': config })
  return { config, ...mod }
}

test('every arena centre and floor maps to its own game', () => {
  const { config, envOrigin, arenaAt } = env()
  assert.equal(config.GAME_OFFSETS.length, config.GAME_COUNT)
  for (let g = 0; g < config.GAME_COUNT; g++) {
    const o = envOrigin(g)
    const [dx, dy, dz] = config.GAME_OFFSETS[g]
    assert.deepEqual([o.x, o.y, o.z], [TEMPLATE.x + dx, TEMPLATE.y + dy, TEMPLATE.z + dz])
    assert.equal(arenaAt(o.x, o.y + config.FLOOR_Y, o.z), g, `centre of arena ${g}`)
    // anywhere on the floor inside the walls
    for (const [ax, az] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const r = config.ARENA_RADIUS - 0.5
      assert.equal(arenaAt(o.x + ax * r, o.y + 1, o.z + az * r), g, `inside the wall of arena ${g}`)
    }
  }
})

test('the arenas do not overlap, and the space between them, below them and the lobby belong to no game', () => {
  const { config, envOrigin, arenaAt } = env()
  const reach = config.ARENA_RADIUS + 4 // arenaAt's margin around the wall
  for (let a = 0; a < config.GAME_COUNT; a++) {
    for (let b = a + 1; b < config.GAME_COUNT; b++) {
      const oa = envOrigin(a)
      const ob = envOrigin(b)
      assert.ok(Math.hypot(oa.x - ob.x, oa.z - ob.z) > 2 * reach, `arenas ${a} and ${b} are apart`)
    }
  }
  const o0 = envOrigin(0)
  const o1 = envOrigin(1)
  assert.equal(arenaAt((o0.x + o1.x) / 2, o0.y + 1, (o0.z + o1.z) / 2), -1, 'halfway between two arenas')
  assert.equal(arenaAt(o0.x, o0.y - 10, o0.z), -1, 'fallen below the floor')
  assert.equal(arenaAt(o0.x + reach + 1, o0.y + 1, o0.z), -1, 'just outside the walls')
  assert.equal(arenaAt(186, 160.75 + 2.8, 57), -1, 'the lobby island')
})

test('without the template entity the arenas fall back to the same layout', () => {
  const { config, envOrigin, arenaAt } = env(null)
  for (let g = 0; g < config.GAME_COUNT; g++) {
    const o = envOrigin(g)
    assert.equal(arenaAt(o.x, o.y + 1, o.z), g)
  }
})
