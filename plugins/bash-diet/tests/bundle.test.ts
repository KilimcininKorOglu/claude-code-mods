import { describe, expect, test, tier } from 'claude-code/testing'

import type { FilterResult } from '../hooks/filters/common.ts'
import { planFor, runFilter } from '../hooks/pipeline.ts'

tier('user')

function planned(command: string, text: string, exitCode = 0): FilterResult {
  const plan = planFor(command)
  if (plan === undefined) throw new Error(`no plan for ${command}`)
  return runFilter(plan, text, exitCode, false)
}

// Captured from webpack 5.111, vite 8.3, rollup 4 and esbuild 0.25 in a scratch project of six modules.
const WEBPACK = 'asset main.js 5.76 KiB [emitted] [minimized] (name: main)\nasset 275.js 3.09 KiB [emitted] [minimized]\nasset 410.js 3.09 KiB [emitted] [minimized]\nruntime modules 6.89 KiB 9 modules\norphan modules 2.98 KiB [orphan] 1 module\ncacheable modules 18 KiB\n  ./src/main.js + 1 modules 3.11 KiB [built] [code generated]\n  ./src/m1.js 2.98 KiB [built] [code generated]\nwebpack 5.111.1 compiled successfully in 213 ms\n'
const VITE = 'vite v8.3.1 building client environment for production...\ntransforming...\n✓ 11 modules transformed.\nrendering chunks...\ncomputing gzip size...\ndist/index.html                0.09 kB │ gzip: 0.10 kB\ndist/assets/m1-P-eNtxP7.js     3.11 kB │ gzip: 0.13 kB\ndist/assets/index-CDWEeBzO.js  5.30 kB │ gzip: 1.19 kB\n\n✓ built in 38ms\n'
const VITE_ERROR = 'vite v8.3.1 building client environment for production...\ntransforming...\n✓ 4 modules transformed.\n✗ Build failed in 21ms\nerror during build:\nBuild failed with 1 error:\n\n[PARSE_ERROR] Expected `)` but found `EOF`\n   ╭─[ src/bad.js:2:18 ]\n   │\n 2 │ console.log(nope\n───╯\n\n    at aggregateBindingErrorsIntoJsError (file:///p/node_modules/rolldown/dist/shared/error-C7pxws0W.mjs:48:18)\n    at async Object.build (file:///p/node_modules/vite/dist/node/chunks/node.js:34866:19) {\n  errors: [Getter/Setter]\n}\n'
const ESBUILD_ERROR = '✘ [ERROR] Expected ")" but found end of file\n\n    src/bad.js:3:0:\n      3 │ \n        │ ^\n        ╵ )\n\n1 error\nnode:child_process:964\n    throw err;\n    ^\n\nError: Command failed: /p/node_modules/@esbuild/darwin-arm64/bin/esbuild src/bad.js --bundle --outdir=eout2\n    at genericNodeError (node:internal/errors:985:15)\n  status: 1,\n  stderr: null\n}\n\nNode.js v24.18.0\n'
const ROLLUP_WARN = '\n\u001b[1msrc/w.js\u001b[22m → \u001b[1mout2\u001b[22m...\n\u001b[1m\u001b[33m(!) Unresolved dependencies\u001b[39m\u001b[22m\nhttps://rollupjs.org/troubleshooting/#warning-treating-module-as-external-dependency\nlodash-missing (imported by "src/w.js")\n\u001b[32mcreated \u001b[1mout2\u001b[22m in \u001b[1m14ms\u001b[22m\u001b[39m\n'

describe('bundlers', () => {
  test('the emitted files read as a count and the largest three, where the rows stood; the module tree and progress go', () => {
    expect(planned('npx webpack --mode production', WEBPACK)).toEqual({ text: '3 assets, largest: main.js 5.76 KiB, 275.js 3.09 KiB, 410.js 3.09 KiB\nwebpack 5.111.1 compiled successfully in 213 ms', elided: true })
    expect(planned('vite build', VITE).text).toBe('vite v8.3.1 building client environment for production...\n3 assets, largest: dist/assets/index-CDWEeBzO.js 5.30 kB, dist/assets/m1-P-eNtxP7.js 3.11 kB, dist/index.html 0.09 kB\n\n✓ built in 38ms')
    expect(planned('esbuild src/main.js --bundle --outdir=eout', '\n  eout/main.js            3.4kb\n  eout/chunk-EMMPVGLW.js  500b \n\n⚡ Done in 4ms\n').text).toBe('2 assets, largest: eout/main.js 3.4kb, eout/chunk-EMMPVGLW.js 500b\n\n⚡ Done in 4ms')
  })

  test('a failed build keeps the error with its code frame, and drops the bundler\'s own stack and Node\'s dump', () => {
    expect(planned('vite build', VITE_ERROR, 1).text).toBe('vite v8.3.1 building client environment for production...\n✗ Build failed in 21ms\nerror during build:\nBuild failed with 1 error:\n\n[PARSE_ERROR] Expected `)` but found `EOF`\n   ╭─[ src/bad.js:2:18 ]\n   │\n 2 │ console.log(nope\n───╯')
    expect(planned('npx esbuild src/bad.js --bundle', ESBUILD_ERROR, 1).text).toBe('✘ [ERROR] Expected ")" but found end of file\n\n    src/bad.js:3:0:\n      3 │ \n        │ ^\n        ╵ )\n\n1 error')
    expect(planned('rollup src/w.js -d out2', ROLLUP_WARN).text).toBe('(!) Unresolved dependencies\nlodash-missing (imported by "src/w.js")\ncreated out2 in 14ms')
  })

  test('an error the project threw during a build stays', () => {
    expect(planned('rollup -c', '[!] TypeError: config.plugins is not iterable\n    at file:///p/rollup.config.js:4:20\n    at run (file:///p/node_modules/rollup/dist/bin/rollup:12:3)\n', 1).text)
      .toBe('[!] TypeError: config.plugins is not iterable\n    at file:///p/rollup.config.js:4:20')
  })
})
