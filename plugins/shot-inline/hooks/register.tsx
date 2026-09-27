import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { absolute, allBytes, blockCells, bmpName, cells, commandImagePaths, copyName, GLYPHS, hasGraphics, isGlyphs, isImagePath, isPng, pngSize, readBmp, screenshotPath, sipsSize, type Glyphs, type Size } from './shot.ts'

const ENABLED_KEY = 'enabled'
const GLYPHS_KEY = 'glyphs'

/** Quadrants hold twice the pixels of a half block across, in two colours a cell. */
const DEFAULT_GLYPHS: Glyphs = 'quadrant'

const USAGE = 'expects nothing (the status), on, off, or glyphs half | quadrant'

/** The Playwright screenshot tool, as a plugin install and as a plain MCP server name it. */
const SCREENSHOT_TOOL = /^mcp__(plugin_playwright_)?playwright__browser_take_screenshot$/

/** `$.fs.read` refuses a larger file, so a larger PNG is measured with sips. */
const MAX_READ_BYTES = 4 * 1024 * 1024

/** The newest pictures kept; an older row draws without its picture. */
const MAX_SHOTS = 200

/** A picture ready to draw: the PNG the terminal reads, its pixel size, and the path the model named. */
type Shot = { png: string; size: Size; source: string; stamp: number }

/** The box of cells a picture is drawn in. */
type Box = { columns: number; rows: number }

type State = {
  shots: Map<string, Shot>
  enabled: boolean
  /**
   * The block cells of each picture at the newest box it was drawn in, keyed by the tool row: one
   * grid per picture, dropped with its picture, so a resize replaces a grid instead of adding one.
   */
  grids: Map<string, { box: string; grid: string }>
  /** The directory the session started in, read before a Bash `cd` can move it. */
  root: string
  /** The terminal takes the kitty graphics protocol, so the picture itself is drawn. */
  graphics: boolean
  /** The block characters of a terminal without it. */
  glyphs: Glyphs
  lastError?: string
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Logs an error once until a different one comes. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`a picture was not drawn: ${text}`)
  state.lastError = text
}

async function sips($: EngineInterface, argv: string[]): Promise<string> {
  const r = await $.process.run(['sips', ...argv], { timeoutMs: 20_000 })
  if (r.exitCode !== 0) throw new Error(`sips failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`)
  return r.stdout
}

async function measure($: EngineInterface, path: string, bytes: number): Promise<Size> {
  const size = isPng(path) && bytes <= MAX_READ_BYTES
    ? pngSize((await $.fs.read(path, { as: 'bytes' })).base64)
    : sipsSize(await sips($, ['-g', 'pixelWidth', '-g', 'pixelHeight', path]))
  if (size === undefined) throw new Error(`${path} has no readable picture size`)
  return size
}

/** A PNG copy of a JPG under the temp directory, made once per path and modification time. */
async function pngCopy($: EngineInterface, path: string, mtimeMs: number): Promise<string> {
  const out = `${await tempDir($)}/${copyName(path, mtimeMs)}`
  if (await $.fs.exists(out)) return out
  await sips($, ['-s', 'format', 'png', path, '--out', out])
  return out
}

/** The picture for an image file, or undefined when the path is not a file. */
async function prepare($: EngineInterface, path: string): Promise<Shot | undefined> {
  if (!(await $.fs.exists(path))) return undefined
  const st = await $.fs.stat(path)
  if (st.kind !== 'file') return undefined
  const size = await measure($, path, st.size ?? 0)
  const png = isPng(path) ? path : await pngCopy($, path, st.mtimeMs)
  return { png, size, source: path, stamp: st.mtimeMs }
}

/** The temp directory the mod writes its copies into. */
async function tempDir($: EngineInterface): Promise<string> {
  const dir = `${((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')}/shot-inline`
  const made = await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5_000 })
  if (made.exitCode !== 0) throw new Error(`mkdir ${dir} failed: ${made.stderr.trim()}`)
  return dir
}

/** A BMP of the picture with exactly the pixels the box's cells hold, made once per picture and size. */
async function bmpCopy($: EngineInterface, shot: Shot, box: Box, glyphs: Glyphs): Promise<string> {
  const width = box.columns * GLYPHS[glyphs].across
  const height = box.rows * GLYPHS[glyphs].down
  const out = `${await tempDir($)}/${bmpName(shot.png, shot.stamp, width, height)}`
  if (await $.fs.exists(out)) return out
  await sips($, ['-z', String(height), String(width), '-s', 'format', 'bmp', shot.png, '--out', out])
  return out
}

