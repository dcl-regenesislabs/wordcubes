// Language flags, cut from one atlas (assets/images/ui/languages.png, the same artwork as marsh-colony and Cozy Farm).
// Flag() for the 2D UI; planeFlagUvs() for a 3D plane (the pad signs, lobby.ts).
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import type { Lang } from '../../shared/lang'

export const FLAG_ATLAS = 'assets/images/ui/languages.png'
const ATLAS_SIZE = 1024
// pixel rectangles of each flag in the atlas (x, y from the top left)
const RECTS: Record<Lang, { x: number; y: number; w: number; h: number }> = {
  en: { x: 12, y: 450, w: 512, h: 342 },
  es: { x: 244, y: 60, w: 510, h: 338 },
  pt: { x: 555, y: 450, w: 457, h: 344 }
}

/** Width / height of a flag. */
export const flagAspect = (lang: Lang) => RECTS[lang].w / RECTS[lang].h

function edges(lang: Lang) {
  const r = RECTS[lang]
  return { left: r.x / ATLAS_SIZE, right: (r.x + r.w) / ATLAS_SIZE, top: 1 - r.y / ATLAS_SIZE, bottom: 1 - (r.y + r.h) / ATLAS_SIZE }
}

/** UI texture coords: bottom-left, top-left, top-right, bottom-right. */
function uiUvs(lang: Lang): number[] {
  const e = edges(lang)
  return [e.left, e.bottom, e.left, e.top, e.right, e.top, e.right, e.bottom]
}

/** MeshRenderer plane coords, both faces. The plane's corners come bottom-right, top-right, top-left, bottom-left as
 *  seen on the pad signs (the bottom-left-first order showed the flag turned 90 degrees). */
export function planeFlagUvs(lang: Lang): number[] {
  const e = edges(lang)
  const face = [e.right, e.bottom, e.right, e.top, e.left, e.top, e.left, e.bottom]
  return [...face, ...face]
}

export function Flag(props: { lang: Lang; height: number; dim?: boolean; margin?: { left?: number; right?: number; top?: number; bottom?: number } }) {
  return (
    <UiEntity
      uiTransform={{ width: Math.round(props.height * flagAspect(props.lang)), height: props.height, margin: props.margin, pointerFilter: 'none' }}
      uiBackground={{
        texture: { src: FLAG_ATLAS, wrapMode: 'clamp', filterMode: 'tri-linear' },
        textureMode: 'stretch',
        uvs: uiUvs(props.lang),
        color: props.dim ? { r: 1, g: 1, b: 1, a: 0.45 } : undefined
      }}
    />
  )
}
