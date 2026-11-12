/** @jsx ReactEcs.createElement */
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { clickSlot } from '../client/arena'
import { Frame, PAL, LetterTile, PillButton, OutlineLabel } from '../client/ui/theme'

// Built from the game's own art (word strip, cartoon panel, cartoon button) and widgets (Frame, LetterTile).
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
  title: '', text: '', next: '', progress: '', primaryDisplay: 'flex' as 'none' | 'flex',
  // ---- the dialogue (virtual px, set by layoutDialog in client/tutorial.ts) ----
  // The UI kit's pieces: cartoon cards (Frame), candy buttons (PillButton) and the kit's tapping hand. talk = Cubby explains; action = the player plays; party = word done.
  mode: 'talk' as 'talk' | 'action' | 'party', copy: '',
  stripLeft: 0, stripBottom: 0, stripW: 1034, stripH: 151, stripPadL: 114, stripPadR: 107, stripFont: 28, stripTextW: 800, stripTextH: 80,
  tabLeft: 0, tabBottom: 0, tabW: 150, tabH: 44, tabFont: 24, tabName: 'Cubby',
  dotsLeft: 0, dotsBottom: 0, dotW: 26, dotH: 9, dotGap: 7, chapter: 0, chapters: 8,
  goalDisplay: 'none' as 'none' | 'flex', goalLetter: '', goalSize: 63, chipW: 80, chipH: 40, chipFont: 22, stepLabel: '1/8',
  actionDisplay: 'none' as 'none' | 'flex', actionLabel: '', actionGrab: false,
  actionLeft: 0, actionBottom: 0, actionW: 244, actionH: 94, actionFont: 30,
  handDisplay: 'none' as 'none' | 'flex', handLeft: 0, handBottom: 0, handW: 63, handH: 76,
  tileLeft: 0, tileBottom: 0,
  bleed: 400, dimW: 2400, dimH: 1520,
  panelLeft: 0, panelTop: 0, panelW: 812, panelH: 406, panelPadTop: 66, panelPadSide: 103, panelGap: 22,
  partyTitle: '', partyTitleFont: 44, partyTitleH: 56, partyTile: 100, hop0: 0, hop1: 0, hop2: 0,
  word0: '', word1: '', word2: '', partyFont: 24, partyTextH: 36
}

export function TutorialOverlay(props: { onNext: () => void; onGrab?: () => void }) {
  return <TutorialDialog onNext={props.onNext} onGrab={props.onGrab} />
}

const HAND = 'assets/images/ui-kit/hand.png'
const DIM = { r: 0.16, g: 0.07, b: 0.3, a: 0.5 }

// Desktop and mobile: one tree, three moods. Every image keeps its native aspect ratio, so nothing is squashed.
function TutorialDialog(props: { onNext: () => void; onGrab?: () => void }) {
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', display: state.display, pointerFilter: 'none' }}>
      {state.mode === 'party' ? <PartyPanel /> : <Strip onNext={props.onNext} />}
      <UiEntity key="mobile-tutorial-frame" uiTransform={{ positionType: 'absolute', position: { left: state.tileLeft, bottom: state.tileBottom }, width: state.tileSize, height: state.tileSize, display: state.framesDisplay, pointerFilter: 'none' }}>
        {state.framesDisplay === 'flex' && <LetterTile size={state.tileSize} letter="" state="empty" index={2} glow onClick={() => clickSlot(2)} />}
      </UiEntity>
      <CartoonButton name="mobile-tutorial-action" id="tutorial-action" label={state.actionLabel} left={state.actionLeft} bottom={state.actionBottom} w={state.actionW} h={state.actionH} font={state.actionFont} display={state.actionDisplay} onClick={() => (state.actionGrab ? props.onGrab?.() : props.onNext())} />
      <TapHand name="mobile-tutorial-hand" left={state.handLeft} bottom={state.handBottom} w={state.handW} h={state.handH} display={state.handDisplay} />
    </UiEntity>
  )
}

