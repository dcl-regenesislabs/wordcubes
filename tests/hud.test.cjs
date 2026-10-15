const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, mocks = {}) {
  const exports = {}
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: 'ReactEcs.createElement'
  } })
  vm.runInNewContext(outputText, { exports, require(name) {
    assert.ok(name in mocks, `Unexpected import: ${name}`)
    return mocks[name]
  } }, { filename: file })
  return exports
}

const { hudLayout, wordCellsLayout } = load('src/client/ui-layout.ts')
const zero = { top: 0, right: 0, bottom: 0, left: 0 }
const viewports = [
  { width: 1920, height: 1080, mobile: false, interactableArea: { ...zero, left: 480 } },
  { width: 1280, height: 720, mobile: false, interactableArea: { ...zero, left: 320 } },
  { width: 1600, height: 720, mobile: true },
  { width: 844, height: 390, mobile: true, screenInsetArea: { ...zero, left: 44, right: 44, bottom: 21 } },
  { width: 640, height: 360, mobile: true, interactableArea: { ...zero, left: 110, top: 30 } },
  { width: 568, height: 320, mobile: true, screenInsetArea: { ...zero, left: 24, right: 24 } },
  { width: 390, height: 844, mobile: true, screenInsetArea: { ...zero, top: 47, bottom: 34 } },
  { width: 320, height: 568, mobile: true, screenInsetArea: { ...zero, left: 16, right: 16 } }
]

for (const canvas of viewports) {
  test(`word strip stays above gameplay at ${canvas.width}x${canvas.height}`, () => {
    const l = hudLayout(canvas, canvas.mobile)
    const d = canvas.screenInsetArea || zero
    const availableWidth = canvas.width - d.left - d.right
    assert.ok((l.panelWidth + l.edge * 2) * l.uiScale <= availableWidth + 0.01)
    assert.ok(l.toastTop + l.toastHeight < l.availableHeight / 2)
    assert.ok(l.panelHeight < l.availableHeight * 0.20)
    if (canvas.mobile) assert.ok(l.wordFont * l.uiScale >= 20)
  })
}

test('missing canvas data renders a finite connecting HUD', () => {
  for (const mobile of [true, false]) {
    for (const value of Object.values(hudLayout(null, mobile))) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value))
      else assert.ok(['none', 'flex'].includes(value))
    }
  }
})

function hudHarness() {
  const sent = []
  let holding = false, synced = true, stopped = 0, thrown = 0
  const actions = load('src/client/actions.ts', {
    '@dcl/sdk/network': { isStateSyncronized: () => synced },
    '../shared/messages': { room: { send: (...args) => sent.push(args) } },
    './cubes': { isHolding: () => holding },
    './emotes': { stopHoldEmote: () => stopped++, playThrowEmote: () => thrown++ },
    './state': { showMessage() {} }
  })
  const ReactEcs = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [initial, () => {}]
  }
  const sdk = { default: ReactEcs, UiEntity: 'UiEntity', Label: 'Label', Button: 'Button' }
  const hud = load('src/ui/WordCubesHud.tsx', {
    '@dcl/sdk/react-ecs': sdk
  })
  return { hud, actions, sent, setHolding: v => holding = v, setSynced: v => synced = v,
    effects: () => ({ stopped, thrown }) }
}

test('word HUD and feedback never capture gameplay input or render buttons', () => {
  const { hud } = hudHarness()
  function check(node) {
    assert.notEqual(node.type, 'Button')
    for (const event of ['onMouseDown', 'onMouseUp', 'onMouseEnter', 'onMouseLeave']) assert.equal(node.props[event], undefined)
    assert.notEqual(node.props.uiTransform?.pointerFilter, 'block')
    for (const child of node.children) check(child)
  }
  const root = hud.WordCubesHud()
  check(root)
  assert.equal(root.props.uiTransform.positionType, 'absolute')
  assert.equal(root.children[0].props.uiTransform.justifyContent, 'center')
  assert.equal(root.children.length, 1)
})

