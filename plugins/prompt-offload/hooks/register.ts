import type { EngineInterface, PromptOrigin, Register } from 'claude-code'
import { DEFAULT_LIMIT, MIN_LIMIT, fileName, isLong, limitOf, logText, offloadText } from './offload.ts'

const ENABLED_KEY = 'enabled'
const LIMIT_KEY = 'limit'

const USAGE = `expects nothing (the status), on, off or limit <n> (at least ${MIN_LIMIT})`

type State = { enabled: boolean; limit: number; lastError?: string }

/** The person's own prompts: typed at the terminal or sent from a phone. */
function isPersons(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Logs an error once until a different one comes; the prompt itself is never dropped. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`the prompt was left as it is: ${text}`)
  state.lastError = text
}

/** The directory the files go in, made when it is missing. */
async function tempDir($: EngineInterface): Promise<string> {
  const dir = `${((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')}/prompt-offload`
  const made = await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5_000 })
  if (made.exitCode !== 0) throw new Error(`mkdir ${dir} failed: ${made.stderr.trim()}`)
  return dir
}

/** Writes the whole prompt to a file and answers the text the model reads, or the prompt unchanged. */
async function offload($: EngineInterface, state: State, text: string): Promise<string> {
  try {
    const path = `${await tempDir($)}/${fileName(text, await $.clock.now())}`
    await $.fs.write(path, text)
    $.ui.log(logText(text, path))
    return offloadText(text, path)
  } catch (err) {
    report($, state, err)
    return text
  }
}

async function setLimit($: EngineInterface, state: State, arg: string): Promise<string> {
  const limit = limitOf(arg)
  if (limit === undefined) return `limit expects a whole number of at least ${MIN_LIMIT}`
  await $.store.set(LIMIT_KEY, limit)
  state.limit = limit
  return `limit ${limit}: a prompt longer than that goes to a file`
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  await $.store.set(ENABLED_KEY, on)
  state.enabled = on
  return on ? `on: a prompt over ${state.limit} characters goes to a file` : 'off: every prompt reaches the model as it is'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const [word = '', arg = ''] = args.trim().split(/\s+/)
  if (word === 'on' || word === 'off') return setEnabled($, state, word === 'on')
  if (word === 'limit') return setLimit($, state, arg)
  return word === '' ? `${state.enabled ? 'on' : 'off'} · limit ${state.limit} characters` : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, limit: DEFAULT_LIMIT }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'prompt-offload', description: 'Long pasted prompts to a file: status, on, off, limit <n> (prompt-offload)', argumentHint: '[on | off | limit <n>]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.limit = Number(await $.store.get(LIMIT_KEY)) || DEFAULT_LIMIT
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'prompt-offload' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('prompt.submit', async ($, e, next) => {
    if (!state.enabled || !isPersons(e.origin) || !isLong(e.text, state.limit)) return next(e)
    return next({ ...e, text: await offload($, state, e.text) })
  })
}
