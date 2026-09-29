import { describe, expect, mock, test, tier, type Engine, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, ProcessRunResult } from 'claude-code'

tier('user')

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the world answers. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)


const ROOT = '/repo'

/**
 * What the engine beneath the mod saw: the store every window shares, the prompts sent through the send
 * command, the log lines, the proof command's answer and the argv it ran, the tools and agents declared,
 * the subagents started and the edits that ran.
 */
type World = {
  store: Map<string, unknown>
  sent: string[]
  logs: string[]
  proof: ProcessRunResult
  ran: string[][]
  tools: string[]
  agents: string[]
  spawned: string[]
  edits: string[]
  clock: MockClock
  git: Git
}

/**
 * The repository beneath the proof: whether there is one, the files `git diff` lists as modified, the git
 * commands that ran, whether the fix is reverted now, what the proof prints then, whether the reverted files
 * are untouched since, and whether putting the fix back fails. The first snapshot, the FAIL's base, is S1.
 */
type Git = { repo: boolean; changed: string[]; ran: string[][]; reverted: boolean; revertedProof: ProcessRunResult; untouched: boolean; putBackFails: boolean; snapshots: number }

const answer = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

function gitAnswer(g: Git, args: string[]): ProcessRunResult {
  g.ran.push(args)
  if (!g.repo) return answer(128, '', 'fatal: not a git repository')
  if (args[0] === 'stash') return answer(0, `S${++g.snapshots}\n`)
  if (args[0] === 'rev-parse') return answer(0, 'HEAD1\n')
  if (args[0] === 'diff') return args.includes('--quiet') ? answer(g.untouched ? 0 : 1, '') : answer(0, `${g.changed.join('\0')}\0`)
  const source = args.find(a => a.startsWith('--source='))?.slice('--source='.length)
  if (source !== 'S1' && g.putBackFails) return answer(1, '', 'error: pathspec did not match')
  g.reverted = source === 'S1'
  return answer(0, '')
}

function world(on: On): World {
  const git: Git = { repo: true, changed: ['src/a.ts'], ran: [], reverted: false, revertedProof: answer(1, 'FAIL: got 3'), untouched: true, putBackFails: false, snapshots: 0 }
  const w: World = { store: new Map(), sent: [], logs: [], proof: answer(1, 'FAIL: got 3'), ran: [], tools: [], agents: [], spawned: [], edits: [], clock: mock.clock(on), git }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => { w.tools.push(e.name); return { value: { tool: `mcp__bughunt__${e.name}` } } })
  on('agent.register', (_, e) => { w.agents.push(e.name); return { value: { agent: `bughunt:${e.name}` } } })
  on('command.run', { command: 'bughunt:send' }, (_, e) => { w.sent.push(String(e.args)); return { text: '' } })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Skill' }, (_, e) => ({ result: { success: true, commandName: e.skill }, text: `Launching skill: ${e.skill}` }) as never)
  on('tool.call', { tool: 'Edit' }, (_, e) => { w.edits.push(e.file_path); return { result: 'ok' } as never })
  on('tool.call', { tool: 'Write' }, (_, e) => { w.edits.push(e.file_path); return { result: 'ok' } as never })
  on('process.run', (_, e) => {
    if (e.argv[0] === 'git') return { value: gitAnswer(git, e.argv.slice(1)) }
    w.ran.push([...e.argv])
    return { value: git.reverted ? git.revertedProof : w.proof }
  })
  // The test engine hands a plugin's own spawn over in the Agent tool's shape (`subagent_type`).
  on('agent.spawn', (_, e) => {
    const type = e.subagentType ?? (e as unknown as { subagent_type: string }).subagent_type
    w.spawned.push(type)
    return { model: 'claude-sonnet-5-5', agentId: `a-${type}` }
  })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
}

