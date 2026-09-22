import { describe, expect, mock, test, tier, type Engine } from 'claude-code/testing'
import type { CommandRunInput, On, RenderPropsOf } from 'claude-code'

tier('user')

const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

/** The head of a PNG: signature, IHDR length and type, width, height. */
const pngHead = (width: number, height: number): string =>
  btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), ...[...'IHDR'].map(c => c.charCodeAt(0)), ...u32(width), ...u32(height), 8, 6, 0, 0, 0))

const ROOT = '/Users/u/app'

const run = (args: string): CommandRunInput => ({
  command: 'shot-inline', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const u32le = (b: Uint8Array, at: number, n: number): void => { b[at] = n & 0xff; b[at + 1] = (n >> 8) & 0xff; b[at + 2] = (n >> 16) & 0xff; b[at + 3] = (n >> 24) & 0xff }

/** A 24-bit bottom-up BMP of one colour per column, as sips writes the resized picture. */
function bmp24(width: number, height: number): string {
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
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) b[54 + (height - 1 - y) * stride + x * 3 + 2] = (x + 1) * 10
  return btoa(String.fromCharCode(...b))
}

/** Files on a fake disk, the commands run, the lines logged. */
type World = { files: Map<string, { base64: string; size: number }>; argv: string[]; logs: string[]; failNext: boolean }

/** The picture is drawn as pixels when the terminal takes the kitty graphics protocol. */
function world(on: On, graphics = true): World {
  const w: World = {
    files: new Map([[`${ROOT}/.playwright-mcp/shot.png`, { base64: pngHead(1200, 1047), size: 19541 }], [`${ROOT}/photo.jpg`, { base64: '', size: 5000 }]]),
    argv: [],
    logs: [],
    failNext: false,
  }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('env.get', (_, e) => ({ value: e.name === 'TMPDIR' ? '/tmp/t/' : (e.name === 'KITTY_WINDOW_ID' && graphics ? '3' : '') }))
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('fs.stat', (_, e) => ({ value: { kind: 'file' as const, size: w.files.get(e.path)?.size ?? 0, mtimeMs: 7, isLink: false } }))
  on('fs.read', (_, e) => ({ value: { base64: w.files.get(e.path)?.base64 ?? '' } }) as never)
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('process.run', (_, e) => {
    w.argv.push(e.argv.join(' '))
    if (w.failNext) return { value: { exitCode: 1, stdout: '', stderr: 'sips: not found' } }
    const out = e.argv.includes('--out') ? (e.argv.at(-1) ?? '') : ''
    if (out.endsWith('.bmp')) w.files.set(out, { base64: bmp24(Number(e.argv[3] ?? 1), Number(e.argv[2] ?? 1)), size: 1 })
    else if (out !== '') w.files.set(out, { base64: '', size: 1 })
    return { value: { exitCode: 0, stdout: 'pixelWidth: 640\npixelHeight: 480\n', stderr: '' } }
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: 'image' }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }) as never)
  // A RegExp, because a literal MCP tool name typechecks only while that server is connected to the session /plugin-types ran in.
  on('tool.call', { tool: /^mcp__plugin_playwright_playwright__browser_take_screenshot$/ }, () => ({ result: 'r', text: '### Result\n- [Screenshot of viewport](.playwright-mcp/shot.png)' }) as never)
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.tool}</Text>
  })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
}

const row = ($: Engine, id: string, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'shot-inline', surface, component: 'ToolUse', requestId: id, props: { tool_use_id: id, tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false } as RenderPropsOf['ToolUse'] })

describe('shot-inline', () => {
  test('a screenshot draws under its row at its own shape, read from the PNG header', async ($, on) => {
    const w = world(on)
    await started($)
    await $.tool.call({ tool: 'mcp__plugin_playwright_playwright__browser_take_screenshot', tool_use_id: 't1' } as never)
    const image = await (await row($, 't1')).find({ type: 'Image' })
    expect(image?.props).toEqual({ source: { file: `${ROOT}/.playwright-mcp/shot.png`, format: 'png' }, columns: 55, rows: 24, alt: `picture: ${ROOT}/.playwright-mcp/shot.png` })
    expect(w.argv).toEqual([])
  })

  test('a JPG the model reads is copied to a PNG once and drawn from the copy', async ($, on) => {
    const w = world(on)
    await started($)
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/photo.jpg`, tool_use_id: 't2' } as never)
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/photo.jpg`, tool_use_id: 't3' } as never)
    const src = (await (await row($, 't3')).find({ type: 'Image' }))?.props.source as { file: string }
    expect(src.file).toMatch(/^\/tmp\/t\/shot-inline\/[0-9a-f]{8}\.png$/)
    expect(w.argv.filter(a => a.includes('--out'))).toHaveLength(1)
    expect(await (await row($, 't2', 'desktop')).find({ type: 'Image' })).toBe(undefined)
  })

  test('a command names a missing file, a sips failure is logged once, and off draws nothing', async ($, on) => {
    const w = world(on)
    await started($)
    await $.tool.call({ tool: 'Bash', command: 'rm gone.png', tool_use_id: 't4' } as never)
    expect(await (await row($, 't4')).find({ type: 'Image' })).toBe(undefined)
    w.failNext = true
    w.files.set(`${ROOT}/b.jpg`, { base64: '', size: 9 })
    await $.tool.call({ tool: 'Bash', command: 'cp a b.jpg', tool_use_id: 't5' } as never)
    await $.tool.call({ tool: 'Bash', command: 'cp a b.jpg', tool_use_id: 't6' } as never)
    expect(w.logs).toEqual(['a picture was not drawn: sips failed: sips: not found'])
    expect((await $.command.run(run('off'))).text).toBe('off: no picture is drawn')
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/.playwright-mcp/shot.png`, tool_use_id: 't7' } as never)
    expect(await (await row($, 't7')).find({ type: 'Image' })).toBe(undefined)
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
  })

  test('a terminal without the kitty protocol draws the picture as half-block cells, made once per box', async ($, on) => {
    const w = world(on, false)
    w.files.set(`${ROOT}/tiny.png`, { base64: pngHead(16, 16), size: 90 })
    await started($)
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/tiny.png`, tool_use_id: 't8' } as never)
    const ui = await row($, 't8')
    const raster = await ui.find({ type: 'Raster' })
    expect(await ui.find({ type: 'Image' })).toBe(undefined)
    expect(raster?.props.columns).toBe(2)
    expect(raster?.props.rows).toBe(1)
    const bytes = Uint8Array.from(atob(String(raster?.props.cells ?? '')), c => c.charCodeAt(0))
    expect([...new Uint32Array(bytes.buffer)]).toEqual([0x2580, 0x0a0000, 0x0a0000, 0x2580, 0x140000, 0x140000])
    const sipsRuns = w.argv.filter(a => a.includes('format bmp')).length
    await ui.unmount()
    await row($, 't8')
    expect(w.argv.filter(a => a.includes('format bmp'))).toHaveLength(sipsRuns)
    expect((await $.command.run(run(''))).text).toBe('on; 1 picture(s) this session; this terminal has no kitty graphics protocol, so a picture is drawn as half-block cells')
  })
})
