import type { EngineInterface, Register } from 'claude-code'
import { backLines, backText, deltaOf, failedLines, failedOf, failedText, prefixOf, reconnectButton, sectionKey, statusText, type Failure } from './doctor.ts'

const ENABLED_KEY = 'enabled'
const CONSUMER = 'mcp-doctor'
const USAGE = 'expects nothing (the status), reconnect <server>, on or off'

/**
 * The on/off setting, every watched server that is not connected with its reason, the failed servers
 * whose section the sidebar has not taken yet, whether ToolSearch answers here, and the measure in
 * flight, so two measures never interleave.
 */
type State = { enabled: boolean; failed: Map<string, string>; unplaced: Set<string>; toolSearch: 'ok' | 'missing'; chain: Promise<void> }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A server that is not connected as a standing section with a reconnect button; false while the sidebar is closed or missing. */
async function placeFailed($: EngineInterface, f: Failure): Promise<boolean> {
  try {
    return await $.sidebar.set({ consumer: CONSUMER, key: sectionKey(`failed-${f.name}`), title: 'MCP server', lines: failedLines(f), buttons: [reconnectButton(f.name)], until: 'session', order: 15 })
  } catch {
    // The sidebar mod is not installed.
    return false
  }
}

/** A server that came back: its standing section goes, and one green line says so. */
async function showBack($: EngineInterface, name: string): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: CONSUMER, key: sectionKey(`failed-${name}`) })
    if (await $.sidebar.set({ consumer: CONSUMER, key: sectionKey(`back-${name}`), title: 'MCP server', lines: backLines(name), until: 'stream' })) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(backText(name))
}

/**
 * Records and shows every server that failed. A new one the sidebar does not take gets one transcript
 * line, and its section is drawn at the next measure after the sidebar opens.
 */
async function addFailures($: EngineInterface, state: State, failures: readonly Failure[]): Promise<void> {
  for (const f of failures) {
    const isKnown = state.failed.has(f.name)
    if (isKnown && !state.unplaced.has(f.name)) continue
    state.failed.set(f.name, f.reason)
    if (await placeFailed($, f)) {
      state.unplaced.delete(f.name)
      continue
    }
    if (!isKnown) $.ui.log(`${failedText(f)}; /mcp-doctor reconnect ${f.name}`)
    state.unplaced.add(f.name)
  }
}

/** Drops and shows every known failed server the predicate says is connected again. */
async function dropFailures($: EngineInterface, state: State, isBack: (name: string) => boolean): Promise<void> {
  for (const name of [...state.failed.keys()]) {
    if (!isBack(name)) continue
    state.failed.delete(name)
    state.unplaced.delete(name)
    await showBack($, name)
  }
}

/**
 * Reads the engine's own list of failed servers through ToolSearch. The call leaves nothing in the
 * model's context. The engine adds the list only to an answer with no match, so the query selects a
 * tool that cannot exist. A build where ToolSearch does not answer falls back to the attachments alone.
 */
async function measure($: EngineInterface, state: State): Promise<void> {
  if (!state.enabled || state.toolSearch === 'missing') return
  let r
  try {
    r = await $.tool.call({ tool: 'ToolSearch', query: 'select:mcp-doctor-no-such-tool', max_results: 1 })
  } catch (err) {
    r = { deny: errorText(err) }
  }
  if (r.deny !== undefined || r.isError === true) {
    state.toolSearch = 'missing'
    $.ui.log(`ToolSearch does not answer here, so only the engine's notes are read: ${r.deny ?? r.text ?? 'no reason given'}`)
    return
  }
  const result = r.result as { pending_mcp_servers?: unknown }
  const pending = new Set(Array.isArray(result.pending_mcp_servers) ? (result.pending_mcp_servers as unknown[]).filter((n): n is string => typeof n === 'string') : [])
  const now = failedOf(r.result)
  const names = new Set(now.map(f => f.name))
  await addFailures($, state, now)
  await dropFailures($, state, name => !names.has(name) && !pending.has(name))
}

/** Runs one measure after the one in flight, off the hook that asked, so no turn waits on ToolSearch. */
function later($: EngineInterface, state: State): void {
  $.clock.after(0, () => {
    state.chain = state.chain.then(() => measure($, state)).catch(err => $.ui.log(`the MCP servers were not read: ${errorText(err)}`))
  })
}

/** What one `deferred_tools_delta` attachment says, applied at once; the measure after it has the last word. */
async function fromDelta($: EngineInterface, state: State, text: string): Promise<void> {
  const delta = deltaOf(text)
  await addFailures($, state, delta.failed)
  const back = new Set(delta.reconnected)
  await dropFailures($, state, name => back.has(prefixOf(name)))
}

/**
 * Asks the engine to reconnect one server. `/mcp` cannot run inside the command's own hook (the host
 * refuses it), so it runs from a timer; a server still failed afterwards says so with the engine's answer.
 */
async function reconnect($: EngineInterface, state: State, name: string): Promise<void> {
  let answer = ''
  try {
    answer = (await $.command.run({ command: 'mcp', args: `reconnect ${name}` })).text ?? ''
  } catch (err) {
    answer = errorText(err)
  }
  await measure($, state)
  if (state.failed.has(name)) $.ui.log(`${name} is still not connected after /mcp reconnect${answer === '' ? '' : `: ${answer}`}`)
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  state.enabled = on
  await $.store.set(ENABLED_KEY, on)
  if (on) later($, state)
  return on ? 'on: the MCP servers are read at session start and at the end of each turn' : 'off: the MCP servers are not read'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') return setEnabled($, state, word === 'on')
  if (word.startsWith('reconnect ')) {
    const name = word.slice('reconnect '.length).trim()
    $.clock.after(100, () => void reconnect($, state, name))
    return `reconnecting ${name}`
  }
  if (word !== '') return USAGE
  return statusText(state.enabled, [...state.failed].map(([name, reason]) => ({ name, reason })))
}

export const register: Register = on => {
  const state: State = { enabled: true, failed: new Map(), unplaced: new Set(), toolSearch: 'ok', chain: Promise.resolve() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    await $.command.register({ name: 'mcp-doctor', description: 'MCP servers that are not connected: status, reconnect <server>, on, off (mcp-doctor)', argumentHint: '[reconnect <server> | on | off]', immediate: true })
    if (state.enabled) later($, state)
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'mcp-doctor' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // A subagent's turn ends inside the main loop's; the main loop's end is enough.
    if (state.enabled && e.agentId === undefined) later($, state)
    return r
  })

  // The engine tells the model itself; the person reads the same fact here. The text is not changed.
  on('prompt.attachment', { type: 'deferred_tools_delta' }, async ($, e, next) => {
    if (state.enabled) {
      await fromDelta($, state, e.text)
      later($, state)
    }
    return next(e)
  })
}
