// ---------------------------------------------------------------------------
// Responsive UI sizing for Decentraland SDK7 scenes — ONE source of truth for
// how the HUD scales across the three clients that matter:
//
//   • Unity desktop explorer   → ×1.18, fixed 1920×1080 virtual canvas
//   • Bevy (web) explorer      → ×1.18, SAME as Unity (no DPR comp — see below)
//   • Mobile (DCL mobile app)  → ×1.6,  virtual canvas 1600×720 expanded by DPR
//
// Drop this file in as `ui/scale.ts`. It depends ONLY on the SDK, nothing from
// your game. Then:
//   1. In your UI module, size EVERY width/height/fontSize/margin through S()
//      (or Sbtn() for touch buttons). Never hardcode raw pixels.
//   2. Call setupResponsiveUi(Root) once at startup instead of calling
//      ReactEcsRenderer.setUiRenderer(...) yourself.
//
// WHY A HELPER AND NOT JUST A SCALE NUMBER:
// The mobile/Bevy distinction can only be read ASYNCHRONOUSLY (getExplorer
// information resolves a frame or more after startup), and the virtual canvas
// (virtualWidth/Height) is FIXED at setUiRenderer time — it can't change per
// frame. So we re-apply setUiRenderer once the platform lookup settles. That is
// the whole trick; miss it and mobile renders at desktop canvas until (never).
// ---------------------------------------------------------------------------

import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { ReactEcsRenderer, type UiComponent } from '@dcl/sdk/react-ecs'
import { getExplorerInformation } from '~system/Runtime'

// ---- Runtime platform detection ------------------------------------------
// Resolved asynchronously once; React-ECS re-renders every frame, so the HUD
// restyles itself as soon as these flip.
let isMobileRuntime = false
// The Bevy explorer reports platform:"web" agent:"bevy". It is scaled EXACTLY
// like Unity desktop — the fixed 1920×1080 virtual canvas already matches, so it
// gets NO mobile canvas and NO DPR compensation.
let isBevyRuntime = false
let platformLookupStarted = false

const MOBILE_AGENT_RE = /mobile|android|iphone|ipad|ios/

/**
 * Live device pixel ratio from the renderer. Used ONLY to expand the mobile
 * virtual canvas in lockstep with pixel density (see getUiRendererConfig).
 * IMPORTANT: it is NOT applied to S(). Multiplying S() by DPR made the HUD
 * gigantic on Bevy/retina (dpr 2 → ~2.36×). This was a real, painful bug.
 */
function devicePixelRatio(): number {
  const ci = UiCanvasInformation.getOrNull(engine.RootEntity)
  return ci?.devicePixelRatio || 1
}

/**
 * Kick off the (async) platform lookup once. `onResolved` fires when the lookup
 * settles (success OR failure) — used to re-apply the UI renderer with the right
 * virtual canvas for mobile. Safe to call from setup.
 */
export function resolveRuntimePlatform(onResolved?: () => void): void {
  if (platformLookupStarted) return
  platformLookupStarted = true
  void getExplorerInformation({})
    .then((info) => {
      const platform = (info.platform ?? '').toLowerCase()
      const agent = (info.agent ?? '').toLowerCase()
      isMobileRuntime = platform === 'mobile' || MOBILE_AGENT_RE.test(agent)
      isBevyRuntime = agent.includes('bevy')
      console.log('[Platform]', `platform:${platform || '?'} agent:${agent || '?'}`)
    })
    .catch(() => {
      // Couldn't read it — stay at desktop scale rather than guess wrong.
    })
    .then(() => {
      if (onResolved) onResolved()
    })
}

/** True on the DCL mobile app. false on Unity desktop AND on Bevy. */
export function mobile(): boolean {
  return isMobileRuntime
}

/** True on the Bevy (web) explorer. It reports platform:"web" agent:"bevy", so
 *  mobile()'s heuristics don't catch it — use this when you need Bevy on its own. */
