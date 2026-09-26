import type { EngineInterface, Register } from 'claude-code'
import { BAND_COLUMNS, BAND_ROWS, configOf, helpText, isStyle, nameProblem, parseArgs, pickStyle, sceneOf, statusText, STYLES, unknownText, type Action, type Config } from './config.ts'
import { clipFromGif, isClip, type Clip } from './clip.ts'
import { bytesOf } from './gif.ts'
import type { NextMessage, SceneProps } from './scene.tsx'

interface State {
  cfg: Config
  /** The saved clips by name, as the store holds them. */
  clips: Map<string, Clip>
  /** When the band first saw the model working in this turn; null while it is idle. */
  since: number | null
  /** The scene and seed of the running turn, and the scene of the one before. */
  style: string | null
  seed: number
  last: string | null
  /** The region the scene was last drawn in, which the next scene of the same turn takes. */
  size?: Size
}

type Size = { width: number; height: number }

/** Rows below which a band has no room for a picture. */
const MIN_ROWS = 3
/** `$.fs.read` refuses a file over 4 MiB; a larger GIF is read through `base64`, up to 32 MiB. */
const MAX_READ_BYTES = 4 * 1024 * 1024
const MAX_BIG_GIF_BYTES = 32 * 1024 * 1024
/** The store key of the saved clip names, and the prefix of each clip's own key. */
const CLIPS_KEY = 'clips'
const CLIP_PREFIX = 'clip:'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The saved clips; a name whose entry is gone or broken is left out, and so is one a built-in scene took
 * after it was saved (`cat`), so the clip never hides the scene.
 */
async function loadClips($: EngineInterface): Promise<Map<string, Clip>> {
  const names = await $.store.get(CLIPS_KEY)
  const clips = new Map<string, Clip>()
  if (!Array.isArray(names)) return clips
  for (const name of names) {
    if (typeof name !== 'string' || nameProblem(name) !== null) continue
    const clip = await $.store.get(`${CLIP_PREFIX}${name}`)
    if (isClip(clip)) clips.set(name, clip)
  }
  return clips
}

async function loadConfig($: EngineInterface, clips: readonly string[]): Promise<Config> {
  const [enabled, style, delay] = await Promise.all([$.store.get('enabled'), $.store.get('style'), $.store.get('delay')])
  return configOf(enabled, style, delay, clips)
}

/** Picks the next scene and its seed, never the one shown last. */
function pickScene(state: State): void {
  state.style = pickStyle(state.cfg.style, state.last, Math.random, [...state.clips.keys()])
  state.last = state.style
  state.seed = Math.floor(Math.random() * 2 ** 31)
}

/** A turn began: pick its scene and seed, and redraw once the delay has passed. */
function beginTurn($: EngineInterface, state: State, now: number): void {
  state.since = now
  pickScene(state)
  if (state.cfg.delaySec > 0) $.clock.after(state.cfg.delaySec * 1000, () => $.ui.invalidate('ui.render'))
}

/** The props of the current scene in a region; under `random` the scene gives way to another once it has run. */
function propsOf(state: State, style: string, size: Size): SceneProps {
  const props: SceneProps = { style, seed: state.seed, ...size, rotate: state.cfg.style === 'random' }
  const clip = state.clips.get(style)
  return clip === undefined ? props : { ...props, clip }
}

/** The scene of a working band, or null while the delay runs or the band has no room. */
async function sceneFor($: EngineInterface, state: State, band: { maxRows: number; bodyColumns: number }): Promise<SceneProps | null> {
  const now = await $.clock.now()
  if (state.since === null) beginTurn($, state, now)
  const height = Math.min(BAND_ROWS, band.maxRows)
  const waited = now - (state.since ?? now) >= state.cfg.delaySec * 1000
  if (state.style === null || !waited || height < MIN_ROWS) return null
  state.size = { width: Math.min(BAND_COLUMNS, band.bodyColumns), height }
  return propsOf(state, state.style, state.size)
}

/**
 * The next scene's props when the running one asks to leave: only under `random`, only for the scene
 * showing now (a late or repeated message changes nothing), and only while a band is drawn.
 */
