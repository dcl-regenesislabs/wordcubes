const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

// client/actions.ts with the real client state and doubles for the engine and the network
function harness() {
  const config = loadTs('src/config.ts')
  const state = loadTs('src/client/state.ts', { '../config': config })
  const sent = []
  const noop = () => {}
  const actions = loadTs('src/client/actions.ts', {
    '@dcl/sdk/ecs': { engine: { PlayerEntity: 1 }, Transform: { getOrNull: () => null, get: () => ({ position: { x: 0, y: 0, z: 0 } }) } },
    '@dcl/sdk/math': { Vector3: { distance: () => 0 } },
    '../config': config,
    '../shared/messages': { room: { send: (name, data) => sent.push({ name, data }) } },
    '../shared/schemas': { CubeData: { get: () => ({ mode: 'free' }) } },
    '../shared/env': { envOrigin: () => ({ x: 0, y: 0, z: 0 }) },
    './cubes': { isHolding: () => false },
    './cubenet': { cubeEntity: () => undefined, guessMode: noop, myHeldCubeId: () => -1, slotTaken: () => false },
    './gamestate': { myState: () => ({ phase: 'playing', masked: '___' }) },
    './state': state,
    './audio': { SFX: {}, playSfx: noop },
    './emotes': { playThrowEmote: noop },
    './i18n': { t: (key) => key },
    './ui/platform': { mobile: () => false },
    '../shared/tutorial': loadTs('src/shared/tutorial.ts'),
    './practice': { grabLocalCube: noop, placeLocalCube: noop, localLetterCube: () => -1 }
  })
  return { actions, state, sent }
}

test('a grab while locked out never leaves the client: the banner hops instead', () => {
  const h = harness()
  h.state.cs.lockoutUntil = Date.now() + 10000
  h.actions.grabCube(7)
  assert.equal(h.sent.length, 0, 'no grab sent for the server to refuse')
  assert.ok(h.state.cs.lockoutPing > 0, 'the banner gets its hop')
  assert.equal(h.state.cs.message, '', 'no toast repeating the banner')
})

test('a lockout is left behind with the game it belongs to', () => {
  const h = harness()
  h.state.cs.lockoutUntil = Date.now() + 10000
  h.state.cs.lockoutTotal = 25
  h.state.clearLockout() // setup.ts calls it whenever the game you sit in changes (lobby, another game)
  assert.equal(h.state.lockoutLeft(), 0)
  h.actions.grabCube(7)
  assert.deepEqual(h.sent.map((m) => m.name), ['grab'], 'grabs work again in the next game')
})
