import { describe, expect, test, tier } from 'claude-code/testing'
import { SCENES } from '../hooks/art/scenes.ts'
import { rngOf, runsOf, sceneDone, textOf } from '../hooks/art/grid.ts'
import { configOf, parseArgs, pickStyle, STYLES } from '../hooks/config.ts'
import { bytesOf, decodeGif } from '../hooks/gif.ts'
import { MAX_CLIP_CHARS, playClip, toClip } from '../hooks/clip.ts'
import { TWO_FRAMES } from './fixtures.ts'

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

  test('the cat walks in to the middle, meows, rolls, and walks out to come round again', () => {
    const anim = SCENES.cat(60, 8, rngOf(3))
    const seen: string[] = []
    for (let i = 0; i < 600; i++) {
      anim.step()
      seen.push(textOf(anim.frame()))
    }
    // Its face never leaves the band's 8 rows, and it stands in the middle (column 25 of 60) once it sits.
    expect(seen.some(f => f.split('\n').some(row => row.indexOf('( o.o )') === 25))).toBe(true)
    // Each word stands in a bubble over the head, its tail pointing down to the cat.
    const meow = seen.find(f => f.includes('( meow )'))?.split('\n') ?? []
    expect(meow.slice(0, 4).map(row => row.trimEnd())).toEqual([`${' '.repeat(32)}.------.`, `${' '.repeat(31)}( meow )`, `${' '.repeat(32)}'------'`, `${' '.repeat(31)}/`])
    expect(meow[5]?.indexOf('( o.o )')).toBe(25)
    expect(seen.some(f => f.includes('( MEOW! )'))).toBe(true)
    expect(seen.some(f => f.includes('( purr~ )'))).toBe(true)
    expect(seen.some(f => f.includes('( -.- )=~'))).toBe(true)
    expect(seen.some(f => f.includes('♥'))).toBe(true)
    // It walks head first: the head leads to the right, the tail trails on the left.
    expect(seen.some(f => f.split('\n').some(row => row.startsWith(' __( o.o )')))).toBe(true)
    expect(seen.some(f => f.includes('( o.o )__'))).toBe(false)
  })

  test('the cat walks out slowly to the right, and only then does random take the next scene', () => {
    const anim = SCENES.cat(60, 8, rngOf(3))
    const faces: number[] = []
    let ms = 0
    for (; ms < 120_000; ms += 100) {
      anim.step(100)
      const col = textOf(anim.frame()).split('\n').map(row => row.indexOf('( o.o )')).find(c => c >= 0) ?? -1
      faces.push(col)
      if (anim.wrapped?.() === true) break
    }
    // The round ends after 20 seconds, with the head at the right edge on the way out, a cell each 200 ms.
    expect(ms).toBeGreaterThan(20_000)
    const out = faces.slice(-40).filter(c => c >= 0)
    expect(out.length).toBeGreaterThanOrEqual(20)
    expect(out.every((c, i) => i === 0 || c - (out[i - 1] ?? 0) <= 1)).toBe(true)
    expect(out.at(-1)).toBeGreaterThan(50)
    // At 20 seconds the round is still on, so random does not cut the cat off mid-show.
    const midway = SCENES.cat(60, 8, rngOf(3))
    for (let t = 0; t < 20_000; t += 100) midway.step(100)
    expect(sceneDone(midway, 20_000)).toBe(false)
  })

  test('a row draws as runs of one colour, joined back to the same text', () => {
    const row = [{ ch: 'a', color: '' }, { ch: 'b', color: '#fff' }, { ch: 'c', color: '#fff' }, { ch: ' ', color: '' }]
    expect(runsOf(row)).toEqual([{ text: 'a', color: '' }, { text: 'bc', color: '#fff' }, { text: ' ', color: '' }])
  })

  test('a scene keeps its pace at any frame rate: small steps reach where large ones do, drawing more frames on the way', () => {
    const plays = (stepMs: number): { end: string; frames: number } => {
      const anim = SCENES.cat(60, 8, rngOf(3))
      const frames = new Set<string>()
      for (let ms = 0; ms < 3000; ms += stepMs) {
        anim.step(stepMs)
        frames.add(textOf(anim.frame()))
      }
      return { end: textOf(anim.frame()), frames: frames.size }
    }
    const coarse = plays(100)
    const fine = plays(25)
    expect(fine.end).toBe(coarse.end)
    // The walk moves a cell every 200 ms either way; the fine steps show the same frames, not fewer.
    expect(fine.frames).toBeGreaterThanOrEqual(coarse.frames)
  })

  test('a fire changes ten times a second whatever the frame rate', () => {
    const anim = SCENES.fire(20, 5, rngOf(2))
    const changes: number[] = []
    let last = textOf(anim.frame())
    for (let ms = 16; ms <= 1600; ms += 16) {
      anim.step(16)
      const now = textOf(anim.frame())
      if (now !== last) changes.push(ms)
      last = now
    }
    expect(changes.length).toBe(16)
  })
})

