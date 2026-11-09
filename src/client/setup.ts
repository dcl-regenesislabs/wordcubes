import { engine, inputSystem, InputAction, PointerEventType, TouchScreenControls } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { room } from '../shared/messages'
import { myState } from './gamestate'
import { buildSlots, clearSlots, disableArenaPassports, setSlotClickHandler } from './arena'
import { resetFrames, lockFrame, failFrames, winFrames, framesSystem } from './frames'
import { cubesSystem, isHolding, setWordLength } from './cubes'
import { predictSystem } from './predict'
import { playThrowEmote } from './emotes'
import { cs, showMessage, showPowerupToast, lockoutLeft } from './state'
import { breakHeld, tossHeld } from './actions'
import { grassSystem } from './grass'
import { setupUi } from './ui'
import { setupLobby, onEntered, onEjected } from './lobby'
import { mobile } from './ui/platform'
import { dbg, showGame } from './ui/debug'
import { UI_PREVIEW } from '../config'
import { TOUCH_CONTROLS_DEBUG } from '../config'
import { setupFx } from './fx'
import { setupNpcs, spawnArenaVendor } from './npcs'
import { arenaSystem, setArenaVendorFactory } from './arenas'
import { rankTagSystem } from './ranktags'
import { leaderboardSystem } from './leaderboard'
import { setupCheats } from './cheats'
import { SFX, playSfx, preloadSfx, audioSystem, onCoins } from './audio'
import { connectionSystem, serverReady, setupConnection } from './connection'
import { cubeNetSystem, setupCubeNet } from './cubenet'
import { netStatsSystem, setupNetStats } from './netstats'
import { NET_STATS } from '../config'

const HOLD_TIPS_STICKY = 3
let holdTips = 0 // how many sticky "Holding" tips you have had this session
let stickySawHold = false // the grab reached us (the tip can arrive a frame before the cube's synced state)
let stickyAge = 0
let lastRound = -1
let lastLength = -1
let lastGame = -1

function useHint() {
  room.send('hint', { n: 0 })
}
export { useHint }

function clientSystem(dt: number) {
  disableArenaPassports()

  if (!cs.myAddress) {
    const p = getPlayer()
    if (p) cs.myAddress = p.userId.toLowerCase()
  }
  connectionSystem(dt) // sends 'join' until the server answers; freezes you and hides the HUD until then
  if (!serverReady()) return

  // keep the frame row in step with the server's word
  const g = myState()
  if (cs.game !== lastGame) {
    lastGame = cs.game
    lastRound = -1
    lastLength = -1
    if (cs.game < 0) {
      clearSlots()
      resetFrames() // forget the frames that were just removed
    }
  }
  if (g) {
    setWordLength(g.length)
    if (g.round !== lastRound || g.length !== lastLength) {
      lastRound = g.round
      lastLength = g.length
      if (g.length > 0) {
        buildSlots(g.length)
        resetFrames()
      } else {
        clearSlots()
        resetFrames()
      }
    }
  }

  const inGame = showGame() // UI_PREVIEW: the debug bar's screen decides, so the native buttons match it
  const hasItems = Object.values(cs.items).some((n) => n > 0)
  if (!inGame || !hasItems) cs.itemsOpen = false
  if (!inGame) cs.confirmLeave = false
  syncTouchButtons(inGame && (isHolding() || (UI_PREVIEW && dbg.screen === 'holding')), inGame, inGame && hasItems)
  audioSystem(dt)
  cubeNetSystem(dt) // your game's cubes from the server's messages, before anything reads them
  cubesSystem(dt)
  predictSystem(dt) // your own pushes move cubes right away, before the server confirms them
  framesSystem(dt)

  if (cs.messageSticky) {
    stickyAge += dt
    if (isHolding()) stickySawHold = true
    // gone once the cube left your hands, or if the grab never shows up (rejected, or you left the game)
    if ((stickySawHold && !isHolding()) || (!stickySawHold && stickyAge > 3) || !cs.inGame) {
      cs.messageSticky = false
      cs.message = ''
    }
  }
  if (cs.messageTime > 0) {
    cs.messageTime -= dt
    if (cs.messageTime <= 0) cs.message = ''
  }

  // Phones only (the HUD has these buttons on desktop): 2 = items in a game / how to play in the lobby, 3 = settings,
  // 4 = back to lobby (in a game)
  if (mobile()) {
    // 2 opens your items in a game (How to play is in Settings there), How to play in the lobby
    if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) {
      if (showGame()) cs.itemsOpen = !cs.itemsOpen
      else cs.showHowTo = true
    }
    if (inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) cs.showSettings = true
    // back to lobby asks first: a tap by mistake would give your seat away mid-round
    if (cs.inGame && inputSystem.isTriggered(InputAction.IA_ACTION_6, PointerEventType.PET_DOWN)) cs.confirmLeave = true
  }

  // E = break held cube, F = throw it away, 1 = hint (game only, not in the lobby)
  if (!cs.inGame) return
  if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) breakHeld()
  if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) tossHeld()
  if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) useHint()
}

