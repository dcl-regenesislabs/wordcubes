const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

for (const action of ['playHoldEmote', 'playThrowEmote', 'stopHoldEmoteQuietly', 'stopHoldEmote']) {
  for (const response of [undefined, null, { success: true }, { success: false }, new Error('RPC failed')]) {
    test(`${action} handles ${response instanceof Error ? 'RPC rejection' : JSON.stringify(response)}`, async t => {
      const errors = t.mock.method(console, 'error', () => {})
      const calls = []
      const result = () => response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
      const emotes = loadTs('src/client/emotes.ts', {
        '@dcl/sdk/ecs': { AvatarMask: { AM_UPPER_BODY: 0 } },
        '~system/RestrictedActions': {
          triggerSceneEmote: args => { calls.push(args); return result() },
          stopEmote: () => { calls.push('stop'); return result() }
        },
        '../config': { HOLD_EMOTE: 'hold_emote.glb', THROW_EMOTE: 'throw_emote.glb' },
        '../shared/schemas': {}
      })
      emotes[action]()
      await new Promise(resolve => setImmediate(resolve))
      const shouldLog = response instanceof Error || response?.success === false
      assert.equal(errors.mock.callCount(), shouldLog ? calls.length : 0)
      if (action === 'playHoldEmote') assert.equal(calls[0].loop, true)
      if (action === 'playThrowEmote') assert.equal(calls[0].loop, false)
      if (action === 'stopHoldEmote') assert.deepEqual(calls.map(c => typeof c === 'string' ? c : c.src), ['stop', 'throw_emote.glb'])
    })
  }
}

test('clients without stopEmote still allow the throw fallback', () => {
  const calls = []
  const emotes = loadTs('src/client/emotes.ts', {
    '@dcl/sdk/ecs': { AvatarMask: { AM_UPPER_BODY: 0 } },
    '~system/RestrictedActions': { triggerSceneEmote: args => { calls.push(args); return Promise.resolve() } },
    '../config': { THROW_EMOTE: 'throw_emote.glb' }, '../shared/schemas': {}
  })
  emotes.stopHoldEmoteQuietly()
  emotes.stopHoldEmote()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].src, 'throw_emote.glb')
})