function nextScene(state: State, data: unknown): SceneProps | undefined {
  const asked = (data as Partial<NextMessage> | null)?.next
  if (state.cfg.style !== 'random' || state.style === null || state.size === undefined) return undefined
  if (asked !== sceneOf({ style: state.style, seed: state.seed })) return undefined
  pickScene(state)
  return propsOf(state, state.style as string, state.size)
}

/** A path as typed: `~` is the home directory, and a relative path is under the session's directory. */
async function resolvePath($: EngineInterface, path: string): Promise<string> {
  if (path === '~' || path.startsWith('~/')) return `${(await $.env.get('HOME')) ?? ''}${path.slice(1)}`
  if (path.startsWith('/')) return path
  return `${(await $.session.cwd()).replace(/\/+$/, '')}/${path}`
}

/**
 * A GIF's bytes: `$.fs.read` up to its 4 MiB limit, and `base64 <path>` above it,
 * whose text the mod decodes itself, up to 32 MiB.
 */
async function readGifBytes($: EngineInterface, path: string): Promise<Uint8Array> {
  if (!(await $.fs.exists(path))) throw new Error(`${path} does not exist`)
  const st = await $.fs.stat(path)
  if (st.kind !== 'file') throw new Error(`${path} is not a file`)
  const size = st.size ?? 0
  if (size > MAX_BIG_GIF_BYTES) throw new Error(`${path} is ${Math.round(size / 1024 / 1024)} MiB, over the 32 MiB limit`)
  if (size <= MAX_READ_BYTES) return bytesOf((await $.fs.read(path, { as: 'bytes' })).base64)
  // macOS base64 takes its input file only after `-i`; GNU base64 reads `-i` as --ignore-garbage, which only
  // decoding uses, and the path as its input file.
  const bytes = bytesOf(await streamedStdout($, ['base64', '-i', path]))
  if (bytes.length !== size) throw new Error(`base64 gave ${bytes.length} bytes of ${size}`)
  return bytes
}

/**
 * A command's whole stdout, read piece by piece: `$.process.run` cuts stdout at
 * 4 MiB (measured on 2.1.283), and a large GIF's base64 is longer.
 */
async function streamedStdout($: EngineInterface, argv: string[]): Promise<string> {
  const parts: string[] = []
  const errors: string[] = []
  const child = $.process.spawn({ argv })
  for (;;) {
    const step = await child.next()
    if (step.done) {
      if (step.value.code !== 0) throw new Error(`${argv[0]} failed: ${errors.join('').trim().slice(0, 200)}`)
      return parts.join('')
    }
    ;(step.value.stream === 'stdout' ? parts : errors).push(step.value.text)
  }
}

async function saveClips($: EngineInterface, state: State): Promise<void> {
  await $.store.set(CLIPS_KEY, [...state.clips.keys()])
}

/** Turns a GIF into a clip, keeps it in the store under its name, and says what was kept. */
async function importGif($: EngineInterface, state: State, typed: string, name: string): Promise<string> {
  const path = await resolvePath($, typed)
  let clip: Clip
  let dropped: number
  let frames: number
  try {
    ;({ clip, dropped, frames } = clipFromGif(await readGifBytes($, path), BAND_COLUMNS, BAND_ROWS))
  } catch (err) {
    return `cannot import ${typed}: ${errorText(err)}`
  }
  try {
    await $.store.set(`${CLIP_PREFIX}${name}`, clip)
  } catch (err) {
    return `cannot save ${name}: ${errorText(err)}. The store holds 4 MiB in all; /idle-art remove <name> frees room.`
  }
  const replaced = state.clips.has(name)
  state.clips.set(name, clip)
  await saveClips($, state)
  const kept = dropped > 0 ? `${clip.frames.length} of ${frames} frames (the rest dropped to fit)` : `${frames} frames`
  return `${replaced ? 'replaced' : 'saved'} ${name}: ${kept}, ${clip.width}×${clip.height} cells. Use it with /idle-art ${name}; random draws it too.`
}

