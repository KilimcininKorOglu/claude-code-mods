import type { EngineInterface, Register } from 'claude-code'
import {
  BACKUP,
  apply,
  appendTopic,
  buildPrompt,
  changeShort,
  changeText,
  clockText,
  isProjectName,
  parseReply,
  projectNameFrom,
  validate,
  type Reply,
  type TopicAppend,
} from './memory.ts'

/**
 * What the hooks share: the project and its memory directory from session
 * start, why they could not be resolved, and the save queue: one save runs at
 * a time, and a turn that ends during it asks for one more.
 */
type State = { project?: string; dir?: string; error?: string; running: boolean; pending: boolean }

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

/** Returns the file's text, undefined when it does not exist; a read error rejects. */
async function readFile($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path))) return undefined
  try {
    return await $.fs.read(path)
  } catch (err) {
    throw new Error(`cannot read ${path}: ${message(err)}`)
  }
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

/** Asks the fork what to remember and reads its answer. */
async function ask($: EngineInterface, project: string, current: string | undefined): Promise<Reply> {
  const reply = await $.model.fork({ prompt: buildPrompt(project, current) })
  if (reply === null) throw new Error('the fork got no reply (cold snapshot or API error)')
  const u = reply.usage
  $.ui.log(`fork usage: in ${u.input_tokens}, cache read ${u.cache_read_input_tokens}, out ${u.output_tokens}`, { to: 'debug' })
  const parsed = parseReply(reply.text)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.reply
}

/** Asks the fork what to remember, then writes MEMORY.md and its topic files. */
async function save($: EngineInterface, state: State): Promise<void> {
  const { project, dir } = state
  if (project === undefined || dir === undefined) throw new Error(state.error ?? 'the project is not resolved yet')
  const file = `${dir}/MEMORY.md`
  const current = await readFile($, file)
  const result = apply(project, current, await ask($, project, current))
  if (!result.ok) throw new Error(result.error)
  if (!result.changed) return report($, 'no change')
  const errors = validate(result.text, result.newBullets)
  if (errors.length > 0) throw new Error(`not written: ${errors.join('; ')}`)
  if ((await readFile($, file)) !== current) throw new Error('not written: MEMORY.md changed during the save')
  await writeTopics($, project, dir, result.topics)
  if (result.changes.migrated && current !== undefined) await $.fs.write(`${dir}/${BACKUP}`, current)
  await $.fs.write(file, result.text)
  $.ui.log(changeText(result.changes, result.topics))
  await report($, changeShort(result.changes, result.topics))
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
      await save($, state).catch((err: unknown) => report($, `error: ${message(err)}`))
    } while (state.pending)
  } finally {
    state.running = false
  }
}

export const register: Register = on => {
  const state: State = { running: false, pending: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await locate($, state, e.cwd)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.reason === 'error' || e.reason === 'refusal') return r
    // Not awaited: the save runs in the background, so the next prompt is not held.
    void drain($, state)
    return r
  })
}
