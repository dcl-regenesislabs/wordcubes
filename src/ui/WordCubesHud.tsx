/** @jsx ReactEcs.createElement */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'

export interface State {
  question: string
  questionHeight: number
  questionFont: number
  wordHeight: number
  word: string
  panelWidth: number
  panelHeight: number
  edge: number
  headerTop: number
  headerRegionLeft: number
  headerRegionWidth: number
  padding: number
  frameInset: number
  capWidth: number
  centreWidth: number
  wordFont: number
  bodyFont: number
  toastHeight: number
  toastTop: number
}

export const state: State = {
  question: 'Find the hidden word', questionHeight: 34, questionFont: 28, wordHeight: 48,
  word: '_ _ _ _ _ _',
  panelWidth: 680, panelHeight: 112, edge: 24, headerTop: 24, headerRegionLeft: 0, headerRegionWidth: 1920, padding: 10, frameInset: 64,
  capWidth: 76.93, centreWidth: 526.14,
  wordFont: 48, bodyFont: 24, toastHeight: 72, toastTop: 144
}

export function WordCubesHud() {
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { top: state.headerTop, left: state.headerRegionLeft }, width: state.headerRegionWidth, height: state.panelHeight, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>
        <UiEntity
          uiTransform={{ width: state.panelWidth, height: state.panelHeight, padding: { top: state.padding, bottom: state.padding, left: state.frameInset, right: state.frameInset }, flexDirection: 'column', pointerFilter: 'none' }}
        >
          <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: state.panelWidth, height: state.panelHeight, flexDirection: 'row', pointerFilter: 'none' }}>
            <UiEntity uiTransform={{ width: state.capWidth, height: state.panelHeight, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ texture: { src: 'assets/images/ui/cartoon-word-strip.png', filterMode: 'tri-linear', wrapMode: 'clamp' }, textureMode: 'stretch', uvs: [0.005064456722, 0.295580110497, 0.005064456722, 0.727900552486, 0.104051565378, 0.727900552486, 0.104051565378, 0.295580110497] }} />
            <UiEntity uiTransform={{ width: state.centreWidth, height: state.panelHeight, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ texture: { src: 'assets/images/ui/cartoon-word-strip.png', filterMode: 'tri-linear', wrapMode: 'clamp' }, textureMode: 'stretch', uvs: [0.104051565378, 0.295580110497, 0.104051565378, 0.727900552486, 0.895948434622, 0.727900552486, 0.895948434622, 0.295580110497] }} />
            <UiEntity uiTransform={{ width: state.capWidth, height: state.panelHeight, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ texture: { src: 'assets/images/ui/cartoon-word-strip.png', filterMode: 'tri-linear', wrapMode: 'clamp' }, textureMode: 'stretch', uvs: [0.895948434622, 0.295580110497, 0.895948434622, 0.727900552486, 0.994935543278, 0.727900552486, 0.994935543278, 0.295580110497] }} />
          </UiEntity>
          <Label value={state.question} fontSize={state.questionFont} textWrap="nowrap" color={{ r: 0.2, g: 0.1, b: 0.27, a: 1 }} uiTransform={{ width: '100%', height: state.questionHeight, flexShrink: 0 }} />
          <Label value={state.word} fontSize={state.wordFont} font="monospace" textWrap="nowrap" color={{ r: 0.43, g: 0.16, b: 0.53, a: 1 }} uiTransform={{ width: '100%', height: state.wordHeight, flexShrink: 0 }} />
        </UiEntity>
      </UiEntity>

    </UiEntity>
  )
}
