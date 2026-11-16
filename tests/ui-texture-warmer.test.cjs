const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs } = require('./load-ts.cjs')

const react = {
  default: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }) },
  UiEntity: 'UiEntity'
}
const warmer = loadTs('src/client/ui/textureWarmer.tsx', { '@dcl/sdk/react-ecs': react })
const nodes = warmer.UiTextureWarmer().children

test('every warmed UI texture exists, stays transparent and leaves input alone', () => {
  assert.equal(new Set(nodes.map(n => n.props.uiBackground.texture.src)).size, nodes.length)
  for (const node of nodes) {
    assert.ok(fs.existsSync(node.props.uiBackground.texture.src))
    assert.equal(node.props.uiBackground.color.a, 0)
    assert.equal(node.props.uiTransform.width, 1)
    assert.equal(node.props.uiTransform.height, 1)
    assert.equal(node.props.uiTransform.pointerFilter, 'none')
    assert.notEqual(node.props.uiTransform.display, 'none', 'hidden nodes may skip texture loading')
    assert.equal(node.props.onMouseDown, undefined)
  }
})

test('warmer matches the cache options of buttons, icons, flags and tutorial art', () => {
  const byPath = new Map(nodes.map(n => [n.props.uiBackground.texture.src, n.props.uiBackground.texture]))
  for (const color of ['green','violet','blue','pink','yellow','red','grey','cream']) {
    const texture = byPath.get(`assets/images/ui-kit/btn-${color}.png`)
    assert.equal(texture.wrapMode, 'clamp')
    assert.equal(texture.filterMode, 'bi-linear')
  }
  for (const icon of ['coin','break','toss','wildcard','freeze','reroll','bomb']) {
    assert.equal(byPath.get(`assets/images/ui/cartoon-${icon}.png`).filterMode, 'tri-linear')
  }
  assert.equal(byPath.get('assets/images/ui/languages.png').filterMode, 'tri-linear')
  assert.equal(byPath.get('assets/images/ui-kit/hand.png').filterMode, undefined)
  // Discover screens recursively; new UI files and template paths must be covered.
  const images = walk('assets/images').filter(file => /\.(png|jpe?g|webp)$/.test(file))
  const screens = [...walk('src/client'), ...walk('src/ui')].filter(file => file.endsWith('.tsx') && !file.endsWith('/textureWarmer.tsx'))
  for (const file of screens) {
    for (const src of referencedImages(fs.readFileSync(file, 'utf8'), images)) {
      assert.ok(byPath.has(src), `${file}: ${src} needs a matching UI cache entry`)
    }
  }
})

test('same warmer stays at root during connection, tutorial, lobby and public game', () => {
  const cs = { tutorialActive: false, dialog: false, shop: false, showSettings: false }
  let ready = false, inGame = false
  const ui = loadTs('src/client/ui.tsx', {
    '@dcl/sdk/react-ecs': react,
    '@dcl/sdk/ecs': {},
    './state': { cs }, '../config': { UI_PREVIEW: false, NET_STATS: false },
    './ui/platform': {}, './ui/hud': {}, './ui/debug': { applyDebug() {}, showGame: () => inGame },
    './connection': { serverReady: () => ready, connectingTooLong: () => false },
    './ui/netstats': {}, '../ui/TutorialOverlay': {}, './tutorial': {}, './actions': {},
    './ui/textureWarmer': warmer
  })
  for (const phase of ['connecting','tutorial','lobby','game']) {
    ready = phase !== 'connecting'
    cs.tutorialActive = phase === 'tutorial'
    inGame = phase === 'game'
    const root = ui.uiMenu()
    assert.equal(root.children[0].type, warmer.UiTextureWarmer, phase)
    assert.equal(root.props.uiTransform.pointerFilter, 'none')
    // Exercise the screen branch too, so all early returns are covered.
    assert.ok(root.children[1].type())
  }
})

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.posix.join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  })
}

function referencedImages(source, images) {
  return [...source.matchAll(/(['"`])(assets\/images\/[^'"`]+\.(?:png|jpe?g|webp))\1/g)].flatMap(([, , src]) => {
    if (!src.includes('${')) return [src]
    const pattern = src.split(/\$\{[^}]+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')
    const matches = images.filter(image => new RegExp(`^${pattern}$`).test(image))
    assert.ok(matches.length, `Template ${src} must resolve to existing images`)
    return matches
  })
}

test('coverage guard expands template image references', () => {
  assert.deepEqual(referencedImages('texture: { src: `assets/images/ui/btn-${color}.png` }', [
    'assets/images/ui/btn-red.png', 'assets/images/ui/btn-blue.png', 'assets/images/ui/coin.png'
  ]), ['assets/images/ui/btn-red.png', 'assets/images/ui/btn-blue.png'])
})