// The word strip at the bottom: Cubby's line while he talks, the mission (letter cube, step count) while you play.
function Strip(props: { onNext: () => void }) {
  const talk = state.mode === 'talk'
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
      <CubbyStrip left={state.stripLeft} bottom={state.stripBottom} w={state.stripW} h={state.stripH} />
      <UiEntity
        key="mobile-tutorial-strip"
        uiTransform={{ positionType: 'absolute', position: { left: state.stripLeft, bottom: state.stripBottom }, width: state.stripW, height: state.stripH, padding: { left: state.stripPadL, right: state.stripPadR }, flexDirection: 'row', alignItems: 'center', pointerFilter: talk ? 'block' : 'none' }}
        onMouseDown={() => { if (talk && state.actionDisplay === 'flex') props.onNext() }}
      >
        <UiEntity uiTransform={{ width: state.goalSize, height: state.goalSize, margin: { right: Math.round(state.goalSize / 4) }, display: state.goalDisplay, pointerFilter: 'none' }}>
          <LetterTile size={state.goalSize} letter={state.goalLetter} state="locked" index={0} />
        </UiEntity>
        <Label value={state.copy} font="sans-serif" fontSize={state.stripFont} color={PAL.ink} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: state.stripTextW, height: state.stripTextH }} />
        <UiEntity uiTransform={{ width: state.chipW, height: state.chipH, margin: { left: Math.round(state.chipH / 4) }, display: talk ? 'none' : 'flex', pointerFilter: 'none' }}>
          <Frame width={state.chipW} height={state.chipH} edge={PAL.outline} fill={PAL.violet} radius={state.chipH / 2} border={2} align="center" justify="center">
            <Label value={state.stepLabel} font="sans-serif" fontSize={state.chipFont} color={PAL.text} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
          </Frame>
        </UiEntity>
      </UiEntity>
      <NameTab name={state.tabName} left={state.tabLeft} bottom={state.tabBottom} w={state.tabW} h={state.tabH} font={state.tabFont} />
      <UiEntity key="mobile-tutorial-dots" uiTransform={{ positionType: 'absolute', position: { left: state.dotsLeft, bottom: state.dotsBottom }, width: state.chapters * (state.dotW + state.dotGap), height: state.dotH, flexDirection: 'row', display: talk ? 'flex' : 'none', pointerFilter: 'none' }}>
        {Array.from({ length: state.chapters }, (_, i) => (
          <UiEntity key={`dot-${i}`} uiTransform={{ width: state.dotW, height: state.dotH, margin: { right: state.dotGap }, borderRadius: state.dotH / 2, pointerFilter: 'none' }} uiBackground={{ color: i <= state.chapter ? PAL.violet : PAL.cream }} />
        ))}
      </UiEntity>
    </UiEntity>
  )
}

// ---- Cubby's dialogue widgets, shared with the NPC replay prompt (client/ui/hud.tsx) ----
// Built from the UI kit like the rest of the HUD: the cartoon card (Frame), candy buttons (PillButton) and the kit's
// hand. All placed absolutely in virtual px by the caller.

/** Rim thickness shared by every tutorial card, so strip, tab and party card match. */
export const rimOf = (h: number) => Math.max(4, Math.round(h * 0.07))

// Cubby's strip: a cream cartoon card in the violet frame.
export function CubbyStrip(props: { left: number; bottom: number; w: number; h: number }) {
  return (
    <UiEntity key="crisp-strip" uiTransform={{ positionType: 'absolute', position: { left: props.left, bottom: props.bottom }, width: props.w, height: props.h, pointerFilter: 'none' }}>
      <Frame width={props.w} height={props.h} edge={PAL.violet} fill={PAL.cream} radius={Math.round(Math.min(props.h * 0.28, 44))} border={rimOf(props.h)} />
    </UiEntity>
  )
}

// The speaker's name: a violet cartoon pill on the strip's top edge, white outlined text like the HUD's titles.
export function NameTab(props: { name: string; left: number; bottom: number; w: number; h: number; font: number }) {
  return (
    <UiEntity key="talk-tab" uiTransform={{ positionType: 'absolute', position: { left: props.left, bottom: props.bottom }, width: props.w, height: props.h, pointerFilter: 'none' }}>
      <Frame width={props.w} height={props.h} edge={PAL.violetLight} fill={PAL.violet} radius={props.h / 2} border={Math.max(4, Math.round(props.h * 0.12))} align="center" justify="center">
        <OutlineLabel value={props.name} fontSize={props.font} color={PAL.text} width="100%" height={props.h - 2 * Math.max(4, Math.round(props.h * 0.12))} />
      </Frame>
    </UiEntity>
  )
}