async function removeClip($: EngineInterface, state: State, name: string): Promise<string> {
  if (!state.clips.has(name)) return `no saved clip is named ${name}`
  state.clips.delete(name)
  await $.store.delete(`${CLIP_PREFIX}${name}`)
  await saveClips($, state)
  const wasChosen = state.cfg.style === name
  if (wasChosen) {
    state.cfg.style = 'random'
    await $.store.set('style', 'random')
  }
  return `removed ${name}${wasChosen ? '; the style is random again' : ''}`
}

function listText(state: State): string {
  const clips = [...state.clips].map(([name, c]) => `${name} (${c.frames.length} frames, ${c.width}×${c.height})`)
  return [`built in: ${STYLES.join(', ')}`, `saved clips: ${clips.length > 0 ? clips.join(', ') : 'none; add one with /idle-art import <gif path> <name>'}`].join('\n')
}

/** Stores a setting, redraws, and answers with the state. */
async function setting($: EngineInterface, state: State, key: 'enabled' | 'style' | 'delay', value: boolean | string | number): Promise<string> {
  if (key === 'enabled') state.cfg.enabled = value as boolean
  if (key === 'style') state.cfg.style = value as string
  if (key === 'delay') state.cfg.delaySec = value as number
  await $.store.set(key, value)
  $.ui.invalidate('ui.render')
  return statusText(state.cfg)
}

/** Stores the chosen style, and a turn already drawing takes it at once instead of at its end. */
async function chooseStyle($: EngineInterface, state: State, style: string): Promise<string> {
  if (style !== 'random' && !isStyle(style) && !state.clips.has(style)) return unknownText(style, [...state.clips.keys()])
  state.cfg.style = style
  if (state.since !== null) pickScene(state)
  return setting($, state, 'style', style)
}

async function apply($: EngineInterface, state: State, action: Action): Promise<string> {
  switch (action.kind) {
    case 'status':
      return statusText(state.cfg)
    case 'help':
      return helpText(state.cfg)
    case 'list':
      return listText(state)
    case 'error':
      return action.text
    case 'enable':
      return setting($, state, 'enabled', action.enabled)
    case 'delay':
      return setting($, state, 'delay', action.seconds)
    case 'style':
      return chooseStyle($, state, action.style)
    case 'import':
      return importGif($, state, action.path, action.name)
    case 'remove':
      return removeClip($, state, action.name)
  }
}

export const register: Register = on => {
  const state: State = { cfg: configOf(undefined, undefined, undefined, []), clips: new Map(), since: null, style: null, seed: 0, last: null }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.clips = await loadClips($)
    state.cfg = await loadConfig($, [...state.clips.keys()])
    await $.command.register({ name: 'idle-art', description: 'ASCII animation above the prompt while the model works: on, off, a scene, random, delay, import a GIF (idle-art)', immediate: true })
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (!e.props.isWorking) state.since = null
    if (!state.cfg.enabled || e.surface !== 'terminal' || e.props.hasSurvey || !e.props.isWorking) return drawn
    const props = await sceneFor($, state, e.props)
    if (props === null) return drawn
    const { Box, Client } = $.ui.resolve(e)
    // What another plugin drew in the band stays above the picture.
    return (
      <Box flexDirection="column">
        {drawn}
        <Client key="idle-art" module="./scene.tsx" width={props.width} height={props.height} props={props} />
      </Box>
    )
  })

  // A scene under `random` that has run its time asks for the next; the answer's props start it in place.
  on('ui.message', async (_, e, next) => {
    if (e.element !== 'idle-art') return next(e)
    const props = nextScene(state, e.data)
    return props === undefined ? next(e) : { props }
  })

  // The band is not drawn idle between two turns, so the main loop's turn end is what starts the next
  // turn with a new style and its own delay.
  on('turn.complete', async (_, e, next) => {
    if (e.agentId === undefined) state.since = null
    return next(e)
  })

  on('command.run', { command: 'idle-art' }, async ($, e) => ({ text: await apply($, state, parseArgs(e.args)) }))
}
