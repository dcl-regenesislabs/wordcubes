const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

// The platform module talks to the SDK: stub the canvas it reads and the renderer it drives.
function sdkStubs(canvasInfo, rendererCalls = []) {
  return {
    '~system/Runtime': { getExplorerInformation: async () => ({ platform: 'desktop' }) },
    '@dcl/sdk/ecs': { engine: { RootEntity: 0, addSystem() {} }, UiCanvasInformation: { getOrNull: () => canvasInfo } },
    '@dcl/sdk/react-ecs': { ReactEcsRenderer: { setUiRenderer: (render, options) => rendererCalls.push(options) } }
  }
}

// phone: true/false; canvas: the screen the explorer reports (pixels), defaults to the virtual canvas at pixel ratio 1
function harness(phone, canvas) {
  const config = loadTs('src/config.ts')
  const state = loadTs('src/client/state.ts', { '../config': config })
  const info = canvas ?? (phone ? { width: 1600, height: 720, devicePixelRatio: 1 } : { width: 1920, height: 1080, devicePixelRatio: 1 })
  const platform = loadTs('src/client/ui/platform.ts', sdkStubs(info))
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
  }, 'exports.testing = { WordPanel, SidePanel, ItemBar, VoteScreen, BottomArea, snapshot: () => ({ seenRound, prev, prevPhase, failAt, winAt, lastDifficulty, levelAt, myVote, votedRound }) }')
  return { hud: hud.testing, module: hud, state, platform, react, setGame: g => { currentGame = g } }
}

const longGame = { phase: 'playing', length: 14, masked: '_'.repeat(14), question: 'A long question '.repeat(10), hint: '', frozen: 0, difficulty: 1 }

// Every mobile case: a 14-letter word and all four items, at pixel ratio 1 (the tightest canvas) and on a real phone.
for (const [name, canvas] of [['pixel ratio 1', undefined], ['a 2400x1080 phone at pixel ratio 3', { width: 2400, height: 1080, devicePixelRatio: 3 }]]) {
  test(`mobile HUD fits on ${name}: word clear of the side column, column and items on screen, below the top bar`, () => {
    const h = harness(true, canvas)
    Object.assign(h.state.cs.items, { wildcard: 1, freeze: 1, reroll: 1, bomb: 1 })
    const { w, h: height } = h.platform.view()
    const L = h.module.hudLayout(longGame)
    const sideLeft = w - L.reserve
    assert.ok(L.rowW <= L.panelW && L.left + L.panelW <= sideLeft, 'tiles must not run under the side column')
    assert.ok(w - L.right <= w - h.platform.RIGHT_RESERVE(), 'side column stays left of the native control band')
    const stack = L.itemsBeside ? Math.max(L.columnH, L.itemsH) : L.columnH + L.itemsH
    assert.ok(L.top + stack <= height, 'side column and items stay on screen')
    assert.ok(L.top >= Math.round(height * 0.08), 'top-anchored pieces start below the app top bar')
    const bottom = h.hud.BottomArea()
    assert.ok(bottom.props.pad.bottom >= Math.round(height * 0.08), 'help line and messages start above the app bottom controls')
    h.state.cs.dialog = { name: 'Cubby', pages: ['Hi'], page: 0 }
    assert.ok(h.module.NpcDialog().props.pad.bottom >= Math.round(height * 0.08), 'NPC dialog starts above the app bottom controls')
    const word = h.hud.WordPanel({ g: longGame })
    assert.equal(word.props.pad.right, L.reserve)
    assert.equal(word.props.pad.left, L.left)
    const side = h.hud.SidePanel({ g: longGame })
    assert.equal(side.props.pad.top, L.top)
    assert.equal(side.props.pad.right, L.right)
  })
}

test('desktop inventory stays in a vertical column under the buttons and empty inventory is hidden', () => {
  const h = harness(false)
  const g = { phase: 'playing' }
  assert.equal(h.hud.ItemBar({ g }), null)
  Object.assign(h.state.cs.items, { wildcard: 1, freeze: 1, reroll: 1, bomb: 1 })
  const bar = h.hud.ItemBar({ g })
  assert.equal(bar.props.uiTransform.flexDirection, 'column')
  assert.equal(bar.props.uiTransform.width, h.platform.S(250))
  assert.equal(h.module.hudLayout(g).itemsBeside, false)
  assert.equal(h.hud.ItemBar({ g: { phase: 'vote' } }), null)
})

test('renderer starts on the desktop canvas and switches to the phone canvas once the platform resolves', async () => {
  const calls = []
  const platform = loadTs('src/client/ui/platform.ts', {
    ...sdkStubs({ width: 2400, height: 1080, devicePixelRatio: 2 }, calls),
    '~system/Runtime': { getExplorerInformation: async () => ({ platform: 'mobile' }) }
  })
  platform.setupResponsiveUi(() => null)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(calls.length, 2)
  // the options come from the scene's own realm: compare as plain data
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { virtualWidth: 1920, virtualHeight: 1080, screenInset: 'none' },
    { virtualWidth: 3200, virtualHeight: 1440, screenInset: 'none' }
  ])
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
