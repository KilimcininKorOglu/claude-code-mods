import { describe, expect, test, tier } from 'claude-code/testing'

import { classOfRule, ignoredDirs, nameRule, parseDu, sizeText, statusText } from '../hooks/classify.ts'
import { deletedShort } from '../hooks/report.ts'

tier('user')

describe('classify', () => {
  test('a data name is data, a certain name needs its marker, an unknown name is not listed', async () => {
    expect(nameRule('data')).toEqual({ cls: 'data', markers: [] })
    expect(nameRule('models')?.cls).toBe('data')
    expect(nameRule('cache')?.cls).toBe('data')
    expect(nameRule('.cache')?.cls).toBe('unsure')
    expect(nameRule('src')).toBe(undefined)
    const target = nameRule('target')
    if (target === undefined) throw new Error('target has a rule')
    expect(classOfRule(target, true)).toBe('certain')
    expect(classOfRule(target, false)).toBe('unsure')
    const pycache = nameRule('__pycache__')
    if (pycache === undefined) throw new Error('__pycache__ has a rule')
    expect(classOfRule(pycache, false)).toBe('certain')
  })

  test('reads the ignored directories and du output', async () => {
    expect(ignoredDirs('node_modules/\0.env\0a/b/target/\0')).toEqual(['node_modules', 'a/b/target'])
    expect(parseDu('1048576\t/r/node_modules\n12\t/r/dist\ndu: cannot read x\n')).toEqual(new Map([['/r/node_modules', 1048576], ['/r/dist', 12]]))
  })

  test('sizes and the status line thresholds', async () => {
    expect(sizeText(12)).toBe('12 KB')
    expect(sizeText(512 * 1024)).toBe('512 MB')
    expect(sizeText(3.44 * 1024 * 1024)).toBe('3.4 GB')
    expect(statusText(4.9 * 1024 * 1024)).toBe(undefined)
    expect(statusText(7.4 * 1024 * 1024)).toBe('artifacts 7.4 GB · /disk-janitor')
    expect(statusText(23.1 * 1024 * 1024)).toBe('over 20 GB: artifacts 23.1 GB · /disk-janitor')
  })

  test('the deletion line colours what went, what was skipped and what failed', async () => {
    const line = deletedShort({ deleted: ['a'], skipped: ['b (x)', 'c (y)'], failed: ['d (z)'], freedKb: 2048 })
    expect(line).toEqual({
      text: 'deleted 1 dir(s), 2 MB · 2 skipped · 1 failed',
      parts: [
        { text: 'deleted 1 dir(s), 2 MB', kind: 'ok' },
        { text: ' · ', kind: 'dim' },
        { text: '2 skipped', kind: 'warn' },
        { text: ' · ', kind: 'dim' },
        { text: '1 failed', kind: 'error' },
      ],
    })
    expect(deletedShort({ deleted: [], skipped: [], failed: [], freedKb: 0 }).parts).toEqual([{ text: 'deleted nothing', kind: 'dim' }])
  })
})
