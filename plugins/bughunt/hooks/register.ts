import type { EngineInterface, Register } from 'claude-code'
import { parseArgs } from './args.ts'
import { COLLAB_SCHEMA, CRITIC_PROMPT, criticTask, findingOf, FOUND_SCHEMA, handBackOf, PLANNER_PROMPT, plannerTask, reportText, SCANNER_PROMPT, scannerTask, verdictOf, type Finding, type Step, type StepResult } from './collab.ts'
import { editRule, proofDir, relativeTo } from './paths.ts'
import { judgeProof, proofInput, tailOf, type ProofRun } from './proof.ts'
import { advance, decide, newHunt, outcomeOf, roundId, type Hunt, type RoundEnd } from './round.ts'
import { editDenyText, editLog, roundLine, roundText, SKILL, skillBlock, SPAWN_DENY } from './texts.ts'

const ENABLED_KEY = 'enabled'
const SEND_COMMAND = 'bughunt:send'
const FOUND_TOOL = 'mcp__bughunt__found'
const PROOF_MS = 300_000
const STEP_MS: Record<Step, number> = { scanner: 600_000, planner: 480_000, critic: 360_000 }
const MAX_TURNS: Record<Step, number> = { scanner: 200, planner: 120, critic: 80 }
const SECTION = { consumer: 'bughunt', key: 'hunt', order: 22 } as const

/** Prompt origins that are the person's own words. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])

type Waiter = (end: RoundEnd) => void
type Line = { text: string; kind: 'ok' | 'warn' | 'error' | 'info' | 'dim' }

/** A running collab: its paths, the step running, the agents it started, the scanner and what it found. */
type CollabRun = { paths: string[]; step: Step; agents: Set<string>; scanner?: string; findings: Finding[] }

/**
 * The on/off setting as the store held it at the last read; the running hunt; the working directory;
 * the collab run; the subagent answers a collab step waits for, and those that came before the wait.
 */
type State = {
  enabled: boolean
  hunt: Hunt | undefined
  cwd: string
  collab: CollabRun | undefined
  waiters: Map<string, Waiter>
  early: Map<string, RoundEnd>
  lastHunt: string[]
}

async function readSettings($: EngineInterface, state: State): Promise<void> {
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
}

