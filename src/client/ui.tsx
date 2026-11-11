import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { cs } from './state'
import { UI_PREVIEW, NET_STATS } from '../config'
import { setupResponsiveUi } from './ui/platform'
import { ConnectingGate, GameHud, ItemsRow, ConfirmLeave, LobbyHud, LobbyMessage, PadCard, HowToPlay, NpcDialog, ShopPanel, SettingsPanel, setupHudMessages, updateHud } from './ui/hud'
import { engine } from '@dcl/sdk/ecs'
import { DebugBar, applyDebug, showGame } from './ui/debug'
import { serverReady, connectingTooLong } from './connection'
import { NetMonitor } from './ui/netstats'
import { TutorialOverlay } from '../ui/TutorialOverlay'
import { nextTutorial } from './tutorial'
import { grabTutorialCube } from './actions'

// The UI canvas depends on the device (1920x1080 desktop, 1600x720 x pixel ratio on phones): setupResponsiveUi sets
// the renderer up once and again as soon as the platform lookup answers.
export function setupUi() {
  setupHudMessages()
  engine.addSystem(updateHud, 1, 'word-cubes-hud')
  setupResponsiveUi(uiMenu)
}

// Coded (not UI-Designer-editable) HUD: everything comes from the server's synced state each frame.
// Pieces and look live in ./ui (theme = palette and shared widgets, hud = the screens).
export const uiMenu = () => {
  applyDebug() // UI_PREVIEW only: the screen picked in the debug bar
  if (!serverReady() && !cs.tutorialActive && !UI_PREVIEW) {
    return (
      <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
        <ConnectingGate slow={connectingTooLong()} />
        {NET_STATS && <NetMonitor />}
      </UiEntity>
    )
  }
  const inGame = showGame()
  if (cs.tutorialActive) return <TutorialOverlay onNext={nextTutorial} onGrab={grabTutorialCube} />
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
      {!inGame && !cs.dialog && <PadCard />}
      {!inGame && <LobbyHud />}
      {!inGame && !cs.dialog && <LobbyMessage />}
      {inGame && <GameHud />}
      {inGame && <ItemsRow />}
      {cs.showHowTo && <HowToPlay />}
      {cs.dialog && <NpcDialog />}
      {cs.shop && <ShopPanel />}
      {cs.showSettings && <SettingsPanel />}
      {inGame && <ConfirmLeave />}
      {UI_PREVIEW && <DebugBar />}
      {NET_STATS && <NetMonitor />}
    </UiEntity>
  )
}
