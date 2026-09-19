import type { EngineInterface, PromptOrigin, Register, ToolCallResult } from 'claude-code'
import { changeText, ENABLED_KEY, NO_KEY_ON, parseCommand, RESET_TEXT, statusText } from './command.ts'
import { CONSUMER, configFrom, DEADLINE_MS, DEFAULT_MODEL, MAX_ROUNDS, type Config } from './config.ts'
import { buildPlanBody, bullets, denyText, failedContext, parseFindings, passContext, planFileIn, summaryText, type Answer, type Finding } from './review.ts'
import { renderTranscript } from './transcript.ts'

/**
 * The plans sent back since the user last spoke, the plan file the engine's
 * plan mode note names, and the last review's line for the status.
 */
type State = { rounds: number; planFile?: string; last?: string }

/** What the review decided: send the plan back, or let it reach the user with a note for the model. */
type Verdict = { deny?: string; context?: string }

/** What ExitPlanMode's call carries of the plan. */
type PlanInput = { plan?: string; planFilePath?: string }

/** Gemini's answer and the tier it went to, or why there is none. */
type Asked = { answer: Answer; tier: 'free' | 'paid' } | { error: string }

/** A prompt from these is the user speaking, which gives the next plan its rounds again. */
const USER_ORIGINS: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge', 'sdk'])

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Off until the user turns it on, so a fresh install sends nothing to Gemini. */
async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED_KEY)) === true
}

/** Stores on or off; `on` is refused while gemini-core has no key. */
async function storeEnabled($: EngineInterface, enabled: boolean): Promise<string> {
  if (enabled && !(await $.gemini.settings({ consumer: CONSUMER })).hasKey) return NO_KEY_ON
  await $.store.set(ENABLED_KEY, enabled)
  return changeText(enabled)
}

/**
 * gemini-core builds the request and reads each answer; the request is sent
 * here, again after a 503 while it allows, and with the next key after a 429
 * or a key error.
 */
async function askGemini($: EngineInterface, body: Record<string, unknown>): Promise<Asked> {
  const prepared = await $.gemini.request({ consumer: CONSUMER, body })
  if ('error' in prepared) return prepared
  const started = await $.clock.now()
  let http = prepared.http
  for (let attempt = 1; ; attempt++) {
    const r = await $.http.fetch(http.url, http.init)
    const read = await $.gemini.read({ http, status: r.status, ok: r.ok, text: r.text, attempt, elapsedMs: (await $.clock.now()) - started, deadlineMs: DEADLINE_MS })
    if ('answer' in read) return { answer: read.answer, tier: prepared.tier }
    if ('error' in read) return read
    if ('next' in read) http = read.next
    else await $.clock.sleep(read.retryInMs)
  }
}

function notReviewed($: EngineInterface, state: State, reason: string): Verdict {
  state.last = `not reviewed: ${reason}`
  $.ui.log(`plan reached you without a review: ${reason}`)
  return { context: failedContext(reason) }
}

function verdictOf($: EngineInterface, state: State, tier: 'free' | 'paid', findings: readonly Finding[], summary: string): Verdict {
  const blockers = findings.filter(f => f.severity === 'blocker')
  const minors = findings.filter(f => f.severity === 'minor')
  $.ui.toast(tier === 'free' ? `${summary} · sent to Gemini free tier` : summary, { timeoutMs: 10_000 })
  if (blockers.length > 0 && state.rounds < MAX_ROUNDS) {
    state.last = `sent back (round ${state.rounds + 1} of ${MAX_ROUNDS}): ${summary}`
    $.ui.log(`plan ${state.last}`)
    return { deny: denyText(blockers, minors, state.rounds + 1, MAX_ROUNDS) }
  }
  state.last = summary
  if (blockers.length > 0) $.ui.log(`plan reached you after ${MAX_ROUNDS} rounds with ${blockers.length} open blocker(s):\n${bullets(blockers)}`)
  return { context: passContext(blockers, minors, MAX_ROUNDS) }
}

/**
 * The plan as the approval dialog shows it: the plan file on disk. The call's
 * own `plan` is read only without a path, because the engine adds it to some
 * calls only (the first after a new plan file carried neither it nor a path)
 * and once carried the version before the model's last edit (measured on 2.1.278).
 */
async function planOf($: EngineInterface, input: PlanInput): Promise<string> {
  if (input.planFilePath === undefined) return input.plan?.trim() ?? ''
  return (await $.fs.read(input.planFilePath)).trim()
}

/** Asks Gemini about the plan. Anything that keeps the review from an answer lets the plan reach the user with a note. */
async function review($: EngineInterface, state: State, config: Config, input: PlanInput): Promise<Verdict> {
  try {
    if (!(await $.gemini.settings({ consumer: CONSUMER })).hasKey) return notReviewed($, state, 'no Gemini key: set GEMINI_API_KEY or the gemini-core apiKey option')
    const plan = await planOf($, input)
    if (plan === '') return notReviewed($, state, 'the call carries no plan text')
    const transcript = renderTranscript(await $.session.messages(), config.maxInputChars)
    const asked = await askGemini($, buildPlanBody(transcript, plan))
    if ('error' in asked) return notReviewed($, state, asked.error)
    const findings = parseFindings(asked.answer)
    return verdictOf($, state, asked.tier, findings, summaryText(findings, asked.answer))
  } catch (err) {
    return notReviewed($, state, errorText(err))
  }
}

/** Adds a note the model reads after the tool's result; an error or a denial is left as it is. */
function withContext(r: ToolCallResult, text: string | undefined): ToolCallResult {
  if (text === undefined || r.deny !== undefined || r.isError === true) return r
  return { ...r, context: [...(r.context ?? []), text] }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const command = parseCommand(args)
  if (command.kind === 'error') return command.text
  if (command.kind === 'reset') {
    await $.store.delete(ENABLED_KEY)
    return RESET_TEXT
  }
  if (command.kind === 'set') return storeEnabled($, command.enabled)
  return statusText(await isEnabled($), await $.gemini.settings({ consumer: CONSUMER }), state.last)
}

export const register: Register = (on, options) => {
  const config = configFrom(options)
  const state: State = { rounds: 0 }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.gemini.enroll({ consumer: CONSUMER, defaultModel: DEFAULT_MODEL })
    await $.command.register({
      name: 'gemini-plan-review',
      description: 'Gemini plan review: status, on, off, reset; /gemini-core sets the model, thinking and tier (gemini-plan-review)',
      argumentHint: '[on | off | reset]',
    })
    return r
  })

  on('command.run', { command: 'gemini-plan-review' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('prompt.submit', async (_, e, next) => {
    if (USER_ORIGINS.has(e.origin.kind)) state.rounds = 0
    return next(e)
  })

  on('prompt.attachment', { type: 'plan_mode' }, async (_, e, next) => {
    const path = e.agentId === undefined ? planFileIn(e.text) : undefined
    if (path !== undefined) state.planFile = path
    return next(e)
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    // A subagent's plan does not reach the user's approval dialog.
    if (e.agentId !== undefined || !(await isEnabled($))) return next(e)
    const verdict = await review($, state, config, { plan: e.plan, planFilePath: e.planFilePath ?? state.planFile })
    if (verdict.deny !== undefined) {
      state.rounds++
      return { deny: verdict.deny }
    }
    // The user sees this plan, so a later plan gets its rounds again.
    state.rounds = 0
    return withContext(await next(e), verdict.context)
  })
}
