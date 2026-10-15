import { engine, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { isStateSyncronized } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { GameState } from '../shared/schemas'
import { buildSlots, disableArenaPassports, setSlotClickHandler } from './arena'
import { resetFrames, lockFrame, failFrames, winFrames, framesSystem } from './frames'
import { cubesSystem, isHolding, setWordLength } from './cubes'
import { predictSystem } from './predict'
import { playThrowEmote, stopHoldEmote } from './emotes'
import { cs, showMessage, lockoutLeft } from './state'
import { grassSystem } from './grass'
import { setupUi } from './ui'
import { setupLobby } from './lobby'
import { setupFx } from './fx'
import { setupNpcs } from './npcs'
import { rankTagSystem } from './ranktags'

let joined = false
let lastRound = -1
let lastLength = -1

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
  for (const [, g] of engine.getEntitiesWith(GameState)) {
    setWordLength(g.length)
    if (g.round !== lastRound || g.length !== lastLength) {
      lastRound = g.round
      lastLength = g.length
      if (g.length > 0) {
        buildSlots(g.length)
        resetFrames()
      }
    }
    break
  }

  cubesSystem(dt)
  predictSystem(dt) // your own pushes move cubes right away, before the server confirms them
  framesSystem(dt)

  if (cs.messageTime > 0) {
    cs.messageTime -= dt
    if (cs.messageTime <= 0) cs.message = ''
  }

  // E = break held cube, F = throw it away, 1 = hint (game only, not in the lobby)
  if (!cs.inGame) return
  if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) {
    if (isHolding()) {
      stopHoldEmote()
      room.send('breakCube', { n: 0 })
    } else showMessage('Nothing to break. Click a cube to grab it first.', 2)
  }
  if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN) && isHolding()) {
    playThrowEmote()
    room.send('toss', { n: 0 })
  }
  if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) useHint()
}

export function initClient() {
  setupUi()
  setupLobby()
  setupFx()
  setupNpcs()

  setSlotClickHandler((slot) => {
    if (!isHolding()) return showMessage('Grab a cube first (click it), then click a frame.', 2)
    if (lockoutLeft() > 0) return showMessage(`Locked out: ${lockoutLeft()}s left before you can place again.`, 2)
    playThrowEmote()
    room.send('place', { slot })
  })

  room.onMessage('toast', (d) => showMessage(d.text, 3))
  room.onMessage('coins', (d) => {
    cs.coins = d.value
  })
  room.onMessage('fx', (d) => {
    if (d.kind === 'lock') lockFrame(d.slot)
    else if (d.kind === 'fail') failFrames()
    else if (d.kind === 'win') winFrames()
  })

  engine.addSystem(clientSystem, 1, 'word-cubes-client')
  engine.addSystem(grassSystem, 1, 'word-cubes-grass')
  engine.addSystem(rankTagSystem, 1, 'word-cubes-rank-tags')
}
