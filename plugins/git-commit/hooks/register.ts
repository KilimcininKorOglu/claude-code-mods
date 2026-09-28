import type { EngineInterface, ProcessRunResult, Register, ToolCallResult } from 'claude-code'
import { gitCalls, heredocsOf, joinPath, type GitCall, type Heredoc } from './command.ts'
import { parseStatus, readNumstat, stateBlock } from './context.ts'
import { note, type Finding } from './finding.ts'
import { addArgs, checkoutKind, commitArgs, isBranchChange, isConfigWrite, isDryCommit, isInteractiveRebase, pushArgs, type Parsed } from './gitargs.ts'
import { messageFindings, messageOf, styleOf } from './message.ts'
import { addFlagFindings, argumentsOf, blanketFinding, blanketReason, branchFindings, commitFlagFindings, configFindings, denyText, hookSkipFindings, ignoreHits, ignoredFindings, logText, noteText, optionsOf, pathspecFindings, pushFindings, rebaseFindings, secretLineFindings, secretNameFindings, sizeFindings, SKILL, spreadFindings, typedSkill, untrackedFindings } from './rules.ts'
import { isSecretName, secretLines } from './secrets.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'
const MAIN = 'main'
const USAGE = 'expects nothing (the status), on, off or mode note | deny'

type Mode = 'note' | 'deny'

/**
 * The on/off setting and the mode as the store held them at the last read; the skill options each agent
 * loop opened in its current turn (`main` for the main loop, the agent id for a subagent), dropped at that
 * loop's turn end; and the person's last prompt, which says whether a push or a branch operation was asked.
 */
type State = { enabled: boolean; mode: Mode; loops: Map<string, Set<string>>; lastPrompt: string }

/** Prompt origins that are the person's own words. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])
const PUSH_WORD = /push/i
const BRANCH_WORD = /branch|checkout|switch/i

/** The git subcommands the mod rules on; any other git call runs unread. */
const RULED = new Set(['add', 'rm', 'commit', 'push', 'config', 'rebase', 'merge', 'switch', 'branch', 'checkout'])

/**
 * One command's measure: the loop that runs it, the directory it starts in, its heredocs (and which a
 * commit message used), whether it commits, the scratch index per repository its `git add`s were replayed
 * into, every temporary index file to delete, and whether a replay failed.
 */
type Run = {
  loop: string
  start: string
  heredocs: Heredoc[]
  used: Set<number>
  hasCommit: boolean
  scratches: Map<string, string>
  temps: string[]
  replayFailed: boolean
}

/**
 * Reads the on/off setting and the mode from the store, which every window shares, so a change made in
 * another window applies here at the next hook that acts on it.
 */
async function readSettings($: EngineInterface, state: State): Promise<void> {
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
  state.mode = (await $.store.get(MODE_KEY)) === 'note' ? 'note' : 'deny'
}

/** Runs git in the C locale, with the index `index` names; undefined when git did not start or timed out. */
async function git($: EngineInterface, args: readonly string[], cwd: string, index?: string, stdin?: string): Promise<ProcessRunResult | undefined> {
  const env: Record<string, string> = index === undefined ? { LC_ALL: 'C' } : { LC_ALL: 'C', GIT_INDEX_FILE: index }
  try {
    return await $.process.run(['git', ...args], { cwd, env, ...(stdin === undefined ? {} : { stdin }) })
  } catch {
    // git did not run: the caller reports the measure as missing.
    return undefined
  }
}

/** git's standard output when it exited 0, else undefined. */
async function gitOut($: EngineInterface, args: readonly string[], cwd: string, index?: string): Promise<string | undefined> {
  const r = await git($, args, cwd, index)
  return r?.exitCode === 0 ? r.stdout : undefined
}

/** Whether git ran and exited 0. */
async function gitOk($: EngineInterface, args: readonly string[], cwd: string, index?: string): Promise<boolean> {
  return (await git($, args, cwd, index))?.exitCode === 0
}

