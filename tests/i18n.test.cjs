const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadI18n } = require('./load-ts.cjs')

const i18n = loadI18n()
const { STRINGS, format } = i18n
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

test('Spanish and Portuguese have every English key, with the same {values}', () => {
  for (const lang of ['es', 'pt']) {
    for (const [key, en] of Object.entries(STRINGS.en)) {
      assert.ok(key in STRINGS[lang], `${lang} is missing ${key}`)
      assert.equal(placeholders(STRINGS[lang][key]), placeholders(en), `${lang} ${key} fills the same values`)
    }
    for (const key of Object.keys(STRINGS[lang])) assert.ok(key in STRINGS.en, `${lang} has ${key}, which English does not`)
  }
  for (const key of Object.keys(STRINGS.en)) if (key.endsWith('.mobile')) assert.ok(key.slice(0, -7) in STRINGS.en, `${key} has a base key`)
})

test('every key the code asks for exists', () => {
  const files = []
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f)
      if (fs.statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f) && !p.includes(path.join('shared', 'i18n'))) files.push(p)
    }
  }
  walk(path.resolve(__dirname, '..', 'src'))
  const used = new Set()
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\b(?:t|toast|toastTo|say|startRound|broadcastToast)\(\s*'([a-z][\w.]*)'/g)) used.add(m[1])
    for (const m of src.matchAll(/'@([a-z][\w.]*)'/g)) used.add(m[1])
  }
  assert.ok(used.size > 50, `found ${used.size} keys in the code`)
  for (const key of used) assert.ok(key in STRINGS.en, `the code uses ${key}, which is not in en.ts`)
})

test('values fill in, and @keys are translated too', () => {
  assert.equal(format('es', 'srv.noItem', { item: '@item.freeze.name' }), 'No tienes Congelar tiempo. El vendedor los vende.')
  assert.equal(format('pt', 'srv.broke', { letter: 'A', coins: 5 }), 'Quebrou A! +5 moedas')
  assert.equal(format('en', 'hud.help.held', {}, true), 'Tap a frame to place it', 'phones get the .mobile text')
  assert.equal(format('es', 'no.such.key'), 'no.such.key')
})
