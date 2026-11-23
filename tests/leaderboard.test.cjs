const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

function harness() {
  const players = new Map()
  const tasks = []
  const board = loadTs('src/client/leaderboard.ts', {
    '@dcl/sdk/ecs': { executeTask: task => tasks.push(task) },
    '@dcl/sdk/math': { Color4: { create: () => ({}) } },
    '@dcl/sdk/players': { getPlayer: ({ userId }) => players.get(userId) },
    '../../assets/scene/entity-names': {},
    './gamestate': {}, './ranktags': {}, './ui/rank': {}, './i18n': {},
    '../config': { LEADERBOARD_NAME_CHARS: 12 }
  }, 'exports.nameOf = nameOf; exports.setFetch = fn => { globalThis.fetch = fn }')
  return { ...board, players, tasks }
}

const wallet = '0x1234567890abcdef1234567890abcdef1234abcd'

test('leaderboard keeps the wallet suffix with normal, long and already suffixed names', () => {
  const h = harness()
  for (const [name, expected] of [
    ['PlayerName', 'PlayerName #abcd'],
    ['ABCDEFGHIJKLMNOP', 'ABCDEFGHIJK… #abcd'],
    ['Alice#1234', 'Alice #abcd'],
    ['Alice #ABCD', 'Alice #abcd'],
    ['   ', 'Player #abcd'],
    ['😀'.repeat(13), '😀'.repeat(11) + '… #abcd']
  ]) {
    h.players.set(wallet, { name })
    assert.equal(h.nameOf(wallet), expected)
  }
})

test('offline names load once, retain the suffix and yield to live player data', async () => {
  const h = harness()
  h.setFetch(async url => {
    assert.equal(url, `https://peer.decentraland.org/lambdas/profile/${wallet}`)
    return { ok: true, json: async () => ({ avatars: [{ name: 'Offline' }] }) }
  })
  assert.equal(h.nameOf(wallet), 'Player #abcd')
  h.nameOf(wallet)
  assert.equal(h.tasks.length, 1)
  await h.tasks[0]()
  assert.equal(h.nameOf(wallet), 'Offline #abcd')
  h.players.set(wallet, { name: 'NewName' })
  assert.equal(h.nameOf(wallet), 'NewName #abcd')
  assert.equal(h.tasks.length, 1)
})

test('unavailable and empty profiles keep a labeled fallback without repeated requests each frame', async () => {
  for (const response of [null, { avatars: [] }]) {
    const h = harness()
    h.setFetch(async () => {
      if (response === null) throw new Error('offline')
      return { ok: true, json: async () => response }
    })
    h.nameOf(wallet)
    await h.tasks[0]()
    assert.equal(h.nameOf(wallet), 'Player #abcd')
    assert.equal(h.tasks.length, 1)
  }
})
