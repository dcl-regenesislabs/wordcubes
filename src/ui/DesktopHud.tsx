/** @jsx ReactEcs.createElement */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'

export interface State {
  desktopDisplay: 'flex' | 'none'
  statusDisplay: 'flex' | 'none'
  coins: string
  round: string
  holding: string
  instruction: string
  statusWidth: number
  statusHeight: number
  desktopRight: number
  desktopTop: number
  desktopBottom: number
  desktopPadding: number
  desktopFont: number
  desktopSmallFont: number
  desktopRow: number
  desktopIcon: number
  desktopIconGap: number
  statusTextWidth: number
  coinTextWidth: number
  shortcutsWidth: number
  shortcutsHeight: number
  shortcutCell: number
  shortcutTextWidth: number
}

export const state: State = {
  desktopDisplay: 'none', statusDisplay: 'none',
  coins: '0 coins', round: 'Waiting for round', holding: 'Hands empty',
  instruction: 'Click a cube to grab it',
  statusWidth: 260, statusHeight: 116,
  desktopRight: 24, desktopTop: 24, desktopBottom: 24, desktopPadding: 12,
  desktopFont: 22, desktopSmallFont: 20, desktopRow: 28, desktopIcon: 28, desktopIconGap: 8,
  statusTextWidth: 232, coinTextWidth: 196,
  shortcutsWidth: 520, shortcutsHeight: 92, shortcutCell: 164, shortcutTextWidth: 128
}

export function DesktopHud() {
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', display: state.desktopDisplay, pointerFilter: 'none' }}>
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: state.desktopTop, right: state.desktopRight }, width: state.statusWidth, height: state.statusHeight, padding: state.desktopPadding, display: state.statusDisplay, flexDirection: 'column', borderWidth: 2, borderRadius: 12, borderColor: { r: 0.43, g: 0.16, b: 0.53, a: 1 }, pointerFilter: 'none' }}
        uiBackground={{ color: { r: 1, g: 0.96, b: 0.86, a: 0.94 } }}
      >
        <UiEntity uiTransform={{ width: state.statusTextWidth, height: state.desktopRow, flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
          <UiEntity uiTransform={{ width: state.desktopIcon, height: state.desktopIcon, margin: { right: state.desktopIconGap }, flexShrink: 0 }} uiBackground={{ texture: { src: 'assets/images/ui/cartoon-coin.png', filterMode: 'tri-linear', wrapMode: 'clamp' }, textureMode: 'stretch' }} />
          <Label value={state.coins} fontSize={state.desktopFont} textAlign="middle-left" textWrap="nowrap" color={{ r: 0.3, g: 0.13, b: 0.37, a: 1 }} uiTransform={{ width: state.coinTextWidth, height: state.desktopRow, flexShrink: 0 }} />
        </UiEntity>
        <Label value={state.round} fontSize={state.desktopSmallFont} textAlign="middle-left" textWrap="nowrap" color={{ r: 0.3, g: 0.13, b: 0.37, a: 1 }} uiTransform={{ width: state.statusTextWidth, height: state.desktopRow, flexShrink: 0 }} />
        <Label value={state.holding} fontSize={state.desktopSmallFont} textAlign="middle-left" textWrap="nowrap" color={{ r: 0.43, g: 0.16, b: 0.53, a: 1 }} uiTransform={{ width: state.statusTextWidth, height: state.desktopRow, flexShrink: 0 }} />
      </UiEntity>
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { bottom: state.desktopBottom, right: state.desktopRight }, width: state.shortcutsWidth, height: state.shortcutsHeight, padding: state.desktopPadding, flexDirection: 'column', borderWidth: 2, borderRadius: 12, borderColor: { r: 0.43, g: 0.16, b: 0.53, a: 1 }, pointerFilter: 'none' }}
        uiBackground={{ color: { r: 1, g: 0.96, b: 0.86, a: 0.94 } }}
      >
        <Label value={state.instruction} fontSize={state.desktopSmallFont} textAlign="middle-left" textWrap="nowrap" color={{ r: 0.3, g: 0.13, b: 0.37, a: 1 }} uiTransform={{ width: '100%', height: state.desktopRow, flexShrink: 0 }} />
        <UiEntity uiTransform={{ width: '100%', height: state.desktopRow, flexDirection: 'row', flexShrink: 0 }}>
          <UiEntity uiTransform={{ width: state.shortcutCell, height: state.desktopRow, flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
            <UiEntity uiTransform={{ width: state.desktopIcon, height: state.desktopIcon, margin: { right: state.desktopIconGap }, flexShrink: 0 }} uiBackground={{ texture: { src: 'assets/images/ui/cartoon-break.png', filterMode: 'tri-linear', wrapMode: 'clamp' }, textureMode: 'stretch' }} />
            <Label value="E  Break" fontSize={state.desktopSmallFont} textAlign="middle-left" textWrap="nowrap" color={{ r: 0.43, g: 0.16, b: 0.53, a: 1 }} uiTransform={{ width: state.shortcutTextWidth, height: state.desktopRow, flexShrink: 0 }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: state.shortcutCell, height: state.desktopRow, flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
            <UiEntity uiTransform={{ width: state.desktopIcon, height: state.desktopIcon, margin: { right: state.desktopIconGap }, flexShrink: 0 }} uiBackground={{ texture: { src: 'assets/images/ui/cartoon-toss.png', filterMode: 'tri-linear', wrapMode: 'clamp' }, textureMode: 'stretch' }} />
            <Label value="F  Toss" fontSize={state.desktopSmallFont} textAlign="middle-left" textWrap="nowrap" color={{ r: 0.43, g: 0.16, b: 0.53, a: 1 }} uiTransform={{ width: state.shortcutTextWidth, height: state.desktopRow, flexShrink: 0 }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: state.shortcutCell, height: state.desktopRow, flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
            <UiEntity uiTransform={{ width: state.desktopIcon, height: state.desktopIcon, margin: { right: state.desktopIconGap }, flexShrink: 0 }} uiBackground={{ texture: { src: 'assets/images/ui/cartoon-hint.png', filterMode: 'tri-linear', wrapMode: 'clamp' }, textureMode: 'stretch' }} />
            <Label value="1  Hint" fontSize={state.desktopSmallFont} textAlign="middle-left" textWrap="nowrap" color={{ r: 0.43, g: 0.16, b: 0.53, a: 1 }} uiTransform={{ width: state.shortcutTextWidth, height: state.desktopRow, flexShrink: 0 }} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
