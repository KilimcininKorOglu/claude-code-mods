import type { EngineInterface, Register } from 'claude-code'
import { BAND_COLUMNS, BAND_ROWS, configOf, helpText, parseArgs, pickStyle, statusText, type Action, type Config, type Style } from './config.ts'
import type { SceneProps } from './scene.tsx'

interface State {
  cfg: Config
  /** When the band first saw the model working in this turn; null while it is idle. */
  since: number | null
  /** The style and seed of the running turn, and the style of the one before. */
  style: Style | null
  seed: number
  last: Style | null
}

/** Rows below which a band has no room for a picture. */
const MIN_ROWS = 3

async function loadConfig($: EngineInterface): Promise<Config> {
  const [enabled, style, delay] = await Promise.all([$.store.get('enabled'), $.store.get('style'), $.store.get('delay')])
  return configOf(enabled, style, delay)
}

/** A turn began: pick its style and seed, and redraw once the delay has passed. */
function beginTurn($: EngineInterface, state: State, now: number): void {
  state.since = now
  state.style = pickStyle(state.cfg.style, state.last, Math.random)
  state.last = state.style
  state.seed = Math.floor(Math.random() * 2 ** 31)
  if (state.cfg.delaySec > 0) $.clock.after(state.cfg.delaySec * 1000, () => $.ui.invalidate('ui.render'))
}

/** The scene of a working band, or null while the delay runs or the band has no room. */
async function sceneFor($: EngineInterface, state: State, band: { maxRows: number; bodyColumns: number }): Promise<SceneProps | null> {
  const now = await $.clock.now()
  if (state.since === null) beginTurn($, state, now)
  const height = Math.min(BAND_ROWS, band.maxRows)
  const waited = now - (state.since ?? now) >= state.cfg.delaySec * 1000
  if (state.style === null || !waited || height < MIN_ROWS) return null
  return { style: state.style, seed: state.seed, width: Math.min(BAND_COLUMNS, band.bodyColumns), height }
}

async function apply($: EngineInterface, state: State, action: Action): Promise<string> {
  switch (action.kind) {
    case 'status':
      return statusText(state.cfg)
    case 'help':
      return helpText(state.cfg)
    case 'error':
      return action.text
    case 'enable':
      state.cfg.enabled = action.enabled
      await $.store.set('enabled', action.enabled)
      break
    case 'style':
      state.cfg.style = action.style
      await $.store.set('style', action.style)
      break
    case 'delay':
      state.cfg.delaySec = action.seconds
      await $.store.set('delay', action.seconds)
      break
  }
  $.ui.invalidate('ui.render')
  return statusText(state.cfg)
}

export const register: Register = on => {
  const state: State = { cfg: configOf(undefined, undefined, undefined), since: null, style: null, seed: 0, last: null }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.cfg = await loadConfig($)
    await $.command.register({ name: 'idle-art', description: 'ASCII animation above the prompt while the model works: on, off, a style, random, delay (idle-art)', immediate: true })
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

  on('command.run', { command: 'idle-art' }, async ($, e) => ({ text: await apply($, state, parseArgs(e.args)) }))
}
