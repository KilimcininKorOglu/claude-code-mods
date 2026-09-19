import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { changeText, ENABLED_KEY, NO_KEY_ON, parseCommand, RESET_TEXT, statusText } from './command.ts'
import { combinedText, diffCommands, fileCount, findCommit, newFileDiff, SKIP_VARIABLE, type CommitPlan } from './commit.ts'
import { CONSUMER, configFrom, DEADLINE_MS, DEFAULT_MODEL, type Config } from './config.ts'
import { buildReviewBody, cleanContext, denyText, failedContext, minorContext, parseFindings, summaryText, type Answer, type Finding } from './review.ts'
import { renderTranscript } from './transcript.ts'

/** The last review's line, for the status. */
type State = { last?: string }

/** What the review decided: stop the commit, or let it run with a note for the model. */
type Verdict = { deny?: string; context?: string }

/** Gemini's answer and the tier it went to, or why there is none. */
type Asked = { answer: Answer; tier: 'free' | 'paid' } | { error: string }

/** At most this many new files are read into the diff. */
const MAX_NEW_FILES = 200

/** A diff over this is not sent, and the commit runs unreviewed. */
const MAX_DIFF_CHARS = 1_500_000

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

/** Runs a git command and answers its output; another exit code throws with git's message. */
async function git($: EngineInterface, argv: readonly string[], cwd: string, okCodes: readonly number[] = [0]): Promise<string> {
  const r = await $.process.run(argv, { cwd, timeoutMs: 20_000 })
  if (!okCodes.includes(r.exitCode)) throw new Error(`${argv.slice(0, 3).join(' ')} failed: ${r.stderr.trim().slice(0, 200)}`)
  return r.stdout
}

function resolveDir(base: string, dir: string | undefined): string {
  if (dir === undefined) return base
  return dir.startsWith('/') ? dir : `${base}/${dir}`
}

/** The change the commit records: the index, what the command stages, and new files whole. */
async function collectDiff($: EngineInterface, plan: CommitPlan, cwd: string): Promise<string> {
  const hasHead = (await $.process.run(['git', 'rev-parse', '--verify', '--quiet', 'HEAD'], { cwd, timeoutMs: 20_000 })).exitCode === 0
  const { diffs, untracked } = diffCommands(plan, hasHead)
  const parts: string[] = []
  for (const argv of diffs) parts.push(await git($, argv, cwd))
  const files = untracked === undefined ? [] : (await git($, untracked, cwd)).split('\n').filter(Boolean)
  for (const file of files.slice(0, MAX_NEW_FILES)) parts.push(await git($, newFileDiff(file), cwd, [0, 1]))
  const diff = parts.filter(p => p.trim() !== '').join('\n')
  if (diff.length > MAX_DIFF_CHARS) throw new Error(`the diff is over ${MAX_DIFF_CHARS} characters`)
  return diff
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
  $.ui.log(`commit ran without a review: ${reason}`)
  return { context: failedContext(reason) }
}

function verdictOf($: EngineInterface, state: State, tier: 'free' | 'paid', findings: readonly Finding[], files: number, summary: string): Verdict {
  state.last = summary
  const blockers = findings.filter(f => f.severity === 'blocker')
  const minors = findings.filter(f => f.severity === 'minor')
  $.ui.toast(tier === 'free' ? `${summary} · sent to Gemini free tier` : summary, { timeoutMs: 10_000 })
  if (blockers.length > 0) {
    $.ui.log(`commit stopped: ${summary}`)
    return { deny: denyText(blockers, minors) }
  }
  return { context: minors.length === 0 ? cleanContext(files) : minorContext(minors) }
}

/**
 * Asks Gemini about the change. Anything that keeps the review from an
 * answer lets the commit run with a note, as the user chose.
 */
async function review($: EngineInterface, state: State, config: Config, plan: CommitPlan, agentId: string | undefined): Promise<Verdict> {
  try {
    // Without a key no git runs and nothing is read.
    if (!(await $.gemini.settings({ consumer: CONSUMER })).hasKey) return notReviewed($, state, 'no Gemini key: set GEMINI_API_KEY or the gemini-core apiKey option')
    const diff = await collectDiff($, plan, resolveDir(await $.session.cwd(), plan.cwd))
    if (diff.trim() === '') return {}
    // A subagent's call sends no conversation: which transcript it would get was not verified.
    const transcript = agentId === undefined ? renderTranscript(await $.session.messages(), config.maxInputChars) : undefined
    const asked = await askGemini($, buildReviewBody(transcript, diff))
    if ('error' in asked) return notReviewed($, state, asked.error)
    const findings = parseFindings(asked.answer)
    const files = fileCount(diff)
    return verdictOf($, state, asked.tier, findings, files, summaryText(files, findings, asked.answer))
  } catch (err) {
    return notReviewed($, state, errorText(err))
  }
}

/** Adds a note the model reads after the tool's result; an error or a denial is left as it is. */
function withContext(r: ToolCallResult, text: string): ToolCallResult {
  if (r.deny !== undefined || r.isError === true) return r
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
  const state: State = {}

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.gemini.enroll({ consumer: CONSUMER, defaultModel: DEFAULT_MODEL })
    await $.command.register({
      name: 'gemini-review',
      description: 'Gemini commit review: status, on, off, reset; /gemini-core sets the model, thinking and tier (gemini-review)',
      argumentHint: '[on | off | reset]',
    })
    return r
  })

  on('command.run', { command: 'gemini-review' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const plan = findCommit(e.command)
    if (plan === undefined || !(await isEnabled($))) return next(e)
    if (plan.skip) {
      state.last = `skipped by the model (${SKIP_VARIABLE}=1)`
      $.ui.log(`commit ran without a review: the model used ${SKIP_VARIABLE}=1`)
      return next(e)
    }
    if (plan.before.length > 0) {
      state.last = 'stopped: git commit came after other commands in one call'
      return { deny: combinedText(plan.before) }
    }
    const verdict = await review($, state, config, plan, e.agentId)
    if (verdict.deny !== undefined) return { deny: verdict.deny }
    const r = await next(e)
    return verdict.context === undefined ? r : withContext(r, verdict.context)
  })
}
