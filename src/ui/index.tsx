/** @jsx ReactEcs.createElement */
import ReactEcs, { UiEntity, ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { WordCubesHud } from './WordCubesHud'
import { DesktopHud } from './DesktopHud'

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <WordCubesHud />
      <DesktopHud />
    </UiEntity>
  ))
}
