import type { EngineInterface, Register } from 'claude-code'
import { baseName, bodyOfFile, changedLog, changedNote, rebuild, restoredLog, rulePathsOf, sectionKey, sectionsOf, sidebarLines, skillFileOf, statusText, type Section } from './restore.ts'

const ENABLED_KEY = 'enabled'
const CONSUMER = 'context-restore'
const USAGE = 'expects nothing (the status), on or off'

/** One skill or command the session used: the text the model read, and the file it came from when one is known. */
type Used = { text: string; file?: string; mtimeMs?: number }

/**
 * The on/off setting, the directory the session started in, the host's config directory, every skill and
 * command the session used by name, every rules file it read with the time it was read, and the last
 * thing the mod did.
 */
type State = { enabled: boolean; root: string; config: string; used: Map<string, Used>; rules: Map<string, number>; last?: string }

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

/** The file a skill or command text came from: a skill names its directory, a command is looked up. */
async function fileOf($: EngineInterface, state: State, name: string, text: string): Promise<string | undefined> {
  return skillFileOf(text) ?? commandFileOf($, state, name)
}

/** A file's text as the engine hands it to the model. */
async function readBody($: EngineInterface, path: string): Promise<string> {
  const text = String(await $.fs.read(path))
  return path.endsWith('/SKILL.md') ? bodyOfFile(text, path.slice(0, -'/SKILL.md'.length)) : bodyOfFile(text)
}

/** Records a skill or command as the model read it, with its file and that file's last write. */
async function recordUse($: EngineInterface, state: State, name: string, text: string): Promise<void> {
  try {
    const file = await fileOf($, state, name, text)
    state.used.set(name, { text, file, mtimeMs: file === undefined ? undefined : await mtimeOf($, file) })
  } catch (err) {
    state.used.set(name, { text })
    $.ui.log(`the file of ${name} was not found, so a change to it is not seen: ${errorText(err)}`)
  }
}

/**
 * The full text of one section: the text the model read when the session used it, else its file, as a
 * resumed session in a new process has no record of what was used before.
 */
async function fullTextOf($: EngineInterface, state: State, s: Section): Promise<string | undefined> {
  const known = state.used.get(s.name)
  if (known !== undefined) return known.text
  const file = await fileOf($, state, s.name, s.body ?? '')
  if (file === undefined || !(await $.fs.exists(file))) return undefined
  const text = await readBody($, file)
  state.used.set(s.name, { text, file, mtimeMs: await mtimeOf($, file) })
  return text
}

/** Puts the full text back into the skills the engine hands back after a compaction. */
async function restoreSkills($: EngineInterface, state: State, text: string): Promise<string> {
  const parsed = sectionsOf(text)
  const full = new Map<string, string>()
  for (const s of parsed.sections) {
    try {
      const body = await fullTextOf($, state, s)
      if (body !== undefined) full.set(s.name, body)
    } catch (err) {
      $.ui.log(`the full text of ${s.name} was not read, so the engine's text stays: ${errorText(err)}`)
    }
  }
  const out = rebuild(parsed, full)
  if (out.changed.length > 0) await toPerson($, state, restoredLog(out.changed))
  return out.text
}

/** Records the rules files the session read, with the time each was last written. */
async function recordRules($: EngineInterface, state: State, text: string): Promise<void> {
  for (const path of rulePathsOf(text)) {
    const at = await mtimeOf($, path)
    if (at !== undefined) state.rules.set(path, at)
  }
}

/** One file that changed on disk: its label, its path and its new text. */
type Change = { label: string; path: string; text: string }

/** The skills and commands whose file changed on disk since the session read it; each record takes the new text. */
async function changedSkills($: EngineInterface, state: State): Promise<Change[]> {
  const out: Change[] = []
  for (const [name, used] of state.used) {
    if (used.file === undefined) continue
    const at = await mtimeOf($, used.file)
    if (at === undefined || at === used.mtimeMs) continue
    const text = await readBody($, used.file)
    state.used.set(name, { text, file: used.file, mtimeMs: at })
    out.push({ label: name, path: used.file, text })
  }
  return out
}

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

/** The notes for every file that changed on disk, and one line to the person naming them. */
async function changeNotes($: EngineInterface, state: State): Promise<string[]> {
  let changes: Change[]
  try {
    changes = [...(await changedSkills($, state)), ...(await changedRules($, state))]
  } catch (err) {
    $.ui.log(`a changed file was not read, so the model keeps its earlier text: ${errorText(err)}`)
    return []
  }
  if (changes.length === 0) return []
  await toPerson($, state, changedLog(changes.map(c => c.label)))
  return changes.map(c => changedNote(c.label, c.path, c.text))
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  state.enabled = on
  await $.store.set(ENABLED_KEY, on)
  return on ? 'on: a skill cut by compaction gets its full text back, and a changed file reaches the model' : 'off: the engine\'s text stays as it is'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') return setEnabled($, state, word === 'on')
  return word === '' ? statusText(state.enabled, state.used.size, state.rules.size, state.last) : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, root: '', config: '', used: new Map(), rules: new Map() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.root = e.cwd
    state.config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
    await $.command.register({ name: 'context-restore', description: 'Full text of skills cut by compaction, and changed skill, command and rules files: status, on, off (context-restore)', argumentHint: '[on | off]', immediate: true })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'context-restore' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    if (state.enabled) await recordUse($, state, e.skill, r.text)
    return r
  })

  on('prompt.attachment', { type: 'invoked_skills' }, async ($, e, next) => {
    if (!state.enabled) return next(e)
    return next({ ...e, text: await restoreSkills($, state, e.text) })
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
