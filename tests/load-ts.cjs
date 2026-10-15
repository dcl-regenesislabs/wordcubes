const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const ts = require('typescript')

// Run real scene modules while replacing the SDK/network boundaries with deterministic test doubles.
exports.loadTs = function loadTs(file, mocks = {}, extra = '') {
  file = path.resolve(__dirname, '..', file)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.React, jsxFactory: 'ReactEcs.createElement'
  } }).outputText
  const module = { exports: {} }
  const localRequire = createRequire(file)
  const requireMock = id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id)
  vm.runInNewContext(code + '\n' + extra, { module, exports: module.exports, require: requireMock, console, Date, Promise }, { filename: file })
  return module.exports
}
