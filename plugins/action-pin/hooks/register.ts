import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { commitUrl, denyText, doneLines, doneLog, isGuarded, isWorkflow, logText, MAX_NAMED, modeOf, noteText, openRefs, refOf, sectionKey, sidebarLines, unpinnedUses, type Mode, type Unpinned } from './pin.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** The GitHub API answers the plain SHA of a ref with this Accept header. */
const HEADERS = { Accept: 'application/vnd.github.sha', 'User-Agent': 'action-pin' }

/**
 * The on/off setting read at session start, the SHAs already resolved in this session, so one workflow
 * does not ask GitHub twice, and the last error, so the same one is logged once.
 */
type State = { enabled: boolean; mode: Mode; shas: Map<string, string>; open: Map<string, string[]>; lastError?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The commit a ref points at, or undefined when GitHub does not answer it. */
async function resolveSha($: EngineInterface, state: State, use: Unpinned): Promise<string | undefined> {
  const key = `${use.action}@${use.ref}`
  const known = state.shas.get(key)
  if (known !== undefined) return known
  const r = await $.http.fetch(commitUrl(use.action, use.ref), { headers: HEADERS })
  if (!r.ok) throw new Error(`api.github.com answered HTTP ${r.status} for ${key}`)
  const sha = r.text.trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`api.github.com answered no commit for ${key}`)
  state.shas.set(key, sha)
  return sha
}

/** Logs an error once until a different one comes. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`a commit SHA was not resolved: ${text}`)
  state.lastError = text
}

/** Each action with its commit; one that GitHub does not answer keeps its ref alone. */
async function withShas($: EngineInterface, state: State, uses: readonly Unpinned[]): Promise<Unpinned[]> {
  const out: Unpinned[] = []
  for (const use of uses.slice(0, MAX_NAMED)) {
    try {
      out.push({ ...use, sha: await resolveSha($, state, use) })
      state.lastError = undefined
    } catch (err) {
      report($, state, err)
      out.push(use)
    }
  }
  return [...out, ...uses.slice(MAX_NAMED)]
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, path: string, title: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'action-pin', key: sectionKey(path), title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Drops the sidebar entries of one finding, so a workflow that pins its actions leaves no warning behind. */
async function dropEntry($: EngineInterface, path: string): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'action-pin', key: sectionKey(path) })
  } catch {
    // The sidebar mod is not installed.
  }
}

/** The refs of one open file that still move, or undefined when the file cannot be read. */
async function stillMoving($: EngineInterface, path: string, refs: readonly string[]): Promise<string[] | undefined> {
  try {
    const held = new Set(unpinnedUses('', await $.fs.read(path)).map(refOf))
    return refs.filter(ref => held.has(ref))
  } catch {
    // The file was moved or cannot be read: the finding stays as it was.
    return undefined
  }
}

/** Reads each open workflow again and closes the findings whose refs are pinned now. */
async function closeResolved($: EngineInterface, state: State, skip?: string): Promise<string[]> {
  const left: string[] = []
  for (const [path, refs] of [...state.open]) {
    const moving = path === skip ? refs : await stillMoving($, path, refs)
    if (moving === undefined || moving.length > 0) {
      left.push(...(moving ?? refs))
      continue
    }
    state.open.delete(path)
    await dropEntry($, path)
    await toPerson($, path, 'actions pinned', doneLines(path, refs), doneLog(path, refs))
  }
  return left
}

/** Adds the note to an edit that pins an action to a moving ref, and closes what a later edit fixed. */
async function afterEdit($: EngineInterface, state: State, path: string, before: string, after: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true || !state.enabled) return r
  const found = isWorkflow(path) ? unpinnedUses(before, after) : []
  if (found.length === 0) {
    await closeResolved($, state)
    return r
  }
  const uses = await withShas($, state, found)
  state.open.set(path, openRefs(state.open.get(path), uses))
  // The note goes to the model, the finding to the person: neither reads the other's channel.
  await toPerson($, path, 'actions by a moving ref', sidebarLines(uses), logText(uses))
  await closeResolved($, state, path)
  return { ...r, context: [...(r.context ?? []), noteText(uses)] }
}

/**
 * The gate of the `deny` mode: it reads each open workflow again, so a ref the model pinned without a
 * new finding opens the gate too. A ref that still moves stops the command, and there is no bypass.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<string | undefined> {
  if (!state.enabled || state.mode !== 'deny' || state.open.size === 0 || !isGuarded(command)) return undefined
  const left = await closeResolved($, state)
  return left.length === 0 ? undefined : denyText(left)
}

async function setMode($: EngineInterface, state: State, word: string): Promise<string> {
  const mode = modeOf(word)
  if (mode === undefined) return 'mode expects note or deny'
  await $.store.set(MODE_KEY, mode)
  state.mode = mode
  return mode === 'deny' ? 'mode deny: git commit, push and merge stop while an action is used by a moving ref' : 'mode note: the actions are only reported'
}

function statusText(state: State): string {
  const open = state.open.size === 0 ? 'no workflow is open' : `${state.open.size} workflow(s) still use a moving ref`
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode} · ${open}`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: a workflow edit that uses an action by a tag or a branch gets a note' : 'off: workflow edits are not checked'
  }
  if (word.startsWith('mode')) return setMode($, state, word.slice(4).trim())
  return word === '' ? statusText(state) : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'note', shas: new Map(), open: new Map() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'action-pin', description: 'GitHub Actions steps an edit pins to a moving tag: status, on, off, mode (action-pin)', argumentHint: '[on | off | mode note | deny]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.mode = (await $.store.get(MODE_KEY)) === 'deny' ? 'deny' : 'note'
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'action-pin' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const stop = await gate($, state, e.command)
    return stop === undefined ? next(e) : { deny: stop }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, e.old_string, e.new_string, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, '', e.content, await next(e)))
}
