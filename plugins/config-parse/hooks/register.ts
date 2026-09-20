import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { doneLines, doneLog, envError, isMissingTool, jsonError, kindOf, logText, noteText, pythonCode, pythonError, sectionKey, shownPath, sidebarLines, type Kind } from './parse.ts'

const ENABLED_KEY = 'enabled'

const CONSUMER = 'config-parse'

const USAGE = 'expects nothing (the status), on or off'

/**
 * The on/off setting, the files whose finding still stands, the kinds this machine cannot parse, and
 * the directory the session started in. A path is shown against that directory, not against
 * `$.session.cwd()`, because a Bash `cd` moves the session's directory.
 */
type State = { enabled: boolean; open: Set<string>; skipped: Set<Kind>; reported: boolean; root?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The file's text after the edit, or undefined when it cannot be read; the first failure is logged. */
async function fileText($: EngineInterface, state: State, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch (err) {
    if (!state.reported) $.ui.log(`the edited file was not read: ${errorText(err)}`)
    state.reported = true
    return undefined
  }
}

/** The parse error python found, or undefined when the file parses or this machine cannot parse the kind. */
async function pythonCheck($: EngineInterface, state: State, kind: 'yaml' | 'toml', path: string): Promise<string | undefined> {
  if (state.skipped.has(kind)) return undefined
  const r = await $.process.run(['python3', '-c', pythonCode(kind), path], { timeoutMs: 10_000 })
  if (r.exitCode === 0) return undefined
  if (!isMissingTool(r.stderr)) return pythonError(r.stderr)
  state.skipped.add(kind)
  $.ui.log(`${kind.toUpperCase()} files are not checked on this machine: ${pythonError(r.stderr)}`)
  return undefined
}

/** The parse error of one file, or undefined when it parses. */
async function checkFile($: EngineInterface, state: State, kind: Kind, path: string): Promise<string | undefined> {
  if (kind === 'yaml' || kind === 'toml') return pythonCheck($, state, kind, path)
  const text = await fileText($, state, path)
  if (text === undefined) return undefined
  return kind === 'json' ? jsonError(text) : envError(text)
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, shown: string, title: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: CONSUMER, key: sectionKey(shown), title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Says the file parses again, once, and drops the standing finding. */
async function closeOne($: EngineInterface, state: State, kind: Kind, shown: string): Promise<void> {
  state.open.delete(shown)
  try {
    await $.sidebar.clear({ consumer: CONSUMER, key: sectionKey(shown) })
  } catch {
    // The sidebar mod is not installed.
  }
  await toPerson($, shown, 'config parses again', doneLines(shown), doneLog(kind, shown))
}

/** Checks the file an edit touched, and adds the note when it no longer parses. */
async function afterEdit($: EngineInterface, state: State, path: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  const kind = state.enabled ? kindOf(path) : undefined
  if (kind === undefined) return r
  const shown = shownPath(path, state.root ?? (await $.session.cwd()))
  const error = await checkFile($, state, kind, path)
  if (error === undefined) {
    if (state.open.has(shown)) await closeOne($, state, kind, shown)
    return r
  }
  state.open.add(shown)
  // The note goes to the model, the line to the person: neither reads the other's channel.
  await toPerson($, shown, 'config does not parse', sidebarLines(error), logText(kind, shown, error))
  return { ...r, context: [...(r.context ?? []), noteText(kind, shown, error)] }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each edited JSON, YAML, TOML and .env file is parsed' : 'off: edited files are not parsed'
  }
  if (word !== '') return USAGE
  const open = state.open.size === 0 ? 'no file is open' : `${[...state.open].join(' · ')} does not parse`
  return `${state.enabled ? 'on' : 'off'} · ${open}`
}

export const register: Register = on => {
  const state: State = { enabled: true, open: new Set(), skipped: new Set(), reported: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'config-parse', description: 'JSON, YAML, TOML and .env files an edit broke: status, on, off (config-parse)', argumentHint: '[on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.root = await $.session.cwd()
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'config-parse' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, await next(e)))
}
