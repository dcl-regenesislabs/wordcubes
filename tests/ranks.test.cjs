const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

test('rank labels merge every synced page, update later pages, and clear departed players', () => {
  const pages = new Map([[1, { data: 'alice:200,bob:450' }], [2, { data: 'carol:800' }]])
  const ranks = loadTs('src/client/ranktags.ts', {
    '@dcl/sdk/ecs': { engine: { getEntitiesWith: () => pages.entries() } },
    '@dcl/sdk/math': { Color4: { create() {} } },
    '../shared/schemas': {}, './ui/rank': {}, './state': {}
  }, 'exports.readRatings = readRatings')
  ranks.readRatings()
  assert.equal(ranks.ratingOf('ALICE'), 200)
  assert.equal(ranks.ratingOf('carol'), 800)
  pages.get(2).data = 'carol:950'
  ranks.readRatings()
  assert.equal(ranks.ratingOf('carol'), 950, 'an unchanged first page cannot hide later updates')
  pages.delete(2)
  ranks.readRatings()
  assert.equal(ranks.ratingOf('carol'), 0)
  pages.clear()
  ranks.readRatings()
  assert.equal(ranks.ratingOf('alice'), 0)
})
