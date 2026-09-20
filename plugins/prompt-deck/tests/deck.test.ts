import { describe, expect, test, tier } from 'claude-code/testing'

import { band, countsKey, fit, listText, MAX_KEPT, mergeCounts, normalize, normalizePin, pinsKey, projectName, record, removeAt, type Counts } from '../hooks/deck.ts'

tier('user')

const uses = (list: [string, number][]): Counts => Object.fromEntries(list.map(([t, n], i) => [t, { n, last: i }]))

describe('deck', () => {
  test('keeps only a short one-line prompt that is not a slash command', async () => {
    expect(normalize('  commitle  ')).toBe('commitle')
    for (const t of ['', '   ', '/prompt-deck', 'a\nb', 'x'.repeat(81)]) expect(normalize(t), JSON.stringify(t)).toBe(undefined)
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
    expect(Object.keys(removeAt(c, [], 1)?.counts ?? {})).toEqual(['commitle'])
    expect(removeAt(c, [], 3)).toBe(undefined)
    expect(fit('run the tests for the area I changed', 5, 100)).toBe('run the tests…')
    expect(fit('short', 5, 100)).toBe('short')
    expect(listText({})).toBe('no prompt counted yet; a prompt reaches the band after 3 uses, or add one with /prompt-deck add <text>')
  })

  test('keeps a pinned prompt of any length, on one line and without a leading slash', async () => {
    expect(normalizePin('  commitle  ')).toBe('commitle')
    expect(normalizePin('x'.repeat(200))).toBe('x'.repeat(200))
    for (const t of ['', '   ', '/prompt-deck', 'a\nb']) expect(normalizePin(t), JSON.stringify(t)).toBe(undefined)
  })

  test('draws the pinned prompts first, and a pinned prompt is listed and removed by its place', async () => {
    const c = uses([['a', 9], ['b', 8], ['c', 7], ['d', 6], ['e', 5]])
    expect(band(c, ['pin1', 'a'])).toEqual(['pin1', 'a', 'b', 'c', 'd'])
    expect(listText(c, ['pin1'])).toBe('1. pin1 (pinned)\n2. a (9)\n3. b (8)\n4. c (7)\n5. d (6)\n6. e (5)')
    const rest = removeAt(c, ['pin1'], 1)
    expect(rest?.pins).toEqual([])
    expect(Object.keys(rest?.counts ?? {})).toHaveLength(5)
    expect(removeAt(c, ['pin1'], 2)?.pins).toEqual(['pin1'])
  })

  test('the store key of the pinned prompts names the project', async () => {
    expect(pinsKey('app')).toBe('pins:app')
  })

  test('names one project store key and takes the project from a path', async () => {
    expect(countsKey('app')).toBe('counts:app')
    expect(projectName('/Users/u/app')).toBe('app')
    expect(projectName('/Users/u/app/')).toBe('app')
    expect(projectName('app')).toBe('app')
  })

  test('merges two decks, keeping the higher count and the later use', async () => {
    const merged = mergeCounts(uses([['a', 2], ['b', 5]]), { a: { n: 4, last: 9 }, c: { n: 1, last: 3 } })
    expect(merged).toEqual({ b: { n: 5, last: 1 }, a: { n: 4, last: 9 }, c: { n: 1, last: 3 } })
    expect(Object.keys(merged)).toEqual(['b', 'a', 'c'])
    let big: Counts = {}
    for (let i = 0; i < MAX_KEPT; i++) big = record(big, `p${i}`, i)
    expect(Object.keys(mergeCounts(big, { extra: { n: 1, last: 0 } }))).toHaveLength(MAX_KEPT)
  })
})
