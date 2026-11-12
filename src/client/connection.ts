// Gate the scene until the server is there: the player is frozen, the HUD is hidden and a "Connecting" card shows until
// the synced state has arrived (every game's GameState) and the server has answered 'join' with your profile.
// Without it a player whose connection failed could walk around a scene that looks fine but never works.
import { engine, InputModifier } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { GameState } from '../shared/schemas'
import { cs } from './state'
import * as C from '../config'

let ready = C.SKIP_SERVER_GATE
let profileSeen = false
let frozen = false
let waited = 0
let sinceJoin = Infinity

/** True once the server has answered; until then the HUD shows only the connecting card. */
export const serverReady = () => ready

/** Release a connection-owned freeze before the tutorial takes control of movement. */
export function releaseTutorialGate() {
  if (frozen) {
    frozen = false
    InputModifier.deleteFrom(engine.PlayerEntity)
  }
}

/** True after SERVER_GATE_HINT_SECONDS without an answer. */
export const connectingTooLong = () => !ready && waited >= C.SERVER_GATE_HINT_SECONDS

/** Every game's synced state is here (the late-join snapshot came through). */
function allGamesSynced(): boolean {
  let n = 0
  for (const [, game] of engine.getEntitiesWith(GameState)) if (game.game >= 0 && game.game < C.GAME_COUNT) n++
  return n >= C.GAME_COUNT
}

export function connectionSystem(dt: number) {
  if (ready) return
  waited += dt
  if (!frozen && !cs.tutorialActive) {
    frozen = true
    InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  }
  if (!isStateSyncronized() || !cs.myAddress) return
  // 'join' is a one-shot message: if it is lost, no profile ever comes back. Ask again until it does.
  sinceJoin += dt
  if (!profileSeen && sinceJoin >= C.JOIN_RETRY_SECONDS) {
    sinceJoin = 0
    room.send('join', { n: 0 })
  }
  if (!profileSeen || !allGamesSynced()) return
  ready = true
  if (!cs.tutorialActive && InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
  console.log('[CLIENT] connected to the server after', waited.toFixed(1), 's')
}

export function setupConnection() {
  room.onMessage('profile', () => {
    profileSeen = true
  })
}
