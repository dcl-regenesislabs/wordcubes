const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

// Every language's bank (src/server/words*.ts), checked the way the game uses it.
const lang = loadTs('src/shared/lang.ts')
const words = loadTs('src/server/words.ts', {
  '../shared/lang': lang,
  './words_es': loadTs('src/server/words_es.ts'),
  './words_pt': loadTs('src/server/words_pt.ts')
})

const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
// answer length per difficulty level (1 easy .. 7 hard)
const RANGES = { 1: [3, 5], 2: [5, 6], 3: [5, 7], 4: [6, 8], 5: [7, 10], 6: [8, 11], 7: [7, 14] }

for (const l of lang.LANGS) {
  test(`the ${l} bank only uses plain A-Z (no Ñ, no accents), with no repeats and a clue for every word`, () => {
    const list = words.WORDS_BY_LANG[l]
    const letters = new Set(lang.ALPHABETS[l])
    const seen = new Set()
    const clues = new Map()
    for (const w of list) {
      assert.match(w.answer, /^[A-Z]+$/, `${w.answer} in ${l} is not plain A-Z`)
      assert.ok([...w.answer].every((ch) => letters.has(ch)), `${w.answer} has a letter the ${l} pile never drops`)
      assert.ok(w.question.length > 0, `${w.answer} has a clue`)
      assert.ok(w.answer.length <= 14, `${w.answer} fits the frames`)
      assert.ok(!seen.has(w.answer), `${w.answer} is listed twice`)
      seen.add(w.answer)
      // a clue that spells out its answer gives the round away
      // ...and so does its root: no clue holds the first 5 letters of its answer (destornillador / TORNILLO)
      const root = w.answer.slice(0, 5)
      assert.ok(!fold(w.question).includes(root), `${w.answer}'s clue contains its answer or its root ${root}`)
      // two answers with one clue leave only the frame count to tell them apart, and a wrong guess collapses the word
      const clue = fold(w.question).replace(/[^A-Z]/g, '')
      assert.ok(!clues.has(clue), `${w.answer} has the same clue as ${clues.get(clue)}`)
      clues.set(clue, w.answer)
    }
    // word length is the main difficulty dial, so each level keeps its range
    for (let level = 1; level <= 7; level++) {
      const at = list.filter((w) => w.level === level)
      assert.ok(at.length >= 100, `${l} level ${level} has at least 100 words`)
      const [lo, hi] = RANGES[level]
      for (const w of at) assert.ok(w.answer.length >= lo && w.answer.length <= hi, `${w.answer} is ${w.answer.length} letters at level ${level} (${lo}-${hi})`)
    }
  })

  test(`pickWord picks from the ${l} bank at the asked level`, () => {
    for (let i = 0; i < 20; i++) {
      const w = words.pickWord(3, '', l)
      assert.ok(words.WORDS_BY_LANG[l].includes(w))
      assert.equal(w.level, 3)
    }
  })
}
