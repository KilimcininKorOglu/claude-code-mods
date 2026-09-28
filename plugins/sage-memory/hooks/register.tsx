import type { EngineInterface, Register } from 'claude-code'
import { launchOf, NODE_PROBE, nodeProblem, setupText, stateLine, statusText, tokenOf, valueOf, type Line, type LinkView } from './link.ts'
import { hexOf, keySource, projectKey, projectNameFrom } from './project.ts'
import { layoutOf, MAX_SOCKET_BYTES, utf8Bytes, type Layout } from './shared/layout.ts'
import type { EmbedStatus, ProjectRef, SetupJob, Status } from './shared/protocol.ts'

const ENABLED_KEY = 'enabled'
const SECTION = { consumer: 'sage-memory', key: 'state' }
const USAGE = 'expects nothing (the state), on, off or setup'

/** How long each kind of call may take before the mod names it late. */
const NODE_MS = 10_000
const LAUNCH_MS = 30_000
const CALL_MS = 30_000
/** How often a running setup job is asked where it is. */
const SETUP_POLL_MS = 2000

/**
 * The on/off setting as last read, the project, the daemon's directory and token, and what the
 * person sees of the link.
 */
type State = { enabled: boolean; project?: ProjectRef; layout?: Layout; token?: string; link: LinkView; polling: boolean }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Reads the on/off setting at the hook that acts on it, because every window shares the store. */
async function readEnabled($: EngineInterface, state: State): Promise<boolean> {
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
  return state.enabled
}

/** Races `work` with a timer, so a call that never answers is named instead of waited on. */
async function within<T>($: EngineInterface, ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: { cancel: () => void } | undefined
  const late = new Promise<never>((_, reject) => {
    timer = $.clock.after(ms, () => reject(new Error(`${what} gave no answer in ${ms / 1000} s`)))
  })
  try {
    return await Promise.race([work, late])
  } finally {
    timer?.cancel()
  }
}

/** The sidebar section, or the status line while the sidebar does not take it. */
async function toPerson($: EngineInterface, line: Line): Promise<void> {
  try {
    if (await $.sidebar.set({ ...SECTION, title: 'memory', lines: [line], until: 'session', order: 23 })) {
      $.ui.status(undefined)
      return
    }
  } catch {
    // The sidebar mod is not installed; the status line carries the state.
  }
  $.ui.status(line.text)
}

async function show($: EngineInterface, state: State): Promise<void> {
  await toPerson($, stateLine(state.link, state.project?.name ?? ''))
}

async function git($: EngineInterface, args: string[]): Promise<string> {
  const r = await $.process.run(['git', ...args], { timeoutMs: 5000, env: { LC_ALL: 'C' } })
  return r.exitCode === 0 ? r.stdout.trim() : ''
}

/** The session's project: its name, the key of its store, its root and the git common dir. */
async function resolveProject($: EngineInterface): Promise<ProjectRef> {
  const cwd = await $.session.cwd()
  const commonDir = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const topLevel = await git($, ['rev-parse', '--show-toplevel'])
  const name = projectNameFrom(commonDir, topLevel, cwd)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keySource(commonDir, cwd)))
  return { key: projectKey(name, hexOf(new Uint8Array(digest))), name, root: topLevel !== '' ? topLevel : cwd, commonDir: keySource(commonDir, cwd) }
}

/** `<config dir>/sage-memory`, where the daemon, its socket and the stores live. */
async function layoutFor($: EngineInterface): Promise<Layout> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
  const layout = layoutOf(`${config.replace(/\/+$/, '')}/sage-memory`)
  const bytes = utf8Bytes(layout.socket)
  if (bytes > MAX_SOCKET_BYTES) throw new Error(`the socket path ${layout.socket} is ${bytes} bytes, over ${MAX_SOCKET_BYTES}`)
  return layout
}

async function checkNode($: EngineInterface): Promise<void> {
  const r = await within($, NODE_MS, 'node', $.process.run(['node', '-p', NODE_PROBE], { timeoutMs: NODE_MS }))
  const problem = r.exitCode === 0 ? nodeProblem(r.stdout) : `node did not run: ${r.stderr.trim().slice(0, 200)}`
  if (problem !== null) throw new Error(problem)
}

