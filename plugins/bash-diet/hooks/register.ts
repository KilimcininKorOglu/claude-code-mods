import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'
import { withFlags } from './command.ts'
import { failureOf, joined, persistedPathOf, planFor, replaces, runFilter, type Plan } from './pipeline.ts'
import { fullOutputLine, hashOf, needsFile, staleFiles } from './recall.ts'
import { AWARENESS, USAGE, isExcluded, patternError, sessionText, statusText } from './text.ts'

const ENABLED_KEY = 'enabled'
const EXCLUDES_KEY = 'excludes'

/** Keys of a Bash record that point at the engine's own copy of the unfiltered output. */
const PERSISTED_KEYS = ['persistedOutputPath', 'persistedOutputSize', 'rawOutputPath'] as const

/** The session's gain, the settings, and the directory the full-output files go in. */
type State = {
  enabled: boolean
  excludes: string[]
  calls: number
  rawChars: number
  shownChars: number
  dir?: string
  lastError?: string
}

/** The output of one call as the model would read it, and where the engine kept it whole. */
type Output = { text: string; exitCode: number; isError: boolean; persisted?: string }

type BashRecord = { stdout: string; stderr: string; interrupted: boolean; isImage?: boolean; backgroundTaskId?: string; persistedOutputPath?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Logs a failure once until a different one comes; the call's own result is never lost to it. */
function report($: EngineInterface, state: State, what: string, err: unknown): void {
  const text = `${what}: ${errorText(err)}`
  if (text !== state.lastError) $.ui.log(text)
  state.lastError = text
}

/** The session's gain in the shared sidebar, or on the status line while the sidebar is closed. */
async function showGain($: EngineInterface, state: State): Promise<void> {
  const text = sessionText(state.calls, state.rawChars, state.shownChars)
  try {
    const taken = await $.sidebar.set({
      consumer: 'bash-diet',
      key: 'session',
      title: 'Bash output',
      lines: [{ text, kind: state.calls === 0 ? 'dim' : 'ok' }],
      until: 'session',
      order: 22,
    })
    if (taken) { $.ui.status(undefined); return }
  } catch {
    // The sidebar mod is not installed: the status line carries the gain.
  }
  $.ui.status(state.calls === 0 ? undefined : text)
}

/** The directory the full-output files go in, made when it is missing. */
async function recallDir($: EngineInterface, state: State): Promise<string> {
  if (state.dir !== undefined) return state.dir
  const dir = `${((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')}/bash-diet`
  const made = await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5_000 })
  if (made.exitCode !== 0) throw new Error(`mkdir ${dir} failed: ${made.stderr.trim()}`)
  state.dir = dir
  return dir
}

/** Deletes the full-output files past the age and count limits; a failure is logged once. */
async function pruneRecall($: EngineInterface, state: State): Promise<void> {
  try {
    const dir = await recallDir($, state)
    const names = (await $.fs.list(dir)).filter(f => f.kind === 'file').map(f => f.name)
    const files = await Promise.all(names.map(async name => ({ name, mtimeMs: (await $.fs.stat(`${dir}/${name}`)).mtimeMs })))
    const stale = staleFiles(files, await $.clock.now())
    if (stale.length > 0) await $.process.run(['rm', '-f', ...stale.map(n => `${dir}/${n}`)], { timeoutMs: 10_000 })
  } catch (err) {
    report($, state, 'old full-output files were not pruned', err)
  }
}

/** The path of the call's full output: the engine's own file, else a new one; undefined when writing failed. */
async function keepFull($: EngineInterface, state: State, command: string, out: Output): Promise<string | undefined> {
  if (out.persisted !== undefined) return out.persisted
  try {
    const path = `${await recallDir($, state)}/${await hashOf(command, out.text)}.log`
    await $.fs.write(path, out.text)
    return path
  } catch (err) {
    report($, state, 'the full output was not kept', err)
    return undefined
  }
}

/** Reads the engine's full-output file when it cut the result, else the text as it came. */
async function wholeText($: EngineInterface, text: string, persisted: string | undefined): Promise<string | undefined> {
  if (persisted === undefined) return text
  try {
    return await $.fs.read(persisted)
  } catch {
    // Over the read limit or gone: the engine's own preview stays, unfiltered.
    return undefined
  }
}

/**
 * The call's output, or undefined for one a filter must not touch: denied, backgrounded, interrupted,
 * an image, or an error that is not a command's exit (a timeout, a refused input).
 */
async function outputOf($: EngineInterface, r: ToolCallResult<'Bash'>): Promise<Output | undefined> {
  if (r.deny !== undefined) return undefined
  if (r.isError === true) return failedOutput($, r.text ?? '')
  const rec = r.result as BashRecord | undefined
  if (rec === undefined || rec.interrupted || rec.isImage === true || rec.backgroundTaskId !== undefined) return undefined
  const text = await wholeText($, joined(rec.stdout, rec.stderr), rec.persistedOutputPath)
  return text === undefined ? undefined : { text, exitCode: 0, isError: false, persisted: rec.persistedOutputPath }
}

/** A failed call's output from its error text, `Exit code N` and the output; undefined for another error. */
async function failedOutput($: EngineInterface, errorText: string): Promise<Output | undefined> {
  const failure = failureOf(errorText)
  if (failure === undefined) return undefined
  const persisted = persistedPathOf(failure.output)
  const text = await wholeText($, failure.output, persisted)
  return text === undefined ? undefined : { text, exitCode: failure.exitCode, isError: true, persisted }
}

