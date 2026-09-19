import type { EngineInterface, Register } from 'claude-code'
import { blockHash, cells, failureLine, mermaidBlocks, pngSize, type Size } from './diagram.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

const INSTALL_HINT = 'mmdc is not installed, so mermaid blocks stay text: npm i -g @mermaid-js/mermaid-cli'

/** mmdc starts a headless browser; a large diagram takes seconds. */
const RENDER_TIMEOUT_MS = 60_000

/**
 * Blocks drawn in a reply wait in `wanted` until the turn ends; `ready` holds the rendered pictures and
 * `failed` the blocks mmdc refused, so neither is tried again. `hasMmdc` is undefined until checked.
 */
type State = {
  enabled: boolean
  wanted: Map<string, string>
  ready: Map<string, { png: string; size: Size }>
  failed: Set<string>
  busy: boolean
  hasMmdc?: boolean
  dir?: string
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Whether mmdc runs; the answer is kept, and a missing mmdc is said once. */
async function mmdcReady($: EngineInterface, state: State): Promise<boolean> {
  if (state.hasMmdc !== undefined) return state.hasMmdc
  const found = await $.process.run(['mmdc', '--version'], { timeoutMs: 20_000 }).then(r => r.exitCode === 0, () => false)
  state.hasMmdc = found
  if (!found) $.ui.log(INSTALL_HINT)
  return found
}

async function workDir($: EngineInterface, state: State): Promise<string> {
  state.dir ??= `${((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')}/diagram-render`
  return state.dir
}

/** Renders one block to `<hash>.png` and answers its size, or throws with mmdc's reason. */
async function renderOne($: EngineInterface, state: State, hash: string, source: string): Promise<{ png: string; size: Size }> {
  const dir = await workDir($, state)
  const input = `${dir}/${hash}.mmd`
  const png = `${dir}/${hash}.png`
  await $.fs.write(input, `${source}\n`)
  const r = await $.process.run(['mmdc', '-i', input, '-o', png, '-b', 'transparent', '-t', 'dark', '-q'], { timeoutMs: RENDER_TIMEOUT_MS })
  if (r.exitCode !== 0) throw new Error(failureLine(`${r.stderr}\n${r.stdout}`))
  const size = pngSize((await $.fs.read(png, { as: 'bytes' })).base64)
  if (size === undefined) throw new Error(`${png} is not a PNG`)
  return { png, size }
}

/** Renders the waiting blocks one at a time, in the background; a failed block is logged and not tried again. */
async function drain($: EngineInterface, state: State): Promise<void> {
  if (state.busy || state.wanted.size === 0) return
  state.busy = true
  try {
    if (!(await mmdcReady($, state))) return state.wanted.clear()
    for (const [hash, source] of state.wanted) {
      state.wanted.delete(hash)
      await renderOne($, state, hash, source).then(
        picture => { state.ready.set(hash, picture); $.ui.invalidate('ui.render') },
        (err: unknown) => { state.failed.add(hash); $.ui.log(`a diagram was not rendered: ${errorText(err)}`) },
      )
    }
  } finally {
    state.busy = false
  }
}

/** Queues the blocks of a drawn reply that have no picture yet. */
function want(state: State, blocks: readonly string[]): void {
  if (state.hasMmdc === false) return
  for (const source of blocks) {
    const hash = blockHash(source)
    if (!state.ready.has(hash) && !state.failed.has(hash)) state.wanted.set(hash, source)
  }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    $.ui.invalidate('ui.render')
    return word === 'on' ? 'on: mermaid blocks render under their reply after each turn' : 'off: mermaid blocks stay text'
  }
  if (word !== '') return USAGE
  const mmdc = state.hasMmdc === undefined ? 'mmdc not checked yet' : state.hasMmdc ? 'mmdc found' : 'mmdc missing'
  return `${state.enabled ? 'on' : 'off'}; ${mmdc}; ${state.ready.size} rendered, ${state.failed.size} failed this session`
}

export const register: Register = on => {
  const state: State = { enabled: true, wanted: new Map(), ready: new Map(), failed: new Set(), busy: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'diagram-render', description: 'Mermaid blocks as pictures: status, on, off (diagram-render)', argumentHint: '[on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'diagram-render' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!state.enabled || e.agentId !== undefined) return r
    want(state, mermaidBlocks(e.answer))
    // Not awaited: mmdc takes seconds, and the next prompt must not wait for it.
    void drain($, state)
    return r
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const blocks = state.enabled && e.surface === 'terminal' ? mermaidBlocks(e.props.text) : []
    if (blocks.length === 0 || e.surface !== 'terminal') return next(e)
    want(state, blocks)
    const pictures = blocks.map(blockHash).map(h => state.ready.get(h)).filter(p => p !== undefined)
    const drawn = await next(e)
    if (pictures.length === 0) return drawn
    const { Box, Image } = $.ui.resolve(e)
    const maxColumns = Math.min(100, Math.max(10, (e.viewport?.columns ?? 84) - 4))
    return (
      <Box flexDirection="column">
        {drawn}
        {pictures.map((p, i) => {
          const box = cells(p.size, maxColumns)
          return <Image key={`diagram:${i}`} source={{ file: p.png, format: 'png' }} columns={box.columns} rows={box.rows} alt={`mermaid diagram ${i + 1}`} />
        })}
      </Box>
    )
  })
}
