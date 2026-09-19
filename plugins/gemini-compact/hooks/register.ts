import type { EngineInterface, Register, SessionCompactInput, SessionMessage } from 'claude-code'
import { actionsByUse, applyActions, sizeOf } from './apply.ts'
import { changeText, parseCommand, STORE_KEYS, statusText, storedValue, type Settings } from './command.ts'
import { configFrom, outcomeText, summaryOutcomeText, type Config } from './config.ts'
import { buildRequest, buildSummaryRequest, parseResponse, type Answer, type Request } from './gemini.ts'
import { collectCalls, parseDecisions, renderTranscript } from './prune.ts'
import { parseSummary, summaryMessage, tailStart } from './summary.ts'

/**
 * What the hooks share: whether a compaction this mod started runs, whether
 * the context was under the threshold since the last one it started (so a
 * context that stays over it does not compact after every turn), and the last
 * outcome.
 */
type State = { compacting: boolean; armed: boolean; last?: string }

type Outcome = { messages: SessionMessage[]; ratio: number; text: string }

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The plugin options with the settings /gemini-compact stored on top. */
async function loadConfig($: EngineInterface, base: Config): Promise<Config> {
  const config: Config = { ...base }
  for (const key of Object.keys(STORE_KEYS) as (keyof Settings)[]) {
    const value = storedValue(key, await $.store.get(STORE_KEYS[key]))
    if (value !== undefined) Object.assign(config, { [key]: value })
  }
  return config
}

async function apiKey($: EngineInterface, config: Config): Promise<string | undefined> {
  if (config.apiKey !== undefined) return config.apiKey
  const fromEnv = (await $.env.get('GEMINI_API_KEY'))?.trim()
  return fromEnv === undefined || fromEnv === '' ? undefined : fromEnv
}

async function ask($: EngineInterface, request: Request): Promise<Answer> {
  const response = await $.http.fetch(request.url, request.init)
  return parseResponse(response.status, response.ok, response.text)
}

/** The fraction of characters the compaction removed. */
function reduction(before: readonly SessionMessage[], after: readonly SessionMessage[]): number {
  const size = sizeOf(before)
  return size === 0 ? 0 : (size - sizeOf(after)) / size
}

/** Asks Gemini about every call outside the pinned messages and applies its answer. */
async function prune($: EngineInterface, config: Config, key: string, e: SessionCompactInput): Promise<Outcome> {
  const calls = collectCalls(e.messages, config.keepRecent)
  const ids = calls.filter(c => !c.pinned).map(c => c.id)
  if (ids.length === 0) throw new Error('no tool call outside the newest messages')
  const transcript = renderTranscript(e.messages, calls, config.maxInputChars)
  const answer = await ask($, buildRequest(config.model, key, transcript, ids, e.instructions))
  const actions = actionsByUse(calls, parseDecisions(answer.text, ids))
  const messages = applyActions(e.messages, actions, config.headChars)
  const ratio = reduction(e.messages, messages)
  const tally = { kept: messages.length, total: e.messages.length, ratio, actions: actions.values(), ...answer }
  return { messages, ratio, text: outcomeText(tally) }
}

/** Has Gemini summarize everything before the newest messages, which stay as they are. */
async function summarize($: EngineInterface, config: Config, key: string, e: SessionCompactInput): Promise<Outcome> {
  const start = tailStart(e.messages, config.keepRecent)
  const head = e.messages.slice(0, start)
  if (head.length === 0) throw new Error('nothing to summarize before the newest messages')
  const transcript = renderTranscript(head, collectCalls(head, 0), config.summaryMaxInputChars, true)
  const answer = await ask($, buildSummaryRequest(config.model, key, transcript, config.summaryMaxOutputTokens, e.instructions))
  const messages = [summaryMessage(parseSummary(answer.text, answer.finishReason)), ...e.messages.slice(start)]
  const ratio = reduction(e.messages, messages)
  return { messages, ratio, text: summaryOutcomeText({ kept: messages.length, total: e.messages.length, ratio, ...answer }) }
}

