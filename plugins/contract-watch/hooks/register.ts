import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { changedSignatures, logText, noteText, parseCheck } from './signature.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/** The last error logged, so the same one is logged once. */
type State = { lastError?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED_KEY)) !== false
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

/** The repository root and the file's path inside it, or undefined outside git. */
async function locate($: EngineInterface, file: string): Promise<{ root: string; rel: string } | undefined> {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel', '--show-prefix'], { cwd: dirOf(file), timeoutMs: 10_000 })
  if (r.exitCode !== 0) return undefined
  const [root = '', prefix = ''] = r.stdout.split('\n')
  return root === '' ? undefined : { root, rel: `${prefix}${file.slice(file.lastIndexOf('/') + 1)}` }
}

/** Asks ripwire about one changed function and answers the note, if its callers need a look. */
async function checkOne($: EngineInterface, root: string, rel: string, name: string): Promise<string | undefined> {
  const r = await $.process.run(['ripwire', root, `--edit-check=${rel}:${name}`], { cwd: root, timeoutMs: 20_000 })
  if (r.exitCode !== 0) throw new Error(`ripwire --edit-check failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`)
  const check = parseCheck(r.stdout)
  if (check === undefined) return undefined
  // The note goes to the model, the log line to the person: neither reads the other's channel.
  const line = logText(check)
  if (line !== undefined) $.ui.log(line)
  return noteText(check)
}

async function notesFor($: EngineInterface, file: string, names: readonly string[]): Promise<string[]> {
  const place = await locate($, file)
  if (place === undefined) return []
  const notes: string[] = []
  for (const name of names) {
    const note = await checkOne($, place.root, place.rel, name)
    if (note !== undefined) notes.push(note)
  }
  return notes
}

/** Logs an error once until a different one comes. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`the callers were not checked: ${text}`)
  state.lastError = text
}

function withNotes(r: ToolCallResult, notes: readonly string[]): ToolCallResult {
  if (notes.length === 0 || r.deny !== undefined || r.isError === true) return r
  return { ...r, context: [...(r.context ?? []), ...notes] }
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    return word === 'on' ? 'on: a changed signature brings its callers to the model' : 'off: signatures are not checked'
  }
  return word === '' ? `${(await isEnabled($)) ? 'on' : 'off'}; it needs ripwire on PATH` : USAGE
}

export const register: Register = on => {
  const state: State = {}

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'contract-watch', description: 'Callers of a changed signature: status, on, off (contract-watch)', argumentHint: '[on | off]' })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'contract-watch' }, async ($, e) => ({ text: await runCommand($, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true || !(await isEnabled($))) return r
    const names = changedSignatures(e.old_string, e.new_string)
    if (names.length === 0) return r
    try {
      const notes = await notesFor($, e.file_path, names)
      state.lastError = undefined
      return withNotes(r, notes)
    } catch (err) {
      report($, state, err)
      return r
    }
  })
}