test('native controls keep movement and jump, show all game actions, and remove overflow', () => {
  const actions = { IA_JUMP: 0, IA_POINTER: 1, IA_PRIMARY: 2, IA_SECONDARY: 3, IA_ACTION_3: 4, IA_ACTION_4: 5, IA_ACTION_5: 6, IA_ACTION_6: 7 }
  let config, target
  const controls = load('src/client/touch-controls.ts', {
    '@dcl/sdk/ecs': { engine: { RootEntity: 0 }, InputAction: actions, TouchScreenControls: { createOrReplace: (entity, value) => { target = entity; config = value } } }
  })
  controls.setupTouchControls()
  assert.equal(target, 0)
  assert.equal(config.hideJoystick, false)
  assert.equal(config.hideCrosshair, false)
  assert.equal(config.mainAction, actions.IA_JUMP)
  assert.equal(config.touchInputs.filter(input => !input.hide).length, 5)
  for (const [action, asset] of [['IA_PRIMARY', 'break'], ['IA_SECONDARY', 'toss'], ['IA_ACTION_3', 'hint']]) {
    const input = config.touchInputs.find(input => input.inputAction === actions[action])
    assert.equal(input.hide, false)
    assert.equal(input.icon.tex.$case, 'texture')
    assert.equal(input.icon.tex.texture.src, `assets/images/ui/cartoon-${asset}.png`)
    assert.ok(fs.existsSync(path.join(__dirname, '..', input.icon.tex.texture.src)))
  }
})

test('cartoon frame preserves both end caps instead of squashing the artwork', () => {
  const { hud } = hudHarness()
  for (const canvas of viewports) {
    const layout = hudLayout(canvas, canvas.mobile)
    Object.assign(hud.state, layout)
    const pieces = hud.WordCubesHud().children[0].children[0].children[0].children
    assert.equal(pieces.length, 3)
    assert.ok(layout.centreWidth > 0)
    assert.ok(Math.abs(pieces.reduce((sum, node) => sum + node.props.uiTransform.width, 0) - layout.panelWidth) < 0.001)
    for (const piece of [pieces[0], pieces[2]]) {
      const { uiBackground: bg, uiTransform: t } = piece.props
      const png = fs.readFileSync(path.join(__dirname, '..', bg.texture.src))
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
      const sourceAspect = (bg.uvs[4] - bg.uvs[0]) * width / ((bg.uvs[3] - bg.uvs[1]) * height)
      assert.ok(Math.abs(t.width / t.height - sourceAspect) < 0.000001)
    }
  }
})

test('empty hands or disconnected transport do not send cube actions or emotes', () => {
  const h = hudHarness()
  h.actions.breakHeldCube()
  h.actions.tossHeldCube()
  h.setHolding(true)
  h.setSynced(false)
  h.actions.breakHeldCube()
  h.actions.tossHeldCube()
  h.actions.useHint()
  assert.equal(h.sent.length, 0)
  assert.deepEqual(h.effects(), { stopped: 0, thrown: 0 })
})

