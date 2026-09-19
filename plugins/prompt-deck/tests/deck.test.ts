import { describe, expect, test, tier } from 'claude-code/testing'

import { band, fit, listText, MAX_KEPT, normalize, record, removeAt, type Counts } from '../hooks/deck.ts'

tier('user')

const uses = (list: [string, number][]): Counts => Object.fromEntries(list.map(([t, n], i) => [t, { n, last: i }]))

describe('deck', () => {
  test('keeps only a short one-line prompt that is not a slash command', async () => {
    expect(normalize('  commitle  ')).toBe('commitle')
    for (const t of ['', '   ', '/deck', 'a\nb', 'x'.repeat(81)]) expect(normalize(t), JSON.stringify(t)).toBe(undefined)
  })

  test('draws the five most used prompts that reached three uses, the latest first on a tie', async () => {
    const c = uses([['a', 2], ['b', 3], ['c', 9], ['d', 3], ['e', 4], ['f', 5], ['g', 3]])
    expect(band(c)).toEqual(['c', 'f', 'e', 'g', 'd'])
    expect(band(uses([['a', 2]]))).toEqual([])
  })

  test('counts a use and drops the least used prompt past the limit', async () => {
    let c: Counts = {}
    for (let i = 0; i < MAX_KEPT; i++) c = record(c, `p${i}`, i)
    c = record(c, 'p5', 500)
    expect(c['p5']).toEqual({ n: 2, last: 500 })
    c = record(c, 'new', 600)
    expect(Object.keys(c)).toHaveLength(MAX_KEPT)
    expect(c['new']).toEqual({ n: 1, last: 600 })
    expect(c['p0']).toBe(undefined)
  })

  test('lists, removes by place and cuts a label to its share of the band', async () => {
    const c = uses([['commitle', 4], ['devam et', 7]])
    expect(listText(c)).toBe('1. devam et (7)\n2. commitle (4)')
    expect(Object.keys(removeAt(c, 1) ?? {})).toEqual(['commitle'])
    expect(removeAt(c, 3)).toBe(undefined)
    expect(fit('run the tests for the area I changed', 5, 100)).toBe('run the tests…')
    expect(fit('short', 5, 100)).toBe('short')
    expect(listText({})).toBe('no prompt counted yet; a prompt reaches the band after 3 uses')
  })
})
