import type { EngineInterface, Register } from 'claude-code'
import {
  BACKUP,
  apply,
  appendTopic,
  buildPrompt,
  changeShort,
  changeText,
  clockText,
  contextText,
  inspect,
  isProjectName,
  parseReply,
  projectNameFrom,
  repairSections,
  skippedText,
  topicFiles,
  validate,
  type Reply,
  type TopicAppend,
} from './memory.ts'

/**
 * What the hooks share: the project and its memory directory, the promise that
 * resolves them, why they could not be resolved, and the save queue: one save
 * runs at a time, and a turn that ends during it asks for one more.
 */
type State = {
  project?: string
  dir?: string
  error?: string
  located?: Promise<void>
  running: boolean
  pending: boolean
  /** The lines the last save skipped, named to the next fork so it copies them exactly. */
  skipped: string[]
  /** The ops the last save refused, named to the next fork so it writes them in the documented shape. */
  refused: string[]
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Returns git's stdout, or "" when git fails, because a directory outside a repository is a normal case. */
async function git($: EngineInterface, args: string[]): Promise<string> {
  try {
    const r = await $.process.run(['git', ...args], { timeoutMs: 3000 })
    return r.exitCode === 0 ? r.stdout : ''
  } catch (err) {
    $.ui.log(`git ${args.join(' ')} did not run: ${message(err)}`, { to: 'debug' })
    return ''
  }
}

/** Resolves the project name and its memory directory once per session. */
async function locate($: EngineInterface, state: State, cwd: string): Promise<void> {
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') {
    state.error = 'HOME is not set'
    return
  }
  const commonDir = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const topLevel = commonDir === '' ? await git($, ['rev-parse', '--show-toplevel']) : ''
  const project = projectNameFrom(commonDir, topLevel, cwd)
  if (!isProjectName(project)) {
    state.error = `project name ${JSON.stringify(project)} is not a safe directory name`
    return
  }
  state.project = project
  state.dir = `${home}/.cli-tweaks/memory/${project}`
}

/**
 * Starts the project lookup once. `classic.SessionStart` runs inside the
 * `next(e)` of `session.start`, so both hooks share the one lookup.
 */
function ensureLocated($: EngineInterface, state: State, cwd: string): Promise<void> {
  state.located ??= locate($, state, cwd)
  return state.located
}

/** Returns the file's text, undefined when it does not exist; a read error rejects. */
async function readFile($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path))) return undefined
  try {
    return await $.fs.read(path)
  } catch (err) {
    throw new Error(`cannot read ${path}: ${message(err)}`)
  }
}

/**
 * Returns MEMORY.md, first put into the template when it is not: the old file
 * is kept as the backup and one line in the transcript says so. Undefined when
 * the file does not exist.
 */
async function templated($: EngineInterface, project: string, dir: string): Promise<string | undefined> {
  const file = `${dir}/MEMORY.md`
  const current = await readFile($, file)
  if (current === undefined || inspect(current).inFormat) return current
  const repaired = repairSections(project, current)
  await $.fs.write(`${dir}/${BACKUP}`, current)
  await $.fs.write(file, repaired)
  $.ui.log(`MEMORY.md: put into the four sections (old copy: ${BACKUP})`)
  return repaired
}

async function writeTopics($: EngineInterface, project: string, dir: string, topics: TopicAppend[]): Promise<void> {
  for (const t of topics) {
    const path = `${dir}/${t.file}`
    await $.fs.write(path, appendTopic(project, t.file, await readFile($, path), t.append))
  }
}

async function report($: EngineInterface, text: string): Promise<void> {
  $.ui.status(`${text} · ${clockText(await $.clock.now())}`)
}

/** Where a reply that could not be read is kept, the last one only, so its cause can be seen. */
const FAILED_REPLY = 'memory-save.failed-reply.txt'

/**
 * Asks the fork what to remember and reads its answer. A reply that cannot be
 * read is written to FAILED_REPLY, and the error names its output tokens.
 */
async function ask($: EngineInterface, state: State, project: string, dir: string, current: string | undefined): Promise<Reply> {
  const reply = await $.model.fork({ prompt: buildPrompt(project, dir, current, state.skipped, state.refused) })
  if (reply === null) throw new Error('the fork got no reply (cold snapshot or API error)')
  const u = reply.usage
  $.ui.log(`fork usage: in ${u.input_tokens}, cache read ${u.cache_read_input_tokens}, out ${u.output_tokens}`, { to: 'debug' })
  const parsed = parseReply(reply.text)
  if (parsed.ok) return parsed.reply
  await $.fs.write(`${dir}/${FAILED_REPLY}`, reply.text)
  throw new Error(`${parsed.error}; ${u.output_tokens} output tokens, ${reply.text.length} characters, kept in ${FAILED_REPLY}`)
}

