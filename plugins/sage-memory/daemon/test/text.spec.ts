import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { canonicalText, collapseSpace, normalizeTags, textKey, tokenize } from '../../hooks/shared/text.ts'

describe('text normalization', () => {
  test('collapses whitespace and trims', () => {
    assert.equal(collapseSpace('  run\n\t tests   now '), 'run tests now')
  })

  test('keys differ only by form, case and spacing', () => {
    assert.equal(textKey('Use  PNPM\n'), textKey('use pnpm'))
    assert.equal(textKey('ﬁle'), 'file')
  })

  test('the duplicate key drops trailing punctuation and keeps inner punctuation', () => {
    assert.equal(canonicalText('Use pnpm.'), canonicalText('use pnpm'))
    assert.equal(canonicalText('Prefer C++ over foo.bar!?'), 'prefer c++ over foo.bar')
  })

  test('terms keep identifiers whole and drop short words', () => {
    assert.deepEqual(tokenize('Edit snake_case in foo.bar, go to edge-case'), ['edit', 'snake_case', 'foo.bar', 'edge-case'])
  })

  test('terms are distinct and case folded', () => {
    assert.deepEqual(tokenize('Cache cache CACHE warm'), ['cache', 'warm'])
  })

  test('tags lose the hash, case and repeats', () => {
    assert.deepEqual(normalizeTags(['#Build', 'build', ' ', 'CI']), ['build', 'ci'])
    assert.deepEqual(normalizeTags(undefined), [])
  })
})
