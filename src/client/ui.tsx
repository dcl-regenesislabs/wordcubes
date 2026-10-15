import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { cs } from './state'
import { UI_PREVIEW } from '../config'
import { resolvePlatform, canvas } from './ui/platform'
import { GameHud, LobbyHud, LobbyCountdown, HowToPlay, NpcDialog, ShopPanel, SettingsPanel, LeaderboardPanel, setupHudMessages, updateHud } from './ui/hud'
import { engine } from '@dcl/sdk/ecs'

// The UI canvas depends on the device (1920x1080 desktop, 1600x720 phone), so the renderer is set up once and
// again as soon as the platform lookup answers.
export function setupUi() {
  setupHudMessages()
  engine.addSystem(updateHud, 1, 'word-cubes-hud')
  ReactEcsRenderer.setUiRenderer(uiMenu, { ...canvas(), screenInset: 'interactable' })
  resolvePlatform(() => ReactEcsRenderer.setUiRenderer(uiMenu, { ...canvas(), screenInset: 'interactable' }))
}

// Coded (not UI-Designer-editable) HUD: everything comes from the server's synced state each frame.
// Pieces and look live in ./ui (theme = palette and shared widgets, hud = the screens).
export const uiMenu = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
    {cs.lobbyCountdown > 0 && <LobbyCountdown />}
    {!cs.inGame && !UI_PREVIEW && <LobbyHud />}
    {!cs.inGame && <LeaderboardPanel />}
    {(cs.inGame || UI_PREVIEW) && <GameHud />}
    {cs.showHowTo && <HowToPlay />}
    {cs.dialog && <NpcDialog />}
    {cs.shop && <ShopPanel />}
    {cs.showSettings && <SettingsPanel />}
  </UiEntity>
)
