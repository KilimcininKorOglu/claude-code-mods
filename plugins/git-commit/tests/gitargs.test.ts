import { describe, expect, test, tier } from 'claude-code/testing'

import { addArgs, checkoutKind, commitArgs, isBranchChange, isConfigWrite, isDryCommit, isInteractiveRebase, pushArgs } from '../hooks/gitargs.ts'

tier('user')

describe('commitArgs', () => {
  test('reads short clusters the way git does', async () => {
    const c = commitArgs(['-am', 'fix: x'])
    expect([...c.flags].sort()).toEqual(['all', 'message'])
    expect(c.values.get('message')).toEqual(['fix: x'])
    expect(commitArgs(['-mfix: y']).values.get('message')).toEqual(['fix: y'])
    expect(commitArgs(['-nm', 'x']).flags.has('no-verify')).toBe(true)
  })

  test('reads long options with = or with the next word, and a unique abbreviation', async () => {
    expect(commitArgs(['--message=a', '--message', 'b']).values.get('message')).toEqual(['a', 'b'])
    expect(commitArgs(['--amen']).flags.has('amend')).toBe(true)
    expect(commitArgs(['--no-verif']).flags.has('no-verify')).toBe(true)
    expect(commitArgs(['--trailer', 'Signed-off-by: A']).values.get('trailer')).toEqual(['Signed-off-by: A'])
  })

  test('keeps the pathspec and knows a commit that records nothing', async () => {
    expect(commitArgs(['-m', 'x', 'a.ts', '--', 'b.ts']).operands).toEqual(['a.ts', 'b.ts'])
    expect(isDryCommit(commitArgs(['--dry-run']))).toBe(true)
    expect(isDryCommit(commitArgs(['--porcelain']))).toBe(true)
    expect(isDryCommit(commitArgs(['-m', 'x']))).toBe(false)
  })

  test('reads -c as reusing a message, not as a config setting', async () => {
    expect(commitArgs(['-c', 'HEAD']).flags.has('reuse')).toBe(true)
    expect(commitArgs(['-S']).flags.has('gpg-sign')).toBe(true)
  })
})

describe('addArgs', () => {
  test('names blanket and interactive options by their long names', async () => {
    expect(addArgs(['-A']).flags.has('all')).toBe(true)
    expect(addArgs(['--no-ignore-removal']).flags.has('all')).toBe(true)
    expect(addArgs(['-fp', 'x']).flags.has('patch')).toBe(true)
    expect(addArgs(['-f', 'x']).operands).toEqual(['x'])
  })
})

describe('isConfigWrite', () => {
  test('tells a read from a write', async () => {
    expect(isConfigWrite(['user.name'])).toBe(false)
    expect(isConfigWrite(['--get', 'user.name'])).toBe(false)
    expect(isConfigWrite(['--global', '--list'])).toBe(false)
    expect(isConfigWrite(['get', 'user.name'])).toBe(false)
    expect(isConfigWrite(['user.name', 'x'])).toBe(true)
    expect(isConfigWrite(['--global', 'core.hooksPath', '/dev/null'])).toBe(true)
    expect(isConfigWrite(['--unset', 'user.name'])).toBe(true)
    expect(isConfigWrite(['set', 'user.name', 'x'])).toBe(true)
    expect(isConfigWrite(['--file', 'f', 'a.b'])).toBe(false)
  })
})

describe('isBranchChange', () => {
  test('tells a listing from a change', async () => {
    expect(isBranchChange([])).toBe(false)
    expect(isBranchChange(['-a'])).toBe(false)
    expect(isBranchChange(['--show-current'])).toBe(false)
    expect(isBranchChange(['--merged', 'main'])).toBe(false)
    expect(isBranchChange(['feature'])).toBe(true)
    expect(isBranchChange(['-D', 'old'])).toBe(true)
    expect(isBranchChange(['-m', 'new'])).toBe(true)
  })
})

describe('checkoutKind', () => {
  test('tells a branch switch from a file restore', async () => {
    expect(checkoutKind(['-b', 'feature'])).toBe('branch')
    expect(checkoutKind(['--orphan', 'x'])).toBe('branch')
    expect(checkoutKind(['--', 'a.ts'])).toBe('paths')
    expect(checkoutKind(['main', 'a.ts'])).toBe('paths')
    expect(checkoutKind([])).toBe('none')
    expect(checkoutKind(['main'])).toEqual({ operand: 'main' })
  })
})

describe('pushArgs and isInteractiveRebase', () => {
  test('reads the options the gate rules on', async () => {
    expect(pushArgs(['-n']).flags.has('dry-run')).toBe(true)
    expect(pushArgs(['--no-verify', 'origin']).flags.has('no-verify')).toBe(true)
    expect(isInteractiveRebase(['-i', 'HEAD~3'])).toBe(true)
    expect(isInteractiveRebase(['--interactive'])).toBe(true)
    expect(isInteractiveRebase(['main'])).toBe(false)
  })
})
