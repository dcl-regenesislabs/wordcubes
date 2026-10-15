import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

// Word Cubes look: a candy toy-block world. Cream alphabet-block faces, bright violet panels, rainbow accents.
// Every colour lives here so the whole UI can be re-skinned from one place.
export const c = (r: number, g: number, b: number, a = 1) => Color4.create(r, g, b, a)
const hex = (h: string, a = 1) => c(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, a)

// The eight block colours, sampled from the rim of each tile in the cube texture (Cube*.glb share one atlas).
export const BLOCK = {
  green: hex('#67a735'),
  orange: hex('#f1882b'),
  purple: hex('#9749a6'),
  blue: hex('#5eaddd'),
  red: hex('#ea6053'),
  yellow: hex('#dcae35'),
  teal: hex('#3da791'),
  pink: hex('#ee538f')
}

// Which colour each letter's cube model uses. Read from the UVs of Cube<letter>.glb: keep in step if the models change.
const LETTER_COLOR: Record<string, Color4> = {
  A: BLOCK.red, B: BLOCK.purple, C: BLOCK.green, D: BLOCK.blue, E: BLOCK.yellow, F: BLOCK.purple, G: BLOCK.blue,
  H: BLOCK.orange, I: BLOCK.red, J: BLOCK.green, K: BLOCK.pink, L: BLOCK.orange, M: BLOCK.red, N: BLOCK.yellow,
  Ñ: BLOCK.green, O: BLOCK.teal, P: BLOCK.orange, Q: BLOCK.purple, R: BLOCK.green, S: BLOCK.red, T: BLOCK.teal,
  U: BLOCK.green, V: BLOCK.blue, W: BLOCK.yellow, X: BLOCK.purple, Y: BLOCK.teal, Z: BLOCK.pink
}
export const letterColor = (letter: string): Color4 => LETTER_COLOR[letter] ?? BLOCK.orange

export const PAL = {
  // violet panels (the colour of the start pads)
  violetDark: c(0.24, 0.12, 0.45, 0.95),
  violet: c(0.46, 0.26, 0.8, 1),
  violetLight: c(0.72, 0.55, 0.97, 1),
  slot: c(0.2, 0.1, 0.4, 0.55), // empty letter slot, translucent so the world shows through
  slotRim: c(1, 1, 1, 0.75),
  // alphabet block face
  cream: c(1, 0.97, 0.86, 1),
  creamDark: c(0.9, 0.84, 0.68, 1),
  // text
  text: c(1, 0.97, 0.9, 1),
  dim: c(0.86, 0.8, 0.98, 1),
  ink: c(0.22, 0.12, 0.4, 1), // dark text on cream
  outline: c(0.16, 0.07, 0.3, 1),
  // candy accents
  red: BLOCK.red,
  orange: BLOCK.orange,
  yellow: c(1, 0.85, 0.25, 1),
  green: BLOCK.green,
  cyan: c(0.16, 0.7, 0.9, 1),
  purple: BLOCK.purple,
  pink: BLOCK.pink,
  grass: c(0.55, 0.85, 0.3, 1)
}

export const darken = (col: Color4, k: number) => c(col.r * (1 - k), col.g * (1 - k), col.b * (1 - k), col.a)

export const lighten = (col: Color4, k: number) => c(Math.min(1, col.r + k), Math.min(1, col.g + k), Math.min(1, col.b + k), col.a)
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ---- tactile pop: a quick swell when something changes or is pressed ----
const POP_MS = 280
const popAt: Record<string, number> = {}
export const popPress = (id: string) => {
  popAt[id] = Date.now()
}
export const popFactor = (id: string, amount = 0.18) => {
  const t = popAt[id]
  if (t === undefined) return 1
  const k = (Date.now() - t) / POP_MS
  return k >= 1 ? 1 : 1 + amount * Math.sin(k * Math.PI)
}

export const hovered: Record<string, boolean> = {}
export const hover = (id: string) => ({
  onMouseEnter: () => {
    hovered[id] = true
  },
  onMouseLeave: () => {
    hovered[id] = false
  }
})

type Edges = { top?: number; left?: number; right?: number; bottom?: number }

