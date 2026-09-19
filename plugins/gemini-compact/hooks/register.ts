import type { EngineInterface, Register, SessionCompactInput, SessionMessage } from 'claude-code'
import { actionsByUse, applyActions, sizeOf } from './apply.ts'
import { changeText, NO_KEY_ON, parseCommand, RESET_TEXT, STORE_KEYS, statusText, storedValue, type Patch, type Settings } from './command.ts'
import { CONSUMER, configFrom, DEADLINE_MS, DEFAULT_MODEL, outcomeText, summaryOutcomeText, type Config } from './config.ts'
import { buildPruneBody, buildSummaryBody, type Answer } from './gemini.ts'
import { collectCalls, parseDecisions, renderTranscript } from './prune.ts'
import { parseSummary, summaryMessage, tailStart } from './summary.ts'

/**
 * What the hooks share: whether a compaction this mod started runs, whether
 * the context was under the threshold since the last one it started (so a
 * context that stays over it does not compact after every turn), and the last
 * outcome.
 */
type State = { compacting: boolean; armed: boolean; last?: string }

type Tier = 'free' | 'paid'

type Outcome = { messages: SessionMessage[]; ratio: number; text: string; tier: Tier }

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

/**
 * gemini-core builds the request and reads each answer; the request is sent
 * here, again after a 503 while it allows, and with the next key after a 429
 * or a key error. The answer carries the tier it went to.
 */
async function askGemini($: EngineInterface, body: Record<string, unknown>): Promise<Answer & { tier: Tier }> {
  const prepared = await $.gemini.request({ consumer: CONSUMER, body })
  if ('error' in prepared) throw new Error(prepared.error)
  const started = await $.clock.now()
  let http = prepared.http
  for (let attempt = 1; ; attempt++) {
    const r = await $.http.fetch(http.url, http.init)
    const read = await $.gemini.read({ http, status: r.status, ok: r.ok, text: r.text, attempt, elapsedMs: (await $.clock.now()) - started, deadlineMs: DEADLINE_MS })
    if ('answer' in read) return { ...read.answer, tier: prepared.tier }
    if ('error' in read) throw new Error(read.error)
    if ('next' in read) http = read.next
    else await $.clock.sleep(read.retryInMs)
  }
}

/** The fraction of characters the compaction removed. */
function reduction(before: readonly SessionMessage[], after: readonly SessionMessage[]): number {
  const size = sizeOf(before)
  return size === 0 ? 0 : (size - sizeOf(after)) / size
}

/** Asks Gemini about every call outside the pinned messages and applies its answer. */
async function prune($: EngineInterface, config: Config, e: SessionCompactInput): Promise<Outcome> {
  const calls = collectCalls(e.messages, config.keepRecent)
  const ids = calls.filter(c => !c.pinned).map(c => c.id)
  if (ids.length === 0) throw new Error('no tool call outside the newest messages')
  const transcript = renderTranscript(e.messages, calls, config.maxInputChars)
  const answer = await askGemini($, buildPruneBody(transcript, ids, e.instructions))
  const actions = actionsByUse(calls, parseDecisions(answer.text, ids))
  const messages = applyActions(e.messages, actions, config.headChars)
  const ratio = reduction(e.messages, messages)
  const tally = { kept: messages.length, total: e.messages.length, ratio, actions: actions.values(), ...answer }
  return { messages, ratio, text: outcomeText(tally), tier: answer.tier }
}

/** Has Gemini summarize everything before the newest messages, which stay as they are. */
async function summarize($: EngineInterface, config: Config, e: SessionCompactInput): Promise<Outcome> {
  const start = tailStart(e.messages, config.keepRecent)
  const head = e.messages.slice(0, start)
  if (head.length === 0) throw new Error('nothing to summarize before the newest messages')
  const transcript = renderTranscript(head, collectCalls(head, 0), config.summaryMaxInputChars, true)
  const answer = await askGemini($, buildSummaryBody(transcript, config.summaryMaxOutputTokens, e.instructions))
  const messages = [summaryMessage(parseSummary(answer.text, answer.finishReason)), ...e.messages.slice(start)]
  const ratio = reduction(e.messages, messages)
  return { messages, ratio, text: summaryOutcomeText({ kept: messages.length, total: e.messages.length, ratio, ...answer }), tier: answer.tier }
}

/** One line in the transcript (not sent to the model) and a toast; free tier adds its warning to the toast. */
function report($: EngineInterface, state: State, tier: Tier, text: string): void {
  state.last = text
  $.ui.log(text)
  $.ui.toast(tier === 'free' ? `${text} · sent to Gemini free tier` : text, { timeoutMs: 15_000 })
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
  const settings = await $.gemini.settings({ consumer: CONSUMER })
  if (!settings.hasKey) {
    report($, state, settings.tier, 'built-in summary: no Gemini key (set GEMINI_API_KEY or the gemini-core apiKey option)')
    return undefined
  }
  try {
    const outcome = config.mode === 'summary' ? await summarize($, config, e) : await prune($, config, e)
    const refused = refusal(config, outcome.ratio)
    if (refused === undefined) {
      report($, state, outcome.tier, outcome.text)
      return outcome.messages
    }
    report($, state, outcome.tier, `built-in summary: ${refused} (${outcome.text})`)
  } catch (err) {
    report($, state, settings.tier, `built-in summary: ${message(err)}`)
  }
  return undefined
}

/** Stores a change; `on` is refused while gemini-core has no key. */
async function storePatch($: EngineInterface, patch: Patch): Promise<string> {
  if (patch.enabled === true && !(await $.gemini.settings({ consumer: CONSUMER })).hasKey) return NO_KEY_ON
  for (const [key, value] of Object.entries(patch)) await $.store.set(STORE_KEYS[key as keyof Settings], value)
  return changeText(patch)
}

async function runCommand($: EngineInterface, state: State, base: Config, args: string): Promise<string> {
  const command = parseCommand(args)
  if (command.kind === 'error') return command.text
  if (command.kind === 'reset') {
    for (const key of Object.values(STORE_KEYS)) await $.store.delete(key)
    return RESET_TEXT
  }
  if (command.kind === 'set') return storePatch($, command.patch)
  return statusText(await loadConfig($, base), await $.gemini.settings({ consumer: CONSUMER }), state.last)
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
    await $.gemini.enroll({ consumer: CONSUMER, defaultModel: DEFAULT_MODEL })
    await $.command.register({
      name: 'gemini-compact',
      description: 'Gemini compaction: status, on, off, mode summary|prune, at <1-99>, at off, reset; /gemini-core sets the model, thinking and tier (gemini-compact)',
      argumentHint: '[on | off | mode summary|prune | at <N> | at off | reset]',
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