const run = (args: string): CommandRunInput => ({ command: 'bughunt', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

async function hunt($: Engine, w: World, args: string): Promise<string> {
  const r = await $.command.run(run(args))
  await w.clock.advance(0)
  return String(r.text)
}

const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never)
const openSkill = ($: Engine, agentId?: string) => call($, { tool: 'Skill', skill: 'bughunt:hunt', args: '', ...(agentId === undefined ? {} : { agentId }) })
const edit = ($: Engine, path: string, agentId?: string) => call($, { tool: 'Edit', file_path: `${ROOT}/${path}`, old_string: 'a', new_string: 'b', ...(agentId === undefined ? {} : { agentId }) })
const proof = ($: Engine, phase: string, argv = ['node', 'p.js'], agentId?: string) => call($, { tool: 'mcp__bughunt__proof', phase, argv, ...(agentId === undefined ? {} : { agentId }) })
const say = ($: Engine, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })

async function roundEnds($: Engine, w: World, text: string, agentId?: string, reason: 'answer' | 'error' = 'answer'): Promise<void> {
  await $.turn.complete({ answer: text, durationMs: 1, isAborted: false, turnId: 't', reason, ...(agentId === undefined ? {} : { agentId }) } as never)
  await w.clock.advance(0)
}

/** A round that proves and fixes one bug, as the model would run it. */
async function provenRound($: Engine, w: World): Promise<void> {
  await openSkill($)
  w.proof = answer(1, 'FAIL: got 3')
  await proof($, 'before')
  w.proof = answer(0, 'PASS')
  await proof($, 'after')
}

describe('the round loop', () => {
  test('/bughunt sends the first round with the protocol, and --rounds may follow the target', async ($, on) => {
    const w = world(on)
    await started($)
    expect(await hunt($, w, 'src --rounds 2')).toBe('hunt started: 2 round(s) over src')
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0]).toContain('round 1/2')
    expect(w.sent[0]).toContain('Scope: src and everything under it')
    expect(w.sent[0]).toContain('invoke the bughunt:hunt skill')
    expect(await hunt($, w, '--rounds 26')).toContain('from 1 to 25')
  })

  test('a proven round starts the next one with its fingerprint, and the last round ends the hunt', async ($, on) => {
    const w = world(on)
    await started($)
    await hunt($, w, '--rounds 2')
    await provenRound($, w)
    await roundEnds($, w, 'fixed-and-verified\n\nfingerprint: src/a.ts:parse: off by one')
    expect(w.sent).toHaveLength(2)
    expect(w.sent[1]).toContain('round 2/2')
    expect(w.sent[1]).toContain('- src/a.ts:parse: off by one')
    await roundEnds($, w, 'no-proven-bug')
    expect(w.sent).toHaveLength(2)
    expect(w.logs.at(-1)).toBe('hunt finished: 2 round(s), last no-proven-bug')
  })

  test('blocked, an incomplete fix and an unrecorded fixed claim each end the hunt', async ($, on) => {
    const w = world(on)
    await started($)
    for (const [text, reason] of [['blocked', 'the round reported blocked'], ['fixed-verification-incomplete', 'the round reported fixed-verification-incomplete'], ['fixed-and-verified', 'the mod recorded no FAIL followed by a PASS']]) {
      await hunt($, w, '--rounds 3')
      await roundEnds($, w, text)
      expect(w.logs.at(-1)).toContain(reason)
    }
    expect(w.sent).toHaveLength(3)
  })

  test('an API error ends the hunt, and a subagent\'s turn is not a round', async ($, on) => {
    const w = world(on)
    await started($)
    await hunt($, w, '--rounds 2')
    await roundEnds($, w, 'fixed-and-verified', 'agent-1')
    expect((await $.command.run(run('status'))).text).toBe('on · round 1/2')
    await roundEnds($, w, '', undefined, 'error')
    expect(w.logs.at(-1)).toBe('hunt stopped after round 1/2: the round ended with error')
  })

  test('a prompt of the person ends the hunt; /bughunt status does not', async ($, on) => {
    const w = world(on)
    await started($)
    await hunt($, w, '--rounds 2')
    await say($, '/bughunt status')
    expect((await $.command.run(run('status'))).text).toBe('on · round 1/2')
    await say($, 'wait, look at this instead')
    expect(w.logs.at(-1)).toBe('hunt stopped: you wrote a prompt in round 1/2')
    expect((await $.command.run(run('stop'))).text).toBe('no hunt is running')
  })

  test('the skill text gets the running round, and nothing outside a hunt', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.skill.prompt({ skill: 'bughunt:hunt', text: 'BODY' })).text).toBe('BODY')
    await hunt($, w, 'src')
    const text = (await $.skill.prompt({ skill: 'bughunt:hunt', text: 'BODY' })).text
    expect(text).toContain('## Current round (bughunt)')
    expect(text).toContain('Proof directory: .temp_files/bughunt/')
  })
})

