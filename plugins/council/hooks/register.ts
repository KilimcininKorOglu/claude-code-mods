import type { EngineInterface, ModelForkResult, Register, SessionMessage, ToolCallResult } from 'claude-code'
import { runLines, statusText, summaryText, type Chair, type Run, type Seat, type Via } from './board.ts'
import { changeText, convenedText, ENABLED_KEY, MEMBERS_KEY, membersText, OFF_DENY, parseCommand } from './command.ts'
import { configFrom, HAIKU_MAX_CHARS, MAX_TOKENS, MEMBER_MS, type Config } from './config.ts'
import { bare, DEFAULT_MEMBERS, isSessionModel, labelOfModel, storedMembers, type Member } from './members.ts'
import { chairPrompt, forkMemberPrompt, INPUT_SCHEMA, letterOf, MEMBER_SYSTEM, memberPrompt, noAnswerText, questionOf, resultText, sendText, SYSTEM_GUIDANCE, TOOL_DESCRIPTION, TOOL_NAME, type Lettered, type Row } from './prompts.ts'
import { renderTranscript } from './transcript.ts'

/** The name gemini-core knows this mod by, and the model it enrolls with; every request names its own. */
const CONSUMER = 'council'
const GEMINI_ENROLL_MODEL = 'gemini-3.8-flash'

const SEND_COMMAND = 'council:send'

const SECTION = { consumer: 'council', key: 'run' }

/**
 * Whether the system prompt carries the note (fixed at a session start or /clear), whether this session
 * declared the tool, the main loop's model, and the runs.
 */
type State = { guidance: boolean; declared: boolean; model?: string; runs: number; current?: number; last?: string }

/** Whether gemini-core can take a request now, or why not. */
type Reach = { ok: true } | { ok: false; why: string }

/** What a run knows: the question, the conversation (absent for a subagent's call), the model of the session. */
type Ctx = { question: string; config: Config; messages?: SessionMessage[]; sessionModel?: string; gemini: Reach; rendered: Map<number, string> }

type Answer = { text: string; ms: number; inTokens: number; outTokens: number; freeTier?: boolean }

type Asked = { answer: Answer } | { why: string }

type Outcome = { text: string } | { deny: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED_KEY)) === true
}

async function membersNow($: EngineInterface): Promise<Member[]> {
  return storedMembers(await $.store.get(MEMBERS_KEY))
}

async function declareTool($: EngineInterface, state: State): Promise<void> {
  await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA })
  state.declared = true
}

async function storeEnabled($: EngineInterface, state: State, enabled: boolean): Promise<string> {
  await $.store.set(ENABLED_KEY, enabled)
  if (enabled) await declareTool($, state)
  return changeText(enabled)
}

/**
 * gemini-core is optional: a session without it has no `$.gemini`, so a call on it throws a TypeError, and
 * the Gemini members are skipped. The validator refuses `$.gemini` read as a value, so the call itself is
 * the test.
 */
function notInstalled(err: unknown): boolean {
  return err instanceof TypeError
}

async function enrollGemini($: EngineInterface): Promise<void> {
  try {
    await $.gemini.enroll({ consumer: CONSUMER, defaultModel: GEMINI_ENROLL_MODEL, ownModels: true })
  } catch (err) {
    if (!notInstalled(err)) $.ui.log(`gemini-core refused the enrollment, so the Gemini members will fail: ${errorText(err)}`)
  }
}

async function geminiReach($: EngineInterface): Promise<Reach> {
  try {
    const s = await $.gemini.settings({ consumer: CONSUMER })
    return s.hasKey ? { ok: true } : { ok: false, why: 'gemini-core has no key' }
  } catch (err) {
    return { ok: false, why: notInstalled(err) ? 'gemini-core is not installed' : `gemini-core did not answer: ${errorText(err)}` }
  }
}

/** One run: the mod's state, the run as drawn, what it knows, and the chair's model. */
type Job = { state: State; run: Run; ctx: Ctx; model: string }

