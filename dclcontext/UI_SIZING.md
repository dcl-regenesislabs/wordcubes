# UI sizing & screen model for DCL SDK7 (Unity desktop · Bevy web · Mobile)

This is the sizing system that makes our HUD look right on **all three** DCL
clients. In Word Cubes it lives in `src/client/ui/platform.ts`; follow the rules below. Everything here is the
distilled result of several real bugs — the "don't do X" notes are not
hypothetical.

## The three runtimes

| Runtime | What `getExplorerInformation` reports | Scale `S()` | Virtual canvas |
|---|---|---|---|
| **Unity desktop** | `platform:"desktop"` (or similar) | **×1.18** | `1920 × 1080` |
| **Bevy** (web explorer) | `platform:"web" agent:"bevy"` | **×1.18** (same as Unity) | `1920 × 1080` |
| **Mobile** (DCL mobile app) | `platform:"mobile"` or agent matches `/mobile\|android\|iphone\|ipad\|ios/` | **×1.6** | `1600 × 720`, each multiplied by the device pixel ratio |

Key mental model: **there are only two sizing regimes — "mobile" and "not
mobile".** Bevy is NOT special-cased for sizing; it is treated exactly like
Unity desktop. `bevy()` exists only for the rare case you need to branch on it
specifically, not for scaling.

## The two things that make it work

### 1. `S(n)` — scale every dimension through it
Wrap **every** `width`, `height`, `fontSize`, `margin`, and absolute `position`
offset in `S()` (or `Sbtn()` for touch buttons). Raw pixel literals in the UI
are a bug.

```ts
width: S(660)          // panel width
fontSize: S(28)        // label
position: { bottom: S(30), left: 0 }
```

`S(n) = round(n × 1.6)` on mobile, `round(n × 1.18)` everywhere else.

### 2. `getUiRendererConfig()` + re-apply after the async lookup
The platform can only be read **asynchronously** (`getExplorerInformation`
resolves a frame or more into the session). But the virtual canvas
(`virtualWidth/Height`) is baked in **once** when you call
`ReactEcsRenderer.setUiRenderer(...)`. So:

- Render immediately at the safe desktop canvas (`1920×1080`).
- When the lookup settles and we learn it's mobile, **call `setUiRenderer`
  again** with the mobile canvas.

`setupResponsiveUi(Root)` in `platform.ts` does all of this (a tiny per-frame
system re-applies the renderer only when the config signature changes, so it's
a no-op after the one flip). **If you wire `setUiRenderer` yourself and forget
the re-apply, mobile stays on the desktop canvas forever.**

## Hard-won rules (do NOT violate)

- **Never multiply `S()` by `devicePixelRatio()`.** It feels like the fix for
  "UI too small on a phone", but on Bevy/retina (dpr 2) it makes the HUD ~2.36×
  and giant. DPR belongs **only** in the mobile virtual-canvas expansion inside
  `getUiRendererConfig()`, never in `S()`.
- **`screenInset: 'none'`.** We opt out of the safe-area inset so anchored HUD
  pieces sit flush with the full screen, matching pre-7.26 behaviour. Changing
  this shifts every anchored element.
- **Mobile's reported canvas under-reports the real screen.** `UiCanvasInformation`
  is NOT the physical resolution. Don't size panels as a fraction of a
  `UiCanvasInformation` height expecting it to match what the player sees — it
  led us to shrink panels that then looked tiny. Prefer fixed `S()` sizes;
  clamp against the canvas only as a safety net, not as the primary size.
- **Text that must stay on one line:** set `textWrap="nowrap"` and wrap it in a
  container with `overflow: 'hidden'`. Without `textWrap`, Bevy uses the
  protocol default `TW_WRAP` and **stacks the digits/words vertically**, while
  Unity **clips**. This bit us on a coins counter.
- **Centering an icon + number pair:** a fixed-width, left/right-aligned label
  leaves empty slack that pushes the visible content off-center — and the slack
  is bigger on mobile because `S()` scales larger there. Either size the label
  width to the content (e.g. `S(digitCount × 17 + 6)`) so the block hugs its
  content, or respect the art: if a label sits over a baked texture cavity,
  align it to that cavity (often `middle-right`) rather than centering it, or
  the digits drift onto the adjacent graphic.
- **Flex layout differs between Bevy and mobile.** A row placed in normal flow
  landed too low / off-center on one client. When exact placement matters
  (e.g. pinning something to a panel's base), use `positionType: 'absolute'`
  with explicit `position` offsets instead of relying on flex stacking.
- **Phones that report a pixel ratio near 1:** their canvas is only 720 tall and the
  ×1.6 HUD cannot fit, so `S()` shrinks with the canvas height below 1100 (Word Cubes
  only). Phones at ratio 2–3 are unaffected. This is a height clamp, not a DPR term.
- **Touch buttons:** use `Sbtn(n)` (adds `MOBILE_BTN_BOOST` ×1.2 on mobile only)
  so tap targets stay comfortable without bloating desktop.

## Minimal setup

```ts
// ui.tsx (your root component lives here)
export const Root = () => (/* your <UiEntity> tree, every size via S() */)

// setup / main
import { Root } from './ui'
import { setupResponsiveUi } from './ui/scale'

export function main() {
  setupResponsiveUi(Root)   // replaces ReactEcsRenderer.setUiRenderer(Root, ...)
  // ...rest of your scene setup
}
```

That's the whole system. `mobile()`, `bevy()`, `S()`, `Sbtn()`,
`getUiRendererConfig()` and `resolveRuntimePlatform()` are all exported from
`platform.ts` if you need them directly.