// A rounded card with a coloured rim: the rim is the outer entity's padding, the fill sits inside.
export const Frame = (props: {
  width: number | `${number}%`
  height: number | `${number}%`
  edge: Color4
  fill: Color4
  radius?: number
  border?: number
  pad?: number
  dir?: 'row' | 'column'
  align?: 'center' | 'flex-start' | 'flex-end'
  justify?: 'center' | 'flex-start' | 'flex-end' | 'space-around' | 'space-between'
  at?: Edges
  margin?: Edges
  block?: boolean // true = the card catches clicks (so they don't reach the world behind it)
  key?: string
  children?: any
}) => {
  const r = props.radius ?? 18
  const b = props.border ?? 4
  return (
    <UiEntity
      uiTransform={{
        positionType: props.at ? 'absolute' : 'relative',
        position: props.at,
        margin: props.margin,
        width: props.width,
        height: props.height,
        padding: b,
        borderRadius: r,
        pointerFilter: props.block ? 'block' : 'none'
      }}
      uiBackground={{ color: props.edge }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          borderRadius: Math.max(2, r - b),
          flexDirection: props.dir ?? 'column',
          alignItems: props.align,
          justifyContent: props.justify,
          padding: props.pad ?? 0,
          pointerFilter: props.block ? 'block' : 'none'
        }}
        uiBackground={{ color: props.fill }}
      >
        {props.children}
      </UiEntity>
    </UiEntity>
  )
}

// Text with a dark outline so it stays readable over the 3D world.
const OFF = [
  { left: -2, top: 0 },
  { left: 2, top: 0 },
  { left: 0, top: -2 },
  { left: 0, top: 2 }
]
export const OutlineLabel = (props: {
  value: string
  fontSize: number
  color: Color4
  width: number | `${number}%`
  height: number
  align?: 'middle-left' | 'middle-center' | 'middle-right'
  wrap?: boolean
  key?: string
}) => {
  const align = props.align ?? 'middle-center'
  const wrap = props.wrap ? 'wrap' : 'nowrap'
  return (
    <UiEntity uiTransform={{ width: props.width, height: props.height, pointerFilter: 'none' }}>
      {OFF.map((o, i) => (
        <Label
          key={`o${i}`}
          value={props.value}
          fontSize={props.fontSize}
          color={PAL.outline}
          font="sans-serif"
          textAlign={align}
          textWrap={wrap}
          uiTransform={{ width: '100%', height: props.height, positionType: 'absolute', position: o }}
        />
      ))}
      <Label
        value={props.value}
        fontSize={props.fontSize}
        color={props.color}
        font="sans-serif"
        textAlign={align}
        textWrap={wrap}
        uiTransform={{ width: '100%', height: props.height }}
      />
    </UiEntity>
  )
}