/** One line for the person: a stream entry in the sidebar while it is open, else the transcript line. */
async function toPerson($: EngineInterface, text: string, kind: 'ok' | 'warn' | 'error' | 'info'): Promise<void> {
  try {
    if (await $.sidebar.set({ consumer: SECTION.consumer, key: 'log', title: 'bughunt', lines: [{ text, kind }], until: 'stream' })) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(text)
}

function huntLines(hunt: Hunt): Line[] {
  const proof = hunt.proof === undefined ? 'no proof yet' : hunt.proof.passed ? 'FAIL then PASS recorded' : 'FAIL recorded'
  return [
    { text: `round ${hunt.round}/${hunt.rounds}${hunt.target === '' ? '' : ` · ${hunt.target}`}`, kind: 'info' },
    { text: `skill ${hunt.skill ? 'open' : 'not open'} · ${proof}`, kind: hunt.proof?.failed === true ? 'ok' : 'warn' },
    ...hunt.history.map(r => ({ text: `r${r.round}: ${r.outcome}${r.fingerprint === undefined ? '' : ` · ${r.fingerprint}`}`, kind: r.outcome === 'fixed-and-verified' ? ('ok' as const) : ('dim' as const) })),
  ]
}

/** The standing section: the running hunt or collab, else the last hunt's summary; cleared when there is none. */
async function show($: EngineInterface, state: State): Promise<void> {
  const lines = state.hunt !== undefined ? huntLines(state.hunt) : state.collab !== undefined ? [{ text: `collab: ${state.collab.step} · ${state.collab.findings.length} finding(s)`, kind: 'info' as const }] : state.lastHunt.map(text => ({ text, kind: 'dim' as const }))
  try {
    if (lines.length === 0) await $.sidebar.clear({ consumer: SECTION.consumer, key: SECTION.key })
    else await $.sidebar.set({ ...SECTION, title: state.hunt === undefined ? 'bughunt' : 'bughunt running', lines, until: 'session' })
  } catch {
    // The sidebar mod is not installed; the stream lines reach the transcript instead.
  }
}

/** Sends a round or a report as the person's own words, through the send command; a refusal falls back to a plain prompt. */
function send($: EngineInterface, text: string): void {
  $.clock.after(0, () => {
    $.command.run({ command: SEND_COMMAND, args: text }).catch(async (err: unknown) => {
      $.ui.log(`the send command failed (${err instanceof Error ? err.message : String(err)}), submitting the prompt instead`)
      await $.prompt.submit({ text }).catch((e: unknown) => $.ui.log(`the prompt was not submitted: ${e instanceof Error ? e.message : String(e)}`))
    })
  })
}

async function startRound($: EngineInterface, state: State, hunt: Hunt): Promise<void> {
  state.hunt = hunt
  send($, roundText(hunt, proofDir(roundId(hunt))))
  await toPerson($, roundLine(hunt), 'info')
  await show($, state)
}

async function endHunt($: EngineInterface, state: State, text: string, kind: 'ok' | 'error' | 'warn'): Promise<void> {
  const hunt = state.hunt
  state.hunt = undefined
  state.lastHunt = hunt === undefined ? [] : [text, ...hunt.history.map(r => `r${r.round}: ${r.outcome}${r.fingerprint === undefined ? '' : ` · ${r.fingerprint}`}`)]
  await toPerson($, text, kind)
  await show($, state)
}

/** Reads a round's end and starts the next round, or ends the hunt saying why. */
async function onRoundEnd($: EngineInterface, state: State, hunt: Hunt, end: RoundEnd): Promise<void> {
  const verdict = decide(hunt, end)
  const next = advance(hunt, end.answer)
  state.hunt = { ...hunt, history: next.history }
  if (verdict.next === 'stop') return endHunt($, state, `hunt stopped after round ${hunt.round}/${hunt.rounds}: ${verdict.reason}`, 'error')
  if (verdict.next === 'done') return endHunt($, state, `hunt finished: ${hunt.rounds} round(s), last ${outcomeOf(end.answer) ?? 'none'}`, 'ok')
  await startRound($, state, next)
}

async function startHunt($: EngineInterface, state: State, rounds: number, target: string): Promise<string> {
  if (!state.enabled) return 'off: /bughunt on turns it on'
  if (state.hunt !== undefined) return `a hunt is running (round ${state.hunt.round}/${state.hunt.rounds}); /bughunt stop ends it`
  if (state.collab !== undefined) return 'a collab run is in progress; wait for its report'
  await startRound($, state, newHunt(Date.now().toString(36), rounds, target))
  return `hunt started: ${rounds} round(s) over ${target === '' ? 'the whole project' : target}`
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  await $.store.set(ENABLED_KEY, on)
  state.enabled = on
  if (!on && state.hunt !== undefined) await endHunt($, state, 'hunt stopped: the mod was turned off', 'warn')
  return on ? 'on: /bughunt starts a hunt' : 'off: /bughunt starts nothing and no gate holds edits'
}

function statusText(state: State): string {
  const onOff = state.enabled ? 'on' : 'off'
  if (state.hunt !== undefined) return `${onOff} · round ${state.hunt.round}/${state.hunt.rounds}${state.hunt.target === '' ? '' : ` in ${state.hunt.target}`}`
  if (state.collab !== undefined) return `${onOff} · collab ${state.collab.step}`
  return `${onOff} · no hunt running`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  await readSettings($, state)
  const p = parseArgs(args)
  if (p.kind === 'error') return p.text
  if (p.kind === 'start') return startHunt($, state, p.rounds, p.target)
  if (p.kind === 'collab') return startCollabCommand($, state, p.paths)
  if (p.kind === 'on' || p.kind === 'off') return setEnabled($, state, p.kind === 'on')
  if (p.kind === 'status') return statusText(state)
  if (state.hunt === undefined) return 'no hunt is running'
  await endHunt($, state, `hunt stopped by /bughunt stop in round ${state.hunt.round}/${state.hunt.rounds}`, 'warn')
  return 'hunt stopped'
}

/** The edit gate of a running round: the rule an edit of `path` breaks, told to the model and the person. */
async function gateEdit($: EngineInterface, state: State, path: string | undefined, agentId: string | undefined): Promise<string | undefined> {
  const hunt = state.hunt
  if (hunt === undefined || agentId !== undefined || path === undefined) return undefined
  const dir = proofDir(roundId(hunt))
  const rel = relativeTo(state.cwd, path)
  const rule = editRule(rel, { skill: hunt.skill, failed: hunt.proof?.failed === true, target: hunt.target, dir })
  if (rule === undefined) return undefined
  await toPerson($, editLog(rule, rel), 'error')
  return editDenyText(rule, dir, hunt.target)
}

function joinCwd(cwd: string, dir: string | undefined): string {
  if (dir === undefined || dir === '') return cwd
  return dir.startsWith('/') ? dir : `${cwd.replace(/\/+$/, '')}/${dir}`
}

async function runProof($: EngineInterface, argv: string[], cwd: string): Promise<ProofRun | string> {
  try {
    const r = await $.process.run(argv, { cwd, timeoutMs: PROOF_MS })
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
  } catch (err) {
    return `the proof did not run: ${err instanceof Error ? err.message : String(err)}`
  }
}

/** The proof tool: runs the command itself and records FAIL or PASS for the round. */
async function onProof($: EngineInterface, state: State, e: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const hunt = state.hunt
  if (hunt === undefined || e.agentId !== undefined) return { deny: 'The proof tool works only inside a /bughunt round, in the main conversation.' }
  const input = proofInput(e)
  if (typeof input === 'string') return { deny: input }
  const run = await runProof($, input.argv, joinCwd(state.cwd, input.cwd))
  if (typeof run === 'string') return { result: `rejected: ${run}` }
  const j = judgeProof(input.phase, input.argv, run, hunt.proof)
  state.hunt = { ...hunt, proof: j.state }
  await toPerson($, `proof ${input.phase}: ${j.accepted ? j.reason : `rejected, ${j.reason}`}`, j.accepted ? 'ok' : 'warn')
  await show($, state)
  return { result: `${j.accepted ? 'accepted' : 'rejected'}: ${j.reason}\nexit code ${run.exitCode}\n--- last lines ---\n${tailOf(run)}` }
}

/** Waits for a subagent's answer, or its step's time limit. */
function answerOf($: EngineInterface, state: State, agentId: string, ms: number): Promise<RoundEnd | undefined> {
  const early = state.early.get(agentId)
  if (early !== undefined) {
    state.early.delete(agentId)
    return Promise.resolve(early)
  }
  return new Promise(resolve => {
    const timer = $.clock.after(ms, () => {
      state.waiters.delete(agentId)
      resolve(undefined)
    })
    state.waiters.set(agentId, end => {
      timer.cancel()
      resolve(end)
    })
  })
}

async function runStep($: EngineInterface, state: State, run: CollabRun, step: Step, prompt: string): Promise<StepResult> {
  run.step = step
  await show($, state)
  const spawned = await $.agent.spawn({ subagentType: `bughunt:${step}`, description: `bughunt ${step}`, prompt })
  if (spawned.deny !== undefined || spawned.agentId === undefined) return { step, status: 'failed', answer: '', reason: spawned.deny ?? 'no agent started' }
  run.agents.add(spawned.agentId)
  if (step === 'scanner') run.scanner = spawned.agentId
  const end = await answerOf($, state, spawned.agentId, STEP_MS[step])
  if (end === undefined) return { step, status: 'timed-out', answer: '', reason: `no answer within ${STEP_MS[step] / 60_000} min` }
  if (end.reason !== 'answer') return { step, status: 'failed', answer: end.answer, reason: `ended with ${end.reason}` }
  return { step, status: 'done', answer: end.answer }
}

/** Scanner, planner and critic in turn; each reads what the ones before it produced. */
async function runCollab($: EngineInterface, state: State, paths: string[]): Promise<string> {
  const run: CollabRun = { paths, step: 'scanner', agents: new Set(), findings: [] }
  state.collab = run
  try {
    const scan = await runStep($, state, run, 'scanner', scannerTask(paths))
    if (scan.status !== 'done' && run.findings.length === 0) {
      return reportText(paths, run.findings, [scan, skipped('planner'), skipped('critic')], 'no-verdict')
    }
    const plan = await runStep($, state, run, 'planner', plannerTask(paths, run.findings, scan.answer))
    const critique = await runStep($, state, run, 'critic', criticTask(paths, run.findings, plan.answer))
    const verdict = critique.status === 'done' ? verdictOf(critique.answer) : 'no-verdict'
    await toPerson($, `collab finished: ${run.findings.length} finding(s), verdict ${verdict}`, verdict === 'approve' ? 'ok' : 'warn')
    return reportText(paths, run.findings, [scan, plan, critique], verdict)
  } finally {
    state.collab = undefined
    await show($, state)
  }
}

const skipped = (step: Step): StepResult => ({ step, status: 'skipped', answer: '', reason: 'the scanner produced nothing' })

function collabRefusal(state: State): string | undefined {
  if (!state.enabled) return 'bughunt is off; /bughunt on turns it on'
  if (state.hunt !== undefined) return 'a hunt round is running; collab waits until it ends'
  if (state.collab !== undefined) return 'a collab run is in progress'
  return undefined
}

async function startCollabCommand($: EngineInterface, state: State, paths: string[]): Promise<string> {
  const refused = collabRefusal(state)
  if (refused !== undefined) return refused
  $.clock.after(0, () => {
    runCollab($, state, paths).then(report => send($, report)).catch((err: unknown) => $.ui.log(`collab failed: ${err instanceof Error ? err.message : String(err)}`))
  })
  return `collab started over ${paths.join(', ')}; the report arrives as a message`
}

async function onCollabTool($: EngineInterface, state: State, e: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  await readSettings($, state)
  const refused = collabRefusal(state)
  if (refused !== undefined) return { deny: refused }
  const paths = Array.isArray(e.paths) ? e.paths.filter((p): p is string => typeof p === 'string' && p !== '') : []
  if (paths.length === 0) return { deny: 'paths must name at least one file or directory' }
  return { result: await runCollab($, state, paths) }
}

async function onFound($: EngineInterface, state: State, e: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const run = state.collab
  if (run === undefined || run.scanner === undefined || e.agentId !== run.scanner) return { deny: 'Only the running bughunt scanner reports findings with this tool.' }
  const f = findingOf(e)
  if (typeof f === 'string') return { deny: f }
  run.findings.push(f)
  await show($, state)
  return { result: `recorded (${run.findings.length})` }
}

/** A subagent's turn end: a collab step waits for it, or it came before the wait began. */
function settleAgent(state: State, agentId: string, end: RoundEnd): void {
  const waiter = state.waiters.get(agentId)
  if (waiter !== undefined) {
    state.waiters.delete(agentId)
    waiter(end)
  } else if (state.collab !== undefined) state.early.set(agentId, end)
}

/** Settles the collab step whose hand-back `text` is; false when it is no collab step's hand-back. */
function takeHandBack(state: State, text: string): boolean {
  const back = handBackOf(text)
  if (back === undefined || state.collab?.agents.has(back.from) !== true) return false
  settleAgent(state, back.from, { reason: 'answer', isAborted: false, answer: back.report })
  return true
}

async function declare($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'bughunt', description: 'Proof-driven bug hunt rounds, and a read-only collab review (bughunt)', argumentHint: '[--rounds N] [target] | collab <paths> | stop | status | on | off' })
  await $.tool.register({ name: 'proof', description: 'Runs the round\'s proof command and records FAIL (phase before: non-zero exit and a line starting with FAIL) or PASS (phase after: same argv, exit 0 and a line starting with PASS). Only inside a /bughunt round.', inputSchema: { type: 'object', properties: { phase: { type: 'string', enum: ['before', 'after'] }, argv: { type: 'array', items: { type: 'string' }, minItems: 1 }, cwd: { type: 'string' } }, required: ['phase', 'argv'] } })
  await $.tool.register({ name: 'found', description: 'Reports one bug finding. Only the bughunt scanner subagent calls it.', inputSchema: FOUND_SCHEMA })
  await $.tool.register({ name: 'collab', description: 'Runs a read-only bug review of the given paths: a scanner, a planner and a critic subagent in turn, and returns their report with findings, plan and verdict.', inputSchema: COLLAB_SCHEMA })
  await $.agent.register({ name: 'scanner', description: 'bughunt collab scanner (started by the bughunt mod only)', prompt: SCANNER_PROMPT, tools: ['Read', 'Grep', 'Glob', FOUND_TOOL], skills: [SKILL], maxTurns: MAX_TURNS.scanner })
  await $.agent.register({ name: 'planner', description: 'bughunt collab planner (started by the bughunt mod only)', prompt: PLANNER_PROMPT, tools: ['Read', 'Grep', 'Glob'], maxTurns: MAX_TURNS.planner })
  await $.agent.register({ name: 'critic', description: 'bughunt collab critic (started by the bughunt mod only)', prompt: CRITIC_PROMPT, tools: ['Read', 'Grep', 'Glob'], maxTurns: MAX_TURNS.critic })
}

