import { describe, expect, test, tier } from 'claude-code/testing'
import { SCENES } from '../hooks/art/scenes.ts'
import { rngOf, runsOf, textOf } from '../hooks/art/grid.ts'
import { nextAlive } from '../hooks/art/life.ts'
import { configOf, parseArgs, pickStyle, STYLES } from '../hooks/config.ts'

tier('user')

describe('art', () => {
  test('every scene fills exactly its region with one-cell glyphs, and one seed replays the same frames', () => {
    for (const style of STYLES) {
      const a = SCENES[style](40, 7, rngOf(11))
      const b = SCENES[style](40, 7, rngOf(11))
      const seen = new Set<string>()
      for (let i = 0; i < 60; i++) {
        a.step()
        b.step()
        const frame = a.frame()
        expect(frame).toHaveLength(7)
        for (const row of frame) {
          expect(row).toHaveLength(40)
          for (const cell of row) expect([...cell.ch]).toHaveLength(1)
        }
        expect(textOf(frame)).toBe(textOf(b.frame()))
        seen.add(textOf(frame))
      }
      // A scene that draws the same frame at every tick is not an animation.
      expect(seen.size).toBeGreaterThan(10)
    }
  })

  test('a row draws as runs of one colour, joined back to the same text', () => {
    const row = [{ ch: 'a', color: '' }, { ch: 'b', color: '#fff' }, { ch: 'c', color: '#fff' }, { ch: ' ', color: '' }]
    expect(runsOf(row)).toEqual([{ text: 'a', color: '' }, { text: 'bc', color: '#fff' }, { text: ' ', color: '' }])
  })

  test('the Game of Life keeps a cell with 2 or 3 neighbours and gives birth at exactly 3', () => {
    expect([0, 1, 2, 3, 4].map(n => nextAlive(true, n))).toEqual([false, false, true, true, false])
    expect([0, 1, 2, 3, 4].map(n => nextAlive(false, n))).toEqual([false, false, false, true, false])
  })
})

describe('config', () => {
  test('a missing or broken setting takes its default, and only a stored false turns the mod off', () => {
    expect(configOf(undefined, undefined, undefined)).toEqual({ enabled: true, style: 'random', delaySec: 3 })
    expect(configOf(false, 'rainbow', 99)).toEqual({ enabled: false, style: 'random', delaySec: 3 })
    expect(configOf('no', 'life', 0)).toEqual({ enabled: true, style: 'life', delaySec: 0 })
  })

  test('random picks every style but the last one', () => {
    const picked = new Set<string>()
    const rng = rngOf(5)
    for (let i = 0; i < 200; i++) picked.add(pickStyle('random', 'fire', rng))
    expect([...picked].sort()).toEqual(STYLES.filter(s => s !== 'fire').sort())
    expect(pickStyle('aquarium', 'aquarium', rng)).toBe('aquarium')
  })

  test('arguments read case-blind, and a wrong one is named', () => {
    expect(parseArgs('  MATRIX ')).toEqual({ kind: 'style', style: 'matrix' })
    expect(parseArgs('delay 10')).toEqual({ kind: 'delay', seconds: 10 })
    expect(parseArgs('delay -1').kind).toBe('error')
    expect(parseArgs('delay')).toMatchObject({ kind: 'error' })
    expect(parseArgs('on off')).toMatchObject({ kind: 'error', text: expect.stringContaining('too many arguments') })
  })
})