/** The run's section in the sidebar; false while the pane is closed, the sidebar mod is not installed, or a newer run holds it. */
async function drawRun($: EngineInterface, job: Job): Promise<boolean> {
  if (job.state.current !== job.run.id) return false
  try {
    // The pane draws the consumer in front of the title, so the title does not repeat it.
    return await $.sidebar.set({ ...SECTION, title: 'run', lines: runLines(job.run, await $.clock.now()), until: 'session', order: 7 })
  } catch {
    // The sidebar mod is not installed; the run's end writes one log line instead.
    return false
  }
}

/** The run's end: the section when the sidebar takes it, else one log line. */
async function toPerson($: EngineInterface, job: Job): Promise<void> {
  if (!(await drawRun($, job))) $.ui.log(summaryText(job.run))
}

function viaOf(member: Member, ctx: Ctx): Via {
  if (member.kind === 'gemini') return 'gemini'
  return ctx.messages !== undefined && isSessionModel(member, ctx.sessionModel) ? 'fork' : 'complete'
}

function seatOf(member: Member, ctx: Ctx): Seat {
  const via = viaOf(member, ctx)
  if (member.kind === 'gemini' && !ctx.gemini.ok) return { label: member.label, via, state: 'skipped', why: ctx.gemini.why }
  return { label: member.label, via, state: 'running' }
}

/** The chair's model: the session's without its window mark, or before its first request the first Claude member. */
function chairModel(ctx: Ctx, members: readonly Member[]): string {
  if (ctx.sessionModel !== undefined) return bare(ctx.sessionModel)
  return members.find(m => m.kind === 'claude')?.id ?? 'claude-opus-5-5'
}

/** The conversation as one member reads it; Haiku 4.5 reads less, because its window is smaller. */
function transcriptOf(ctx: Ctx, member: Member): string | undefined {
  if (ctx.messages === undefined) return undefined
  const cap = member.id.includes('haiku') ? Math.min(ctx.config.maxInputChars, HAIKU_MAX_CHARS) : ctx.config.maxInputChars
  const cached = ctx.rendered.get(cap)
  if (cached !== undefined) return cached
  const text = renderTranscript(ctx.messages, cap)
  ctx.rendered.set(cap, text)
  return text
}

function reasonText(r: Exclude<ModelForkResult, { isAnswered: true }>): string {
  return r.reason === 'api-error' ? `api-error ${r.status ?? 'without a response'} ${r.error}` : r.reason
}

function fromModel(r: ModelForkResult, ms: number): Asked {
  if (!r.isAnswered) return { why: reasonText(r) }
  const u = r.usage
  return { answer: { text: r.text.trim(), ms, inTokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, outTokens: u.output_tokens } }
}

/**
 * A Claude member: a fork of the session when it runs on the session's model, else a completion over the
 * conversation as text. A session with nothing to fork yet gets the completion, and the seat says so.
 */
async function askClaude($: EngineInterface, member: Member, seat: Seat, ctx: Ctx): Promise<Asked> {
  const started = await $.clock.now()
  if (seat.via === 'fork') {
    const forked = await $.model.fork({ prompt: forkMemberPrompt(ctx.question) })
    if (forked.isAnswered || forked.reason !== 'nothing-to-fork') return fromModel(forked, (await $.clock.now()) - started)
    seat.via = 'complete'
  }
  const prompt = memberPrompt(transcriptOf(ctx, member), ctx.question)
  const r = await $.model.complete({ model: member.id, system: MEMBER_SYSTEM, prompt, effort: 'high', maxTokens: MAX_TOKENS, timeoutMs: MEMBER_MS })
  return fromModel(r, (await $.clock.now()) - started)
}

type GeminiGot = { text: string; inTokens: number; outTokens: number; freeTier: boolean } | { why: string }

/**
 * One Gemini request through gemini-core, with the next key after a 429. After a 503 the same request
 * goes again without the wait gemini-core names: `$.clock.sleep` counts against the hook's 10 s budget
 * (measured on 2.1.283), and the waits of members asked at once add up.
 */