/** The block cells for one picture at one box, kept while the picture is and until the box or the glyphs change. */
async function gridFor($: EngineInterface, state: State, id: string, shot: Shot, box: Box, key: string): Promise<string | undefined> {
  const kept = state.grids.get(id)
  if (kept?.box === key) return kept.grid
  try {
    const bmp = readBmp(allBytes((await $.fs.read(await bmpCopy($, shot, box, state.glyphs), { as: 'bytes' })).base64))
    if (bmp === undefined) throw new Error(`${shot.source}: sips wrote a BMP this reader does not take`)
    const grid = blockCells(bmp, box.columns, box.rows, state.glyphs)
    state.grids.set(id, { box: key, grid })
    return grid
  } catch (err) {
    // A redraw drops the dispatch under it, so the work of the old one is not a failure.
    if (!/\baborted\b/.test(errorText(err))) report($, state, err)
    return undefined
  }
}

/**
 * Keeps the picture for a tool row and redraws the rows. A relative path is read against `base`: the
 * directory the tool itself ran in.
 */
async function remember($: EngineInterface, state: State, id: string, paths: readonly string[], base: string): Promise<void> {
  try {
    for (const path of paths) {
      const shot = await prepare($, absolute(path, base))
      if (shot === undefined) continue
      state.shots.set(id, shot)
      if (state.shots.size > MAX_SHOTS) {
        const oldest = state.shots.keys().next().value ?? ''
        state.shots.delete(oldest)
        state.grids.delete(oldest)
      }
      $.ui.invalidate('ui.render')
      return
    }
  } catch (err) {
    report($, state, err)
  }
}

const answered = (r: ToolCallResult): boolean => r.deny === undefined && r.isError !== true

/** Stores the block characters and redraws; every grid is made again for the new family. */
async function setGlyphs($: EngineInterface, state: State, word: string): Promise<string> {
  if (!isGlyphs(word)) return `glyphs expects half or quadrant; now ${state.glyphs}`
  await $.store.set(GLYPHS_KEY, word)
  state.glyphs = word
  $.ui.invalidate('ui.render')
  const { across, down } = GLYPHS[word]
  return `glyphs ${word}: ${across}x${down} pixels a cell on a terminal without the kitty graphics protocol`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    $.ui.invalidate('ui.render')
    return word === 'on' ? 'on: saved and read pictures draw under their tool row' : 'off: no picture is drawn'
  }
  if (word.startsWith('glyphs')) return setGlyphs($, state, word.slice('glyphs'.length).trim())
  const how = state.graphics ? 'this terminal draws the picture itself' : `this terminal has no kitty graphics protocol, so a picture is drawn as ${state.glyphs} block cells`
  return word === '' ? `${state.enabled ? 'on' : 'off'}; ${state.shots.size} picture(s) this session; ${how}` : USAGE
}

export const register: Register = on => {
  const state: State = { shots: new Map(), enabled: true, grids: new Map(), root: '', graphics: false, glyphs: DEFAULT_GLYPHS }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'shot-inline', description: 'Pictures under their tool row: status, on, off, glyphs (shot-inline)', argumentHint: '[on | off | glyphs half|quadrant]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    const glyphs = await $.store.get(GLYPHS_KEY)
    state.glyphs = isGlyphs(glyphs) ? glyphs : DEFAULT_GLYPHS
    state.root = await $.session.cwd()
    state.graphics = hasGraphics((await $.env.get('TERM')) ?? '', (await $.env.get('TERM_PROGRAM')) ?? '', (await $.env.get('KITTY_WINDOW_ID')) ?? '')
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'shot-inline' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const r = await next(e)
    if (state.enabled && answered(r) && isImagePath(e.file_path)) await remember($, state, e.tool_use_id, [e.file_path], await $.session.cwd())
    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    const paths = state.enabled && answered(r) ? commandImagePaths(e.command) : []
    // A Bash command runs where its shell stands, which a `cd` moves, so its paths read against that.
    if (paths.length > 0) await remember($, state, e.tool_use_id, paths, await $.session.cwd())
    return r
  })

  on('tool.call', { tool: SCREENSHOT_TOOL }, async ($, e, next) => {
    const r = await next(e)
    const path = state.enabled && answered(r) ? screenshotPath(r.text ?? '') : undefined
    // The Playwright server writes a relative path under the directory it started in, the session's own,
    // which a Bash `cd` does not move.
    if (path !== undefined) await remember($, state, e.tool_use_id, [path], state.root)
    return r
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const shot = state.enabled && e.surface === 'terminal' ? state.shots.get(e.requestId) : undefined
    if (shot === undefined || e.surface !== 'terminal') return next(e)
    const drawn = await next(e)
    const { Box, Image, Raster } = $.ui.resolve(e)
    const box = cells(shot.size, Math.min(80, Math.max(10, (e.viewport?.columns ?? 84) - 4)))
    const key = `${e.requestId}:${box.columns}x${box.rows}:${state.glyphs}`
    const grid = state.graphics ? undefined : await gridFor($, state, e.requestId, shot, box, key)
    return (
      <Box flexDirection="column">
        {drawn}
        {grid === undefined
          ? <Image source={{ file: shot.png, format: 'png' }} columns={box.columns} rows={box.rows} alt={`picture: ${shot.source}`} />
          : <Raster key={key} columns={box.columns} rows={box.rows} cells={grid} />}
      </Box>
    )
  })
}