// A gold coin drawn from rounded boxes (no image needed): dark rim, bright face, a small highlight.
export const CoinIcon = (props: { size: number; margin?: Edges; key?: string }) => {
  const s = props.size
  return (
    <UiEntity uiTransform={{ width: s, height: s, margin: props.margin, padding: Math.max(2, Math.round(s * 0.09)), borderRadius: s / 2, pointerFilter: 'none' }} uiBackground={{ color: c(0.72, 0.45, 0.08, 1) }}>
      <UiEntity
        uiTransform={{ width: '100%', height: '100%', borderRadius: s / 2, padding: Math.round(s * 0.18), pointerFilter: 'none' }}
        uiBackground={{ color: c(1, 0.84, 0.25, 1) }}
      >
        <UiEntity
          uiTransform={{ width: '100%', height: '100%', borderRadius: s / 2, padding: Math.round(s * 0.12), pointerFilter: 'none' }}
          uiBackground={{ color: c(0.95, 0.68, 0.12, 1) }}
        >
          <UiEntity uiTransform={{ width: Math.round(s * 0.2), height: Math.round(s * 0.2), borderRadius: s, pointerFilter: 'none' }} uiBackground={{ color: c(1, 0.96, 0.7, 1) }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// A pill button with hover and press feedback. Wood by default, candy-coloured when `tint` is set.
export const PillButton = (props: {
  id: string
  label: string
  width: number
  height: number
  font?: number
  tint?: Color4
  active?: boolean // e.g. the option you picked: gold rim and bright text
  cost?: number // shows a coin and this price after the label
  onClick: () => void
  at?: Edges
  margin?: Edges
  key?: string
}) => {
  const hov = !!hovered[props.id]
  const k = popFactor(props.id, 0.08)
  const w = Math.round(props.width * k)
  const h = Math.round(props.height * k)
  const rim = props.tint ?? PAL.violetLight
  return (
    <UiEntity
      uiTransform={{
        positionType: props.at ? 'absolute' : 'relative',
        position: props.at,
        margin: props.margin,
        width: w,
        height: h,
        padding: 4,
        borderRadius: h / 2,
        pointerFilter: 'block'
      }}
      uiBackground={{ color: props.active ? PAL.yellow : hov ? lighten(rim, 0.12) : rim }}
      onMouseDown={() => {
        popPress(props.id)
        props.onClick()
      }}
      {...hover(props.id)}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: '100%', borderRadius: h / 2 - 4, justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}
        uiBackground={{ color: hov ? PAL.violet : PAL.violetDark }}
      >
        {props.cost === undefined ? (
          <Label value={props.label} fontSize={props.font ?? 24} font="sans-serif" color={hov || props.active ? PAL.yellow : PAL.text} textWrap="nowrap" uiTransform={{ width: w - 12, height: Math.max(24, h - 12) }} />
        ) : (
          <UiEntity uiTransform={{ width: w - 12, height: Math.max(24, h - 12), flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
            <Label value={props.label} fontSize={props.font ?? 24} font="sans-serif" color={hov || props.active ? PAL.yellow : PAL.text} textWrap="nowrap" uiTransform={{ width: Math.round((props.font ?? 24) * 2.3), height: Math.max(24, h - 12) }} />
            <CoinIcon size={Math.round((props.font ?? 24) * 0.95)} margin={{ left: 4, right: 4 }} />
            <Label value={`${props.cost}`} fontSize={props.font ?? 24} font="sans-serif" color={PAL.yellow} textWrap="nowrap" uiTransform={{ width: Math.round((props.font ?? 24) * 1.2), height: Math.max(24, h - 12) }} />
          </UiEntity>
        )}
      </UiEntity>
    </UiEntity>
  )
}

// One alphabet block. `state` decides how it looks; `pop` (1 = rest) swells it, `shake` slides it sideways, `flash` tints the rim.
export type TileState = 'empty' | 'hint' | 'locked'
export const LetterTile = (props: {
  size: number
  letter: string
  state: TileState
  index: number
  pop?: number
  shake?: number
  flash?: Color4 | null
  margin?: number
  key?: string
}) => {
  const k = props.pop ?? 1
  const inner = Math.round(props.size * k)
  const off = Math.round((props.size - inner) / 2)
  const own = letterColor(props.letter)
  const rim = props.flash ?? (props.state === 'locked' ? own : props.state === 'hint' ? PAL.slotRim : PAL.slotRim)
  const fill = props.state === 'locked' ? PAL.cream : PAL.slot
  const ink = props.state === 'locked' ? darken(own, 0.12) : c(1, 1, 1, 0.5)
  const showLetter = props.state !== 'empty' && props.letter !== '' && props.letter !== '_'
  return (
    <UiEntity uiTransform={{ width: props.size, height: props.size, margin: { left: props.margin ?? 0, right: props.margin ?? 0 }, pointerFilter: 'none' }}>
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { left: off + Math.round(props.shake ?? 0), top: off },
          width: inner,
          height: inner,
          padding: Math.max(3, Math.round(props.size * 0.07)),
          borderRadius: Math.round(props.size * 0.22),
          pointerFilter: 'none'
        }}
        uiBackground={{ color: rim }}
      >
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            borderRadius: Math.round(props.size * 0.16),
            justifyContent: 'center',
            alignItems: 'center',
            pointerFilter: 'none'
          }}
          uiBackground={{ color: fill }}
        >
          {showLetter && (
            <Label
              value={props.letter}
              fontSize={Math.round(props.size * 0.62)}
              font="sans-serif"
              color={ink}
              textAlign="middle-center"
              uiTransform={{ width: '100%', height: '100%' }}
            />
          )}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