describe('the gates of a round', () => {
  test('an edit waits for the skill, then for a recorded FAIL; the proof directory is open after the skill', async ($, on) => {
    const w = world(on)
    await started($)
    await hunt($, w, 'src')
    expect((await edit($, 'src/a.ts')).deny).toContain('the bughunt:hunt skill is not open')
    await openSkill($)
    expect((await edit($, 'src/a.ts')).deny).toContain('No FAIL is recorded in this round')
    const dir = /Proof directory: (\S+)/.exec(w.sent[0] ?? '')?.[1] ?? ''
    expect((await edit($, `${dir}/p.js`)).result).toBe('ok')
    await proof($, 'before')
    expect((await edit($, 'src/a.ts')).result).toBe('ok')
    expect(w.edits).toEqual([`${ROOT}/${dir}/p.js`, `${ROOT}/src/a.ts`])
    expect(w.logs).toContain('edit stopped (proof): src/a.ts')
  })

  test('after the FAIL an edit outside the scope stops, and a test file passes', async ($, on) => {
    const w = world(on)
    await started($)
    await hunt($, w, 'src')
    await openSkill($)
    await proof($, 'before')
    expect((await edit($, 'lib/b.ts')).deny).toContain('outside the round\'s scope (src)')
    expect((await edit($, 'tests/a.test.ts')).result).toBe('ok')
  })

  test('a subagent spawn stops during a round and runs outside one; a subagent\'s own edit is not gated', async ($, on) => {
    const w = world(on)
    await started($)
    const spawn = () => $.agent.spawn({ tool_use_id: 'u', prompt: 'p', description: 'd', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: false, fork: false })
    expect((await spawn()).agentId).toBe('a-Explore')
    await hunt($, w, '')
    expect((await spawn()).deny).toContain('a round uses no subagents')
    expect((await edit($, 'src/a.ts', 'agent-1')).result).toBe('ok')
  })

  test('the proof tool runs the command and records only a real FAIL, then only a PASS of the same argv', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await proof($, 'before')).deny).toContain('only inside a /bughunt round')
    await hunt($, w, '')
    w.proof = answer(1, 'Error: Cannot find module')
    expect(String((await proof($, 'before')).result)).toContain('rejected: the proof exited non-zero but printed no line starting with FAIL')
    w.proof = answer(1, 'FAIL: got 3')
    expect(String((await proof($, 'before')).result)).toContain('accepted: FAIL recorded')
    w.proof = answer(0, 'PASS')
    expect(String((await proof($, 'after', ['node', 'other.js'])).result)).toContain('rejected: argv differs')
    expect(String((await proof($, 'after')).result)).toContain('accepted: PASS recorded')
    expect(w.ran).toEqual([['node', 'p.js'], ['node', 'p.js'], ['node', 'other.js'], ['node', 'p.js'], ['node', 'p.js']])
    expect((await proof($, 'during')).deny).toBe('phase must be "before" or "after"')
  })
})

