import { describe, expect, test, tier } from 'claude-code/testing'

import { absolute, cells, commandImagePaths, copyName, headBytes, pngSize, screenshotPath, sipsSize } from '../hooks/shot.ts'

tier('user')

const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

/** The head of a PNG: signature, IHDR length and type, width, height. */
const pngHead = (width: number, height: number): string =>
  btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), ...[...'IHDR'].map(c => c.charCodeAt(0)), ...u32(width), ...u32(height), 8, 6, 0, 0, 0))

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
  })
})
