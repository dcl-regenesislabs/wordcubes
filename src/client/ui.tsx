import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'
import { GameState } from '../shared/schemas'
import { setupUi as renderHud } from '../ui'
import { state } from '../ui/WordCubesHud'
import { state as desktop } from '../ui/DesktopHud'
import { cs } from './state'
import { hudLayout } from './ui-layout'
import { setupTouchControls } from './touch-controls'
import { heldLetter } from './cubes'
import { runtimeHud, setupRuntimeHud } from './runtime-hud'

function updateHud() {
  const mobile = isMobile()
  const layout = hudLayout(UiCanvasInformation.getOrNull(engine.RootEntity), mobile)
  Object.assign(state, layout)
  Object.assign(desktop, layout)
  Object.assign(runtimeHud, layout, {
    mobile,
    mask: '',
    hint: '',
    message: cs.message
  })
  let game = null
  for (const [, value] of engine.getEntitiesWith(GameState)) {
    game = value
    break
  }
  state.question = game ? game.question : 'Connecting...'
  state.questionFont = Math.min(layout.questionFont, layout.contentWidth / Math.max(state.question.length * 0.55, 1))
  // Hints share the word row with placed letters instead of adding another overlay.
  state.word = game
    ? game.masked.split('').map((letter, i) => letter === '_' ? game.hint[i] || '_' : letter).join(' ')
    : ''
  state.wordFont = Math.min(layout.wordFont, layout.contentWidth / Math.max(state.word.length, 1) * 1.5)
  runtimeHud.mask = game?.masked || ''
  runtimeHud.hint = game?.hint || ''
  if (!mobile) state.word = '' // Desktop renders native text in individual word cells.
  const held = heldLetter()
  desktop.coins = `${cs.coins} coins`
  desktop.round = game ? `Round ${game.round} / Done ${game.completed}` : 'Waiting for round'
  desktop.holding = held ? `Holding ${held}` : 'Hands empty'
  desktop.instruction = held ? `Click a frame to place ${held}` : 'Click a cube to grab it'
}

export function setupUi() {
  setupTouchControls()
  updateHud()
  renderHud()
  setupRuntimeHud()
  engine.addSystem(updateHud, 2, 'word-cubes-hud')
}