async function askGeminiModel($: EngineInterface, body: Record<string, unknown>, model: string): Promise<GeminiGot> {
  const prepared = await $.gemini.request({ consumer: CONSUMER, body, model })
  if ('error' in prepared) return { why: prepared.error }
  if (prepared.model !== model) return { why: 'gemini-core is older than 0.3.0 and sends every request to one model; update it' }
  const started = await $.clock.now()
  let http = prepared.http
  for (let attempt = 1; ; attempt++) {
    const r = await $.http.fetch(http.url, http.init)
    const read = await $.gemini.read({ http, status: r.status, ok: r.ok, text: r.text, attempt, elapsedMs: (await $.clock.now()) - started, deadlineMs: MEMBER_MS })
    if ('error' in read) return { why: read.error }
    if ('answer' in read) {
      const cut = read.answer.finishReason === 'MAX_TOKENS' ? '\n[the answer was cut at the output token limit]' : ''
      return { text: `${read.answer.text.trim()}${cut}`, inTokens: read.answer.inputTokens, outTokens: read.answer.outputTokens, freeTier: prepared.tier === 'free' }
    }
    if ('next' in read) http = read.next
  }
}

async function askGemini($: EngineInterface, member: Member, ctx: Ctx): Promise<Asked> {
  const started = await $.clock.now()
  const text = `${MEMBER_SYSTEM}\n\n${memberPrompt(transcriptOf(ctx, member), ctx.question)}`
  const got = await askGeminiModel($, { contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { maxOutputTokens: MAX_TOKENS } }, member.id)
  if ('why' in got) return got
  return { answer: { ...got, ms: (await $.clock.now()) - started } }
}

/** Asks one member and redraws its seat with the answer or the reason there is none. */
async function sit($: EngineInterface, job: Job, seat: Seat, member: Member): Promise<Asked> {
  if (seat.state === 'skipped') return { why: seat.why ?? 'skipped' }
  let asked: Asked
  try {
    asked = member.kind === 'gemini' ? await askGemini($, member, job.ctx) : await askClaude($, member, seat, job.ctx)
  } catch (err) {
    asked = { why: errorText(err) }
  }
  if ('answer' in asked) {
    const { ms, inTokens, outTokens, freeTier } = asked.answer
    Object.assign(seat, { state: 'answered', ms, inTokens, outTokens, ...(freeTier === undefined ? {} : { freeTier }) })
  } else Object.assign(seat, { state: 'failed', why: asked.why })
  await drawRun($, job)
  return asked
}

/** Each member's row for the caller; the members that answered get a letter, in order. */
function rowsOf(members: readonly Member[], asked: readonly Asked[]): Row[] {
  let next = 0
  return members.map((m, i) => {
    const a = asked[i] ?? { why: 'not asked' }
    if ('why' in a) return { label: m.label, why: a.why }
    return { letter: letterOf(next++), label: m.label, ms: a.answer.ms, text: a.answer.text }
  })
}

async function askChair($: EngineInterface, job: Job, answers: readonly Lettered[]): Promise<ModelForkResult> {
  const prompt = chairPrompt(job.ctx.question, answers, job.ctx.messages !== undefined)
  if (job.run.chair.via === 'fork') {
    const forked = await $.model.fork({ prompt })
    if (forked.isAnswered || forked.reason !== 'nothing-to-fork') return forked
    Object.assign(job.run.chair, { via: 'complete', label: labelOfModel(job.model) })
  }
  return $.model.complete({ model: job.model, prompt, effort: 'high', maxTokens: MAX_TOKENS, timeoutMs: MEMBER_MS })
}

/**
 * The chair as the person reads it. A fork runs on the session's model, which is not known after a module
 * reload until the next main-loop request, so the label then names the session and not the fallback model.
 */