/** Reports a save that changed no file, naming the lines it skipped and the ops it refused. */
async function reportNoChange($: EngineInterface, skipped: string[], refused: string[]): Promise<void> {
  const parts = [skipped.length > 0 ? skippedText(skipped) : '', refused.length > 0 ? `refused: ${refused.join('; ')}` : ''].filter(p => p !== '')
  if (parts.length > 0) $.ui.log(`MEMORY.md: no change; ${parts.join('; ')}`)
  const counts = [skipped.length > 0 ? `${skipped.length} skipped` : '', refused.length > 0 ? `${refused.length} refused` : ''].filter(p => p !== '')
  return report($, counts.length > 0 ? `no change, ${counts.join(', ')}` : 'no change')
}

/** Asks the fork what to remember, then writes MEMORY.md and its topic files. */
async function save($: EngineInterface, state: State): Promise<void> {
  await state.located
  const { project, dir } = state
  if (project === undefined || dir === undefined) throw new Error(state.error ?? 'the project is not resolved yet')
  const file = `${dir}/MEMORY.md`
  const current = await templated($, project, dir)
  const result = apply(project, current, await ask($, state, project, dir, current))
  if (!result.ok) throw new Error(result.error)
  if (!result.changed) {
    state.skipped = result.skipped
    state.refused = result.refused
    return reportNoChange($, result.skipped, result.refused)
  }
  state.skipped = result.changes.skipped
  state.refused = result.changes.refused
  const errors = validate(result.text, result.newBullets, current)
  if (errors.length > 0) throw new Error(`not written: ${errors.join('; ')}`)
  if ((await readFile($, file)) !== current) throw new Error('not written: MEMORY.md changed during the save')
  await writeTopics($, project, dir, result.topics)
  await $.fs.write(file, result.text)
  $.ui.log(changeText(result.changes, result.topics))
  await report($, changeShort(result.changes, result.topics))
}

/** Returns the session's memory context, or undefined when the project has no MEMORY.md. */
async function memoryContext($: EngineInterface, state: State): Promise<string | undefined> {
  const { project, dir } = state
  if (project === undefined || dir === undefined) throw new Error(state.error ?? 'the project is not resolved')
  const memory = await templated($, project, dir)
  if (memory === undefined) return undefined
  const files = (await $.fs.list(dir)).filter(f => f.kind === 'file').map(f => f.name)
  return contextText(project, dir, memory, topicFiles(files))
}

/** Adds the memory context to the classic SessionStart result; a failure shows on the status line and adds nothing. */
async function withMemory<R extends { additionalContext?: string[] }>($: EngineInterface, state: State, r: R): Promise<R> {
  try {
    const text = await memoryContext($, state)
    return text === undefined ? r : { ...r, additionalContext: [...(r.additionalContext ?? []), text] }
  } catch (err) {
    await report($, `error: memory not loaded: ${message(err)}`)
    return r
  }
}

/** Runs saves one at a time; a failed save shows its error on the status line and the queue goes on. */
async function drain($: EngineInterface, state: State): Promise<void> {
  if (state.running) {
    state.pending = true
    return
  }
  state.running = true
  try {
    do {
      state.pending = false
      // The fork runs in the background; the line says so until the result replaces it.
      await report($, 'saving…')
      await save($, state).catch((err: unknown) => report($, `error: ${message(err)}`))
    } while (state.pending)
  } finally {
    state.running = false
  }
}

export const register: Register = on => {
  const state: State = { running: false, pending: false, skipped: [], refused: [] }

  on('session.start', async ($, e, next) => {
    // A new start (a reload, an enable) looks the project up again.
    state.located = locate($, state, e.cwd)
    const r = await next(e)
    await state.located
    return r
  })

  // The memory enters the context at startup, resume, /clear and compaction.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.agent_id !== undefined) return r
    await ensureLocated($, state, e.cwd)
    return withMemory($, state, r)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.reason === 'error' || e.reason === 'refusal') return r
    // Not awaited: the save runs in the background, so the next prompt is not held.
    void drain($, state)
    return r
  })
}
