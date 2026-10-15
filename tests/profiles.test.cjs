const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')
const flush = () => new Promise(setImmediate)

function harness(get = async () => undefined) {
  const writes = []
  const Storage = { player: { get, set: (address, key, value) => new Promise((resolve, reject) => {
    writes.push({ address, value, resolve, reject })
  }) } }
  return { profiles: loadTs('src/server/profiles.ts', { '@dcl/sdk/server': { Storage } }), writes }
}

test('rejoining during a departure save preserves the live profile and subsequent changes', async () => {
  const { profiles: p, writes } = harness()
  const profile = await p.retain('alice')
  profile.coins = 100
  p.touch('alice')
  p.release('alice')
  assert.equal(await p.retain('alice'), profile)
  profile.coins += 25
  profile.items.bomb = 1
  p.touch('alice')
  assert.equal(writes[0].value.coins, 100)
  assert.equal(writes[0].value.items.bomb, undefined)
  p.saveSome()
  assert.equal(writes.length, 1, 'same-wallet writes must not overlap')
  writes[0].resolve(true)
  await flush()
  assert.equal(p.profileOf('alice'), profile)
  p.saveSome()
  assert.equal(writes[1].value.coins, 125)
  writes[1].resolve(true)
  await flush()
  assert.equal(p.profileOf('alice'), profile)
  p.release('alice')
  assert.equal(p.profileOf('alice'), undefined)
})

for (const failure of ['false', 'reject']) test(`departure save ${failure} retains dirty data and retries`, async () => {
  const { profiles: p, writes } = harness()
  const profile = await p.retain('alice')
  profile.rating = 220
  p.touch('alice')
  p.release('alice')
  if (failure === 'false') writes[0].resolve(false)
  else writes[0].reject(new Error('storage unavailable'))
  await flush()
  assert.equal(p.profileOf('alice'), profile)
  p.saveSome()
  assert.equal(writes[1].value.rating, 220)
  writes[1].resolve(true)
  await flush()
  assert.equal(p.profileOf('alice'), undefined)
})

test('leaving during load and rejoining before it completes keeps the loaded profile pinned', async () => {
  let resolveRead
  const { profiles: p } = harness(() => new Promise(resolve => { resolveRead = resolve }))
  const first = p.retain('alice')
  p.release('alice')
  const second = p.retain('alice')
  resolveRead({ coins: 90 })
  assert.equal(await first, await second)
  await flush()
  assert.equal(p.profileOf('alice').coins, 90)
})

test('failed reads never overwrite saved data and can recover after leaving', async () => {
  let fail = true
  const { profiles: p, writes } = harness(async () => {
    if (fail) throw new Error('simulated read failure')
    return { coins: 350 }
  })
  const profile = await p.retain('alice')
  profile.coins = 5
  p.touch('alice')
  p.release('alice')
  p.saveSome()
  assert.equal(writes.length, 0)
  fail = false
  const recovered = await p.retain('alice')
  assert.equal(recovered.coins, 350)
  p.touch('alice')
  p.saveSome()
  assert.equal(writes.length, 1)
  writes[0].resolve(true)
  await flush()
})