function chairOf(ctx: Ctx, model: string): Chair {
  if (ctx.messages === undefined) return { label: labelOfModel(model), via: 'complete', state: 'waiting' }
  return { label: ctx.sessionModel === undefined ? 'the model of the session' : labelOfModel(ctx.sessionModel), via: 'fork', state: 'waiting' }
}

/** The chair's verdict over the lettered answers, or why there is none; the chair's seat is redrawn either way. */
async function verdictOf($: EngineInterface, job: Job, answers: readonly Lettered[]): Promise<{ text: string } | { why: string }> {
  const chair = job.run.chair
  chair.state = 'running'
  await drawRun($, job)
  const started = await $.clock.now()
  let got: { text: string } | { why: string }
  try {
    const r = await askChair($, job, answers)
    got = r.isAnswered ? { text: r.text.trim() } : { why: reasonText(r) }
  } catch (err) {
    got = { why: errorText(err) }
  }
  Object.assign(chair, 'text' in got ? { state: 'answered', ms: (await $.clock.now()) - started } : { state: 'failed', why: got.why })
  if ('text' in got) job.run.verdict = got.text
  return got
}

async function contextOf($: EngineInterface, state: State, config: Config, question: string, agentId: string | undefined): Promise<Ctx> {
  const messages = agentId === undefined ? await $.session.messages() : undefined
  return {
    question,
    config,
    gemini: await geminiReach($),
    rendered: new Map(),
    ...(messages === undefined ? {} : { messages }),
    ...(state.model === undefined ? {} : { sessionModel: state.model }),
  }
}

async function ended($: EngineInterface, job: Job): Promise<void> {
  job.run.endedAt = await $.clock.now()
  job.state.last = summaryText(job.run)
  await toPerson($, job)
}

/** One council run: every member at once, then the chair over the answers. */
async function convene($: EngineInterface, state: State, config: Config, question: string, agentId: string | undefined): Promise<Outcome> {
  const ctx = await contextOf($, state, config, question, agentId)
  const members = await membersNow($)
  const model = chairModel(ctx, members)
  const chair = chairOf(ctx, model)
  const run: Run = { id: ++state.runs, question, startedAt: await $.clock.now(), seats: members.map(m => seatOf(m, ctx)), chair }
  const job: Job = { state, run, ctx, model }
  state.current = run.id
  await drawRun($, job)
  const asked = await Promise.all(members.map((m, i) => sit($, job, run.seats[i] as Seat, m)))
  const rows = rowsOf(members, asked)
  const answers = rows.flatMap(r => (r.text === undefined ? [] : [{ letter: r.letter ?? '?', text: r.text }]))
  if (answers.length === 0) {
    Object.assign(run.chair, { state: 'failed', why: 'no member answered' })
    await ended($, job)
    return { deny: noAnswerText(rows) }
  }
  const verdict = await verdictOf($, job, answers)
  await ended($, job)
  return { text: resultText(verdict, chair.label, rows) }
}

async function onToolCall($: EngineInterface, state: State, config: Config, input: Record<string, unknown>, agentId: string | undefined): Promise<ToolCallResult> {
  if (!(await isEnabled($))) return { deny: OFF_DENY }
  let question: string
  try {
    question = questionOf(input)
  } catch (err) {
    return { deny: errorText(err) }
  }
  const outcome = await convene($, state, config, question, agentId)
  return 'deny' in outcome ? outcome : { result: outcome.text }
}

/**
 * Hands the result to the model through the mod's own `send` command, so the model reads the text alone,
 * as the person would type it. A turn that runs meanwhile holds it until its end (measured on 2.1.283).
 * A run the engine refuses sends it as a plugin prompt instead.
 */
function send($: EngineInterface, text: string): void {
  $.command.run({ command: SEND_COMMAND, args: text }).catch((err: unknown) => {
    $.ui.log(`the send command did not run, the verdict goes out as a plugin prompt: ${errorText(err)}`)
    $.prompt.submit({ text }).catch((e: unknown) => $.ui.log(`the verdict was not sent: ${errorText(e)}`))
  })
}

