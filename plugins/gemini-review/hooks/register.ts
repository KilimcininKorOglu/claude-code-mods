import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { changeText, parseCommand, STORE_KEYS, statusText, storedValue, type Settings } from './command.ts'
import { diffCommands, fileCount, findCommit, newFileDiff, SKIP_VARIABLE, type CommitPlan } from './commit.ts'
import { configFrom, type Config } from './config.ts'
import { parseResponse, retryDelay, type Answer, type Request } from './gemini.ts'
import { buildReviewRequest, cleanContext, denyText, failedContext, minorContext, parseFindings, summaryText, type Finding } from './review.ts'
import { renderTranscript } from './transcript.ts'

/** The last review's line, for the status. */
type State = { last?: string }

/** What the review decided: stop the commit, or let it run with a note for the model. */
type Verdict = { deny?: string; context?: string }

/** At most this many new files are read into the diff. */
const MAX_NEW_FILES = 200

/** A diff over this is not sent, and the commit runs unreviewed. */
const MAX_DIFF_CHARS = 1_500_000

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The plugin options with the settings /gemini-review stored on top. */
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

/** Sends the request, again after a 503 while the retry budget allows. */
async function fetchAnswer($: EngineInterface, request: Request): Promise<Answer> {
  const started = await $.clock.now()
  for (let attempt = 1; ; attempt++) {
    const response = await $.http.fetch(request.url, request.init)
    const delay = retryDelay(response.status, attempt, (await $.clock.now()) - started)
    if (delay === undefined) return parseResponse(response.status, response.ok, response.text)
    await $.clock.sleep(delay)
  }
}

function notReviewed($: EngineInterface, state: State, reason: string): Verdict {
  state.last = `not reviewed: ${reason}`
  $.ui.log(`commit ran without a review: ${reason}`)
  return { context: failedContext(reason) }
}

function verdictOf($: EngineInterface, state: State, config: Config, findings: readonly Finding[], files: number, summary: string): Verdict {
  state.last = summary
  const blockers = findings.filter(f => f.severity === 'blocker')
  const minors = findings.filter(f => f.severity === 'minor')
  $.ui.toast(config.tier === 'free' ? `${summary} · sent to Gemini free tier` : summary, { timeoutMs: 10_000 })
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
  const key = await apiKey($, config)
  if (key === undefined) return notReviewed($, state, 'no Gemini key (set GEMINI_API_KEY or the plugin option)')
  try {
    const diff = await collectDiff($, plan, resolveDir(await $.session.cwd(), plan.cwd))
    if (diff.trim() === '') return {}
    // A subagent's call sends no conversation: which transcript it would get was not verified.
    const transcript = agentId === undefined ? renderTranscript(await $.session.messages(), config.maxInputChars) : undefined
    const answer = await fetchAnswer($, buildReviewRequest(config.model, key, transcript, diff))
    const findings = parseFindings(answer)
    const files = fileCount(diff)
    return verdictOf($, state, config, findings, files, summaryText(files, findings, answer))
  } catch (err) {
    return notReviewed($, state, errorText(err))
  }
}

/** Adds a note the model reads after the tool's result; an error or a denial is left as it is. */
function withContext(r: ToolCallResult, text: string): ToolCallResult {
  if (r.deny !== undefined || r.isError === true) return r
  return { ...r, context: [...(r.context ?? []), text] }
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

export const register: Register = (on, options) => {
  const base = configFrom(options)
  const state: State = {}

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'gemini-review',
      description: 'Gemini commit review: status, on, off, free, paid, model <id>, reset (gemini-review)',
      argumentHint: '[on | off | free | paid | model <id> | reset]',
    })
    return r
  })

  on('command.run', { command: 'gemini-review' }, async ($, e) => ({ text: await runCommand($, state, base, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const plan = findCommit(e.command)
    if (plan === undefined) return next(e)
    const config = await loadConfig($, base)
    if (!config.enabled) return next(e)
    if (plan.skip) {
      state.last = `skipped by the model (${SKIP_VARIABLE}=1)`
      $.ui.log(`commit ran without a review: the model used ${SKIP_VARIABLE}=1`)
      return next(e)
    }
    const verdict = await review($, state, config, plan, e.agentId)
    if (verdict.deny !== undefined) return { deny: verdict.deny }
    const r = await next(e)
    return verdict.context === undefined ? r : withContext(r, verdict.context)
  })
}
