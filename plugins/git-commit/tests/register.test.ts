import { describe, expect, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, ProcessRunResult } from 'claude-code'

import { joinPath } from '../hooks/command.ts'

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
const INDEX = `${ROOT}/.git/index`

// Built at run time, so this file holds no line the gate itself reads as a secret.
const AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP'

/**
 * A repository in memory. `staged` is the real index; `indexes` holds each temporary index file by path;
 * `content` is the added lines per path; `realAdds` records a `git add` that ran without a temporary index,
 * which the mod must never run.
 */
type World = {
  store: Map<string, unknown>
  logs: string[]
  ran: string[]
  gitCalls: string[][]
  subjects: string[]
  status: string
  staged: string[]
  modified: string[]
  untracked: string[]
  content: Record<string, string[]>
  ignored: Record<string, { source: string; line: string; pattern: string }>
  dirs: Set<string>
  files: Record<string, string>
  indexes: Map<string, Set<string>>
  removed: string[]
  realAdds: string[][]
}

type Git = { args: string[]; cwd: string; index?: string; stdin: string }
type Answer = ProcessRunResult

const ok = (stdout = ''): Answer => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const failed = (exitCode = 1): Answer => ({ ...ok(), exitCode })

/** A path as the repository names it, from the directory git ran in. */
const repoPath = (cwd: string, path: string) => joinPath(cwd, path).slice(ROOT.length + 1)

/** The paths after `--`, or every word that is not an option. */
const operands = (args: readonly string[]) => (args.includes('--') ? args.slice(args.indexOf('--') + 1) : args.filter(a => !a.startsWith('-')))

/** The paths an index holds changes for: a temporary one, or the real index. */
const held = (w: World, g: Git) => [...(g.index === undefined ? w.staged : (w.indexes.get(g.index) ?? []))]

