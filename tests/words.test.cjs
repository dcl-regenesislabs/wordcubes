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

for (const l of lang.LANGS) {
  test(`the ${l} bank only uses plain A-Z (no Ñ, no accents), with no repeats and a clue for every word`, () => {
    const list = words.WORDS_BY_LANG[l]
    const letters = new Set(lang.ALPHABETS[l])
    const seen = new Set()
    for (const w of list) {
      assert.match(w.answer, /^[A-Z]+$/, `${w.answer} in ${l} is not plain A-Z`)
      assert.ok([...w.answer].every((ch) => letters.has(ch)), `${w.answer} has a letter the ${l} pile never drops`)
      assert.ok(w.question.length > 0, `${w.answer} has a clue`)
      assert.ok(w.answer.length <= 14, `${w.answer} fits the frames`)
      assert.ok(!seen.has(w.answer), `${w.answer} is listed twice`)
      seen.add(w.answer)
    }
    for (let level = 1; level <= 7; level++) {
      assert.ok(list.filter((w) => w.level === level).length >= 20, `${l} level ${level} has enough words`)
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