/** One line in the transcript (not sent to the model) and a toast; free tier adds its warning to the toast. */
function report($: EngineInterface, state: State, config: Config, text: string): void {
  state.last = text
  $.ui.log(text)
  $.ui.toast(config.tier === 'free' ? `${text} · sent to Gemini free tier` : text, { timeoutMs: 15_000 })
}

/**
 * Why a result goes to the built-in summary, or undefined when it is taken.
 * A summary is taken whenever it is smaller, so the built-in summary runs only
 * when Gemini fails; a prune must reach `minReduction`.
 */
function refusal(config: Config, ratio: number): string | undefined {
  if (config.mode === 'summary') return ratio > 0 ? undefined : 'the summary is not smaller'
  return ratio >= config.minReduction ? undefined : `under ${Math.round(config.minReduction * 100)}% smaller`
}

async function compactWithGemini($: EngineInterface, state: State, config: Config, e: SessionCompactInput): Promise<SessionMessage[] | undefined> {
  const key = await apiKey($, config)
  if (key === undefined) {
    report($, state, config, 'built-in summary: no Gemini key (set GEMINI_API_KEY or the plugin option)')
    return undefined
  }
  try {
    const outcome = config.mode === 'summary' ? await summarize($, config, key, e) : await prune($, config, key, e)
    const refused = refusal(config, outcome.ratio)
    if (refused === undefined) {
      report($, state, config, outcome.text)
      return outcome.messages
    }
    report($, state, config, `built-in summary: ${refused} (${outcome.text})`)
  } catch (err) {
    report($, state, config, `built-in summary: ${message(err)}`)
  }
  return undefined
}

async function runCommand($: EngineInterface, state: State, base: Config, args: string): Promise<string> {
  const command = parseCommand(args)
  if (command.kind === 'error') return command.text
  if (command.kind === 'reset') {
    for (const key of Object.values(STORE_KEYS)) await $.store.delete(key)
    return 'settings reset to the plugin options'
  }
  if (command.kind === 'set') {
    for (const [key, value] of Object.entries(command.patch)) await $.store.set(STORE_KEYS[key as keyof Settings], value)
    return changeText(command.patch)
  }
  const config = await loadConfig($, base)
  return statusText(config, (await apiKey($, config)) !== undefined, state.last)
}

/** Starts a compaction when the context passed the threshold; not awaited, so the next prompt is not held. */
async function maybeCompact($: EngineInterface, state: State, base: Config): Promise<void> {
  const config = await loadConfig($, base)
  if (!config.enabled || config.atPercent === 0) return
  const { context } = await $.session.usage()
  if ((context.percent ?? 0) < config.atPercent) {
    state.armed = true
    return
  }
  if (!state.armed) return
  state.armed = false
  state.compacting = true
  // A compaction started from a timer skips this plugin's own hook (measured
  // on 2.1.277), so it starts here, inside the dispatch, without an await.
  void $.session
    .compact()
    .then(r => {
      if (r.skip !== undefined) $.ui.log(`automatic compaction skipped: ${r.skip}`)
    })
    .catch((err: unknown) => $.ui.log(`automatic compaction failed: ${message(err)}`))
    .finally(() => {
      state.compacting = false
    })
}

export const register: Register = (on, options) => {
  const base = configFrom(options)
  const state: State = { compacting: false, armed: true }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'gemini-compact',
      description: 'Gemini compaction: status, on, off, mode summary|prune, free, paid, model <id>, at <1-99>, at off, reset (gemini-compact)',
      argumentHint: '[on | off | mode summary|prune | free | paid | model <id> | at <N> | at off | reset]',
    })
    return r
  })

  on('command.run', { command: 'gemini-compact' }, async ($, e) => ({ text: await runCommand($, state, base, String(e.args ?? '')) }))

  on('session.compact', async ($, e, next) => {
    const config = await loadConfig($, base)
    if (!config.enabled || e.agentId !== undefined) return next(e)
    const messages = await compactWithGemini($, state, config, e)
    return messages === undefined ? next(e) : { messages }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || state.compacting) return r
    try {
      await maybeCompact($, state, base)
    } catch (err) {
      $.ui.log(`automatic compaction not started: ${message(err)}`)
    }
    return r
  })
}
