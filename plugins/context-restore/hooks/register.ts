import type { EngineInterface, Register } from 'claude-code'
import { baseName, bodyOfFile, changedLog, changedNote, currentLog, currentText, rulePathsOf, sectionKey, sidebarLines, skillFileOf, statusText } from './restore.ts'

const ENABLED_KEY = 'enabled'
const CONSUMER = 'context-restore'
const USAGE = 'expects nothing (the status), on or off'

/**
 * The on/off setting, the directory the session started in, the host's config directory, when the session
 * started, every rules file it read with the time it was last written, and the last thing the mod did.
 */
type State = { enabled: boolean; root: string; config: string; startedAt: number; rules: Map<string, number>; last?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** What the mod did, told to the person: the sidebar while it is open, else one transcript line. */
async function toPerson($: EngineInterface, state: State, line: string): Promise<void> {
  state.last = line
  try {
    if (await $.sidebar.set({ consumer: CONSUMER, key: sectionKey(line), title: 'context restored', lines: sidebarLines(line), until: 'stream' })) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** The last write of a file, or undefined when it is not there. */
async function mtimeOf($: EngineInterface, path: string): Promise<number | undefined> {
  if (!(await $.fs.exists(path))) return undefined
  return (await $.fs.stat(path)).mtimeMs
}

/** The directories a plugin is installed in, from the host's install record. */
async function pluginDirs($: EngineInterface, state: State, plugin: string): Promise<string[]> {
  const record = `${state.config}/plugins/installed_plugins.json`
  if (!(await $.fs.exists(record))) return []
  const all = (JSON.parse(String(await $.fs.read(record))) as { plugins?: Record<string, { installPath?: unknown }[]> }).plugins ?? {}
  return Object.entries(all)
    .filter(([id]) => id.startsWith(`${plugin}@`))
    .flatMap(([, rows]) => rows.map(r => r.installPath).filter((p): p is string => typeof p === 'string'))
}

/**
 * The file a command came from: a plugin's `commands/<name>.md` for `<plugin>:<name>`, else the project's
 * or the person's `commands/<name>.md`. A built-in command has none.
 */
async function commandFileOf($: EngineInterface, state: State, name: string): Promise<string | undefined> {
  const colon = name.indexOf(':')
  const candidates = colon > 0
    ? (await pluginDirs($, state, name.slice(0, colon))).map(dir => `${dir}/commands/${name.slice(colon + 1)}.md`)
    : [`${state.root}/.claude/commands/${name}.md`, `${state.config}/commands/${name}.md`]
  for (const path of candidates) if (await $.fs.exists(path)) return path
  return undefined
}

/** A file's text as the engine hands it to the model. */
async function readBody($: EngineInterface, path: string): Promise<string> {
  const text = String(await $.fs.read(path))
  return path.endsWith('/SKILL.md') ? bodyOfFile(text, path.slice(0, -'/SKILL.md'.length)) : bodyOfFile(text)
}

/**
 * The text one call of a skill or command should carry: the file's current text when the engine handed an
 * older copy it loaded at the start, else undefined. A skill names its directory, a command is looked up.
 */
async function fresherText($: EngineInterface, state: State, name: string, text: string): Promise<string | undefined> {
  const file = skillFileOf(text) ?? (await commandFileOf($, state, name))
  if (file === undefined) return undefined
  const at = await mtimeOf($, file)
  if (at === undefined) return undefined
  return currentText(text, await readBody($, file), file, at > state.startedAt)
}

/** Records the rules files the session read, with the time each was last written. */
async function recordRules($: EngineInterface, state: State, text: string): Promise<void> {
  for (const path of rulePathsOf(text)) {
    const at = await mtimeOf($, path)
    if (at !== undefined) state.rules.set(path, at)
  }
}

/** One rules file that changed on disk: its label, its path and its new text. */
type Change = { label: string; path: string; text: string }

/** The rules files that changed on disk since the session read them; each record takes the new time. */
async function changedRules($: EngineInterface, state: State): Promise<Change[]> {
  const out: Change[] = []
  for (const [path, seen] of state.rules) {
    const at = await mtimeOf($, path)
    if (at === undefined || at === seen) continue
    state.rules.set(path, at)
    out.push({ label: baseName(path), path, text: String(await $.fs.read(path)) })
  }
  return out
}

/** The notes for every rules file that changed on disk, and one line to the person naming them. */
async function changeNotes($: EngineInterface, state: State): Promise<string[]> {
  let changes: Change[]
  try {
    changes = await changedRules($, state)
  } catch (err) {
    $.ui.log(`a changed rules file was not read, so the model keeps its earlier text: ${errorText(err)}`)
    return []
  }
  if (changes.length === 0) return []
  await toPerson($, state, changedLog(changes.map(c => c.label)))
  return changes.map(c => changedNote(c.label, c.path, c.text))
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  state.enabled = on
  await $.store.set(ENABLED_KEY, on)
  return on ? 'on: a call of a changed skill or command gets its current text, and a changed rules file reaches the model' : 'off: the engine\'s text stays as it is'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') return setEnabled($, state, word === 'on')
  return word === '' ? statusText(state.enabled, state.rules.size, state.last) : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, root: '', config: '', startedAt: 0, rules: new Map() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.startedAt = await $.clock.now()
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.root = e.cwd
    state.config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
    await $.command.register({ name: 'context-restore', description: 'The current text of a changed skill, command or rules file: status, on, off (context-restore)', argumentHint: '[on | off]', immediate: true })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'context-restore' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // The engine loads each skill and command once and hands that copy at every call, also after its file changed.
  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    if (!state.enabled) return r
    try {
      const text = await fresherText($, state, e.skill, r.text)
      if (text === undefined) return r
      await toPerson($, state, currentLog(e.skill))
      return { ...r, text }
    } catch (err) {
      $.ui.log(`the file of ${e.skill} was not read, so the call keeps the engine's text: ${errorText(err)}`)
      return r
    }
  })

  on('prompt.attachment', { type: 'instructions' }, async ($, e, next) => {
    if (state.enabled) await recordRules($, state, e.text)
    return next(e)
  })

  // The notes go to the model alone; the person reads one line naming the files.
  on('prompt.submit', async ($, e, next) => {
    if (!state.enabled) return next(e)
    const notes = await changeNotes($, state)
    return notes.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...notes] })
  })
}
