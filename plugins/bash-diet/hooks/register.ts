import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'
import { BUILTIN_RULES } from './builtin-rules.ts'
import { withFlags } from './command.ts'
import { rulesOf, type Rule } from './dsl.ts'
import { correctionsOf, discoverText, finish, learnFile, learnText, scan, scannerOf, type BashCall } from './history.ts'
import type { FilterResult } from './filters/common.ts'
import { dayOf, gainFileName, gainReport, linesOfRecords, recordsOf, staleGainFiles, type GainRecord } from './gain.ts'
import { failureOf, joined, persistedPathOf, planFor, replaces, runFilter, type Plan } from './pipeline.ts'
import { PLAYWRIGHT_TOOL, resultWithoutEcho } from './playwright.ts'
import { costText } from './pricing.ts'
import { fullOutputLine, hashOf, isCut, needsFile, sha256Of, staleFiles } from './recall.ts'
import { AWARENESS, USAGE, filtersText, isExcluded, patternError, sessionLine, sessionText, statusText, tokensOf } from './text.ts'

const ENABLED_KEY = 'enabled'
const EXCLUDES_KEY = 'excludes'
/** The SHA-256 each trusted project rule file had when the person trusted it, by path. */
const TRUSTED_KEY = 'trusted'

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
  /** The person's rule files: the project's first, then the global one. */
  files: RuleFile[]
  trusted: Record<string, string>
  /** Where the saving records go, this session's id and project, and its records so far. */
  gain?: { dir: string; sessionId: string; project: string; ready: boolean }
  records: GainRecord[]
  places?: Places
}

/** The places the mod reads and writes: the repository the session runs in, and the config directory. */
type Places = { repo: string; config: string; home: string }

