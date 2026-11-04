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
  // the HUD under test is the real one, whatever the dev-only UI preview flag is set to
  const config = { ...loadTs('src/config.ts'), UI_PREVIEW: false }
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
    '../audio': { SFX: {}, playSfx: noop, onItems: noop, onProfileLoaded: noop, talkSfx: noop },
    './theme': theme, './debug': { dbg: { screen: 'game' }, debugWord: () => ({ answer: 'PARIS', question: 'Capital of France?' }) }, './rank': loadTs('src/client/ui/rank.ts', { '../../config': config }), '../ranktags': {}, '@dcl/sdk/players': {},
    '../../../assets/scene/entity-names': {}
  }, 'exports.testing = { WordPanel, SidePanel, ItemBar, VoteScreen, BottomArea, snapshot: () => ({ seenRound, prev, prevPhase, failAt, winAt, lastDifficulty, levelAt, myVote, votedRound }) }')
  return { hud: hud.testing, module: hud, config, state, platform, react, setGame: g => { currentGame = g } }
}

const longGame = { phase: 'playing', length: 14, masked: '_'.repeat(14), question: 'A long question '.repeat(10), hint: '', frozen: 0, difficulty: 1 }

// Every mobile case: a 14-letter word and all four items, at pixel ratio 1 (the tightest canvas) and on a real phone.
for (const [name, canvas] of [['pixel ratio 1', undefined], ['a 2400x1080 phone at pixel ratio 3', { width: 2400, height: 1080, devicePixelRatio: 3 }]]) {
  test(`mobile HUD fits on ${name}: one slim top bar, clear of the app buttons and native controls`, () => {
    const h = harness(true, canvas)
    Object.assign(h.state.cs.items, { wildcard: 1, freeze: 1, reroll: 1, bomb: 1 })
    const { w, h: height } = h.platform.view()
    for (const g of [longGame, { ...longGame, length: 3, masked: '___', question: 'A pet?' }]) {
      const L = h.module.hudLayout(g)
      assert.ok(L.rowW <= L.panelW, 'the tiles fit in the bar')
      assert.equal(L.left + L.panelW, w, 'the bar reaches the device safe-area edge without an extra margin')
      if (g.length === 3) assert.ok(L.left > w / 2, 'short words leave the centre clear')
      assert.ok(L.left >= Math.round(w * h.config.MOBILE_APP_BUTTONS_RIGHT), 'the bar starts right of the app buttons at the top left')
      assert.ok(L.barH <= Math.round(height * 0.12), 'the bar is one slim row')
      assert.equal(L.top, Math.round(height * h.config.MOBILE_TOP_BAR_TOP), 'bar aligns with the native top row')
      assert.equal(L.barH, Math.round(height * h.config.MOBILE_TOP_BAR_HEIGHT), 'bar matches the native button height')
      const word = h.hud.WordPanel({ g })
      assert.equal(word.props.pad.left, L.left)
      assert.equal(word.props.pad.right, L.reserve)
      const bar = word.children[0]
      assert.equal(bar.props.dir, 'row', 'time and level | tiles | coins on one row')
      assert.equal(bar.props.width, L.panelW)
      assert.equal(word.children[1].type, 'OutlineLabel', 'the question is bare outlined text under the bar')
    }
    assert.equal(h.hud.SidePanel({ g: longGame }), null, 'no side column on phones: the stats are in the bar')
    assert.equal(h.hud.ItemBar({ g: longGame }), null, 'phones open the items from a native button')
    const bottom = h.hud.BottomArea()
    assert.ok(bottom.props.pad.bottom >= Math.round(height * 0.08), 'help line starts above the app bottom controls')
    // messages are toasts at the safe-area top left, left of the top bar
    const toast = h.module.Toast({ text: 'Wrong cube! The whole word collapsed.' })
    assert.equal(toast.props.pad.left, 0, 'toast starts at the device safe-area edge without an extra margin')
    const L = h.module.hudLayout(longGame)
    assert.equal(toast.props.pad.top, L.top + L.barH + h.platform.S(24), 'toast sits below the native top row with a gap')
    assert.ok(toast.props.pad.left + toast.children[0].props.width <= L.left, 'toast stays left of the top bar and its question')
    assert.equal(h.module.Toast({ text: '' }), null)
    // How to play: centred in the free middle, clear of the native buttons on the right and of the top bar
    const card = h.module.HowToPlay().children[0]
    assert.ok(card.props.width <= Math.round(w * 0.52) + 1, 'how to play leaves the native buttons free')
    assert.ok(card.props.height <= Math.round(height * 0.64) + 1, 'how to play stays under the top bar')
    h.state.cs.dialog = { name: 'Lexi', pages: ['Ranks go from Letter to Author.'], page: 0 }
    for (const [name, panel] of [['shop', h.module.ShopPanel()], ['NPC dialog', h.module.NpcDialog()]]) {
      const frame = panel.children[0]
      assert.ok(frame.props.width <= Math.round(w * 0.52) + 1, `${name} leaves the native buttons free`)
      assert.ok(frame.props.height <= Math.round(height * 0.64) + 1, `${name} stays under the top bar`)
    }
    // the lobby's coins and rank: the same slim bar, in the same place as the game's
    const bar = h.module.LobbyHud() // on phones: <LobbyBar />
    const lobby = bar.type(bar.props)
    assert.equal(lobby.props.pad.left + lobby.children[0].props.width, w, 'lobby bar reaches the device safe-area edge without an extra margin')
    assert.equal(lobby.props.pad.top, L.top)
    assert.equal(lobby.children[0].props.height, L.barH, 'lobby and game bars have the same height')
    assert.equal(lobby.children[0].props.dir, 'row')
    // the desktop keys in server texts become the native buttons' icons; the letter in your hand stays a letter
    const pieces = h.module.toastPieces('That letter is needed. Place it or throw it back with F.')
    assert.ok(pieces.at(-1).icon.endsWith('cartoon-toss.png') && pieces.at(-1).after === '.')
    const held = h.module.toastPieces('Holding E. Click a frame to throw it, E to break, F to throw away.')
    assert.equal(held[1].text, 'E.', 'Holding E. is the letter, not the break key')
    assert.equal(held[2].text, 'Tap')
    assert.equal(held.filter((p) => p.icon).length, 2)
    assert.equal(h.module.NpcDialog().props.justify, 'center', 'phones: the NPC dialog is a centred card, clear of the app bottom controls')
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
    { virtualWidth: 3200, virtualHeight: 1440, screenInset: 'device' }
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

test('mobile layout uses device insets and follows safe-area changes', () => {
  const canvas = { width: 2400, height: 1080, devicePixelRatio: 3, screenInsetArea: { left: 90, right: 60, top: 12, bottom: 24 } }
  const h = harness(true, canvas)
  assert.equal(h.platform.getUiRendererConfig().screenInset, 'device')
  const scale = 0.5
  assert.equal(h.platform.view().w, (2400 - 90 - 60) / scale)
  assert.equal(h.platform.view().h, (1080 - 12 - 24) / scale)
  const layout = h.module.hudLayout(longGame)
  assert.equal(layout.left + layout.panelW, h.platform.view().w)
  canvas.screenInsetArea.right = 120
  assert.equal(h.platform.view().w, (2400 - 90 - 120) / scale)
  const desktop = harness(false, canvas)
  assert.equal(desktop.platform.getUiRendererConfig().screenInset, 'none')
  assert.equal(desktop.platform.view().w, 2400)
})