/** The kit's candy buttons: violet for the main action (green blends into the grassy world), cream for the quieter choice. */
export const BUTTON_ASPECT = 2.6
export function CartoonButton(props: { id: string; name?: string; variant?: 'primary' | 'secondary'; label: string; left: number; bottom: number; w: number; h: number; font: number; display?: 'flex' | 'none'; onClick: () => void }) {
  return (
    <UiEntity key={props.name ?? props.id} uiTransform={{ positionType: 'absolute', position: { left: props.left, bottom: props.bottom }, width: props.w, height: props.h, display: props.display ?? 'flex', pointerFilter: 'none' }}>
      <PillButton id={props.id} label={props.label} width={props.w} height={props.h} font={props.font} tint={props.variant === 'secondary' ? PAL.cream : PAL.violetLight} onClick={props.onClick} />
    </UiEntity>
  )
}

/** The kit's tapping hand: cream with the dark outline (184x216 art: always draw it at HAND_ASPECT). */
export const HAND_ASPECT = 184 / 216
export function TapHand(props: { name?: string; left: number; bottom: number; w: number; h: number; display?: 'flex' | 'none' }) {
  return <UiEntity key={props.name ?? 'tap-hand'} uiTransform={{ positionType: 'absolute', position: { left: props.left, bottom: props.bottom }, width: props.w, height: props.h, display: props.display ?? 'flex', pointerFilter: 'none' }} uiBackground={{ texture: { src: HAND }, textureMode: 'stretch' }} />
}

// Word complete: the cartoon card over a dim that reaches past the device safe area (scene UI
// is kept inside that area but not clipped to it), the button riding its bottom edge.
function PartyPanel() {
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
      <UiEntity key="party-dim" uiTransform={{ positionType: 'absolute', position: { left: -state.bleed, top: -state.bleed }, width: state.dimW, height: state.dimH, pointerFilter: 'none' }} uiBackground={{ color: DIM }} />
      <UiEntity key="party-panel" uiTransform={{ positionType: 'absolute', position: { left: state.panelLeft, top: state.panelTop }, width: state.panelW, height: state.panelH, pointerFilter: 'block' }}>
        <Frame width={state.panelW} height={state.panelH} edge={PAL.violet} fill={PAL.cream} radius={Math.round(state.panelH * 0.12)} border={rimOf(state.panelH / 2.5)} pad={0} align="center" block>
          <UiEntity uiTransform={{ width: '100%', height: '100%', padding: { top: state.panelPadTop, left: state.panelPadSide, right: state.panelPadSide }, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
            <OutlineLabel value={state.partyTitle} fontSize={state.partyTitleFont} color={PAL.yellow} width="100%" height={state.partyTitleH} />
            <UiEntity key="party-word" uiTransform={{ width: '100%', height: state.partyTile + state.panelGap, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', pointerFilter: 'none' }}>
              <UiEntity uiTransform={{ width: state.partyTile, height: state.partyTile, margin: { left: state.panelGap / 2, right: state.panelGap / 2, bottom: state.hop0 }, pointerFilter: 'none' }}><LetterTile size={state.partyTile} letter={state.word0} state="locked" index={0} /></UiEntity>
              <UiEntity uiTransform={{ width: state.partyTile, height: state.partyTile, margin: { left: state.panelGap / 2, right: state.panelGap / 2, bottom: state.hop1 }, pointerFilter: 'none' }}><LetterTile size={state.partyTile} letter={state.word1} state="locked" index={1} /></UiEntity>
              <UiEntity uiTransform={{ width: state.partyTile, height: state.partyTile, margin: { left: state.panelGap / 2, right: state.panelGap / 2, bottom: state.hop2 }, pointerFilter: 'none' }}><LetterTile size={state.partyTile} letter={state.word2} state="locked" index={2} /></UiEntity>
            </UiEntity>
            <Label value={state.copy} font="sans-serif" fontSize={state.partyFont} color={PAL.ink} textWrap="wrap" textAlign="middle-center" uiTransform={{ width: '100%', height: state.partyTextH, margin: { top: state.panelGap / 2 } }} />
          </UiEntity>
        </Frame>
      </UiEntity>
    </UiEntity>
  )
}