// Phones: the native buttons replace the HUD's buttons, each with a cartoon icon. E (break) and F (throw away) show
// while you hold a cube; 1 (hint) and 4 (back to lobby) while you are in a game; 3 (settings) always. 2 is How to play
// in the lobby and, in a game, your items (shown only when you carry some): How to play moves into Settings there.
// Interact and jump stay. TouchScreenControls does nothing on desktop (Unity or Bevy): their HUD is unchanged.
const TOUCH_ICONS: Partial<Record<InputAction, string>> = {
  [InputAction.IA_PRIMARY]: 'assets/images/ui/cartoon-break.png',
  [InputAction.IA_SECONDARY]: 'assets/images/ui/cartoon-toss.png',
  [InputAction.IA_ACTION_3]: 'assets/images/ui/cartoon-hint.png',
  [InputAction.IA_ACTION_4]: 'assets/images/ui/cartoon-howto.png',
  [InputAction.IA_ACTION_5]: 'assets/images/ui/cartoon-settings.png',
  [InputAction.IA_ACTION_6]: 'assets/images/ui/cartoon-lobby.png'
}
const ITEMS_ICON = 'assets/images/ui/cartoon-powerups.png'
let touchShown = ''
function syncTouchButtons(holding: boolean, inGame: boolean, items: boolean) {
  const key = `${holding}:${inGame}:${items}`
  if (key === touchShown) return
  touchShown = key
  const shown = new Set<InputAction>([InputAction.IA_ACTION_5])
  if (holding) shown.add(InputAction.IA_PRIMARY).add(InputAction.IA_SECONDARY)
  if (inGame) shown.add(InputAction.IA_ACTION_3).add(InputAction.IA_ACTION_6)
  if (!inGame || items) shown.add(InputAction.IA_ACTION_4)
  const icons = { ...TOUCH_ICONS }
  if (inGame) icons[InputAction.IA_ACTION_4] = ITEMS_ICON
  const buttons = [
    InputAction.IA_PRIMARY,
    InputAction.IA_SECONDARY,
    InputAction.IA_ACTION_3,
    InputAction.IA_ACTION_4,
    InputAction.IA_ACTION_5,
    InputAction.IA_ACTION_6
  ]
  if (TOUCH_CONTROLS_DEBUG) for (const b of buttons) shown.add(b)
  TouchScreenControls.createOrReplace(engine.RootEntity, {
    touchInputs: buttons.map((inputAction) => {
      const src = icons[inputAction]
      return {
        inputAction,
        hide: !shown.has(inputAction),
        icon: src ? { tex: { $case: 'texture' as const, texture: { src } } } : undefined
      }
    }),
    hideJoystick: false,
    hideCrosshair: false
  })
}

export function initClient() {
  syncTouchButtons(false, false, false)
  preloadSfx()
  setupConnection()
  setupCubeNet()
  if (NET_STATS) {
    setupNetStats()
    engine.addSystem(netStatsSystem, 1, 'word-cubes-net-stats') // runs while connecting too
  }
  setupUi()
  setupLobby()
  setupFx()
  setupNpcs()
  setArenaVendorFactory(spawnArenaVendor)
  setupCheats()

  setSlotClickHandler((slot) => {
    if (!isHolding()) return showMessage('Grab a cube first (click it), then click a frame.', 2)
    if (lockoutLeft() > 0) return showMessage(`Locked out: ${lockoutLeft()}s left before you can place again.`, 2)
    playThrowEmote()
    playSfx(SFX.throw)
    room.send('place', { slot })
  })

  room.onMessage('toast', (d) => {
    if (d.kind === 'powerup') return showPowerupToast(d.text)
    // Phones: the server's "Holding X. ..." tip stays on screen until you place, break or toss that cube, for your first
    // HOLD_TIPS_STICKY grabs, so there is time to read it. After that, and for every other message, the usual 3 s.
    if (mobile() && d.text.startsWith('Holding ') && holdTips < HOLD_TIPS_STICKY) {
      holdTips++
      showMessage(d.text, 0) // 0: no countdown, cleared in clientSystem when the cube leaves your hands
      cs.messageSticky = true
      stickySawHold = false
      stickyAge = 0
      return
    }
    cs.messageSticky = false
    showMessage(d.text, 3)
  })
  room.onMessage('entered', (d) => onEntered(d.game, d.ok === 1))
  room.onMessage('eject', () => onEjected())
  room.onMessage('coins', (d) => {
    onCoins(d.value)
    cs.coins = d.value
  })
  room.onMessage('fx', (d) => {
    if (d.kind === 'lock') {
      lockFrame(d.slot)
      playSfx(SFX.lock)
    } else if (d.kind === 'fail') {
      failFrames()
      playSfx(SFX.fail)
    } else if (d.kind === 'win') {
      winFrames()
      playSfx(SFX.win)
    }
  })

  engine.addSystem(clientSystem, 1, 'word-cubes-client')
  engine.addSystem(arenaSystem, 1, 'word-cubes-arenas')
  engine.addSystem(grassSystem, 1, 'word-cubes-grass')
  engine.addSystem(rankTagSystem, 1, 'word-cubes-rank-tags')
  engine.addSystem(leaderboardSystem, 1, 'word-cubes-leaderboard')
}
