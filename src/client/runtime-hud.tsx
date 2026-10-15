// Runtime-sized word cells and transient feedback. The static frame stays editable in src/ui/.
import ReactEcs, { UiEntity, Label, ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { wordCellsLayout } from './ui-layout'

export const runtimeHud = {
  mobile: true,
  mask: '',
  hint: '',
  message: '',
  panelWidth: 560,
  panelHeight: 98,
  contentWidth: 448,
  headerTop: 12,
  headerRegionLeft: 0,
  headerRegionWidth: 1600,
  padding: 8,
  questionHeight: 34,
  wordHeight: 48,
  bodyFont: 24,
  toastHeight: 72,
  toastTop: 118
}

export function RuntimeHud() {
  const letters = runtimeHud.mask.split('')
  const cells = wordCellsLayout(letters.length, runtimeHud.contentWidth, runtimeHud.wordHeight)
  const message = runtimeHud.message.trim()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}>
      {!runtimeHud.mobile && letters.length > 0 ? (
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: runtimeHud.headerTop + runtimeHud.padding + runtimeHud.questionHeight, left: runtimeHud.headerRegionLeft }, width: runtimeHud.headerRegionWidth, height: runtimeHud.wordHeight, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
          <UiEntity uiTransform={{ width: cells.rowWidth, height: runtimeHud.wordHeight, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', pointerFilter: 'none' }}>
            {letters.map((letter, index) => {
              const placed = letter !== '_'
              const hint = runtimeHud.hint[index]
              const hinted = !placed && !!hint && hint !== '_'
              return (
                <UiEntity key={`letter-${index}`}
                  uiTransform={{ width: cells.size, height: cells.size, flexShrink: 0, borderWidth: 2, borderRadius: 6, borderColor: { r: 0.48, g: 0.27, b: 0.59, a: 1 }, pointerFilter: 'none' }}
                  uiBackground={{ color: placed ? { r: 0.73, g: 0.93, b: 0.84, a: 1 } : hinted ? { r: 1, g: 0.9, b: 0.57, a: 1 } : { r: 0.95, g: 0.9, b: 0.98, a: 1 } }}
                >
                  <Label value={placed ? letter : hinted ? hint : ''} font="monospace" fontSize={cells.fontSize} color={{ r: 0.26, g: 0.12, b: 0.34, a: 1 }} uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
                </UiEntity>
              )
            })}
          </UiEntity>
        </UiEntity>
      ) : null}
      {message ? (
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: runtimeHud.toastTop, left: runtimeHud.headerRegionLeft }, width: runtimeHud.headerRegionWidth, height: runtimeHud.toastHeight, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>
          <UiEntity uiTransform={{ width: runtimeHud.panelWidth, height: runtimeHud.toastHeight, padding: runtimeHud.padding, borderWidth: 1, borderColor: { r: 0.48, g: 0.27, b: 0.59, a: 1 }, pointerFilter: 'none' }} uiBackground={{ color: { r: 1, g: 0.97, b: 0.88, a: 0.96 } }}>
            <Label value={message} fontSize={runtimeHud.bodyFont} textWrap="wrap" color={{ r: 0.26, g: 0.12, b: 0.34, a: 1 }} uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
          </UiEntity>
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

let owner: Entity | null = null
export function setupRuntimeHud() {
  if (owner !== null) return
  owner = engine.addEntity()
  ReactEcsRenderer.addUiRenderer(owner, RuntimeHud, { virtualWidth: 1920, virtualHeight: 1080 })
}