describe('config', () => {
  test('a missing or broken setting takes its default, and only a stored false turns the mod off', () => {
    expect(configOf(undefined, undefined, undefined, [])).toEqual({ enabled: true, style: 'random', delaySec: 3 })
    expect(configOf(false, 'rainbow', 99, [])).toEqual({ enabled: false, style: 'random', delaySec: 3 })
    expect(configOf('no', 'stars', 0, [])).toEqual({ enabled: true, style: 'stars', delaySec: 0 })
    // A scene that is gone (the Game of Life, removed) reads as random.
    expect(configOf(true, 'life', 3, []).style).toBe('random')
    // A stored clip name holds only while the clip is saved.
    expect(configOf(true, 'kitty', 3, ['kitty']).style).toBe('kitty')
    expect(configOf(true, 'kitty', 3, []).style).toBe('random')
  })

  test('random picks every style and saved clip but the last one', () => {
    const picked = new Set<string>()
    const rng = rngOf(5)
    for (let i = 0; i < 300; i++) picked.add(pickStyle('random', 'fire', rng, ['kitty']))
    expect([...picked].sort()).toEqual([...STYLES.filter(s => s !== 'fire'), 'kitty'].sort())
    expect(pickStyle('aquarium', 'aquarium', rng)).toBe('aquarium')
  })

  test('arguments read case-blind, a path keeps its case and spaces, and a wrong one is named', () => {
    expect(parseArgs('  MATRIX ')).toEqual({ kind: 'style', style: 'matrix' })
    expect(parseArgs('delay 10')).toEqual({ kind: 'delay', seconds: 10 })
    expect(parseArgs('delay -1').kind).toBe('error')
    expect(parseArgs('delay')).toMatchObject({ kind: 'error' })
    expect(parseArgs('on off')).toMatchObject({ kind: 'error', text: expect.stringContaining('too many arguments') })
    expect(parseArgs('import ~/My GIFs/Cat.gif Kitty')).toEqual({ kind: 'import', path: '~/My GIFs/Cat.gif', name: 'kitty' })
    expect(parseArgs('import cat.gif cat')).toMatchObject({ kind: 'error', text: expect.stringContaining('taken') })
    expect(parseArgs('import cat.gif')).toMatchObject({ kind: 'error', text: expect.stringContaining('a GIF path and a name') })
    expect(parseArgs('import cat.gif fire')).toMatchObject({ kind: 'error', text: expect.stringContaining('taken') })
    expect(parseArgs('import cat.gif no_way')).toMatchObject({ kind: 'error', text: expect.stringContaining('not a clip name') })
    expect(parseArgs('remove cat')).toEqual({ kind: 'remove', name: 'cat' })
    expect(parseArgs('list')).toEqual({ kind: 'list' })
  })
})

