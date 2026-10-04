import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { layoutOf } from '../../hooks/shared/layout.ts'
import { transformersRuntime } from '../embedder.ts'

/**
 * The real model, run only where SAGE_MEMORY_TEST_RUNTIME names a directory laid out as setup
 * leaves `runtime/`: the package under `node_modules`, the model under `models`. It loads offline.
 */
const RUNTIME = process.env.SAGE_MEMORY_TEST_RUNTIME

function dot(a: Float32Array, b: Float32Array): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0)
}

describe('the multilingual model', { skip: RUNTIME === undefined ? 'SAGE_MEMORY_TEST_RUNTIME names no runtime directory' : false }, () => {
  test('loads offline and ranks first the English memory a Turkish question is about', async () => {
    const dir = RUNTIME ?? ''
    const runtime = transformersRuntime({ ...layoutOf(dir), runtimeDir: dir, modelsDir: join(dir, 'models') })
    assert.equal(runtime.installed(), true)
    const model = await runtime.load({ allowRemote: false, onProgress: () => undefined })
    assert.equal(model.dims, 768)
    const memories = [
      'Never write a Gemini API key into a file, a test or a commit; gemini-core reads it from its apiKey option',
      'Run tests with caching disabled, for example go test -count=1',
      'Keep the sidebar log in ~/.claude/sidebar, one file per project and day',
    ]
    const [question, ...vectors] = await model.embed(["gemini key'ini nereye yazayım?", ...memories])
    assert.ok(question)
    const cosines = vectors.map(vector => dot(question, vector))
    assert.equal(cosines.indexOf(Math.max(...cosines)), 0, `cosines ${cosines.map(cosine => cosine.toFixed(2)).join(', ')}`)
  })
})
