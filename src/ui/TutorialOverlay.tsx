/** @jsx ReactEcs.createElement */
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { clickSlot } from '../client/arena'
import { Frame, PAL, PillButton, LetterTile } from '../client/ui/theme'

// Shares the exact Frame and PillButton widgets used by Cubby's existing NPC dialogue.
// This panel follows the existing coded HUD because Frame accepts arbitrary children.
export const state = {
  display: 'none' as 'none' | 'flex', barHeight: 0, left: 30, bottom: 35, width: 760, height: 220,
  font: 25, titleFont: 28, titleHeight: 38, lineHeight: 90, buttonWidth: 230, buttonHeight: 48,
  radius: 28, border: 6, padding: 22, buttonBorder: 4,
  buttonRowHeight: 48, progressFont: 16, progressHeight: 24,
  framesDisplay: 'none' as 'none' | 'flex', framesHeight: 0, tileSize: 0,
  letter0: '', letter1: '', letter2: '', targetSlot: -1,
  mobile: false, bodyWidth: 500, sideWidth: 0, sideGap: 0, mobileRowHeight: 60, mobileCopyHeight: 60,
  grabDisplay: 'none' as 'none' | 'flex', grabLabel: '',
  title: '', text: '', next: '', progress: '', primaryDisplay: 'flex' as 'none' | 'flex'
}

export function TutorialOverlay(props: { onNext: () => void; onGrab?: () => void }) {
  if (state.mobile) return <MobileTutorialDialog onNext={props.onNext} onGrab={props.onGrab} />
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', display: state.display, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: state.left, bottom: state.bottom }, width: state.width, height: state.height, pointerFilter: 'none' }}>
        <Frame width={state.width} height={state.height} edge={PAL.violet} fill={PAL.cream} radius={state.radius} border={state.border} pad={state.padding} align="flex-start" justify="center" block>
          <Label value={state.title} font="sans-serif" fontSize={state.titleFont} color={PAL.violet} textAlign="middle-left" uiTransform={{ width: '100%', height: state.titleHeight }} />
          <Label value={state.text} font="sans-serif" fontSize={state.font} color={PAL.ink} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: '100%', height: state.lineHeight }} />
          <UiEntity uiTransform={{ width: '100%', height: state.buttonRowHeight, flexDirection: 'row', justifyContent: 'flex-end', pointerFilter: 'none' }}>
            <UiEntity key="tutorial-next-slot" uiTransform={{ width: state.buttonWidth, height: state.buttonHeight, pointerFilter: 'none' }}>
              {state.primaryDisplay === 'flex' && <PillButton id="tutorial-next" label={state.next} width={state.buttonWidth} height={state.buttonHeight} font={state.font} tint={PAL.green} onClick={props.onNext} />}
            </UiEntity>
          </UiEntity>
          {state.framesDisplay === 'flex' && <LetterTile size={state.tileSize} letter="" state="empty" index={2} glow onClick={() => clickSlot(2)} />}
          <Label value={state.progress} font="sans-serif" fontSize={state.progressFont} color={PAL.ink} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: '100%', height: state.progressHeight }} />
        </Frame>
      </UiEntity>
    </UiEntity>
  )
}

function MobileTutorialDialog(props: { onNext: () => void; onGrab?: () => void }) {
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', display: state.display, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: state.left, bottom: state.bottom }, width: state.width, height: state.height, pointerFilter: 'none' }}>
        <Frame width={state.width} height={state.height} edge={PAL.violet} fill={PAL.cream} radius={state.radius} border={state.border} pad={state.padding} align="center" justify="center" block>
          <UiEntity uiTransform={{ width: '100%', height: state.mobileRowHeight, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
            <UiEntity uiTransform={{ width: state.bodyWidth, height: state.mobileCopyHeight, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
              <Label value={state.title} font="sans-serif" fontSize={state.titleFont} color={PAL.violet} textAlign="middle-left" uiTransform={{ width: '100%', height: state.titleHeight }} />
              <Label value={state.text} font="sans-serif" fontSize={state.font} color={PAL.ink} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: '100%', height: state.lineHeight }} />
            </UiEntity>
            <UiEntity key="mobile-tutorial-action" uiTransform={{ width: state.sideWidth, height: state.mobileRowHeight, margin: { left: state.sideGap }, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
              {state.primaryDisplay === 'flex' && <PillButton id="tutorial-next" label={state.next} width={state.buttonWidth} height={state.buttonHeight} font={state.font} border={state.buttonBorder} tint={PAL.green} onClick={props.onNext} />}
              {state.framesDisplay === 'flex' && <LetterTile size={state.tileSize} letter="" state="empty" index={2} glow onClick={() => clickSlot(2)} />}
              {state.grabDisplay === 'flex' && <PillButton id="tutorial-grab" label={state.grabLabel} width={state.buttonWidth} height={state.buttonHeight} font={state.font} border={state.buttonBorder} tint={PAL.green} onClick={() => props.onGrab?.()} />}
            </UiEntity>
          </UiEntity>
        </Frame>
      </UiEntity>
    </UiEntity>
  )
}