/** Runs the launcher, which answers once a daemon of this plugin's protocol listens, and reads its token. */
async function launch($: EngineInterface, layout: Layout): Promise<string> {
  const argv = ['node', '--disable-warning=ExperimentalWarning', `${$.plugin.root}/daemon/launch.ts`, '--dir', layout.dir]
  const r = await within($, LAUNCH_MS, 'the launcher', $.process.run(argv, { timeoutMs: LAUNCH_MS }))
  const outcome = launchOf(r.stdout)
  if (!outcome.ready) throw new Error(outcome.log === undefined ? outcome.error : `${outcome.error}\n${outcome.log}`)
  return tokenOf(await $.fs.read(layout.serverFile))
}

/** One daemon route: its value, or an error that names the route. */
async function ask<T>($: EngineInterface, state: State, path: string, body: Record<string, unknown>, ms = CALL_MS): Promise<T> {
  if (state.layout === undefined || state.token === undefined) throw new Error('the daemon is not connected')
  const init = {
    method: 'POST',
    socketPath: state.layout.socket,
    headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ project: state.project, ...body }),
  }
  const r = await within($, ms, path, $.http.fetch(`http://sage-memory${path}`, init))
  return valueOf<T>(path, r.status, r.text)
}

/** Checks Node, finds the project, starts or joins the daemon, and reads its embeddings. */
async function connect($: EngineInterface, state: State): Promise<void> {
  state.link = { state: 'starting' }
  await show($, state)
  try {
    await checkNode($)
    state.project = await resolveProject($)
    state.layout = await layoutFor($)
    state.token = await launch($, state.layout)
    const daemon = await ask<Status>($, state, '/status', {})
    const status = await ask<EmbedStatus>($, state, '/embed/status', {})
    state.link = { state: 'ready', pid: daemon.pid, embedding: status.embedding, setup: status.setup }
  } catch (err) {
    state.link = { state: 'failed', error: errorText(err) }
  }
  await show($, state)
}

/** Follows a setup job every 2 s until it ends, and shows each step. */
async function pollSetup($: EngineInterface, state: State): Promise<void> {
  if (state.polling) return
  state.polling = true
  const tick = $.clock.every(SETUP_POLL_MS, () => {
    void ask<EmbedStatus>($, state, '/embed/status', {}).then(
      status => {
        if (state.link.state === 'ready') state.link = { ...state.link, embedding: status.embedding, setup: status.setup }
        if (status.setup.state !== 'running') {
          tick.cancel()
          state.polling = false
          $.ui.log(setupText(status.setup))
        }
        return show($, state)
      },
      (err: unknown) => {
        tick.cancel()
        state.polling = false
        $.ui.log(`the setup job could not be followed: ${errorText(err)}`)
      },
    )
  })
}

async function setup($: EngineInterface, state: State): Promise<string> {
  if (state.link.state !== 'ready') return `the daemon is not ready: ${statusText(state.enabled, state.link, state.project?.name ?? '')}`
  const job = await ask<SetupJob>($, state, '/embed/setup', {})
  if (job.state === 'running') await pollSetup($, state)
  return setupText(job)
}

async function turn($: EngineInterface, state: State, on: boolean): Promise<string> {
  await $.store.set(ENABLED_KEY, on)
  state.enabled = on
  if (!on) {
    state.link = { state: 'off' }
    await show($, state)
    return 'off: nothing is recalled or saved; the memories stay'
  }
  await connect($, state)
  return `on · ${stateLine(state.link, state.project?.name ?? '').text}`
}

/** Follows another window's on or off, as this window's own command would. */
async function follow($: EngineInterface, state: State): Promise<void> {
  const was = state.enabled
  if ((await readEnabled($, state)) === was) return
  if (state.enabled) await connect($, state)
  else {
    state.link = { state: 'off' }
    await show($, state)
  }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  await follow($, state)
  const word = args.trim().toLowerCase()
  if (word === 'on' || word === 'off') return turn($, state, word === 'on')
  if (word === 'setup') return setup($, state)
  return word === '' ? statusText(state.enabled, state.link, state.project?.name ?? '') : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, link: { state: 'off' }, polling: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'sage-memory', description: 'Project memory recalled when it is relevant: state, on, off, setup (sage-memory)', argumentHint: '[on | off | setup]' })
    if (await readEnabled($, state)) await connect($, state)
    else await show($, state)
    return r
  })

  on('command.run', { command: 'sage-memory' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // Each turn follows an on or off another window stored, before it would recall anything.
  on('turn.start', async ($, e, next) => {
    await follow($, state)
    return next(e)
  })
}
