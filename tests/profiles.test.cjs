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

// The modules run with the real Date: move its clock by hand for the retry waits.
function withClock(fn) {
  const real = Date.now
  let now = real()
  Date.now = () => now
  return Promise.resolve(fn((ms) => { now += ms })).finally(() => { Date.now = real })
}

test('a failed read caches nothing, never writes, and is retried while the player stays', () => withClock(async (advance) => {
  let fail = true
  let reads = 0
  const { profiles: p, writes } = harness(async () => {
    reads++
    if (fail) throw new Error('too many concurrent host calls')
    return { coins: 350 }
  })
  assert.equal(await p.retain('alice'), undefined, 'no empty stand-in profile')
  assert.equal(p.profileOf('alice'), undefined)
  p.touch('alice')
  p.saveSome()
  assert.equal(writes.length, 0, 'nothing to overwrite the saved profile with')
  assert.equal(await p.retain('alice'), undefined, 'waits before asking again')
  assert.equal(reads, 1)
  fail = false
  advance(1000)
  const profile = await p.retain('alice') // the server's housekeeping asks every second
  assert.equal(reads, 2)
  assert.equal(profile.coins, 350, 'the saved profile, not a fresh one')
  assert.equal(p.profileOf('alice'), profile)
}))

test('repeated failures wait longer each time', () => withClock(async (advance) => {
  let reads = 0
  const { profiles: p } = harness(async () => { reads++; throw new Error('storage unavailable') })
  await p.retain('alice')
  advance(1000); await p.retain('alice')
  assert.equal(reads, 2)
  advance(1000); await p.retain('alice')
  assert.equal(reads, 2, 'second wait is 2 s')
  advance(1000); await p.retain('alice')
  assert.equal(reads, 3)
  p.forgetFailures(new Set()) // gone: the next visit asks at once
  await p.retain('alice')
  assert.equal(reads, 4)
}))

test('a crowd arriving at once never has more than 10 profile reads in flight', async () => {
  const pending = []
  let peak = 0
  const { profiles: p } = harness(() => new Promise((resolve) => {
    pending.push(resolve)
    peak = Math.max(peak, pending.length)
  }))
  const loads = Array.from({ length: 50 }, (_, i) => p.retain('player' + i))
  assert.equal(pending.length, 10)
  while (pending.length) { pending.shift()({ coins: 1 }); await flush() }
  const all = await Promise.all(loads)
  assert.equal(peak, 10)
  assert.ok(all.every((x) => x && x.coins === 1), 'everyone gets their profile')
})
