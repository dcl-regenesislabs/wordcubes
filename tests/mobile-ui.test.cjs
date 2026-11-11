const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs, loadI18n } = require('./load-ts.cjs')

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
  const tutorialStarts=[]
  const theme = { PAL: {}, Frame: 'Frame', OutlineLabel: 'OutlineLabel', PillButton: 'PillButton',
    LetterTile: 'LetterTile', CoinIcon: 'CoinIcon', c: noop,
    clamp: (n, min, max) => Math.min(max, Math.max(min, n)) }
  const netMon = { allowed: false, open: false }
  const netstats = { netMon, toggleNetMonitor: () => { if (netMon.allowed) netMon.open = !netMon.open } }
  const hud = loadTs('src/client/ui/hud.tsx', {
    '@dcl/sdk/react-ecs': react, '@dcl/sdk/ecs': { engine: { getEntitiesWith: () => currentGame ? [[0, currentGame]] : [] } },
    '../../shared/schemas': {}, '../gamestate': { myState: () => currentGame || undefined, boardText: () => '' }, '../state': state, '../cubes': { heldLetter: () => '' },
    '../netstats': netstats, '../tutorial': { startTutorial: () => tutorialStarts.push(true) },
    '../../config': config, '../../shared/messages': { room: { send: noop } },
    '../lobby': { returnToLobby: noop, gameLang: () => '' }, '../../shared/lang': loadTs('src/shared/lang.ts'),
    '../i18n': { t: (key, args) => loadI18n().format('en', key, args, phone), uiLang: () => 'en', pickUiLang: noop }, './flags': { Flag: 'Flag' }, '../arena': {}, './platform': platform,
    '../audio': { SFX: {}, playSfx: noop, onItems: noop, onProfileLoaded: noop, talkSfx: noop },
    './theme': theme, './debug': { dbg: { screen: 'game' }, debugWord: () => ({ answer: 'PARIS', question: 'Capital of France?' }) }, './rank': loadTs('src/client/ui/rank.ts', { '../../config': config }), '../ranktags': {}, '@dcl/sdk/players': {},
    '../../../assets/scene/entity-names': {}
  }, 'exports.testing = { WordPanel, SidePanel, ItemBar, VoteScreen, BottomArea, LockoutBanner, snapshot: () => ({ seenRound, prev, prevPhase, failAt, winAt, lastDifficulty, levelAt, myVote, votedRound }) }')
  return { tutorialStarts, hud: hud.testing, module: hud, config, state, platform, react, theme, netstats, setGame: g => { currentGame = g } }
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
    assert.equal(h.module.NpcDialog().props.justify, 'flex-end', 'phones: the NPC dialog sits at the bottom like on desktop, between the joystick and the native buttons')
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

test('power-up broadcasts preserve mobile holding tutorials and resume after release', () => {
  const h = harness(true)
  for (let grab = 0; grab < 3; grab++) {
    h.state.showMessage('Holding X. Click a frame to throw it.', 0)
    h.state.cs.messageSticky = true
    for (const item of h.config.ITEMS) {
      h.state.showPowerupToast(`Alice#abcd used ${item.name}!`)
      assert.equal(h.state.cs.message, 'Holding X. Click a frame to throw it.')
      assert.equal(h.state.cs.messageTime, 0)
      assert.equal(h.state.cs.messageSticky, true)
    }
    h.state.cs.messageSticky = false // release, placement or leaving clears the tutorial
    h.state.showPowerupToast('Alice#abcd used Bomb!')
    assert.equal(h.state.cs.message, 'Alice#abcd used Bomb!')
    assert.equal(h.state.cs.messageTime, 3)
    assert.equal(h.state.cs.messageKind, 'powerup')
  }
})

test('power-up player names render as plain text on phones', () => {
  const h = harness(true)
  const toast = h.module.Toast({ text: 'E F Click#abcd used Bomb!', plain: true })
  const frame = toast.children[0]
  const label = frame.children.find(child => child && child.type === 'Label')
  assert.equal(label.props.value, 'E F Click#abcd used Bomb!')
})

test('desktop toast layout does not depend on mobile app button tuning', () => {
  const h = harness(false)
  const before = h.module.Toast({ text: 'Alice#abcd used Bomb!' })
  h.config.MOBILE_APP_BUTTONS_Y = 0.8
  h.config.MOBILE_APP_BUTTONS_RIGHT = 0.9
  const after = h.module.Toast({ text: 'Alice#abcd used Bomb!' })
  assert.deepEqual(after.props.pad, before.props.pad)
  assert.equal(after.children[0].props.width, before.children[0].props.width)
})

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...(tree.children || []).flatMap(nodes)]
}