export const register: Register = on => {
  const state: State = { enabled: true, hunt: undefined, cwd: '', collab: undefined, waiters: new Map(), early: new Map(), lastHunt: [] }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.cwd = e.cwd
    await declare($)
    await readSettings($, state)
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'bughunt' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // The collab agents are the mod's own; the model never dispatches them.
  on('agent.offer', { agent: /^bughunt:(scanner|planner|critic)$/ }, () => ({ isOffered: false }))
  on('tool.describe', { tool: /^mcp__bughunt__(proof|found|collab)$/ }, async (_, e, next) => ({ ...(await next(e)), isDeferred: false }))

  on('tool.call', { tool: /^mcp__bughunt__proof$/ }, async ($, e) => onProof($, state, e as Record<string, unknown>))
  on('tool.call', { tool: /^mcp__bughunt__found$/ }, async ($, e) => onFound($, state, e as Record<string, unknown>))
  on('tool.call', { tool: /^mcp__bughunt__collab$/ }, async ($, e) => onCollabTool($, state, e as Record<string, unknown>))

  // A person's own prompt ends the hunt: the loop runs only on the mod's own round prompts. A collab step's
  // hand-back arrives here as a peer prompt: the mod takes its report, and the model reads it in the report.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'peer' && takeHandBack(state, e.text)) return { drop: 'bughunt collab step' }
    if (state.hunt !== undefined && PERSON.has(e.origin?.kind ?? '') && !e.text.trimStart().startsWith('/bughunt')) {
      await endHunt($, state, `hunt stopped: you wrote a prompt in round ${state.hunt.round}/${state.hunt.rounds}`, 'warn')
    }
    return next(e)
  })

  on('skill.prompt', { skill: 'bughunt:hunt' }, async (_, e, next) => {
    const r = await next(e)
    const hunt = state.hunt
    return hunt === undefined ? r : { text: `${r.text}\n${skillBlock(hunt, proofDir(roundId(hunt)))}` }
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const r = await next(e)
    if (state.hunt !== undefined && e.skill === SKILL && e.agentId === undefined && r.deny === undefined && r.isError !== true) {
      state.hunt = { ...state.hunt, skill: true }
      await show($, state)
    }
    return r
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const deny = await gateEdit($, state, e.file_path, e.agentId)
    return deny === undefined ? next(e) : { deny }
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const deny = await gateEdit($, state, e.file_path, e.agentId)
    return deny === undefined ? next(e) : { deny }
  })
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const deny = await gateEdit($, state, e.notebook_path, e.agentId)
    return deny === undefined ? next(e) : { deny }
  })

  // A round runs in one conversation; the mod's own collab spawns skip this hook, as the calling one.
  on('agent.spawn', async ($, e, next) => {
    if (state.hunt === undefined) return next(e)
    await toPerson($, `subagent stopped: ${e.subagentType}`, 'error')
    return { deny: SPAWN_DENY }
  })

  // A subagent's answered turn does not carry its report (measured: the hand-back does), so only a failed
  // end settles a collab step here.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const end: RoundEnd = { reason: e.reason, isAborted: e.isAborted, answer: e.answer }
    if (e.agentId !== undefined) {
      if (e.reason !== 'answer') settleAgent(state, e.agentId, end)
    } else if (state.hunt !== undefined) await onRoundEnd($, state, state.hunt, end)
    return r
  })
}