describe('gif', () => {
  test('decodes each frame over the disposed one, with its delay and its transparent pixels', () => {
    const gif = decodeGif(bytesOf(TWO_FRAMES))
    expect([gif.width, gif.height, gif.frames.map(f => f.delayMs)]).toEqual([4, 2, [200, 300]])
    const opaque = (rgba: Uint8Array): string => Array.from({ length: 8 }, (_, i) => ((rgba[i * 4 + 3] ?? 0) > 0 ? 'x' : '.')).join('')
    expect(gif.frames.map(f => opaque(f.rgba))).toEqual(['xx..xx..', '..xx..xx'])
    expect([...(gif.frames[0]?.rgba.subarray(0, 4) ?? [])]).toEqual([255, 0, 0, 255])
    expect([...(gif.frames[1]?.rgba.subarray(8, 12) ?? [])]).toEqual([255, 255, 255, 255])
  })

  test('refuses a file that is not a GIF, and one cut short', () => {
    expect(() => decodeGif(new TextEncoder().encode('PNG....'))).toThrow('not a GIF')
    expect(() => decodeGif(bytesOf(TWO_FRAMES).subarray(0, 20))).toThrow('ends early')
  })

  test('a clip fills the band with the picture\'s shape kept, draws the dim half dim and the bright half bright, and loops by its delays', () => {
    // 4x2 pixels scale by 8 into the 8 rows: 32 columns, two pixel rows per cell row.
    const { clip, dropped } = toClip(decodeGif(bytesOf(TWO_FRAMES)), 100, 8)
    expect([clip.width, clip.height, dropped]).toEqual([32, 8, 0])
    expect(clip.frames[0]?.[0]).toEqual([['.'.repeat(16), '#ff0000'], [' '.repeat(16), '']])
    expect(clip.frames[1]?.[7]).toEqual([[' '.repeat(16), ''], ['@'.repeat(16), '#ffffff']])
    // Centred in 40 columns: 4 blank columns on each side.
    const anim = playClip(clip, 40, 8, 100)
    const firstRow = (): string => textOf(anim.frame()).split('\n')[0] ?? ''
    const red = `    ${'.'.repeat(16)}${' '.repeat(20)}`
    const white = `${' '.repeat(20)}${'@'.repeat(16)}    `
    expect(firstRow()).toBe(red)
    anim.step()
    expect(firstRow()).toBe(red)
    anim.step()
    expect(firstRow()).toBe(white)
    for (let i = 0; i < 3; i++) anim.step()
    expect(firstRow()).toBe(red)
  })

  test('a scene has run its time at 20 seconds; a clip at the first end of a loop from then on', () => {
    const endless = SCENES.fire(10, 4, rngOf(1))
    expect([sceneDone(endless, 19_900), sceneDone(endless, 20_000)]).toEqual([false, true])
    // The clip loops every 500 ms: from 20,000 ms it is done at each end of a loop, and between them not.
    const clip = playClip(toClip(decodeGif(bytesOf(TWO_FRAMES)), 100, 8).clip, 40, 8, 100)
    const done: number[] = []
    for (let ms = 100; ms <= 21_000; ms += 100) {
      clip.step()
      if (sceneDone(clip, ms)) done.push(ms)
    }
    expect(done).toEqual([20_000, 20_500, 21_000])
  })

  test('a clip over the size limit drops every other frame until it fits', () => {
    const frame = { rgba: new Uint8Array(200 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256)), delayMs: 100 }
    const gif = { width: 200, height: 16, frames: Array.from({ length: 400 }, () => frame) }
    const { clip, dropped } = toClip(gif, 100, 8)
    expect(JSON.stringify(clip).length).toBeLessThanOrEqual(MAX_CLIP_CHARS)
    expect(dropped).toBeGreaterThan(0)
    expect(clip.frames.length + dropped).toBe(400)
    expect(clip.delays.reduce((a, b) => a + b, 0)).toBe(40_000)
  })

  test('the base64 reader matches the standard alphabet with padding', () => {
    expect([...bytesOf('AAEC/w==')]).toEqual([0, 1, 2, 255])
  })
})
