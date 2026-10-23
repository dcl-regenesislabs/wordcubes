import { engine, inputSystem, InputAction, PointerEventType, TouchScreenControls } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { isStateSyncronized } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { myState } from './gamestate'
import { buildSlots, clearSlots, disableArenaPassports, setSlotClickHandler } from './arena'
import { resetFrames, lockFrame, failFrames, winFrames, framesSystem } from './frames'
import { cubesSystem, isHolding, setWordLength } from './cubes'
import { predictSystem } from './predict'
import { playThrowEmote } from './emotes'
import { cs, showMessage, lockoutLeft } from './state'
import { breakHeld, tossHeld } from './actions'
import { grassSystem } from './grass'
import { setupUi } from './ui'
import { setupLobby, onEntered, onEjected } from './lobby'
import { setupFx } from './fx'
import { setupNpcs, spawnArenaVendor } from './npcs'
import { arenaSystem, setArenaVendorFactory } from './arenas'
import { rankTagSystem } from './ranktags'
import { setupCheats } from './cheats'

let joined = false
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
  if (!joined && cs.myAddress && isStateSyncronized()) {
    joined = true
    room.send('join', { n: 0 })
  }

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

  syncTouchButtons(cs.inGame && isHolding())
  cubesSystem(dt)
  predictSystem(dt) // your own pushes move cubes right away, before the server confirms them
  framesSystem(dt)

  if (cs.messageTime > 0) {
    cs.messageTime -= dt
    if (cs.messageTime <= 0) cs.message = ''
  }

  // E = break held cube, F = throw it away, 1 = hint (game only, not in the lobby)
  if (!cs.inGame) return
  if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) breakHeld()
  if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) tossHeld()
  if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) useHint()
}

// Phones: the native E (break) and F (throw away) buttons only show while you hold a cube. The numbered buttons are
// never needed (hint is a HUD button); interact and jump stay.
let eAndFShown: boolean | null = null
function syncTouchButtons(holding: boolean) {
  if (holding === eAndFShown) return
  eAndFShown = holding
  const hidden = [InputAction.IA_ACTION_3, InputAction.IA_ACTION_4, InputAction.IA_ACTION_5, InputAction.IA_ACTION_6]
  if (!holding) hidden.push(InputAction.IA_PRIMARY, InputAction.IA_SECONDARY)
  TouchScreenControls.createOrReplace(engine.RootEntity, {
    touchInputs: hidden.map((inputAction) => ({ inputAction, hide: true })),
    hideJoystick: false,
    hideCrosshair: false
  })
}

export function initClient() {
  syncTouchButtons(false)
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
    room.send('place', { slot })
  })

  room.onMessage('toast', (d) => showMessage(d.text, 3))
  room.onMessage('entered', (d) => onEntered(d.game, d.ok === 1))
  room.onMessage('eject', () => onEjected())
  room.onMessage('coins', (d) => {
    cs.coins = d.value
  })
  room.onMessage('fx', (d) => {
    if (d.kind === 'lock') lockFrame(d.slot)
    else if (d.kind === 'fail') failFrames()
    else if (d.kind === 'win') winFrames()
  })

  engine.addSystem(clientSystem, 1, 'word-cubes-client')
  engine.addSystem(arenaSystem, 1, 'word-cubes-arenas')
  engine.addSystem(grassSystem, 1, 'word-cubes-grass')
  engine.addSystem(rankTagSystem, 1, 'word-cubes-rank-tags')
}
