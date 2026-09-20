import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { commitUrl, isWorkflow, logText, MAX_NAMED, noteText, unpinnedUses, type Unpinned } from './pin.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/** The GitHub API answers the plain SHA of a ref with this Accept header. */
const HEADERS = { Accept: 'application/vnd.github.sha', 'User-Agent': 'action-pin' }

/**
 * The on/off setting read at session start, the SHAs already resolved in this session, so one workflow
 * does not ask GitHub twice, and the last error, so the same one is logged once.
 */
type State = { enabled: boolean; shas: Map<string, string>; lastError?: string }

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

/** Adds the note to an edit that pins an action to a moving ref. */
async function afterEdit($: EngineInterface, state: State, path: string, before: string, after: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  const found = state.enabled && isWorkflow(path) ? unpinnedUses(before, after) : []
  if (found.length === 0) return r
  const uses = await withShas($, state, found)
  // The note goes to the model, the log line to the person: neither reads the other's channel.
  $.ui.log(logText(uses))
  return { ...r, context: [...(r.context ?? []), noteText(uses)] }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: a workflow edit that uses an action by a tag or a branch gets a note' : 'off: workflow edits are not checked'
  }
  return word === '' ? (state.enabled ? 'on' : 'off') : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, shas: new Map() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'action-pin', description: 'GitHub Actions steps an edit pins to a moving tag: status, on, off (action-pin)', argumentHint: '[on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'action-pin' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, e.old_string, e.new_string, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, '', e.content, await next(e)))
}
