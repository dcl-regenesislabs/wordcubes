import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

// Real UiBackgrounds warm the same cache entries as the screens (AssetLoad alone
// uses a different cache). Match each screen's wrap/filter settings as well as src.
const UI_TEXTURES = [
  ...['green', 'violet', 'blue', 'pink', 'yellow', 'red', 'grey', 'cream'].map(color => ({
    src: `assets/images/ui-kit/btn-${color}.png`, wrapMode: 'clamp' as const, filterMode: 'bi-linear' as const
  })),
  ...['coin', 'break', 'toss', 'wildcard', 'freeze', 'reroll', 'bomb'].map(icon => ({
    src: `assets/images/ui/cartoon-${icon}.png`, wrapMode: 'clamp' as const, filterMode: 'tri-linear' as const
  })),
  { src: 'assets/images/ui/languages.png', wrapMode: 'clamp' as const, filterMode: 'tri-linear' as const },
  { src: 'assets/images/ui-kit/hand.png' }
]
const INVISIBLE = { r: 1, g: 1, b: 1, a: 0 }

// Keep these transparent 1px nodes alive through connection, tutorial and public
// screens. display:none can skip loading; pointerFilter:none leaves input alone.
// Same pattern as Marsh Colony #458 and Slide-Maze #19.
export function UiTextureWarmer() {
  return (
    <UiEntity key="ui-texture-warmer" uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: 1, height: 1, pointerFilter: 'none' }}>
      {UI_TEXTURES.map(texture => (
        <UiEntity key={texture.src}
          uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: 1, height: 1, pointerFilter: 'none' }}
          uiBackground={{ texture, textureMode: 'stretch', color: INVISIBLE }} />
      ))}
    </UiEntity>
  )
}