describe('the revert check of a PASS', () => {
  const after = async ($: Engine) => String((await proof($, 'after')).result)

  async function failed($: Engine, w: World): Promise<string> {
    await started($)
    await hunt($, w, '')
    await openSkill($)
    await proof($, 'before')
    w.proof = answer(0, 'PASS')
    return /Proof directory: (\S+)/.exec(w.sent[0] ?? '')?.[1] ?? ''
  }

  test('a proof that passes with the fix reverted records no PASS, and the fix is put back', async ($, on) => {
    const w = world(on)
    const dir = await failed($, w)
    w.git.changed = ['src/a.ts', 'tests/a.test.ts', `${dir}/p.js`]
    w.git.revertedProof = answer(0, 'PASS')
    const text = await after($)
    expect(text).toContain('rejected: with the fix reverted (src/a.ts) the proof still exits 0 without a FAIL line')
    expect(w.git.ran.filter(a => a[0] === 'restore')).toEqual([['restore', '--source=S1', '--worktree', '--', 'src/a.ts'], ['restore', '--source=S2', '--worktree', '--', 'src/a.ts']])
    expect(w.git.reverted).toBe(false)
    expect(w.store.has(`restore:${ROOT}`)).toBe(false)
    expect((await $.command.run(run('status'))).text).toBe('on · round 1/1')
  })

  test('a proof that fails again with the fix reverted records the PASS', async ($, on) => {
    const w = world(on)
    await failed($, w)
    expect(await after($)).toContain('accepted: PASS recorded')
    expect(w.ran).toEqual([['node', 'p.js'], ['node', 'p.js'], ['node', 'p.js']])
    await roundEnds($, w, 'fixed-and-verified')
    expect(w.logs.at(-1)).toBe('hunt finished: 1 round(s), last fixed-and-verified')
  })

  test('with no modified production file there is no fix to revert, and the PASS is refused', async ($, on) => {
    const w = world(on)
    await failed($, w)
    w.git.changed = ['tests/a.test.ts']
    expect(await after($)).toContain('rejected: no production file was modified since the FAIL')
    expect(w.ran).toEqual([['node', 'p.js'], ['node', 'p.js']])
  })

  test('outside a git repository the FAIL records, and the PASS is refused saying why', async ($, on) => {
    const w = world(on)
    w.git.repo = false
    await failed($, w)
    expect(await after($)).toContain('rejected: the revert check needs a git repository')
  })

  test('a fix that cannot be put back refuses the PASS, keeps the record and tells the person', async ($, on) => {
    const w = world(on)
    await failed($, w)
    w.git.putBackFails = true
    expect(await after($)).toContain('rejected: the revert check failed: git restore exited 1: error: pathspec did not match')
    expect(w.store.get(`restore:${ROOT}`)).toEqual({ base: 'S1', fixed: 'S2', files: ['src/a.ts'] })
    expect(w.logs).toContain('revert check failed: git restore exited 1: error: pathspec did not match')
  })

  test('a revert check a crash cut short is put back at the next session start', async ($, on) => {
    const w = world(on)
    w.store.set(`restore:${ROOT}`, { base: 'S1', fixed: 'S7', files: ['src/a.ts'] })
    await started($)
    expect(w.git.ran).toEqual([['diff', '--quiet', 'S1', '--', 'src/a.ts'], ['restore', '--source=S7', '--worktree', '--', 'src/a.ts']])
    expect(w.store.has(`restore:${ROOT}`)).toBe(false)
    expect(w.logs).toEqual(['put back the fix a cut-short revert check left reverted: src/a.ts'])
  })

  test('a cut-short revert whose files changed since is not overwritten; the person gets the command', async ($, on) => {
    const w = world(on)
    w.git.untouched = false
    w.store.set(`restore:${ROOT}`, { base: 'S1', fixed: 'S7', files: ['src/a.ts'] })
    await started($)
    expect(w.git.ran.filter(a => a[0] === 'restore')).toEqual([])
    expect(w.store.has(`restore:${ROOT}`)).toBe(false)
    expect(w.logs.at(-1)).toContain('the fix is in S7: git restore --source=S7 --worktree -- src/a.ts')
  })
})