test('word HUD follows hints, feedback and screen rotation', () => {
  const { hud } = hudHarness()
  let mobile = true, canvas = { width: 390, height: 844 }, game = null
  const cs = { message: '' }
  const desktop = {}
  const runtime = {}
  let held = ''
  let tick, controlsSet = 0
  const driver = load('src/client/ui.tsx', {
    '@dcl/sdk/ecs': { engine: { RootEntity: 0, getEntitiesWith: () => game ? [[1, game]] : [], addSystem: fn => tick = fn }, UiCanvasInformation: { getOrNull: () => canvas } },
    '@dcl/sdk/platform': { isMobile: () => mobile },
    '../shared/schemas': { GameState: {} },
    '../ui': { setupUi() {} },
    '../ui/WordCubesHud': hud,
    '../ui/DesktopHud': { state: desktop },
    './state': { cs },
    './cubes': { heldLetter: () => held },
    './ui-layout': { hudLayout },
    './runtime-hud': { runtimeHud: runtime, setupRuntimeHud() {} },
    './touch-controls': { setupTouchControls: () => controlsSet++ }
  })
  driver.setupUi()
  assert.equal(hud.state.question, 'Connecting...')
  assert.equal(hud.state.word, '')
  assert.equal(controlsSet, 1)
  assert.equal(desktop.desktopDisplay, 'none')
  game = { question: 'Sails the seas looking for treasure', masked: '__R___', hint: 'PI____' }
  tick()
  assert.equal(hud.state.word, 'P I R _ _ _')
  assert.equal(runtime.mask, game.masked)
  assert.equal(runtime.hint, game.hint)
  assert.equal(hud.state.question, game.question)
  assert.ok(hud.state.questionFont * hud.state.question.length * 0.55 <= hudLayout(canvas, mobile).contentWidth + 0.01)
  const portraitWidth = hud.state.panelWidth
  canvas = { width: 844, height: 390 }
  tick()
  assert.ok(hud.state.panelWidth < portraitWidth)
  cs.message = 'Word complete!'
  tick()
  assert.equal(runtime.message, 'Word complete!')
  cs.message = ''
  mobile = false
  held = 'Q'
  cs.coins = 180
  game.round = 8
  game.completed = 7
  tick()
  assert.equal(runtime.message, '')
  assert.equal(controlsSet, 1)
  assert.equal(desktop.desktopDisplay, 'flex')
  assert.equal(desktop.coins, '180 coins')
  assert.equal(desktop.round, 'Round 8 / Done 7')
  assert.equal(desktop.holding, 'Holding Q')
  assert.equal(desktop.instruction, 'Click a frame to place Q')
  held = ''
  tick()
  assert.equal(desktop.instruction, 'Click a cube to grab it')
})

test('desktop Unity and Bevy layouts respect their native HUD margins without overlapping', () => {
  const cases = [
    { width: 1920, height: 1080, interactableArea: { ...zero, left: 480 } },
    { width: 1280, height: 720, interactableArea: { ...zero, left: 320 } },
    { width: 1024, height: 768, interactableArea: { ...zero, left: 256 } },
    { width: 800, height: 600, interactableArea: { ...zero, left: 200 } },
    { width: 1920, height: 1080, interactableArea: zero },
    { width: 1440, height: 900, interactableArea: { top: 64, left: 0, right: 16, bottom: 80 } },
    { width: 3440, height: 1440, interactableArea: { ...zero, left: 640 } }
  ]
  for (const canvas of cases) {
    const l = hudLayout(canvas, false), n = canvas.interactableArea, s = l.uiScale
    const left = (l.headerRegionLeft + (l.headerRegionWidth - l.panelWidth) / 2) * s
    const right = left + l.panelWidth * s
    assert.equal(l.headerRegionLeft, 0)
    assert.ok(left >= n.left + l.edge * s - 0.01)
    assert.ok(right <= canvas.width - n.right - l.edge * s + 0.01)
    assert.ok(l.headerTop * s >= n.top)
    assert.ok((l.headerTop + l.panelHeight) * s < canvas.height / 2)
    if (l.statusDisplay === 'flex') {
      const statusLeft = canvas.width - (l.desktopRight + l.statusWidth) * s
      assert.ok(right < statusLeft)
    }
    const legendLeft = canvas.width - (l.desktopRight + l.shortcutsWidth) * s
    assert.ok(legendLeft > n.left)
    assert.ok(canvas.height - (l.desktopBottom + l.shortcutsHeight) * s > canvas.height / 2)
    assert.ok(l.shortcutCell * 3 + l.desktopPadding * 2 + 4 <= l.shortcutsWidth + 0.01)
    assert.ok(l.centreWidth > 0)
  }
})