/** The top of the repository a directory is in, or undefined outside one. */
async function topOf($: EngineInterface, dir: string): Promise<string | undefined> {
  return (await gitOut($, ['rev-parse', '--show-toplevel'], dir))?.trim() || undefined
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line. The model reads the deny text or the note, another channel.
 */
async function toPerson($: EngineInterface, findings: readonly Finding[], stopped: boolean): Promise<void> {
  const lines = findings.map(f => ({ text: f.short, kind: f.level === 'deny' ? ('error' as const) : ('warn' as const) }))
  try {
    const taken = await $.sidebar.set({ consumer: 'git-commit', key: 'git', title: stopped ? 'git command stopped' : 'git command noted', lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(logText(findings, stopped))
}

/** A note for a call whose paths the mod could not measure. */
function unmeasured(what: string, why: string): Finding {
  return note(`${what} not measured`, `The mod did not measure ${what}: ${why}.`)
}

/**
 * The index this command's `git add`s are replayed into for one repository, a copy of the real index made
 * at the first replay, so the commit later in the command is measured as git will record it.
 */
async function scratchIndex($: EngineInterface, run: Run, top: string): Promise<string | undefined> {
  const held = run.scratches.get(top)
  if (held !== undefined) return held
  const real = (await gitOut($, ['rev-parse', '--path-format=absolute', '--git-path', 'index'], top))?.trim()
  if (real === undefined) return undefined
  const index = `${real}.git-commit-${crypto.randomUUID()}`
  run.temps.push(index)
  const copied = (await $.fs.exists(real)) ? await $.process.run(['cp', real, index]).catch(() => undefined) : { exitCode: 0 }
  if (copied?.exitCode !== 0) return undefined
  run.scratches.set(top, index)
  return index
}

/**
 * Replays one index-only git call (`add`, `rm --cached`) into the scratch index of its repository. It
 * never runs without a scratch index, so the real index is never touched.
 */
async function replay($: EngineInterface, run: Run, dir: string, args: readonly string[]): Promise<void> {
  const top = await topOf($, dir)
  const index = top === undefined ? undefined : await scratchIndex($, run, top)
  if (index === undefined || !(await gitOk($, args, dir, index))) run.replayFailed = true
}

/** The directory a call runs in, or undefined when the command text does not say. */
function dirOf(run: Run, call: GitCall): string | undefined {
  return call.where === null ? undefined : joinPath(run.start, call.where)
}

/** Operands that are directories (a submodule excepted), where the skill names files. */
async function directoryFindings($: EngineInterface, operands: readonly string[], dir: string): Promise<Finding[]> {
  const out: Finding[] = []
  for (const operand of operands.filter(o => blanketReason(o) === undefined)) {
    const path = joinPath(dir, operand)
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat?.kind === 'dir' && !(await $.fs.exists(`${path}/.git`))) out.push(blanketFinding(operand, 'is a directory'))
  }
  return out
}

/** Paths an ignore file names, as `git check-ignore -v` reports them; undefined when git did not answer. */
async function ignoredOf($: EngineInterface, paths: readonly string[], cwd: string, index?: string): Promise<ReturnType<typeof ignoreHits> | undefined> {
  if (paths.length === 0) return []
  const r = await git($, ['check-ignore', '--no-index', '-v', '-z', '--stdin'], cwd, index, paths.join('\0'))
  if (r?.exitCode === 1) return []
  return r?.exitCode === 0 ? ignoreHits(r.stdout) : undefined
}

/** A `git add -f` of a path an ignore file names. */
async function forcedFindings($: EngineInterface, a: Parsed, dir: string): Promise<Finding[]> {
  if (!a.flags.has('force')) return []
  const hits = await ignoredOf($, a.operands, dir)
  return hits === undefined ? [unmeasured('the forced paths', 'git check-ignore did not answer')] : ignoredFindings(hits, 'add')
}

/** The untracked files a `git add` stages, named in a note. */
async function newFileFindings($: EngineInterface, a: Parsed, dir: string): Promise<Finding[]> {
  if (a.operands.length === 0) return []
  const out = await gitOut($, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...a.operands], dir)
  return untrackedFindings((out ?? '').split('\0').filter(Boolean))
}

const INTERACTIVE_ADD = ['interactive', 'patch', 'edit']

/** A `git add`: its options and operands, the directories and forced ignored paths it names, the new files it stages. */
async function judgeAdd($: EngineInterface, state: State, run: Run, call: GitCall): Promise<Finding[]> {
  const a = addArgs(call.args)
  const options = state.loops.get(run.loop)
  const out = addFlagFindings(a, options)
  const dir = dirOf(run, call)
  if (dir === undefined) return [...out, unmeasured('the staged paths', 'a cd in the command goes where its text does not say')]
  if (options?.has('all') !== true) out.push(...(await directoryFindings($, a.operands, dir)))
  out.push(...(await forcedFindings($, a, dir)), ...(await newFileFindings($, a, dir)))
  if (run.hasCommit && !INTERACTIVE_ADD.some(flag => a.flags.has(flag))) await replay($, run, dir, ['add', ...call.args])
  return out
}

/** A `git rm --cached` before a commit changes only the index, so it is replayed; any other `git rm` is left alone. */
async function judgeRemoval($: EngineInterface, run: Run, call: GitCall): Promise<Finding[]> {
  const dir = dirOf(run, call)
  if (run.hasCommit && dir !== undefined && call.args.includes('--cached')) await replay($, run, dir, ['rm', ...call.args])
  return []
}

/** The last 20 subjects of the repository, newest first; none before the first commit. */
async function subjectsOf($: EngineInterface, top: string): Promise<string[]> {
  const out = await gitOut($, ['log', '-20', '--format=%s'], top)
  return (out ?? '').split('\n').filter(Boolean)
}

/** The message rules, measured against the repository's recent subjects; a note when the command does not say the message. */
async function messageCheck($: EngineInterface, run: Run, c: Parsed, dir: string, top: string): Promise<Finding[]> {
  const file = c.values.get('file')?.[0]
  const fileText = file === undefined || file === '-' ? undefined : await $.fs.read(joinPath(dir, file)).catch(() => undefined)
  const message = messageOf(c, run.heredocs, run.used, fileText)
  if ('unknown' in message) return [unmeasured('the commit message', message.unknown)]
  return messageFindings(message.text, styleOf(await subjectsOf($, top)))
}

/** A fresh index holding HEAD's tree (empty before the first commit), for a commit that records only its pathspec. */
async function headIndex($: EngineInterface, run: Run, top: string): Promise<string | undefined> {
  const real = (await gitOut($, ['rev-parse', '--path-format=absolute', '--git-path', 'index'], top))?.trim()
  if (real === undefined) return undefined
  const index = `${real}.git-commit-only-${crypto.randomUUID()}`
  run.temps.push(index)
  const hasHead = (await gitOut($, ['rev-parse', '--verify', '--quiet', 'HEAD'], top)) !== undefined
  const read = await git($, ['read-tree', hasHead ? 'HEAD' : '--empty'], top, index)
  return read?.exitCode === 0 ? index : undefined
}

/**
 * The index the commit's own staging starts from: HEAD's tree for a commit that records only its pathspec,
 * the scratch copy for `-a` or `--include`, else the scratch this command's `git add`s were replayed into,
 * or the real index (`{}`) when it replayed none. Undefined when a temporary index could not be made.
 */
async function baseIndex($: EngineInterface, run: Run, c: Parsed, top: string): Promise<{ index?: string } | undefined> {
  const staging = c.operands.length > 0 || c.flags.has('all')
  const made = c.operands.length > 0 && !c.flags.has('include') ? await headIndex($, run, top) : staging ? await scratchIndex($, run, top) : run.scratches.get(top)
  if (made !== undefined) return { index: made }
  return staging ? undefined : {}
}

/**
 * The index that holds what the commit records: the base, with `-a`'s tracked changes and the commit's
 * own pathspec staged into it. The real index is never written: staging runs only into a temporary one.
 */
async function commitIndex($: EngineInterface, run: Run, c: Parsed, dir: string, top: string): Promise<{ index?: string } | undefined> {
  const base = await baseIndex($, run, c, top)
  const index = base?.index
  if (base === undefined || (index === undefined && (c.flags.has('all') || c.operands.length > 0))) return base
  if (c.flags.has('all') && !(await gitOk($, ['add', '-u', '--', ':/'], top, index))) return undefined
  if (c.operands.length > 0 && !(await gitOk($, ['add', '--', ...c.operands], dir, index))) return undefined
  return base
}

const DIFF = ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-renames', '--diff-filter=d', '--no-color', '--no-ext-diff']

/** What the commit holds: its paths, its changed lines, its zero-context patch; undefined when git did not answer. */
async function viewOf($: EngineInterface, top: string, index?: string): Promise<{ names: string[]; lines: number; patch: string } | undefined> {
  const stat = await gitOut($, [...DIFF, '--numstat', '-z'], top, index)
  const patch = await gitOut($, [...DIFF, '-U0'], top, index)
  return stat === undefined || patch === undefined ? undefined : { ...readNumstat(stat), patch }
}

/** What the commit records: secret files and lines, ignored paths, its size and its spread. */
async function contentFindings($: EngineInterface, run: Run, c: Parsed, dir: string, top: string): Promise<Finding[]> {
  const picked = run.replayFailed ? undefined : await commitIndex($, run, c, dir, top)
  const view = picked === undefined ? undefined : await viewOf($, top, picked.index)
  if (view === undefined) return [unmeasured('what the commit holds', 'git could not replay or diff this command\'s staging, so secrets and ignored paths were not checked')]
  const ignored = await ignoredOf($, view.names, top, picked?.index)
  const ignoreFindings = ignored === undefined ? [unmeasured('ignored paths', 'git check-ignore did not answer')] : ignoredFindings(ignored, 'commit')
  return [...secretNameFindings(view.names.filter(isSecretName)), ...secretLineFindings(secretLines(view.patch)), ...ignoreFindings, ...sizeFindings(view.lines), ...spreadFindings(view.names)]
}

/** A `git commit`: the skill, its flags, its pathspec, its message, and what it records. */
async function judgeCommit($: EngineInterface, state: State, run: Run, call: GitCall): Promise<Finding[]> {
  const c = commitArgs(call.args)
  if (isDryCommit(c)) return []
  const options = state.loops.get(run.loop)
  const out = [...hookSkipFindings(call, options), ...commitFlagFindings(c, options), ...pathspecFindings(c.operands, options)]
  const dir = dirOf(run, call)
  const top = dir === undefined ? undefined : await topOf($, dir)
  if (dir === undefined || top === undefined) return [...out, unmeasured('the commit', 'the command does not say which repository it runs in')]
  const dirs = options?.has('all') === true ? [] : await directoryFindings($, c.operands, dir)
  return [...out, ...dirs, ...(await messageCheck($, run, c, dir, top)), ...(await contentFindings($, run, c, dir, top))]
}

/** A `git checkout` that switches or creates a branch; a single operand that is an existing path is a file restore. */
async function judgeCheckout($: EngineInterface, state: State, run: Run, call: GitCall): Promise<Finding[]> {
  const kind = checkoutKind(call.args)
  const label = `git checkout ${call.args.join(' ')}`
  const asked = BRANCH_WORD.test(state.lastPrompt)
  if (kind === 'branch') return branchFindings(label, asked)
  if (typeof kind === 'string') return []
  const dir = dirOf(run, call)
  const isPath = dir !== undefined && (await $.fs.exists(joinPath(dir, kind.operand)))
  return isPath || dir === undefined ? [] : branchFindings(label, asked)
}

/** A `git push`: asked for in the person's last prompt or by the skill's --push, and without skipping hooks. */
function judgePush(state: State, options: ReadonlySet<string> | undefined, call: GitCall): Finding[] {
  const asked = PUSH_WORD.test(state.lastPrompt) || options?.has('push') === true
  return [...hookSkipFindings(call, options), ...pushFindings(pushArgs(call.args), asked, options)]
}

/** The calls the mod rules on by their arguments alone. */
function judgeArgs(state: State, run: Run, call: GitCall): Finding[] {
  const options = state.loops.get(run.loop)
  const branchAsked = BRANCH_WORD.test(state.lastPrompt)
  if (call.sub === 'push') return judgePush(state, options, call)
  if (call.sub === 'merge') return hookSkipFindings(call, options)
  if (call.sub === 'config') return isConfigWrite(call.args) ? configFindings() : []
  if (call.sub === 'rebase') return isInteractiveRebase(call.args) ? rebaseFindings() : []
  if (call.sub === 'switch') return branchFindings(`git switch ${call.args.join(' ')}`, branchAsked)
  return call.sub === 'branch' && isBranchChange(call.args) ? branchFindings(`git branch ${call.args.join(' ')}`, branchAsked) : []
}

async function judgeCall($: EngineInterface, state: State, run: Run, call: GitCall): Promise<Finding[]> {
  if (call.sub === 'add') return judgeAdd($, state, run, call)
  if (call.sub === 'rm') return judgeRemoval($, run, call)
  if (call.sub === 'commit') return judgeCommit($, state, run, call)
  if (call.sub === 'checkout') return judgeCheckout($, state, run, call)
  return judgeArgs(state, run, call)
}

/** Deletes the command's temporary index files; one that stays behind is named in the transcript. */
async function dropTemps($: EngineInterface, run: Run): Promise<void> {
  if (run.temps.length === 0) return
  const done = await $.process.run(['rm', '-f', ...run.temps]).catch(() => undefined)
  if (done?.exitCode !== 0) $.ui.log(`temporary index files were left behind: ${run.temps.join(', ')}`)
}

/** Every rule of the skill a Bash command breaks, call by call, in the order the calls run. */
async function judge($: EngineInterface, state: State, command: string, loop: string): Promise<Finding[]> {
  const calls = gitCalls(command)
  if (!calls.some(c => RULED.has(c.sub))) return []
  const run: Run = { loop, start: await $.session.cwd(), heredocs: heredocsOf(command), used: new Set(), hasCommit: calls.some(c => c.sub === 'commit'), scratches: new Map(), temps: [], replayFailed: false }
  try {
    const out: Finding[] = []
    for (const call of calls) out.push(...(await judgeCall($, state, run, call)))
    return out
  } finally {
    await dropTemps($, run)
  }
}

/**
 * The gate: in the `deny` mode a command that breaks a hard rule stops before it runs; otherwise it runs
 * and the model reads every finding after its result.
 */
async function onBash($: EngineInterface, state: State, command: string, loop: string, run: () => Promise<ToolCallResult>): Promise<ToolCallResult> {
  if (!/\bgit\b/.test(command)) return run()
  await readSettings($, state)
  if (!state.enabled) return run()
  const findings = await judge($, state, command, loop)
  const hard = findings.filter(f => f.level === 'deny')
  if (state.mode === 'deny' && hard.length > 0) {
    await toPerson($, hard, true)
    return { deny: denyText(hard) }
  }
  const r = await run()
  if (findings.length === 0 || r.deny !== undefined) return r
  await toPerson($, findings, false)
  return { ...r, context: [...(r.context ?? []), noteText(findings)] }
}

/** The repository state appended to the skill's text; undefined outside a repository. */
async function repoBlock($: EngineInterface, options: ReadonlySet<string>): Promise<string | undefined> {
  const top = await topOf($, await $.session.cwd())
  const status = top === undefined ? undefined : await gitOut($, ['status', '--porcelain=v1', '-z', '--branch'], top)
  if (top === undefined || status === undefined) return undefined
  const subjects = await subjectsOf($, top)
  const staged = (await gitOut($, ['diff', '--cached', '--name-only', '-z', '--diff-filter=d'], top) ?? '').split('\0').filter(Boolean)
  const ignored = (await ignoredOf($, staged, top)) ?? []
  const warnings = [
    ...staged.filter(isSecretName).map(p => `staged ${p} is a file name that holds credentials`),
    ...ignored.map(h => `staged ${h.path} is ignored by ${h.source}:${h.line} (${h.pattern})`),
  ]
  return stateBlock(parseStatus(status), subjects, styleOf(subjects), options, warnings)
}

async function setMode($: EngineInterface, state: State, word: string): Promise<string> {
  if (word !== 'note' && word !== 'deny') return 'mode expects note or deny'
  await $.store.set(MODE_KEY, word)
  state.mode = word
  return word === 'deny' ? `mode deny: a git command that breaks the ${SKILL} skill stops before it runs` : 'mode note: a git command that breaks the skill runs, and the model reads which rule it broke'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? `on: every Bash git command is held to the ${SKILL} skill` : 'off: git commands run unchecked, and the engine\'s own commit trailer text is back'
  }
  if (word.startsWith('mode')) return setMode($, state, word.slice(4).trim())
  if (word !== '') return USAGE
  await readSettings($, state)
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode}`
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'deny', loops: new Map(), lastPrompt: '' }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'git-commit', description: `Holds Bash git commands to the ${SKILL} skill: status, on, off, mode (git-commit)`, argumentHint: '[on | off | mode note | deny]' })
    await readSettings($, state)
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'git-commit' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('turn.start', async ($, e, next) => {
    await readSettings($, state)
    return next(e)
  })

  // A typed `/git-commit:commit` opens the main loop's turn, and the person's words say whether a push or a branch operation was asked.
  on('prompt.submit', async (_, e, next) => {
    if (!PERSON.has(e.origin?.kind ?? '')) return next(e)
    state.lastPrompt = e.text
    const typed = typedSkill(e.text)
    if (typed !== undefined) state.loops.set(MAIN, typed)
    return next(e)
  })

  // The skill opened through the Skill tool opens the calling loop's turn, with the options its args name.
  on('tool.call', { tool: 'Skill' }, async (_, e, next) => {
    const r = await next(e)
    if (e.skill === SKILL && r.deny === undefined && r.isError !== true) state.loops.set(e.agentId ?? MAIN, optionsOf(e.args ?? ''))
    return r
  })

  on('skill.prompt', { skill: 'git-commit:commit' }, async ($, e, next) => {
    const r = await next(e)
    if (!state.enabled) return r
    const block = await repoBlock($, optionsOf(argumentsOf(e.text)))
    return block === undefined ? r : { text: `${r.text}\n\n${block}` }
  })

  // The skill never signs a commit, so the engine's commit trailer text is left empty while the mod is on.
  on('attribution.text', { kind: 'commit' }, async (_, e, next) => (state.enabled ? { text: '' } : next(e)))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => onBash($, state, e.command, e.agentId ?? MAIN, () => next(e)))

  on('turn.complete', async (_, e, next) => {
    const r = await next(e)
    state.loops.delete(e.agentId ?? MAIN)
    return r
  })
}
