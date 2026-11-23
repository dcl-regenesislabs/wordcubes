const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTs, loadI18n } = require('./load-ts.cjs')

const wallet = '0x1234567890abcdef1234567890abcdef1234abcd'

function harness(lang = 'en') {
  const players = new Map()
  const tasks = []
  const transforms = new Map([[1, { scale: { x: 1, y: 1, z: 1 } }]])
  const texts = new Map()
  const config = loadTs('src/config.ts')
  const { format } = loadI18n()
  let nextEntity = 2
  const board = loadTs('src/client/leaderboard.ts', {
    '@dcl/sdk/ecs': {
      engine: {
        addEntity: () => nextEntity++,
        getEntityOrNullByName: () => 1,
        getEntitiesWith: () => Array.from(players.keys(), address => [address, { address }])
      },
      AvatarBase: { getOrNull: id => players.get(id) },
      Transform: {
        create: (id, transform) => transforms.set(id, transform),
        get: id => transforms.get(id),
        getOrNull: id => transforms.get(id)
      },
      TextShape: {
        create: (id, shape) => texts.set(id, shape),
        get: id => texts.get(id),
        getMutable: id => texts.get(id)
      },
      TextAlignMode: { TAM_MIDDLE_LEFT: 1, TAM_MIDDLE_RIGHT: 2 },
      executeTask: task => tasks.push(task)
    },
    '@dcl/sdk/math': {
      Color4: { create: () => ({}) },
      Quaternion: { fromEulerDegrees: () => ({}) },
      Vector3: { create: (x, y, z) => ({ x, y, z }) }
    },
    '../../assets/scene/entity-names': { EntityNames: {} },
    './gamestate': { boardText: () => '' },
    './ranktags': { parseBoard: () => [[wallet, 1]] },
    './ui/rank': { rankIndex: () => 5 },
    './i18n': { t: key => format(lang, key), uiLang: () => lang },
    '../shared/player-label': loadTs('src/shared/player-label.ts'),
    '../config': config
  }, 'exports.setFetch = fn => { globalThis.fetch = fn }')
  return {
    ...board, players, tasks,
    render() {
      board.leaderboardSystem(1)
      return Array.from(texts, ([id, shape]) => ({ ...shape, ...transforms.get(id).position })).slice(0, 4)
    }
  }
}

test('leaderboard puts long names above the wallet suffix and rank', () => {
  const h = harness()
  for (const [name, expected] of [
    ['PlayerName', 'PlayerName'],
    ['ABCDEFGHIJKLMNOP', 'ABCDEFGHI...'],
    ['Alice#1234', 'Alice'],
    ['Alice #ABCD', 'Alice'],
    ['<Alice>\n', 'Alice'],
    ['😀'.repeat(13), '😀'.repeat(9) + '...']
  ]) {
    h.players.set(wallet.toUpperCase(), { name })
    const [, display, suffix, rank] = h.render()
    assert.equal(display.text, expected)
    assert.equal(suffix.text, '#abcd')
    assert.equal(rank.text, 'Paragraph')
    assert.ok(display.y > rank.y)
    assert.equal(suffix.y, rank.y)
    assert.equal(suffix.x, display.x)
    assert.ok(suffix.fontSize < display.fontSize)
  }
  assert.equal(h.tasks.length, 0)
})

test('offline names load once and display as plain text', async () => {
  const h = harness('es')
  h.setFetch(async url => {
    assert.equal(url, `https://peer.decentraland.org/lambdas/profile/${wallet}`)
    return { ok: true, json: async () => ({ avatars: [{ name: '<Offline>\n' }] }) }
  })
  assert.equal(h.render()[1].text, 'Jugador')
  h.render()
  assert.equal(h.tasks.length, 1)
  await h.tasks[0]()
  assert.equal(h.render()[1].text, 'Offline')
})

test('a pending profile lookup cannot overwrite a live name', async () => {
  const h = harness()
  h.setFetch(async () => ({ ok: true, json: async () => ({ avatars: [{ name: 'OldName' }] }) }))
  h.render()
  h.players.set(wallet, { name: 'LiveName' })
  assert.equal(h.render()[1].text, 'LiveName')
  await h.tasks[0]()
  h.players.clear()
  assert.equal(h.render()[1].text, 'LiveName')
})

test('network failures, empty profiles and HTTP 404 retain a localized fallback', async () => {
  for (const response of [null, { avatars: [] }, 404]) {
    const h = harness('pt')
    h.setFetch(async () => {
      if (response === null) throw new Error('offline')
      if (response === 404) return { ok: false }
      return { ok: true, json: async () => response }
    })
    h.render()
    await h.tasks[0]()
    const [, display, suffix] = h.render()
    assert.equal(display.text, 'Jogador')
    assert.equal(suffix.text, '#abcd')
    assert.equal(h.tasks.length, 1)
  }
})