/** /council <question>: the run starts from a timer, because the engine refuses `$.command.run` inside the hook the command waits on. */
function runManual($: EngineInterface, state: State, config: Config, question: string): void {
  $.clock.after(0, () => {
    convene($, state, config, question, undefined).then(
      outcome => ('text' in outcome ? send($, sendText(question, outcome.text)) : $.ui.log(outcome.deny)),
      (err: unknown) => $.ui.log(`the council did not run: ${errorText(err)}`),
    )
  })
}

async function statusOf($: EngineInterface, state: State): Promise<string> {
  const reach = await geminiReach($)
  const members = (await membersNow($)).map(m => (m.kind === 'gemini' && !reach.ok ? { label: m.label, skipped: reach.why } : { label: m.label }))
  const chair = state.model === undefined ? 'the model of the session, forked' : `${labelOfModel(state.model)}, the model of the session, forked`
  return statusText(await isEnabled($), members, chair, state.last)
}

async function runCommand($: EngineInterface, state: State, config: Config, args: string): Promise<string> {
  const command = parseCommand(args)
  switch (command.kind) {
    case 'error': return command.text
    case 'status': return statusOf($, state)
    case 'set': return storeEnabled($, state, command.enabled)
    case 'members': return membersText((await membersNow($)).map(m => m.label))
    case 'setMembers':
      await $.store.set(MEMBERS_KEY, command.members)
      return membersText((await membersNow($)).map(m => m.label))
    case 'resetMembers':
      await $.store.delete(MEMBERS_KEY)
      return membersText(storedMembers(DEFAULT_MEMBERS).map(m => m.label))
    case 'ask':
      runManual($, state, config, command.question)
      return convenedText((await membersNow($)).length)
  }
}

export const register: Register = (on, options) => {
  const config = configFrom(options)
  const state: State = { guidance: false, declared: false, runs: 0 }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'council',
      description: 'A council of models on a hard problem: status, on, off, members [models | reset], or a question to ask it (council)',
      argumentHint: '[on | off | members [models | reset] | <question>]',
    })
    await enrollGemini($)
    state.guidance = await isEnabled($)
    if (state.guidance) await declareTool($, state)
    return r
  })

  // Every window shares the store: a /council on made in another window declares the tool here before the
  // next turn's first request. The note waits for /clear, as after /council on in this window.
  on('turn.start', async ($, e, next) => {
    if (!state.declared && (await isEnabled($))) await declareTool($, state)
    return next(e)
  })

  // /clear arrives only through the classic seam; the note follows the setting from there.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.agent_id === undefined) state.guidance = await isEnabled($)
    return r
  })

  on('command.run', { command: 'council' }, async ($, e) => ({ text: await runCommand($, state, config, String(e.args ?? '')) }))

  // The note is fixed at a session start or /clear, so a change of the setting does not change the prompt the cache holds.
  on('prompt.section', { name: 'env_info_simple' }, async (_, e, next) => {
    const r = await next(e)
    return r.text === null || !state.guidance ? r : { text: `${r.text}\n\n${SYSTEM_GUIDANCE}` }
  })

  // The tool matchers are patterns that equal TOOL_ID, because a literal typechecks only while the tool is
  // declared in the session /plugin-types ran in, and the tool is declared only while the council is on.

  // A plugin's tool waits behind ToolSearch by default; this one is listed, so the model can call it at once.
  on('tool.describe', { tool: /^mcp__council__convene$/ }, async (_, e, next) => ({ ...(await next(e)), isDeferred: false }))

  on('tool.call', { tool: /^mcp__council__convene$/ }, async ($, e) => onToolCall($, state, config, e as Record<string, unknown>, e.agentId))

  // The main loop's model decides which member forks the session and which model chairs.
  on('turn.step', async function* (_, e, next) {
    if (e.agentId === undefined) state.model = e.model
    return yield* next(e)
  })
}