export function bevy(): boolean {
  return isBevyRuntime
}

// ---- Virtual canvas config ------------------------------------------------
/**
 * The renderer config passed to setUiRenderer.
 *
 * Desktop/Bevy: a fixed 1920×1080 virtual canvas. S()'s ×1.18 is tuned for this.
 * Mobile:       1600×720 EXPANDED by device pixel ratio, which reproduces the
 *               pre-react-ecs-7.26 HUD sizing, plus screenInset:'none' so anchored
 *               HUD pieces sit flush with the full screen (no safe-area gap).
 *
 * virtualWidth/Height are read ONCE by setUiRenderer, so when isMobileRuntime
 * flips after the async lookup you MUST call setUiRenderer again (setupResponsiveUi
 * does this for you).
 */
export function getUiRendererConfig() {
  const densityScale = isMobileRuntime ? Math.max(1, devicePixelRatio()) : 1
  return {
    virtualWidth: isMobileRuntime ? Math.max(1, Math.round(1600 * densityScale)) : 1920,
    virtualHeight: isMobileRuntime ? Math.max(1, Math.round(720 * densityScale)) : 1080,
    screenInset: 'none' as const
  }
}

// ---- The scale helpers ----------------------------------------------------
/**
 * Global UI scale. Wrap EVERY pixel dimension and fontSize in this.
 *   mobile  → ×1.6  (bigger touch targets)
 *   desktop → ×1.18 (also used for Bevy — NO DPR term, deliberately)
 *
 * S() has NO device-pixel-ratio factor on purpose: the fixed 1920×1080 canvas
 * already keeps Bevy in step with Unity, and adding DPR double-counted and blew
 * the HUD up on retina. If you are tempted to "fix" small mobile UI by adding
 * DPR here — don't. Adjust the mobile virtual canvas in getUiRendererConfig, or
 * the ×1.6 factor, instead.
 */
export function S(n: number): number {
  return Math.round(n * (isMobileRuntime ? 1.6 : 1.18))
}

/** Extra size bump for touch buttons on mobile only, on top of S(). Tune freely. */
export const MOBILE_BTN_BOOST = 1.2
export function Sbtn(n: number): number {
  return Math.round(S(n) * (isMobileRuntime ? MOBILE_BTN_BOOST : 1))
}

// ---- Renderer wiring (the part people forget) -----------------------------
let uiRendererSyncRegistered = false
let lastAppliedSignature = ''
let rootComponent: UiComponent | null = null

function applyUiRenderer(force = false): void {
  if (!rootComponent) return
  const config = getUiRendererConfig()
  const signature = `${mobile()}:${config.virtualWidth}x${config.virtualHeight}:${config.screenInset}`
  if (!force && signature === lastAppliedSignature) return
  ReactEcsRenderer.setUiRenderer(rootComponent, config)
  lastAppliedSignature = signature
}

function syncUiRendererSystem(): void {
  // Cheap: only re-applies setUiRenderer when the signature actually changes
  // (i.e. once, when the async platform lookup flips mobile/canvas).
  applyUiRenderer()
}

/**
 * Call this ONCE at scene startup with your root UI component, INSTEAD of calling
 * ReactEcsRenderer.setUiRenderer yourself. It:
 *   1. renders immediately at the safe desktop canvas,
 *   2. starts the async platform lookup,
 *   3. re-applies the renderer with the mobile canvas the moment the lookup
 *      resolves (via a per-frame system that no-ops until something changes).
 *
 *   import { Root } from './ui'
 *   setupResponsiveUi(Root)
 */
export function setupResponsiveUi(Root: UiComponent): void {
  rootComponent = Root
  if (!uiRendererSyncRegistered) {
    uiRendererSyncRegistered = true
    engine.addSystem(syncUiRendererSystem)
  }
  resolveRuntimePlatform(() => applyUiRenderer())
  applyUiRenderer(true)
}