/** One `filters.json` file as last read: its rules, and the hash trust is checked against. */
type RuleFile = {
  path: string
  shown: string
  source: 'project' | 'global'
  mtimeMs?: number
  hash?: string
  rules: Rule[]
  /** The hash of the content the untrusted notice was last written for. */
  told?: string
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
      lines: [sessionLine(state.calls, state.rawChars, state.shownChars)],
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

/**
 * What the model reads without the mod: the engine's preview and path when it kept the output in a file,
 * else the output itself.
 */
function unfiltered(r: ToolCallResult<'Bash'>, out: Output): string {
  return out.persisted !== undefined && r.text !== undefined ? r.text : out.text
}

/**
 * The path of the call's full output when the filter left something out, else undefined. A masked
 * result gets none, because that file would hold the credential values the filter masked.
 */
async function fullPathOf($: EngineInterface, state: State, command: string, out: Output, filtered: FilterResult): Promise<string | undefined> {
  if (filtered.redacted === true || !needsFile(filtered.elided, out.exitCode, out.text.length)) return undefined
  return keepFull($, state, command, out)
}

/**
 * Whether the engine's preview stays: it kept the output in a file, and the filtered text is no shorter
 * than that preview. A masked result stands anyway, because the preview holds the values it masked.
 */
const previewStays = (out: Output, filtered: FilterResult, text: string, before: string): boolean =>
  out.persisted !== undefined && filtered.redacted !== true && text.length >= before.length

/** Filters one call's result, keeps its full output when something was left out, and counts the gain. */
async function shrink($: EngineInterface, state: State, command: string, plan: Plan, flagged: boolean, r: ToolCallResult<'Bash'>): Promise<ToolCallResult<'Bash'>> {
  const out = await outputOf($, r)
  if (out === undefined) return r
  const filtered = runFilter(plan, out.text, out.exitCode, flagged)
  if (!replaces(out.text, filtered.text, flagged || filtered.redacted === true)) return r
  const full = await fullPathOf($, state, command, out, filtered)
  const text = full === undefined ? filtered.text : `${filtered.text}\n${fullOutputLine(full, out.isError && isCut(out.text))}`
  const before = unfiltered(r, out)
  if (previewStays(out, filtered, text, before)) return r
  state.calls += 1
  state.rawChars += before.length
  state.shownChars += text.length
  await Promise.all([showGain($, state), recordGain($, state, plan.family, before.length, text.length)])
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

/** The repository the session started in (its root where git does not answer) and the config directory. */
async function locate($: EngineInterface): Promise<Places> {
  const root = await $.session.root()
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root, timeoutMs: 5_000 })
  const home = (await $.env.get('HOME')) ?? ''
  const config = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`).replace(/\/+$/, '')
  return { repo: top.exitCode === 0 ? top.stdout.trim() : root, config, home }
}

/** The two rule files: `<repo>/.bash-diet/filters.json` and `<config>/bash-diet/filters.json`. */
function ruleFilesOf(p: Places): RuleFile[] {
  const global = `${p.config}/bash-diet/filters.json`
  return [
    { path: `${p.repo}/.bash-diet/filters.json`, shown: '.bash-diet/filters.json', source: 'project', rules: [] },
    { path: global, shown: p.home !== '' && global.startsWith(`${p.home}/`) ? `~${global.slice(p.home.length)}` : global, source: 'global', rules: [] },
  ]
}

/** Writes this session's records of the day to its file; a failure is logged once. */
async function recordGain($: EngineInterface, state: State, family: string, raw: number, shown: number): Promise<void> {
  const g = state.gain
  if (g === undefined) return
  try {
    const at = await $.clock.now()
    state.records.push({ at, project: g.project, family, raw, shown })
    if (!g.ready) {
      const made = await $.process.run(['mkdir', '-p', g.dir], { timeoutMs: 5_000 })
      if (made.exitCode !== 0) throw new Error(`mkdir ${g.dir} failed: ${made.stderr.trim()}`)
      g.ready = true
    }
    await $.fs.write(`${g.dir}/${gainFileName(at, g.sessionId)}`, linesOfRecords(state.records.filter(r => dayOf(r.at) === dayOf(at))))
  } catch (err) {
    report($, state, 'the saving was not recorded', err)
  }
}

/** The gain files in the directory; none when it does not exist yet. */
async function gainFiles($: EngineInterface, dir: string): Promise<string[]> {
  if (!(await $.fs.exists(dir))) return []
  return (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.jsonl')).map(f => f.name)
}

/**
 * Takes back this session's records and counts from its gain files, so a reloaded module (an edit, an
 * update, `/reload-plugins`) neither overwrites the records written before it nor restarts the count.
 */
async function seedGain($: EngineInterface, state: State): Promise<void> {
  const g = state.gain
  if (g === undefined || state.records.length > 0) return
  try {
    const own = (await gainFiles($, g.dir)).filter(n => n.endsWith(`-${g.sessionId}.jsonl`))
    for (const name of own) state.records.push(...recordsOf(await $.fs.read(`${g.dir}/${name}`)).records)
    state.calls = state.records.length
    state.rawChars = state.records.reduce((n, r) => n + r.raw, 0)
    state.shownChars = state.records.reduce((n, r) => n + r.shown, 0)
  } catch (err) {
    report($, state, 'the saving records of this session were not read', err)
  }
}

/** Deletes the gain files past the retention; a failure is logged once. */
async function pruneGain($: EngineInterface, state: State): Promise<void> {
  if (state.gain === undefined) return
  const dir = state.gain.dir
  try {
    const stale = staleGainFiles(await gainFiles($, dir), await $.clock.now())
    if (stale.length > 0) await $.process.run(['rm', '-f', ...stale.map(n => `${dir}/${n}`)], { timeoutMs: 10_000 })
  } catch (err) {
    report($, state, 'old saving records were not pruned', err)
  }
}

/** `/bash-diet gain [project | daily | graph | history]` over every kept record. */
async function gainCommand($: EngineInterface, state: State, view: string): Promise<string> {
  if (state.gain === undefined) return 'the saving records are not known yet'
  const dir = state.gain.dir
  let bad = 0
  const records: GainRecord[] = []
  for (const name of await gainFiles($, dir)) {
    const r = recordsOf(await $.fs.read(`${dir}/${name}`))
    records.push(...r.records)
    bad += r.bad
  }
  const text = gainReport(view, records, await $.clock.now())
  if (text === undefined) return 'gain expects nothing, project, daily, graph or history'
  return bad === 0 ? text : `${text}\n(${bad} unreadable line(s) in ${dir} left out)`
}

/** The transcript directories: the one holding this session's transcript, or every project's. */
async function transcriptDirs($: EngineInterface, state: State, all: boolean): Promise<string[]> {
  const root = `${state.places?.config ?? ''}/projects`
  if (!(await $.fs.exists(root))) return []
  const dirs = (await $.fs.list(root)).filter(f => f.kind === 'dir').map(f => `${root}/${f.name}`)
  if (all) return dirs
  for (const dir of dirs) if (await $.fs.exists(`${dir}/${state.gain?.sessionId ?? ''}.jsonl`)) return [dir]
  return []
}

/** The transcripts in the directories written in the last `days` days. */
async function transcriptsOf($: EngineInterface, dirs: string[], days: number): Promise<string[]> {
  const since = (await $.clock.now()) - days * 24 * 60 * 60 * 1000
  const files: string[] = []
  for (const dir of dirs) {
    for (const f of await $.fs.list(dir)) {
      if (f.kind === 'file' && f.name.endsWith('.jsonl') && (await $.fs.stat(`${dir}/${f.name}`)).mtimeMs >= since) files.push(`${dir}/${f.name}`)
    }
  }
  return files
}

/** Every Bash call of the transcripts, streamed, because a transcript can pass the file read limit. */
async function callsIn($: EngineInterface, files: string[]): Promise<BashCall[]> {
  const calls: BashCall[] = []
  for (const path of files) {
    const s = scannerOf(path)
    for await (const chunk of $.process.spawn({ argv: ['cat', path] })) if (chunk.stream === 'stdout') scan(s, chunk.text)
    calls.push(...finish(s))
  }
  return calls
}

/** `/bash-diet learn write`: the corrections as a rules file the model reads in later sessions. */
async function writeLearned($: EngineInterface, state: State, calls: BashCall[]): Promise<string> {
  const corrections = correctionsOf(calls)
  if (corrections.length === 0) return 'no corrected command to write'
  const dir = `${state.places?.repo ?? ''}/.claude/rules`
  const made = await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5_000 })
  if (made.exitCode !== 0) return `mkdir ${dir} failed: ${made.stderr.trim()}`
  await $.fs.write(`${dir}/cli-corrections.md`, learnFile(corrections))
  return `wrote ${corrections.length} correction(s) to .claude/rules/cli-corrections.md`
}

/** `/bash-diet discover [days] [all]` and `learn [days] [write]` over the transcripts. */
async function historyCommand($: EngineInterface, state: State, word: string, rest: string[]): Promise<string> {
  const days = Number(rest.find(w => /^\d+$/.test(w)) ?? 30)
  if (days < 1 || days > 365) return `${word} expects a number of days from 1 to 365`
  if (word === 'discover' && rest.includes('all')) return discoverAll($, state, days)
  const files = await transcriptsOf($, await transcriptDirs($, state, false), days)
  const calls = await callsIn($, files)
  if (word === 'discover') return discoverText(calls, files.length, days)
  if (rest.includes('write')) return writeLearned($, state, calls)
  return learnText(correctionsOf(calls), files.length, days)
}

/**
 * `/bash-diet discover all`: every project's transcripts are more than a command's own time allows (6.6 s
 * of parsing for 110k calls, measured), so the reading runs on after the command answers, and its report
 * comes as a log line.
 */
async function discoverAll($: EngineInterface, state: State, days: number): Promise<string> {
  const files = await transcriptsOf($, await transcriptDirs($, state, true), days)
  void (async () => {
    try {
      $.ui.log(discoverText(await callsIn($, files), files.length, days))
    } catch (err) {
      report($, state, 'discover all did not finish', err)
    }
  })()
  return `reading ${files.length} transcript(s) of every project from the last ${days} days; the report follows as a log line`
}

/** `/bash-diet gain`, `discover` and `learn`: the reports over what earlier sessions left. */
function reportCommand($: EngineInterface, state: State, word: string, rest: string[]): Promise<string> {
  return word === 'gain' ? gainCommand($, state, rest.join(' ')) : historyCommand($, state, word, rest)
}

/** `/bash-diet cost`: the session's spend and what the tokens kept out would have cost. */
async function costCommand($: EngineInterface, state: State): Promise<string> {
  const [model, usage] = await Promise.all([$.session.model(), $.session.usage()])
  return costText(model, tokensOf(Math.max(0, state.rawChars - state.shownChars)), usage.cost?.usd)
}

/** Reads a rule file again when it changed; a file with errors keeps its good rules and says what is wrong. */
async function refreshFile($: EngineInterface, f: RuleFile): Promise<void> {
  if (!(await $.fs.exists(f.path))) {
    Object.assign(f, { mtimeMs: undefined, hash: undefined, rules: [] })
    return
  }
  const { mtimeMs } = await $.fs.stat(f.path)
  if (mtimeMs === f.mtimeMs) return
  const text = await $.fs.read(f.path)
  const compiled = rulesOf(text, f.source)
  Object.assign(f, { mtimeMs, hash: await sha256Of(text), rules: compiled.rules })
  if (compiled.errors.length > 0) $.ui.log(`${f.shown}: ${compiled.errors.join('; ')}`)
}

const isTrusted = (state: State, f: RuleFile): boolean => f.source === 'global' || (f.hash !== undefined && state.trusted[f.path] === f.hash)

/** The person's rules that may run: a project file's only while its content is the trusted one. */
async function activeRules($: EngineInterface, state: State): Promise<Rule[]> {
  try {
    for (const f of state.files) await refreshFile($, f)
  } catch (err) {
    report($, state, 'the filter rules were not read', err)
  }
  for (const f of state.files) {
    if (isTrusted(state, f) || f.rules.length === 0 || f.told === f.hash) continue
    f.told = f.hash
    $.ui.log(`${f.shown}: ${f.rules.length} filter rule(s) are not trusted and do not run; /bash-diet trust runs them`)
  }
  return state.files.filter(f => isTrusted(state, f)).flatMap(f => f.rules)
}

async function setTrusted($: EngineInterface, state: State, trusted: Record<string, string>): Promise<void> {
  state.trusted = trusted
  await $.store.set(TRUSTED_KEY, trusted)
}

/** `/bash-diet trust`, `untrust` and `filters`. */
async function ruleCommand($: EngineInterface, state: State, word: string): Promise<string> {
  const project = state.files.find(f => f.source === 'project')
  if (project === undefined) return 'the rule files are not known yet'
  await activeRules($, state)
  if (word === 'filters') {
    return filtersText(state.files.map(f => ({ shown: f.shown, source: f.source, exists: f.hash !== undefined, trusted: isTrusted(state, f), names: f.rules.map(r => r.name) })), BUILTIN_RULES.map(r => r.name))
  }
  const others = Object.fromEntries(Object.entries(state.trusted).filter(([path]) => path !== project.path))
  if (word === 'untrust') {
    await setTrusted($, state, others)
    return `untrusted: ${project.shown} does not run`
  }
  if (project.hash === undefined) return `there is no ${project.shown} in this repository`
  await setTrusted($, state, { ...others, [project.path]: project.hash })
  return `trusted: ${project.rules.length} rule(s) of ${project.shown} run until the file changes (sha256 ${project.hash.slice(0, 12)})`
}

async function setExcludes($: EngineInterface, state: State, excludes: string[]): Promise<void> {
  state.excludes = excludes
  await $.store.set(EXCLUDES_KEY, excludes)
}

/** `/bash-diet exclude <p>`, `include <p>` and `excludes`. */
async function exclude($: EngineInterface, state: State, word: string, pattern: string): Promise<string> {
  if (word === 'excludes') return state.excludes.length === 0 ? 'no excludes' : state.excludes.join('\n')
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

async function setEnabled($: EngineInterface, state: State, enabled: boolean): Promise<string> {
  state.enabled = enabled
  await $.store.set(ENABLED_KEY, enabled)
  return enabled ? 'on: Bash results are filtered' : 'off: Bash results reach the model as they are'
}

/** The answer to a subcommand, or undefined for one the command does not know. */
function subcommand($: EngineInterface, state: State, word: string, rest: string[]): Promise<string> | undefined {
  const bare = rest.length === 0
  if (['on', 'off'].includes(word) && bare) return setEnabled($, state, word === 'on')
  if (['exclude', 'include', 'excludes'].includes(word)) return exclude($, state, word, rest.join(' '))
  if (['trust', 'untrust', 'filters'].includes(word) && bare) return ruleCommand($, state, word)
  if (['gain', 'discover', 'learn'].includes(word)) return reportCommand($, state, word, rest)
  if (word === 'cost' && bare) return costCommand($, state)
  return undefined
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const text = args.trim()
  if (text === '') return statusText(state.enabled, state.excludes, sessionText(state.calls, state.rawChars, state.shownChars))
  const [word = '', ...rest] = text.split(/\s+/)
  return (await subcommand($, state, word, rest)) ?? USAGE
}

/** Filters one Bash call; everything the plan leaves alone runs as the model wrote it. */
async function filterCall($: EngineInterface, state: State, e: ToolCallInput & { tool: 'Bash' }, next: (e: ToolCallInput) => Promise<ToolCallResult<'Bash'>>): Promise<ToolCallResult<'Bash'>> {
  const plan = state.enabled && e.run_in_background !== true ? planFor(e.command, await activeRules($, state)) : undefined
  if (plan === undefined || (plan.target !== undefined && isExcluded(state.excludes, plan.target.words))) return next(e)
  const command = await withPlanFlags($, e.command, plan)
  const r = await next(command === e.command ? e : { ...e, command })
  return shrink($, state, e.command, plan, command !== e.command, r)
}

export const register: Register = on => {
  const state: State = { enabled: true, excludes: [], calls: 0, rawChars: 0, shownChars: 0, files: [], trusted: {}, records: [] }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    const stored = await $.store.get(EXCLUDES_KEY)
    state.excludes = Array.isArray(stored) ? stored.filter((p): p is string => typeof p === 'string') : []
    const trusted = await $.store.get(TRUSTED_KEY)
    state.trusted = typeof trusted === 'object' && trusted !== null ? (trusted as Record<string, string>) : {}
    const places = await locate($)
    state.places = places
    state.files = ruleFilesOf(places)
    state.gain = { dir: `${places.config}/bash-diet/gain`, sessionId: await $.session.id(), project: places.repo.split('/').pop() ?? places.repo, ready: false }
    await $.command.register({
      name: 'bash-diet',
      description: 'Filters Bash results: status, on, off, exclude, include, filters, trust, gain, discover, learn, cost (bash-diet)',
      argumentHint: '[on | off | exclude <p> | include <p> | excludes | filters | trust | untrust | gain [project | daily | graph | history] | discover [days] [all] | learn [days] [write] | cost]',
      immediate: true,
    })
    await Promise.all([pruneRecall($, state), pruneGain($, state), seedGain($, state)])
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

  // Playwright MCP repeats the code of each call in its result; the model already holds that code.
  on('tool.call', { tool: PLAYWRIGHT_TOOL }, async (_$, e, next) => resultWithoutEcho(await next(e)))
}
