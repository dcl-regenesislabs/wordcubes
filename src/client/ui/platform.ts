import { getExplorerInformation } from '~system/Runtime'

// One place that knows whether we are on a phone. The UI reads mobile() every frame, so it switches as soon as the
// lookup answers. Same approach as Marsh Colony / Pumpkin Ball / Last Gate: ask the Explorer once, add an agent-string
// fallback, and stay on desktop if the lookup fails.
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
    .catch(() => {})
    .then(() => onResolved && onResolved())
}

export const mobile = (): boolean => (forced === null ? detected : forced)
export function forceMobile(v: boolean | null) {
  forced = v
}

// The SDK draws the UI on a fixed virtual canvas: 1920x1080 on desktop, 1600x720 on phones.
export const canvas = () => (mobile() ? { virtualWidth: 1600, virtualHeight: 720 } : { virtualWidth: 1920, virtualHeight: 1080 })

// Keep things away from notches and rounded corners on the left and right edges of a phone.
export const EDGE = (): number => (mobile() ? 56 : 24)
// Smallest text on a phone.
export const fs = (n: number): number => (mobile() ? Math.max(n, 18) : n)
// Phone layouts are drawn a bit smaller than desktop ones because the canvas is shorter (720 vs 1080).
export const sz = (desktop: number, phone: number): number => (mobile() ? phone : desktop)
