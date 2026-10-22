const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

function harness(phone) {
  const config = loadTs('src/config.ts')
  const state = loadTs('src/client/state.ts', { '../config': config })
  const platform = loadTs('src/client/ui/platform.ts', { '~system/Runtime': {
    getExplorerInformation: async () => ({ platform: phone ? 'mobile' : 'desktop' })
  } })
  platform.forceMobile(phone)
  const createElement = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  const react = { default: { createElement }, UiEntity: 'UiEntity', Label: 'Label' }
  const noop = () => {}
  let currentGame = null
  const theme = { PAL: {}, Frame: 'Frame', OutlineLabel: 'OutlineLabel', PillButton: 'PillButton',
    LetterTile: 'LetterTile', CoinIcon: 'CoinIcon', c: noop,
    clamp: (n, min, max) => Math.min(max, Math.max(min, n)) }
  const hud = loadTs('src/client/ui/hud.tsx', {
    '@dcl/sdk/react-ecs': react, '@dcl/sdk/ecs': { engine: { getEntitiesWith: () => currentGame ? [[0, currentGame]] : [] } },
    '../../shared/schemas': {}, '../gamestate': { myState: () => currentGame || undefined, boardText: () => '' }, '../state': state, '../cubes': { heldLetter: () => '' },
    '../../config': config, '../../shared/messages': { room: { send: noop } },
    '../lobby': { returnToLobby: noop }, '../arena': {}, './platform': platform,
    './theme': theme, './rank': loadTs('src/client/ui/rank.ts', { '../../config': config }), '../ranktags': {}, '@dcl/sdk/players': {},
    '../../../assets/scene/entity-names': {}
  }, 'exports.testing = { WordPanel, SidePanel, ItemBar, VoteScreen, snapshot: () => ({ seenRound, prev, prevPhase, failAt, winAt, lastDifficulty, levelAt, myVote, votedRound }) }')
  return { hud: hud.testing, module: hud, state, platform, react, setGame: g => { currentGame = g } }
}

test('mobile gameplay controls clear the native action band with every inventory item visible', () => {
  const h = harness(true)
  Object.assign(h.state.cs.items, { wildcard: 1, freeze: 1, reroll: 1, bomb: 1 })
  const g = { phase: 'playing', length: 14, masked: '_'.repeat(14), question: 'A long question '.repeat(10), hint: '', frozen: 0, difficulty: 1 }
  const width = h.platform.canvas().virtualWidth
  const height = h.platform.canvas().virtualHeight
  const bandLeft = width - 240
  const side = h.hud.SidePanel({ g })
  const sideLayout = side.props.uiTransform
  const sideLeft = width - sideLayout.position.right - sideLayout.width
  assert.ok(width - sideLayout.position.right <= bandLeft, 'side buttons must stay left of the native control band')
  const sideHeight = side.children.reduce((sum, child) => sum + child.props.height + (child.props.margin?.top || 0), 0)
  assert.ok(sideLayout.position.top + sideHeight <= height)
  const word = h.hud.WordPanel({ g })
  assert.ok(word.props.uiTransform.width <= sideLeft, 'question and tiles must not overlap the side buttons')
  const bar = h.hud.ItemBar({ g })
  const layout = bar.props.uiTransform
  assert.equal(bar.children.length, 4)
  assert.equal(layout.flexDirection, 'row')
  assert.ok(width - layout.position.right <= bandLeft)
  assert.ok(width - layout.position.right - layout.width >= 0)
  for (const child of bar.children) {
    assert.ok(layout.position.top + child.props.height + child.props.margin.top <= height)
  }
  assert.ok(layout.position.top >= sideLayout.position.top + sideHeight)
})

test('desktop inventory stays in a vertical column and empty inventory is hidden', () => {
  const h = harness(false)
  const g = { phase: 'playing' }
  assert.equal(h.hud.ItemBar({ g }), null)
  Object.assign(h.state.cs.items, { wildcard: 1, freeze: 1, reroll: 1, bomb: 1 })
  const bar = h.hud.ItemBar({ g })
  assert.equal(bar.props.uiTransform.flexDirection, 'column')
  assert.equal(bar.props.uiTransform.width, 250)
  assert.equal(h.hud.ItemBar({ g: { phase: 'vote' } }), null)
})

test('renderer keeps the interactable inset before and after platform resolution', () => {
  const calls = []
  let resolved
  const h = harness(true)
  const ui = loadTs('src/client/ui.tsx', {
    '@dcl/sdk/react-ecs': { ...h.react, ReactEcsRenderer: { setUiRenderer: (render, options) => calls.push(options) } },
    '@dcl/sdk/ecs': { engine: { addSystem() {} } },
    './state': h.state, '../config': {}, './ui/hud': { setupHudMessages() {} },
    './ui/platform': { canvas: h.platform.canvas, resolvePlatform: callback => { resolved = callback } }
  })
  ui.setupUi()
  resolved()
  assert.equal(calls.length, 2)
  for (const options of calls) {
    assert.equal(options.screenInset, 'interactable')
    assert.equal(options.virtualWidth, 1600)
    assert.equal(options.virtualHeight, 720)
  }
})

test('HUD renders do not mutate animation state or reset a vote; the system advances both', () => {
  const h = harness(false)
  const game = { round: 1, masked: '___', length: 3, question: 'A pet?', hint: '', phase: 'playing', difficulty: 1 }
  h.setGame(game)
  h.module.updateHud()
  const initial = h.hud.snapshot()
  game.masked = 'D__'
  game.phase = 'vote'
  game.difficulty = 2
  h.module.GameHud()
  h.hud.VoteScreen({ g: game })
  h.module.GameHud()
  assert.deepEqual(h.hud.snapshot(), initial, 'rendering new state must not perform transitions')
  h.module.updateHud()
  assert.equal(h.hud.snapshot().prev, 'D__')
  assert.equal(h.hud.snapshot().lastDifficulty, 2)
  const screen = h.hud.VoteScreen({ g: game })
  const sameButton = screen.children[0].children[2].children[1].children[0]
  sameButton.props.onClick()
  assert.equal(h.hud.snapshot().myVote, 0)
  h.module.GameHud()
  h.hud.VoteScreen({ g: game })
  h.module.updateHud()
  assert.equal(h.hud.snapshot().myVote, 0)
  game.round = 2
  h.module.GameHud()
  h.hud.VoteScreen({ g: game })
  assert.equal(h.hud.snapshot().myVote, 0, 'the render must not reset the previous choice')
  h.module.updateHud()
  assert.equal(h.hud.snapshot().myVote, null)
  game.phase = 'playing'
  h.module.updateHud()
  assert.equal(h.hud.snapshot().myVote, null)
})