for (const [name, phone, canvas] of [
  ['desktop', false, undefined],
  ['dpr-1 phone', true, undefined],
  ['dpr-3 phone', true, { width: 2400, height: 1080, devicePixelRatio: 3 }]
]) {
  test(`developer Settings toggle is gated and fits on ${name}`, () => {
    const h = harness(phone, canvas)
    const off = h.module.SettingsPanel()
    assert.ok(!nodes(off).some(n => n.props.id === 'set-dev-toggle'))
    assert.equal(off.children[0].props.width, Math.min(h.platform.S(820), Math.round(h.platform.view().w * 0.92)), 'ordinary Settings keeps its original size')
    h.netstats.netMon.allowed = true
    const panel = h.module.SettingsPanel()
    const button = nodes(panel).find(n => n.props.id === 'set-dev-toggle')
    assert.ok(button)
    assert.ok(nodes(panel).some(n => n.props.value === 'Activate dev panel'))
    if (phone) assert.ok(panel.children[0].props.height <= h.platform.view().h * 0.64 + 1)
    h.state.cs.showSettings = true
    button.props.onClick()
    assert.equal(h.netstats.netMon.open, true)
    assert.equal(h.state.cs.showSettings, false)
    nodes(h.module.SettingsPanel()).find(n => n.props.id === 'set-dev-toggle').props.onClick()
    assert.equal(h.netstats.netMon.open, false)
    h.config.NET_STATS = false
    assert.ok(!nodes(h.module.SettingsPanel()).some(n => n.props.id === 'set-dev-toggle'))
  })

  test(`all diagnostics and warnings remain reachable on ${name}`, () => {
    const h = harness(phone, canvas)
    Object.assign(h.theme.PAL, { pink: 'warning', text: 'normal' })
    const source = Array.from({ length: 60 }, (_, i) => `row ${i} ${'data '.repeat(12)}`)
    source[59] = 'NO ANSWER WAITING FULL STATE'
    let reasons = ['NO connection ' + 'reason '.repeat(20)]
    const monitor = loadTs('src/client/ui/netstats.tsx', {
      '@dcl/sdk/react-ecs': h.react, './platform': h.platform, './theme': h.theme,
      '../netstats': { ...h.netstats, netLines: () => source, health: () => ({ level: 'fail', reasons }), logSummary() {} }
    })
    assert.equal(monitor.NetMonitor(), null)
    Object.assign(h.netstats.netMon, { allowed: true, open: true })
    const seen = new Set()
    let pages
    for (let page = 0; page < 100; page++) {
      const tree = monitor.NetMonitor()
      const all = nodes(tree)
      assert.ok(!all.some(n => n.props.uiTransform?.pointerFilter === 'block'), 'only buttons intercept input')
      assert.ok(tree.props.uiTransform.position.top + tree.props.uiTransform.height <= h.platform.view().h - h.platform.BOTTOM_RESERVE() + 1)
      const data = all.filter(n => n.type === 'Label' && n.props.font === 'monospace')
      data.forEach(n => seen.add(n.props.value))
      const content = tree.children[2]
      assert.ok(data.length * h.platform.S(19) <= content.props.uiTransform.height)
      const pageLabel = all.find(n => /^\d+ \/ \d+$/.test(n.props.value || ''))
      pages = Number(pageLabel.props.value.split(' / ')[1])
      if (page === pages - 1) break
      all.find(n => n.props.id === 'net-next').props.onClick()
    }
    for (let i = 0; i < 59; i++) assert.ok([...seen].some(text => text.startsWith(`row ${i} `)), `row ${i} reachable`)
    assert.ok(seen.has(source[59]), 'last server row reachable')
    const last = nodes(monitor.NetMonitor()).find(n => n.props.value === source[59])
    assert.equal(last.props.color, 'warning')
    source.splice(0, source.length, 'short')
    reasons = []
    assert.ok(nodes(monitor.NetMonitor()).some(n => n.props.value === '1 / 1'), 'page clamps when data shrinks')
    nodes(monitor.NetMonitor()).find(n => n.props.id === 'net-close').props.onClick()
    assert.equal(monitor.NetMonitor(), null)
    h.netstats.netMon.open = true
    h.netstats.netMon.allowed = false
    assert.equal(monitor.NetMonitor(), null)
  })
}

test('mobile detection recognizes the Godot phone emulator even with a desktop host platform', async () => {
  const stubs=sdkStubs({width:1600,height:720,devicePixelRatio:1})
  stubs['~system/Runtime'].getExplorerInformation=async()=>({platform:'desktop',agent:'Godot'})
  const platform=loadTs('src/client/ui/platform.ts',stubs)
  platform.resolvePlatform()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(platform.mobile(),true)
  assert.equal(platform.getUiRendererConfig().virtualWidth,1600)
  for(const info of [{platform:'ios'},{platform:'Android'},{platform:'desktop',agent:'godot-explorer'}]) assert.equal(platform.isMobileExplorer(info),true)
  for(const info of [{platform:'desktop',agent:'Unity'},{platform:'web',agent:'bevy'}]) assert.equal(platform.isMobileExplorer(info),false)
})

