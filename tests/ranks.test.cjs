const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

test('rank labels merge every synced page, update later pages, and clear departed players', () => {
  const pages = new Map([[1, { data: 'alice:200,bob:450' }], [2, { data: 'carol:800' }]])
  const ranks = loadTs('src/client/ranktags.ts', {
    '@dcl/sdk/ecs': { engine: { getEntitiesWith: () => pages.entries() } },
    '@dcl/sdk/math': { Color4: { create() {} } },
    '../shared/schemas': {}, './ui/rank': {}, './state': {}, '../config': {}, './i18n': { t: (key) => key }, './ui/platform': { mobile: () => false }
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

test('the rank table maps rank r to room level r + 1, as the rating model rates each level', () => {
  const config = loadTs('src/config.ts')
  const profiles = loadTs('src/server/profiles.ts', { '@dcl/sdk/server': { Storage: {} } })
  const rank = loadTs('src/client/ui/rank.ts', { '../../config': config })
  assert.equal(rank.RANK_NAMES.length, config.MAX_DIFFICULTY, 'one rank per room level')
  for (let level = 1; level <= config.MAX_DIFFICULTY; level++) {
    // the panel shows "Level {r + 1} rooms" on rank r's row
    assert.equal(rank.rankIndex(profiles.levelRating(level, config.RATING_PER_RANK)), level - 1)
  }
})
