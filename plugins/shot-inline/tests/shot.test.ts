import { describe, expect, test, tier } from 'claude-code/testing'

import { absolute, allBytes, base64, bmpName, cells, commandImagePaths, copyName, halfBlocks, hasGraphics, headBytes, pngSize, readBmp, screenshotPath, sipsSize } from '../hooks/shot.ts'

tier('user')

const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

/** The head of a PNG: signature, IHDR length and type, width, height. */
const pngHead = (width: number, height: number): string =>
  btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), ...[...'IHDR'].map(c => c.charCodeAt(0)), ...u32(width), ...u32(height), 8, 6, 0, 0, 0))

const u32le = (b: Uint8Array, at: number, n: number): void => { b[at] = n & 0xff; b[at + 1] = (n >> 8) & 0xff; b[at + 2] = (n >> 16) & 0xff; b[at + 3] = (n >> 24) & 0xff }

/** A 24-bit bottom-up BMP, as `sips -s format bmp` writes one but for its 32-bit pixels. */
function bmp24(width: number, height: number, color: (x: number, y: number) => [number, number, number]): Uint8Array {
  const stride = Math.ceil((width * 3) / 4) * 4
  const b = new Uint8Array(54 + stride * height)
  b[0] = 0x42
  b[1] = 0x4d
  u32le(b, 2, b.length)
  u32le(b, 10, 54)
  u32le(b, 14, 40)
  u32le(b, 18, width)
  u32le(b, 22, height)
  b[26] = 1
  b[28] = 24
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, bl] = color(x, y)
      const at = 54 + (height - 1 - y) * stride + x * 3
      b[at] = bl
      b[at + 1] = g
      b[at + 2] = r
    }
  }
  return b
}

describe('shot', () => {
  test('finds the file a screenshot result links to', async () => {
    expect(screenshotPath('### Result\n- [Screenshot of viewport](.playwright-mcp/shot-probe.png)\n### Ran Playwright code')).toBe('.playwright-mcp/shot-probe.png')
    expect(screenshotPath('### Result\n- [Snapshot](.playwright-mcp/page.yml)')).toBe(undefined)
  })

  test('finds the image paths a command names, the last first', async () => {
    expect(commandImagePaths('sips -s format png in.jpg --out "out dir/x.png" && open ./shots/a.PNG')).toEqual(['./shots/a.PNG', 'out dir/x.png', 'in.jpg'])
    expect(commandImagePaths('convert a.png b.png; echo a.png')).toEqual(['a.png', 'b.png'])
    expect(commandImagePaths('ls *.txt')).toEqual([])
  })

  test('reads a PNG size from its IHDR and a size from sips', async () => {
    expect(headBytes(btoa('abc'), 3)).toEqual([97, 98, 99])
    expect(pngSize(pngHead(1200, 1047))).toEqual({ width: 1200, height: 1047 })
    expect(pngSize(btoa('GIF89a not a png at all.....'))).toBe(undefined)
    expect(sipsSize('/x/a.jpg\n  pixelWidth: 640\n  pixelHeight: 480\n')).toEqual({ width: 640, height: 480 })
    expect(sipsSize('Error: unable to open')).toBe(undefined)
  })

  test('keeps the picture shape inside 80 columns and 24 rows', async () => {
    expect(cells({ width: 1200, height: 1047 }, 80)).toEqual({ columns: 55, rows: 24 })
    expect(cells({ width: 1600, height: 400 }, 80)).toEqual({ columns: 80, rows: 10 })
    expect(cells({ width: 40, height: 40 }, 80)).toEqual({ columns: 5, rows: 3 })
  })

  test('resolves a relative path and names a JPG copy by path and time', async () => {
    expect(absolute('./a.png', '/r/')).toBe('/r/a.png')
    expect(absolute('/abs/a.png', '/r')).toBe('/abs/a.png')
    expect(copyName('/a.jpg', 1)).toMatch(/^[0-9a-f]{8}\.png$/)
    expect(copyName('/a.jpg', 1)).not.toBe(copyName('/a.jpg', 2))
    expect(bmpName('/a.png', 1, 10, 4)).toMatch(/^[0-9a-f]{8}\.bmp$/)
    expect(bmpName('/a.png', 1, 10, 4)).not.toBe(bmpName('/a.png', 1, 20, 8))
  })

  test('names the terminals that draw a picture themselves', async () => {
    expect(hasGraphics('xterm-kitty', '', '')).toBe(true)
    expect(hasGraphics('xterm-256color', 'ghostty', '')).toBe(true)
    expect(hasGraphics('xterm-256color', '', '3')).toBe(true)
    for (const [term, program] of [['xterm-256color', 'vscode'], ['xterm-256color', 'Apple_Terminal'], ['xterm-256color', 'iTerm.app'], ['screen', '']]) {
      expect(hasGraphics(term ?? '', program ?? '', ''), `${term} ${program}`).toBe(false)
    }
  })

  test('reads a BMP header and reads a pixel from its rows', async () => {
    const bmp = readBmp(bmp24(2, 2, (x, y) => [x * 100, y * 100, 7]))
    expect({ ...bmp, bytes: undefined }).toEqual({ width: 2, height: 2, offset: 54, topDown: false, step: 3, stride: 8, bytes: undefined })
    expect(readBmp(new Uint8Array([0x89, 0x50]))).toBe(undefined)
  })

  test('packs a picture into half-block cells, each cell two pixels of one column', async () => {
    const grid = halfBlocks(readBmp(bmp24(2, 2, (x, y) => [x * 100, y * 100, 7])) ?? { width: 0, height: 0, offset: 0, topDown: true, step: 3, stride: 0, bytes: new Uint8Array() }, 2, 1)
    const words = new Uint32Array(allBytes(grid).slice().buffer)
    expect([...words]).toEqual([0x2580, 0x000007, 0x006407, 0x2580, 0x640007, 0x646407])
  })

  test('writes and reads standard padded base64', async () => {
    for (const text of ['a', 'ab', 'abc', 'abcd', '']) {
      const bytes = Uint8Array.from([...text].map(c => c.charCodeAt(0)))
      expect(base64(bytes), text).toBe(btoa(text))
      expect([...allBytes(btoa(text))], text).toEqual([...bytes])
    }
  })
})