test('phone side safe insets select mobile layout before explorer metadata arrives', () => {
  const platform=loadTs('src/client/ui/platform.ts',sdkStubs({width:1600,height:720,devicePixelRatio:1,screenInsetArea:{left:44,right:0,top:0,bottom:0}}))
  assert.equal(platform.mobile(),true)
  assert.equal(platform.getUiRendererConfig().screenInset,'device')
})

test('a failed platform lookup retries instead of keeping the phone on desktop layout', async () => {
  const calls=[],systems=[]
  const stubs=sdkStubs({width:1600,height:720,devicePixelRatio:1},calls)
  stubs['@dcl/sdk/ecs'].engine.addSystem=fn=>systems.push(fn)
  let attempts=0
  stubs['~system/Runtime'].getExplorerInformation=async()=>{
    if(++attempts===1) throw Error('temporary startup failure')
    return {platform:'desktop',agent:'Godot'}
  }
  const platform=loadTs('src/client/ui/platform.ts',stubs)
  platform.setupResponsiveUi(()=>null)
  await new Promise(resolve=>setImmediate(resolve))
  systems[0](1.1)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(attempts,2)
  assert.equal(platform.mobile(),true)
  assert.equal(calls.at(-1).virtualWidth,1600)
})


for(const phone of [false,true]) test(`tutorial replay lives in How to Play (${phone?'mobile':'desktop'})`,()=>{
  const h=harness(phone)
  h.state.cs.showHowTo=true
  assert.ok(!nodes(h.module.SettingsPanel()).some(n=>n.props.id==='settings-tutorial'))
  const replay=nodes(h.module.HowToPlay()).find(n=>n.props.id==='howto-tutorial')
  assert.ok(replay)
  replay.props.onClick()
  assert.equal(h.state.cs.showHowTo,false)
  assert.equal(h.tutorialStarts.length,1)
  h.state.cs.inGame=true
  assert.ok(!nodes(h.module.HowToPlay()).some(n=>n.props.id==='howto-tutorial'))
})


for(const phone of [false,true]) test(`Cubby asks before replaying the tutorial (${phone?'mobile':'desktop'})`,()=>{
  const h=harness(phone)
  const prompt=()=>{h.state.cs.dialog={name:'Cubby',pages:['Replay the tutorial?'],page:0,replayTutorial:true}}
  prompt()
  nodes(h.module.NpcDialog()).find(n=>n.props.id==='npc-close').props.onClick()
  assert.equal(h.state.cs.dialog,null)
  assert.equal(h.tutorialStarts.length,0)
  prompt()
  nodes(h.module.NpcDialog()).find(n=>n.props.id==='npc-next').props.onClick()
  assert.equal(h.state.cs.dialog,null)
  assert.equal(h.tutorialStarts.length,1)
})

test('the lockout banner gives the reason and the seconds left, with a bar that runs down', () => {
  const h = harness(false)
  const texts = (node, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (node.props && typeof node.props.value === 'string') out.push(node.props.value)
    for (const c of node.children || []) texts(c, out)
    return out
  }
  const widths = (node, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (node.props?.uiTransform?.width !== undefined) out.push(node.props.uiTransform.width)
    for (const c of node.children || []) widths(c, out)
    return out
  }
  h.state.cs.lockoutTotal = 20
  h.state.cs.lockoutUntil = Date.now() + 10000 // half of it left
  const banner = h.hud.LockoutBanner()
  assert.ok(texts(banner).some(v => /^Wrong letter · locked 1[01]s$/.test(v)), 'one line: why and how long')
  const ws = widths(banner).filter(w => typeof w === 'number')
  const track = Math.max(...ws.filter(w => w < banner.props.width))
  assert.ok(ws.some(w => w > 0 && w < track && Math.abs(w - track / 2) < track * 0.1), 'the bar is about half full with half the time left')
})

test('while locked out the help line is hidden: the banner replaces it', () => {
  const h = harness(true)
  const texts = (node, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (node.props && typeof node.props.value === 'string') out.push(node.props.value)
    for (const c of node.children || []) texts(c, out)
    return out
  }
  h.state.cs.lockoutUntil = 0
  assert.ok(texts(h.hud.BottomArea()).includes('Tap a cube to grab it'), 'the help line shows normally')
  h.state.cs.lockoutUntil = Date.now() + 10000
  h.state.cs.lockoutTotal = 25
  const bottom = h.hud.BottomArea()
  assert.ok(!texts(bottom).includes('Tap a cube to grab it'), 'no "tap a cube" while you cannot grab')
  const has = (node, type) => !!node && typeof node === 'object' && (node.type === type || (node.children || []).some(c => has(c, type)))
  assert.ok(has(bottom, h.hud.LockoutBanner), 'the banner is there')
})
