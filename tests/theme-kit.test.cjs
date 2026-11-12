const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

function theme() {
  const react = { default: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }) }, UiEntity: 'UiEntity', Label: 'Label' }
  return loadTs('src/client/ui/theme.tsx', {
    '@dcl/sdk/react-ecs': react,
    '@dcl/sdk/math': { Color4: { create: (r, g, b, a) => ({ r, g, b, a }) } },
    './platform': { S: n => n },
    '../audio': { SFX: {}, playSfx() {} }
  })
}
const render = (n, out = []) => { if (n && typeof n === 'object') { if (typeof n.type === 'function') return render(n.type(n.props), out); out.push(n); for (const c of n.children ?? []) render(c, out) } return out }

for (const [w, h] of [[220, 52], [400, 60], [140, 54], [60, 50]]) test(`kit buttons never deform at ${w}x${h}`, () => {
  const t = theme()
  const nodes = render(t.PillButton({ id: 'x', label: 'Salir', width: w, height: h, onClick() {} }))
  const root = nodes[0]
  assert.equal(root.props.uiTransform.width, w)
  assert.equal(root.props.uiTransform.height, h, 'the button keeps the size the layout asked for')
  const left = nodes.find(n => n.props.key === 'cap-l'), mid = nodes.find(n => n.props.key === 'mid'), right = nodes.find(n => n.props.key === 'cap-r')
  const cap = Math.min(Math.round(h / 2), Math.floor(w / 2))
  assert.equal(left.props.uiTransform.width, cap, 'the rounded end is half the height wide: its art keeps its proportions')
  assert.equal(right.props.uiTransform.width, cap)
  // the middle spans the gap between the ends and tucks under both, so no hairline seam can show
  assert.ok(mid.props.uiTransform.position.left < cap && mid.props.uiTransform.position.left + mid.props.uiTransform.width > w - cap, 'the middle overlaps both ends')
  assert.equal(right.props.uiTransform.position.left + cap, w)
  assert.ok(nodes.indexOf(mid) < nodes.indexOf(left) && nodes.indexOf(mid) < nodes.indexOf(right), 'the ends draw on top of the middle')
  assert.ok(left.props.uiBackground.texture.src.startsWith('assets/images/ui-kit/btn-'))
  assert.equal(JSON.stringify(left.props.uiBackground.uvs.slice(0, 2)), '[0,0]')
})

test('the coin is the game\'s cartoon coin image at the requested size', () => {
  const t = theme()
  const coin = render(t.CoinIcon({ size: 34 }))[0]
  assert.equal(coin.props.uiTransform.width, 34)
  assert.equal(coin.props.uiTransform.height, 34)
  assert.equal(coin.props.uiBackground.texture.src, 'assets/images/ui/cartoon-coin.png')
})

test('outlined text is a single clean drop shadow, not jagged copies all around', () => {
  const t = theme()
  const label = render(t.OutlineLabel({ value: 'Hola', fontSize: 24, color: t.PAL.text, width: 100, height: 30 }))
  const shadows = label.filter(n => n.type === 'Label' && n.props.uiTransform.positionType === 'absolute')
  assert.equal(shadows.length, 1)
  assert.equal(shadows[0].props.uiTransform.position.left, 0, 'straight down, no sideways copies')
})

test('PillButton tints map to the matching kit button', () => {
  const t = theme()
  assert.equal(t.buttonArt(undefined), 'violet')
  assert.equal(t.buttonArt(t.PAL.green), 'green')
  assert.equal(t.buttonArt(t.PAL.pink), 'pink')
  assert.equal(t.buttonArt(t.PAL.cyan), 'blue')
  assert.equal(t.buttonArt(t.PAL.yellow), 'yellow')
  assert.equal(t.buttonArt(t.c(0.6, 0.55, 0.7, 0.8)), 'grey', 'disabled grey stays grey')
  const active = render(t.PillButton({ id: 'a', label: 'ES', width: 120, height: 50, active: true, onClick() {} }))
  assert.ok(active.find(n => n.props.key === 'mid').props.uiBackground.texture.src.endsWith('btn-yellow.png'))
})

test('cards get the cartoon rim inside the same border; see-through pills stay plain', () => {
  const t = theme()
  const card = render(t.Frame({ width: 300, height: 120, edge: t.PAL.violet, fill: t.PAL.cream, border: 8, pad: 10, children: [] }))
  assert.equal(card[0].props.uiTransform.width, 300)
  assert.equal(card[0].props.uiBackground.color, t.OUTLINE)
  const rim = card[1]
  assert.equal(card[0].props.uiTransform.padding + rim.props.uiTransform.padding, 8, 'outline + rim = the same border thickness, so the content area is unchanged')
  assert.ok(card.some(n => n.props.key === 'rim-shine') && card.some(n => n.props.key === 'rim-lip'))
  const glass = render(t.Frame({ width: 300, height: 120, edge: t.PAL.violetLight, fill: t.PAL.violetGlass, border: 8, children: [] }))
  assert.ok(glass.some(n => n.props.key === 'rim-shine'), 'glass and dark HUD cards get the cartoon rim too')
  assert.equal(glass.at(-1).props.uiBackground.color.a, 1, 'drawn with an opaque fill')
  const veil = render(t.Frame({ width: 300, height: 40, edge: t.c(0, 0, 0, 0), fill: t.c(0.2, 0.1, 0.4, 0.5), border: 0, children: [] }))
  assert.ok(!veil.some(n => n.props.key === 'rim-shine'), 'see-through helper pills keep the plain look (no banding on mobile)')
})