/** The result the model reads: the filtered text in the tool's own shape, or its exit as an error. */
function shaped(r: ToolCallResult<'Bash'>, out: Output, text: string): ToolCallResult<'Bash'> {
  if (out.isError) return { deny: `Exit code ${out.exitCode}\n${text}` }
  const rec = { ...(r.result as BashRecord) } as Record<string, unknown>
  for (const key of PERSISTED_KEYS) delete rec[key]
  return { result: { ...rec, stdout: text, stderr: '' } as never, context: r.context }
}

/** Filters one call's result, keeps its full output when something was left out, and counts the gain. */
async function shrink($: EngineInterface, state: State, command: string, plan: Plan, flagged: boolean, r: ToolCallResult<'Bash'>): Promise<ToolCallResult<'Bash'>> {
  const out = await outputOf($, r)
  if (out === undefined) return r
  const filtered = runFilter(plan, out.text, out.exitCode, flagged)
  if (!replaces(out.text, filtered.text, flagged)) return r
  const full = needsFile(filtered.elided, out.exitCode, out.text.length) ? await keepFull($, state, command, out) : undefined
  const text = full === undefined ? filtered.text : `${filtered.text}\n${fullOutputLine(full)}`
  state.calls += 1
  state.rawChars += out.text.length
  state.shownChars += text.length
  await showGain($, state)
  return shaped(r, out, text)
}

/**
 * The command with the plan's flags, when the permission check reads it as it reads the command the
 * model wrote; a flag that would raise a new prompt is left out, and the filter reads plain output.
 */
async function withPlanFlags($: EngineInterface, command: string, plan: Plan): Promise<string> {
  if (plan.target === undefined || plan.flags.length === 0) return command
  const next = withFlags(command, plan.target, plan.nameEnd, plan.flags)
  const [before, after] = await Promise.all([
    $.tool.check({ tool: 'Bash', input: { command } }),
    $.tool.check({ tool: 'Bash', input: { command: next } }),
  ])
  return before.decision === after.decision ? next : command
}

async function setExcludes($: EngineInterface, state: State, excludes: string[]): Promise<void> {
  state.excludes = excludes
  await $.store.set(EXCLUDES_KEY, excludes)
}

async function exclude($: EngineInterface, state: State, word: string, pattern: string): Promise<string> {
  const error = patternError(pattern)
  if (error !== undefined) return `${word} ${error}`
  if (word === 'exclude') {
    if (!state.excludes.includes(pattern)) await setExcludes($, state, [...state.excludes, pattern])
    return `excluded: ${pattern} runs unfiltered`
  }
  if (!state.excludes.includes(pattern)) return `${pattern} is not excluded`
  await setExcludes($, state, state.excludes.filter(p => p !== pattern))
  return `included: ${pattern} is filtered again`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const text = args.trim()
  const [word = '', ...rest] = text.split(/\s+/)
  if (word === 'on' || word === 'off') {
    state.enabled = word === 'on'
    await $.store.set(ENABLED_KEY, state.enabled)
    return state.enabled ? 'on: Bash results are filtered' : 'off: Bash results reach the model as they are'
  }
  if (word === 'exclude' || word === 'include') return exclude($, state, word, rest.join(' '))
  if (word === 'excludes') return state.excludes.length === 0 ? 'no excludes' : state.excludes.join('\n')
  if (text !== '') return USAGE
  return statusText(state.enabled, state.excludes, sessionText(state.calls, state.rawChars, state.shownChars))
}

/** Filters one Bash call; everything the plan leaves alone runs as the model wrote it. */
async function filterCall($: EngineInterface, state: State, e: ToolCallInput & { tool: 'Bash' }, next: (e: ToolCallInput) => Promise<ToolCallResult<'Bash'>>): Promise<ToolCallResult<'Bash'>> {
  const plan = state.enabled && e.run_in_background !== true ? planFor(e.command) : undefined
  if (plan === undefined || (plan.target !== undefined && isExcluded(state.excludes, plan.target.words))) return next(e)
  const command = await withPlanFlags($, e.command, plan)
  const r = await next(command === e.command ? e : { ...e, command })
  return shrink($, state, e.command, plan, command !== e.command, r)
}

export const register: Register = on => {
  const state: State = { enabled: true, excludes: [], calls: 0, rawChars: 0, shownChars: 0 }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    const stored = await $.store.get(EXCLUDES_KEY)
    state.excludes = Array.isArray(stored) ? stored.filter((p): p is string => typeof p === 'string') : []
    await $.command.register({
      name: 'bash-diet',
      description: 'Filters Bash results: status, on, off, exclude, include (bash-diet)',
      argumentHint: '[on | off | exclude <p> | include <p> | excludes]',
      immediate: true,
    })
    await pruneRecall($, state)
    await showGain($, state)
    return r
  })

  // The note reaches the model at startup, resume, /clear and after a compaction, while the mod is on.
  on('classic.SessionStart', async (_$, e, next) => {
    const r = await next(e)
    return state.enabled ? { ...r, additionalContext: [...(r.additionalContext ?? []), AWARENESS] } : r
  })

  on('command.run', { command: 'bash-diet' }, async ($, e) => {
    const text = await runCommand($, state, String(e.args ?? ''))
    await showGain($, state)
    return { text }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => filterCall($, state, e, next as never))
}