test('desktop overlays are passive, explicitly sized, and absent on mobile', () => {
  const ReactEcs = { createElement: (type, props, ...children) => ({ type, props, children }) }
  const sdk = { default: ReactEcs, UiEntity: 'UiEntity', Label: 'Label' }
  const desktop = load('src/ui/DesktopHud.tsx', { '@dcl/sdk/react-ecs': sdk })
  function check(node) {
    for (const event of ['onMouseDown', 'onMouseUp', 'onMouseEnter', 'onMouseLeave']) assert.equal(node.props[event], undefined)
    assert.notEqual(node.props.uiTransform.pointerFilter, 'block')
    assert.ok(node.props.uiTransform.width)
    assert.ok(node.props.uiTransform.height)
    for (const child of node.children) check(child)
  }
  Object.assign(desktop.state, hudLayout({ width: 1920, height: 1080 }, false))
  const root = desktop.DesktopHud()
  check(root)
  assert.equal(root.props.uiTransform.positionType, 'absolute')
  assert.equal(root.props.uiTransform.display, 'flex')
  Object.assign(desktop.state, hudLayout({ width: 844, height: 390 }, true))
  assert.equal(desktop.DesktopHud().props.uiTransform.display, 'none')
})

test('mobile keeps the approved strip dimensions and native control layout', () => {
  for (const canvas of viewports.filter(canvas => canvas.mobile)) {
    const l = hudLayout(canvas, true), scale = Math.max(1, 0.5 / l.uiScale)
    assert.ok(Math.abs(l.panelHeight - 98 * scale) < 0.000001)
    assert.equal(l.questionHeight, 34 * scale)
    assert.equal(l.wordHeight, 48 * scale)
    assert.equal(l.headerRegionLeft, 0)
    assert.equal(l.desktopDisplay, 'none')
    assert.equal(l.statusDisplay, 'none')
  }
})

function runtimeHarness() {
  const R = { createElement: (type, props, ...children) => ({ type, props, children }) }
  return load('src/client/runtime-hud.tsx', {
    '@dcl/sdk/react-ecs': { default: R, UiEntity: 'UiEntity', Label: 'Label', ReactEcsRenderer: { addUiRenderer() {} } },
    '@dcl/sdk/ecs': { engine: { addEntity: () => 512 } },
    './ui-layout': { wordCellsLayout }
  })
}

test('idle and whitespace feedback creates no panel, including after a message expires', () => {
  const { runtimeHud: state, RuntimeHud } = runtimeHarness()
  for (const message of ['', '  ', '\n']) {
    state.message = message
    assert.equal(RuntimeHud().children[1], null)
  }
  state.message = 'Word complete!'
  const feedback = RuntimeHud().children[1]
  assert.ok(feedback)
  assert.equal(feedback.children[0].children[0].props.value, 'Word complete!')
  state.message = ''
  assert.equal(RuntimeHud().children[1], null)
})

test('desktop word cells distinguish placed letters, hints and blanks without blocking clicks', () => {
  const { runtimeHud: state, RuntimeHud } = runtimeHarness()
  Object.assign(state, hudLayout({ width: 1920, height: 1080 }, false), { mobile: false, mask: '__R___', hint: 'PI____' })
  const row = RuntimeHud().children[0].children[0]
  const cells = row.children[0]
  assert.equal(cells.length, 6)
  assert.equal(cells.map(cell => cell.children[0].props.value).join(','), 'P,I,R,,,')
  assert.notDeepEqual(cells[0].props.uiBackground.color, cells[2].props.uiBackground.color)
  assert.notDeepEqual(cells[2].props.uiBackground.color, cells[3].props.uiBackground.color)
  for (const cell of cells) {
    assert.equal(cell.props.uiTransform.width, cell.props.uiTransform.height)
    assert.equal(cell.props.uiTransform.pointerFilter, 'none')
    assert.equal(cell.props.onMouseDown, undefined)
  }
  state.mobile = true
  assert.equal(RuntimeHud().children[0], null)
})

test('long words stay within the available row at desktop viewport sizes', () => {
  for (const canvas of viewports.filter(canvas => !canvas.mobile)) {
    const l = hudLayout(canvas, false)
    for (const count of [3, 6, 12, 20]) {
      const cells = wordCellsLayout(count, l.contentWidth, l.wordHeight)
      assert.ok(cells.size > 0)
      assert.ok(cells.rowWidth <= l.contentWidth + 0.01)
      assert.ok(cells.size <= l.wordHeight)
    }
  }
})
