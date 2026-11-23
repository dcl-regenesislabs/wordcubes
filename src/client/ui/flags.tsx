// Standalone crops from assets/images/ui/languages.png, shared by the HUD and 3D room signs.
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import type { Lang } from '../../shared/lang'

export const FLAG_TEXTURES: Record<Lang, string> = {
  en: 'assets/images/ui/flag-en.png',
  es: 'assets/images/ui/flag-es.png',
  pt: 'assets/images/ui/flag-pt.png'
}
const ASPECTS: Record<Lang, number> = {
  en: 512 / 342,
  es: 510 / 338,
  pt: 457 / 344
}

/** Width / height of a flag. */
export const flagAspect = (lang: Lang) => ASPECTS[lang]

export function Flag(props: { lang: Lang; height: number; dim?: boolean; margin?: { left?: number; right?: number; top?: number; bottom?: number } }) {
  return (
    <UiEntity
      uiTransform={{ width: Math.round(props.height * flagAspect(props.lang)), height: props.height, margin: props.margin, pointerFilter: 'none' }}
      uiBackground={{
        texture: { src: FLAG_TEXTURES[props.lang], wrapMode: 'clamp', filterMode: 'tri-linear' },
        textureMode: 'stretch',
        color: props.dim ? { r: 1, g: 1, b: 1, a: 0.45 } : undefined
      }}
    />
  )
}