describe('settings', () => {
  test('a setting another window stored applies here at the next hook that acts on it', async ($, on) => {
    const w = world(on)
    await started($)
    w.store.set('enabled', false)
    expect(await hunt($, w, '')).toBe('off: /bughunt on turns it on')
    expect(w.sent).toEqual([])
    expect(await hunt($, w, 'on')).toBe('on: /bughunt starts a hunt')
    await hunt($, w, '')
    expect(await hunt($, w, 'off')).toBe('off: /bughunt starts nothing and no gate holds edits')
    expect((await edit($, 'src/a.ts')).result).toBe('ok')
  })

  test('the session declares the tools and the three collab agents', async ($, on) => {
    const w = world(on)
    await started($)
    expect(w.tools).toEqual(['proof', 'found', 'collab'])
    expect(w.agents).toEqual(['scanner', 'planner', 'critic'])
  })

  withSidebar('the sidebar holds the running round; a stopped edit goes to its stream', async ($, on) => {
    const w = world(on)
    const sets: { key: string; until: string; lines: string[] }[] = []
    on('sidebar.set', (_, e) => { const s = e as unknown as { key: string; until: string; lines: { text: string }[] }; sets.push({ key: s.key, until: s.until, lines: s.lines.map(l => l.text) }); return { value: true } })
    on('sidebar.clear', () => ({ value: undefined }))
    await started($)
    await hunt($, w, '--rounds 3 src')
    await edit($, 'src/a.ts')
    expect(sets.find(s => s.key === 'hunt')?.lines[0]).toBe('round 1/3 · src')
    expect(sets.filter(s => s.key === 'log').map(s => s.lines[0])).toContain('edit stopped (skill): src/a.ts')
    expect(w.logs).toEqual([])
  })
})

/**
 * The test engine has no core to start a subagent: a plugin's own `$.agent.spawn` resolves there without an
 * agent id, whatever the hooks beneath answer (measured). The steps that wait for a started subagent are
 * covered in `pipeline.test.ts` with fake engine calls; these tests cover the paths around them.
 */
describe('collab', () => {
  const collab = ($: Engine, paths: string[]) => call($, { tool: 'mcp__bughunt__collab', paths })
  const found = ($: Engine, agentId: string) => call($, { tool: 'mcp__bughunt__found', file: 'src/a.ts', line: 4, severity: 'high', description: 'd', agentId })

  test('a scanner that did not start ends the run with no verdict, never an approval', async ($, on) => {
    const w = world(on)
    await started($)
    expect(String((await collab($, ['src'])).result)).toBe('collab started over src; the report arrives as a message')
    await w.clock.advance(0)
    const text = w.sent.at(-1) ?? ''
    expect(w.spawned).toEqual(['bughunt:scanner'])
    expect(text).toContain('- scanner: failed (no agent started)')
    expect(text).toContain('- planner: skipped')
    expect(text).toContain('Verdict: no-verdict (the critic gave no verdict line; this is not an approval)')
  })

  test('only a running scanner reports findings, and an empty path list is refused', async ($, on) => {
    world(on)
    await started($)
    expect((await found($, 'a-bughunt:scanner')).deny).toContain('Only the running bughunt scanner')
    expect((await collab($, [])).deny).toBe('paths must name at least one file or directory')
  })

  test('a peer message that is no collab step\'s hand-back reaches the model', async ($, on) => {
    world(on)
    await started($)
    const r = await $.prompt.submit({ text: '<agent-message from="a-Explore">\nThe report follows:\n  done\n</agent-message>', origin: { kind: 'peer' }, wait: false })
    expect(r).toMatchObject({ text: expect.stringContaining('a-Explore') })
  })

  test('collab waits while a round runs, and /bughunt collab sends its report as a message', async ($, on) => {
    const w = world(on)
    await started($)
    await hunt($, w, '')
    expect((await collab($, ['src'])).deny).toBe('a hunt round is running; collab waits until it ends')
    await hunt($, w, 'stop')
    expect(await hunt($, w, 'collab src')).toBe('collab started over src; the report arrives as a message')
    expect(w.sent.at(-1)).toContain('# bughunt collab report')
    expect(w.sent.at(-1)).toContain('This is a read-only review.')
  })
})