function patchOf(w: World, names: readonly string[]): string {
  return names.map(p => {
    const lines = w.content[p] ?? ['x']
    return [`diff --git a/${p} b/${p}`, `--- a/${p}`, `+++ b/${p}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)].join('\n')
  }).join('\n')
}

function diffAnswer(w: World, g: Git): Answer {
  const names = held(w, g)
  if (g.args.includes('--name-only')) return ok(names.join('\0'))
  if (g.args.includes('--numstat')) return ok(names.map(p => `${(w.content[p] ?? ['x']).length}\t0\t${p}`).join('\0'))
  return ok(patchOf(w, names))
}

function checkIgnore(w: World, g: Git): Answer {
  const hits = g.stdin.split('\0').filter(p => w.ignored[p] !== undefined)
  const out = hits.map(p => { const h = w.ignored[p]; return `${h?.source}\0${h?.line}\0${h?.pattern}\0${p}\0` }).join('')
  return hits.length > 0 ? ok(out) : failed()
}

/** `git add` and `git rm --cached` into a temporary index; into the real one they are recorded as a fault. */
function stage(w: World, g: Git): Answer {
  if (g.index === undefined) {
    w.realAdds.push(g.args)
    return ok()
  }
  const index = w.indexes.get(g.index) ?? new Set<string>()
  w.indexes.set(g.index, index)
  const paths = g.args.includes('-u') ? w.modified : operands(g.args.slice(1)).map(p => repoPath(g.cwd, p))
  for (const p of paths) {
    if (g.args[0] === 'rm') index.delete(p)
    else index.add(p)
  }
  return ok()
}

function revParse(g: Git): Answer {
  if (g.args.includes('--show-toplevel')) return ok(`${ROOT}\n`)
  if (g.args.includes('--git-path')) return ok(`${INDEX}\n`)
  return ok('abc123\n')
}

function readTree(w: World, g: Git): Answer {
  if (g.index !== undefined) w.indexes.set(g.index, new Set())
  return ok()
}

/** Each git subcommand the mod runs, answered from the world; `g.args` starts at the subcommand. */
const ANSWERS: Record<string, (w: World, g: Git) => Answer> = {
  'rev-parse': (_, g) => revParse(g),
  log: w => ok(w.subjects.join('\n')),
  status: w => ok(w.status),
  diff: diffAnswer,
  'check-ignore': checkIgnore,
  'ls-files': (w, g) => ok(operands(g.args).filter(p => w.untracked.includes(p)).join('\0')),
  add: stage,
  rm: stage,
  'read-tree': readTree,
}

function gitAnswer(w: World, g: Git): Answer {
  const at = g.args.findIndex((a, i) => !a.startsWith('-') && g.args[i - 1] !== '-c')
  const answer = ANSWERS[g.args[at] ?? '']
  return answer === undefined ? ok() : answer(w, { ...g, args: g.args.slice(at) })
}

function hostAnswer(w: World, argv: readonly string[]): Answer {
  if (argv[0] === 'cp') w.indexes.set(argv[2] ?? '', new Set(w.staged))
  if (argv[0] === 'rm') w.removed.push(...argv.slice(2))
  return ok()
}

function world(on: On): World {
  const w: World = {
    store: new Map(), logs: [], ran: [], gitCalls: [], subjects: ['feat(a): add x', 'fix(b): stop y', 'docs: note z'], status: '## main\0',
    staged: [], modified: [], untracked: [], content: {}, ignored: {}, dirs: new Set(), files: {}, indexes: new Map(), removed: [], realAdds: [],
  }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: e.path === INDEX || w.dirs.has(e.path) || w.files[e.path] !== undefined }))
  on('fs.stat', (_, e) => {
    if (!w.dirs.has(e.path) && w.files[e.path] === undefined) throw new Error('ENOENT')
    return { value: { kind: w.dirs.has(e.path) ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false } } as never
  })
  on('fs.read', (_, e) => {
    const text = w.files[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('process.run', (_, e) => {
    if (e.argv[0] !== 'git') return { value: hostAnswer(w, e.argv) }
    w.gitCalls.push([...e.argv])
    const g: Git = { args: e.argv.slice(1), cwd: e.init?.cwd ?? ROOT, index: e.init?.env?.GIT_INDEX_FILE, stdin: e.init?.stdin ?? '' }
    return { value: gitAnswer(w, g) }
  })
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    w.ran.push(e.command)
    return { result: 'ok' } as never
  })
  on('tool.call', { tool: 'Skill' }, (_, e) => ({ result: { success: true, commandName: e.skill }, text: `Launching skill: ${e.skill}` }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('attribution.text', (_, e) => ({ text: e.text }))
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
}

const run = (args: string): CommandRunInput => ({
  command: 'git-commit', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const bash = ($: Engine, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId === undefined ? {} : { agentId }) } as never)
const openSkill = ($: Engine, args = '', agentId?: string) => $.tool.call({ tool: 'Skill', skill: 'git-commit:commit', args, ...(agentId === undefined ? {} : { agentId }) } as never)
const say = ($: Engine, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
const endTurn = ($: Engine, agentId?: string) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId === undefined ? {} : { agentId }) } as never)

const COMMIT = 'git commit -m "fix(b): stop the leak"'

describe('the skill gate', () => {
  test('a commit the skill did not open stops, and runs once the skill is opened in the turn', async ($, on) => {
    const w = world(on)
    await started($)
    const denied = await bash($, COMMIT)
    expect(denied.deny).toContain('A git commit runs only after the git-commit:commit skill was opened in this turn')
    expect(denied.deny?.endsWith('There is no way around this gate.')).toBe(true)
    expect(w.logs).toEqual(['stopped: skill not opened'])
    expect(w.ran).toEqual([])
    await openSkill($)
    expect((await bash($, COMMIT)).result).toBe('ok')
    expect(w.ran).toEqual([COMMIT])
  })

  test('the skill opens only its own loop, and only until that loop\'s turn ends', async ($, on) => {
    world(on)
    await started($)
    await openSkill($)
    expect((await bash($, COMMIT, 'agent-1')).deny).toContain('skill was opened in this turn, by this agent')
    await openSkill($, '', 'agent-1')
    expect((await bash($, COMMIT, 'agent-1')).result).toBe('ok')
    await endTurn($)
    expect((await bash($, COMMIT)).deny).toContain('git-commit:commit')
    expect((await bash($, COMMIT, 'agent-1')).result).toBe('ok')
    await endTurn($, 'agent-1')
    expect((await bash($, COMMIT, 'agent-1')).deny).toContain('git-commit:commit')
  })

  test('a typed /git-commit:commit opens the main loop with the options it names', async ($, on) => {
    world(on)
    await started($)
    await say($, '/git-commit:commit --amend')
    expect((await bash($, `${COMMIT} --amend`)).result).toBe('ok')
    expect((await bash($, `${COMMIT} --no-verify`)).deny).toContain('--no-verify')
  })

  test('a flag the skill gates needs the option that opens it', async ($, on) => {
    world(on)
    await started($)
    await openSkill($)
    expect((await bash($, `${COMMIT} --no-verify`)).deny).toContain('`--no-verify` skips the repository\'s hooks')
    expect((await bash($, `HUSKY=0 ${COMMIT}`)).deny).toContain('`HUSKY=0` switches the repository\'s hooks off')
    await openSkill($, '--no-verify')
    expect((await bash($, `${COMMIT} --no-verify`)).result).toBe('ok')
    expect((await bash($, `${COMMIT} --allow-empty`)).deny).toContain('--allow-empty')
  })
})

describe('staging', () => {
  test('explicit paths pass; a dot, -A and a directory stop; --all opens them', async ($, on) => {
    const w = world(on)
    w.dirs.add(`${ROOT}/src`)
    await started($)
    expect((await bash($, 'git add src/a.ts README.md')).result).toBe('ok')
    expect((await bash($, 'git add .')).deny).toContain('`.` names a whole directory tree')
    expect((await bash($, 'git add -A')).deny).toContain('`git add -A` stages every change')
    expect((await bash($, 'git add src')).deny).toContain('`src` is a directory')
    expect((await bash($, 'git add -p src/a.ts')).deny).toContain('interactively')
    await openSkill($, '--all')
    expect((await bash($, 'git add -A')).result).toBe('ok')
    expect((await bash($, 'git add src')).result).toBe('ok')
  })

  test('the new files a git add stages reach the model as a note, and the command runs', async ($, on) => {
    const w = world(on)
    w.untracked = ['new.ts']
    await started($)
    const r = await bash($, 'git add new.ts old.ts')
    expect(r.result).toBe('ok')
    expect(r.context?.[0]).toContain('git add stages 1 untracked file(s): new.ts')
    expect(w.logs).toEqual(['noted: 1 new file(s) staged'])
  })

  test('git add -f of an ignored path stops and names the ignore file and line', async ($, on) => {
    const w = world(on)
    w.ignored['CLAUDE.md'] = { source: '/home/u/.gitignore_global', line: '5', pattern: 'CLAUDE.md' }
    await started($)
    expect((await bash($, 'git add -f CLAUDE.md')).deny).toContain('`git add -f` forces `CLAUDE.md`, which /home/u/.gitignore_global:5 (`CLAUDE.md`) ignores')
    expect((await bash($, 'git add -f src/a.ts')).result).toBe('ok')
  })
})

describe('what the commit records', () => {
  test('a secret file this command stages stops the commit, and the real index is never written', async ($, on) => {
    const w = world(on)
    await started($)
    await openSkill($)
    const denied = await bash($, `git add .env src/a.ts && ${COMMIT}`)
    expect(denied.deny).toContain('The commit holds `.env`, a file name that holds credentials')
    expect(w.realAdds).toEqual([])
    expect(w.removed.every(p => p.startsWith(`${INDEX}.git-commit-`))).toBe(true)
    expect(w.removed.length).toBeGreaterThan(0)
  })

  test('a secret line stops the commit, named by place and kind, never by value', async ($, on) => {
    const w = world(on)
    w.staged = ['src/a.ts']
    w.content['src/a.ts'] = [`const key = "${AWS}"`]
    await started($)
    await openSkill($)
    const denied = await bash($, COMMIT)
    expect(denied.deny).toContain('src/a.ts:1 (AWS access key)')
    expect(denied.deny?.includes(AWS)).toBe(false)
  })

  test('an ignored path the index holds stops the commit, and -a is measured with the tracked changes', async ($, on) => {
    const w = world(on)
    w.modified = ['AGENTS.md']
    w.ignored['AGENTS.md'] = { source: '/home/u/.gitignore_global', line: '3', pattern: 'AGENTS.md' }
    await started($)
    await openSkill($, '--modified')
    expect((await bash($, 'git commit -am "docs: note it"')).deny).toContain('The commit holds `AGENTS.md`, which /home/u/.gitignore_global:3 (`AGENTS.md`) ignores')
    expect(w.realAdds).toEqual([])
  })

  test('a large commit across two packages runs with notes', async ($, on) => {
    const w = world(on)
    w.staged = ['plugins/a/x.ts', 'plugins/b/y.ts']
    w.content['plugins/a/x.ts'] = Array.from({ length: 120 }, (_, i) => `line ${i}`)
    await started($)
    await openSkill($)
    const r = await bash($, COMMIT)
    expect(r.result).toBe('ok')
    expect(r.context?.[0]).toContain('The commit changes 121 lines')
    expect(r.context?.[0]).toContain('The commit touches 2 areas (plugins/a, plugins/b)')
  })
})

describe('the message', () => {
  test('a subject that breaks the repository style, the length or the period rule stops', async ($, on) => {
    world(on)
    await started($)
    await openSkill($)
    const denied = await bash($, 'git commit -m "Fix the leak."')
    expect(denied.deny).toContain('This repository writes conventional subjects (3 of the last 3 subjects)')
    expect(denied.deny).toContain('ends with a period')
  })

  test('an AI signature in a heredoc message stops', async ($, on) => {
    world(on)
    await started($)
    await openSkill($)
    const command = 'git commit -m "$(cat <<\'EOF\'\nfix(b): stop the leak\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>\nEOF\n)"'
    expect((await bash($, command)).deny).toContain('AI signature line (`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`)')
  })

  test('a message the command does not say runs with a note', async ($, on) => {
    world(on)
    await started($)
    await openSkill($)
    const r = await bash($, 'git commit -F msg.txt')
    expect(r.result).toBe('ok')
    expect(r.context?.[0]).toContain('The mod did not measure the commit message: the message file msg.txt was not read.')
  })
})

describe('push, branches and config', () => {
  test('a push runs only when the person asked for it or the skill was opened with --push', async ($, on) => {
    world(on)
    await started($)
    await say($, 'commitle')
    expect((await bash($, 'git push')).deny).toContain('The user did not ask for a push')
    await say($, 'commitle ve push et')
    expect((await bash($, 'git push')).result).toBe('ok')
    await say($, 'commitle')
    await openSkill($, '--push')
    expect((await bash($, 'git push origin main')).result).toBe('ok')
  })

  test('a branch operation runs only when the person asked for one, and a file restore always runs', async ($, on) => {
    const w = world(on)
    w.files[`${ROOT}/src/a.ts`] = 'x'
    await started($)
    await say($, 'commitle')
    expect((await bash($, 'git checkout -b feature')).deny).toContain('creates, switches or renames a branch')
    expect((await bash($, 'git switch main')).deny).toContain('git switch main')
    expect((await bash($, 'git checkout main')).deny).toContain('git checkout main')
    expect((await bash($, 'git checkout src/a.ts')).result).toBe('ok')
    expect((await bash($, 'git branch --show-current')).result).toBe('ok')
    await say($, 'yeni bir branch aç')
    expect((await bash($, 'git checkout -b feature')).result).toBe('ok')
  })

  test('a git config write and -c core.hooksPath stop, and a read runs', async ($, on) => {
    world(on)
    await started($)
    await openSkill($, '--no-verify')
    expect((await bash($, 'git config user.name x')).deny).toContain('changes a setting')
    expect((await bash($, 'git config --get user.name')).result).toBe('ok')
    expect((await bash($, `git -c core.hooksPath=/dev/null ${COMMIT.slice(4)}`)).deny).toContain('core.hooksPath')
    expect((await bash($, 'git rebase -i HEAD~2')).deny).toContain('interactive editor')
  })

  test('a read-only git command measures nothing', async ($, on) => {
    const w = world(on)
    await started($)
    const r = await bash($, 'git status && git log --oneline -5 && git diff HEAD')
    expect(r.result).toBe('ok')
    expect(r.context).toBe(undefined)
    expect(w.gitCalls).toEqual([])
  })
})

describe('mode, settings and the other channels', () => {
  test('the note mode lets a rule break run and tells the model which rule it broke', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('mode note'))).text).toBe('mode note: a git command that breaks the skill runs, and the model reads which rule it broke')
    const r = await bash($, COMMIT)
    expect(r.result).toBe('ok')
    expect(r.context?.[0]).toContain('this command broke the git-commit:commit skill (the mode is note, so it ran)')
    expect(w.logs).toEqual(['noted: skill not opened'])
  })

  test('the command shows and sets the state', async ($, on) => {
    world(on)
    await started($)
    expect((await $.command.run(run(''))).text).toBe('on · mode deny')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off or mode note | deny')
    expect((await $.command.run(run('off'))).text).toBe('off: git commands run unchecked, and the engine\'s own commit trailer text is back')
    expect((await bash($, COMMIT)).result).toBe('ok')
    expect((await $.command.run(run(''))).text).toBe('off · mode deny')
  })

  test('the skill\'s text carries the repository state and the options it was opened with', async ($, on) => {
    const w = world(on)
    w.status = ['## main...origin/main [ahead 1]', 'M  src/a.ts', '?? new.ts', ''].join('\0')
    w.staged = ['src/a.ts', '.env']
    await started($)
    const r = await $.skill.prompt({ skill: 'git-commit:commit', text: '# Commit\n\nARGUMENTS: --push' })
    expect(r.text.startsWith('# Commit\n\nARGUMENTS: --push\n\n## Current repository state (git-commit)')).toBe(true)
    expect(r.text).toContain('Branch: main...origin/main [ahead 1]')
    expect(r.text).toContain('Untracked (1): new.ts')
    expect(r.text).toContain('Options this skill was opened with: --push')
    expect(r.text).toContain('  fix(b): stop y')
    expect(r.text).toContain('staged .env is a file name that holds credentials')
  })

  test('the commit trailer text is empty while the mod is on', async ($, on) => {
    world(on)
    await started($)
    expect((await $.attribution.text({ kind: 'commit', text: 'Co-Authored-By: Claude' })).text).toBe('')
    expect((await $.attribution.text({ kind: 'pr', text: 'Generated with Claude Code' })).text).toBe('Generated with Claude Code')
    await $.command.run(run('off'))
    expect((await $.attribution.text({ kind: 'commit', text: 'Co-Authored-By: Claude' })).text).toBe('Co-Authored-By: Claude')
  })

  withSidebar('an open sidebar takes the line and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const entries: { title: string; lines: string[] }[] = []
    on('sidebar.set', (_, e) => {
      const s = e as unknown as { title: string; lines: { text: string }[] }
      entries.push({ title: s.title, lines: s.lines.map(l => l.text) })
      return { value: true }
    })
    await started($)
    await bash($, COMMIT)
    expect(entries).toEqual([{ title: 'git command stopped', lines: ['skill not opened'] }])
    expect(w.logs).toEqual([])
  })

  test('a setting another window stored applies here at the next hook that acts on it', async ($, on) => {
    const w = world(on)
    await started($)
    // Every window shares the store: another one chose the note mode, and this one never ran the command.
    w.store.set('mode', 'note')
    expect((await bash($, COMMIT)).result).toBe('ok')
    w.store.set('enabled', false)
    expect((await bash($, 'git push')).context).toBe(undefined)
    await $.turn.start({ text: 'x', turnId: 't2' })
    expect((await $.attribution.text({ kind: 'commit', text: 'Co-Authored-By: Claude' })).text).toBe('Co-Authored-By: Claude')
  })
})
