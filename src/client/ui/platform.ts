// Responsive UI sizing, ported from the shared scale.ts (see dclcontext/UI_SIZING.md). Two regimes only: mobile and
// not mobile. Unity desktop and Bevy are sized the same way.
//
//   • every width / height / fontSize / margin / offset goes through S() (Sbtn() for touch buttons)
//   • setupResponsiveUi(Root) replaces ReactEcsRenderer.setUiRenderer: it renders at the desktop canvas right away and
//     re-applies the renderer once the async platform lookup says we are on a phone (the virtual canvas is read only
//     when setUiRenderer is called)
//   • layout is centred with flex (see Layer in hud.tsx), never with left = (1920 - w) / 2: the visible canvas is not
//     always 1920 wide
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { ReactEcsRenderer, type UiComponent } from '@dcl/sdk/react-ecs'
import { getExplorerInformation } from '~system/Runtime'

const MOBILE_AGENT_RE = /mobile|android|iphone|ipad|ios/

let detected = false
let forced: boolean | null = null // lets a desktop Explorer show the phone layout while testing
let started = false

export function resolvePlatform(onResolved?: () => void) {
  if (started) return
  started = true
  void getExplorerInformation({})
    .then((info) => {
      const platform = (info.platform ?? '').toLowerCase()
      const agent = (info.agent ?? '').toLowerCase()
      detected = platform === 'mobile' || MOBILE_AGENT_RE.test(agent)
      console.log('[CLIENT] platform', platform || '?', 'agent', agent || '?', 'mobile', detected)
    })
    .catch(() => {}) // couldn't read it: stay on desktop rather than guess
    .then(() => onResolved && onResolved())
}

/** True on the DCL mobile app. false on Unity desktop and on Bevy. */
export const mobile = (): boolean => (forced === null ? detected : forced)
export function forceMobile(v: boolean | null) {
  forced = v
}

/** Device pixel ratio. Used ONLY to expand the mobile virtual canvas, never in S() (that made Bevy/retina giant). */
function devicePixelRatio(): number {
  return UiCanvasInformation.getOrNull(engine.RootEntity)?.devicePixelRatio || 1
}

/** Desktop / Bevy: fixed 1920x1080. Mobile: 1600x720 expanded by the pixel ratio. Full screen, no safe-area inset. */
export function getUiRendererConfig() {
  const density = mobile() ? Math.max(1, devicePixelRatio()) : 1
  return {
    virtualWidth: mobile() ? Math.max(1, Math.round(1600 * density)) : 1920,
    virtualHeight: mobile() ? Math.max(1, Math.round(720 * density)) : 1080,
    screenInset: 'none' as const
  }
}

/** Global UI scale: ×1.6 on mobile, ×1.18 everywhere else (no pixel-ratio term, on purpose). */
export function S(n: number): number {
  return Math.round(n * (mobile() ? 1.6 * shortPhone() : 1.18))
}

// ×1.6 is tuned for the phone canvas expanded by a pixel ratio of 2-3 (1440+ tall). A phone that reports a ratio near
// 1 gets a 720 tall canvas where the HUD cannot fit, so only then shrink with the canvas height. Not a pixel-ratio
// term: real phones (ratio >= 2) are unaffected.
const PHONE_DESIGN_H = 1100
function shortPhone(): number {
  return Math.min(1, view().h / PHONE_DESIGN_H)
}

/** Touch buttons: a little bigger on mobile only, on top of S(). */
export const MOBILE_BTN_BOOST = 1.2
export function Sbtn(n: number): number {
  return Math.round(S(n) * (mobile() ? MOBILE_BTN_BOOST : 1))
}

/** The visible screen in virtual units. The SDK contain-fits the virtual canvas, so one side is usually larger than
 *  the canvas. Only a safety net for clamping (mobile under-reports its canvas): sizes come from S(). */
export function view(): { w: number; h: number } {
  const cfg = getUiRendererConfig()
  const ci = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!ci || !ci.width || !ci.height) return { w: cfg.virtualWidth, h: cfg.virtualHeight }
  const scale = Math.min(ci.width / cfg.virtualWidth, ci.height / cfg.virtualHeight)
  return { w: ci.width / scale, h: ci.height / scale }
}

/** Gap kept from the screen edges: notches and rounded corners on phones. */
export const EDGE = (): number => (mobile() ? Math.round(view().w * 0.035) : S(20))
/** Extra room on the right of a phone for the app's own buttons. */
export const RIGHT_RESERVE = (): number => (mobile() ? Math.round(view().w * 0.15) : 0)
/** The phone app's own top bar: screenInset is 'none', so top-anchored pieces start below it themselves. */
export const TOP_RESERVE = (): number => (mobile() ? Math.round(view().h * 0.09) : 0)
/** The phone app's own bottom controls (about 8% of the height): bottom-anchored pieces start above them. */
export const BOTTOM_RESERVE = (): number => (mobile() ? Math.round(view().h * 0.09) : 0)

let rootComponent: UiComponent | null = null
let lastSignature = ''
let syncRegistered = false

function applyUiRenderer(force = false) {
  if (!rootComponent) return
  const config = getUiRendererConfig()
  const signature = `${mobile()}:${config.virtualWidth}x${config.virtualHeight}`
  if (!force && signature === lastSignature) return
  ReactEcsRenderer.setUiRenderer(rootComponent, config)
  lastSignature = signature
}

/** Call once at startup instead of ReactEcsRenderer.setUiRenderer. Re-applies the renderer when the platform lookup
 *  (or forceMobile, or the pixel ratio) changes the canvas; a no-op every other frame. */
export function setupResponsiveUi(Root: UiComponent) {
  rootComponent = Root
  if (!syncRegistered) {
    syncRegistered = true
    engine.addSystem(() => applyUiRenderer())
  }
  resolvePlatform(() => applyUiRenderer())
  applyUiRenderer(true)
}
