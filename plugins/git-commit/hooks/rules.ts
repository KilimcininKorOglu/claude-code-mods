/**
 * The skill's rules as findings: what each git call broke, given what the
 * command names and what the caller measured in the repository.
 */
import type { GitCall } from './command.ts'
import { deny, note, type Finding } from './finding.ts'
import type { Parsed } from './gitargs.ts'
import type { SecretHit } from './secrets.ts'

/** The skill as the model calls it. */
export const SKILL = 'git-commit:commit'

/** The skill options the mod reads: each opens one operation the skill otherwise refuses. */
export const OPTIONS = ['all', 'staged', 'modified', 'no-verify', 'amend', 'push'] as const

/** The skill options named in an argument string (`--push --amend`). */
export function optionsOf(args: string): Set<string> {
  const words = new Set(args.split(/\s+/).map(w => w.replace(/^--/, '')))
  return new Set(OPTIONS.filter(option => words.has(option)))
}

/** The `ARGUMENTS:` line the engine appends to a skill's text, '' when it has none. */
export function argumentsOf(text: string): string {
  const at = text.lastIndexOf('\nARGUMENTS: ')
  return at < 0 ? '' : (text.slice(at + 12).split('\n')[0] ?? '')
}

/** The options a typed `/git-commit:commit ...` prompt opens, or undefined when the prompt is not one. */
export function typedSkill(prompt: string): Set<string> | undefined {
  const m = /^\/git-commit:commit(?:\s+([\s\S]*))?$/.exec(prompt.trim())
  return m === null ? undefined : optionsOf(m[1] ?? '')
}

/** Environment variables that switch a repository's hook runner off. */
const HOOK_SKIPS = /^(?:HUSKY=0|HUSKY_SKIP_HOOKS=\S+|SKIP=\S+|LEFTHOOK=0)$/

/** A call that skips the repository's hooks through `-c core.hooksPath` or a hook runner's variable. */
export function hookSkipFindings(call: GitCall, options: ReadonlySet<string> | undefined): Finding[] {
  const out: Finding[] = []
  if (call.configs.some(c => /^core\.hookspath=/i.test(c))) {
    out.push(deny('-c core.hooksPath', '`-c core.hooksPath=...` replaces the repository\'s hooks for this call. Run it without that setting; when the user asked to skip the hooks, the skill uses `--no-verify`.'))
  }
  const skip = call.env.find(v => HOOK_SKIPS.test(v))
  if (skip !== undefined && options?.has('no-verify') !== true) {
    out.push(deny(`${skip} skips hooks`, `\`${skip}\` switches the repository's hooks off, which the skill allows only when the user passed --no-verify. Run the command without it.`))
  }
  return out
}

const SKILL_TEXT = `A git commit runs only after the ${SKILL} skill was opened in this turn, by this agent. Call the Skill tool with skill "${SKILL}" and, as args, the options the user gave (such as --push or --amend), follow its steps, then run the commit again.`

/** A commit flag the skill allows only with one of its options. */
type Gated = { flag: string; options: string[]; short: string; text: string }

const GATED: Gated[] = [
  { flag: 'no-verify', options: ['no-verify'], short: '--no-verify', text: '`--no-verify` skips the repository\'s hooks; the skill allows it only when the user passed --no-verify. Run the commit without it.' },
  { flag: 'amend', options: ['amend'], short: '--amend', text: '`--amend` rewrites the last commit; the skill allows it only when the user passed --amend. Make a new commit instead.' },
  { flag: 'all', options: ['all', 'modified'], short: 'commit -a', text: '`git commit -a` stages every modified tracked file; the skill stages the files of this change by explicit path, and allows -a only when the user passed --all or --modified. Run `git add <path>...` for this change\'s files, then commit.' },
]

/** Commit flags the skill never uses. */
const NEVER: { flag: string; short: string; text: string }[] = [
  { flag: 'allow-empty', short: '--allow-empty', text: '`--allow-empty` records a commit with no change, which the skill never does.' },
  { flag: 'allow-empty-message', short: '--allow-empty-message', text: '`--allow-empty-message` records a commit without a message, which the skill never does.' },
  { flag: 'interactive', short: 'commit --interactive', text: '`git commit --interactive` opens an interactive session, which does not work here. Stage explicit paths with `git add <path>`.' },
  { flag: 'patch', short: 'commit -p', text: '`git commit -p` asks which hunks to take interactively, which does not work here. Stage explicit paths with `git add <path>`.' },
]

/** What a `git commit` breaks by its options alone: the skill not opened, a gated flag, a flag the skill never uses. */
export function commitFlagFindings(c: Parsed, options: ReadonlySet<string> | undefined): Finding[] {
  if (options === undefined) return [deny('skill not opened', SKILL_TEXT)]
  const gated = GATED.filter(g => c.flags.has(g.flag) && !g.options.some(o => options.has(o)))
  const never = NEVER.filter(n => c.flags.has(n.flag))
  return [...gated, ...never].map(f => deny(f.short, f.text))
}

/** Why an operand is more than a list of this change's files, or undefined when it names a file. */
export function blanketReason(operand: string): string | undefined {
  if (/^(?:\.{1,2}\/?|\*)$/.test(operand)) return 'names a whole directory tree'
  if (operand.startsWith(':')) return 'is a pathspec that reaches past the named files'
  if (/[*?[]/.test(operand)) return 'is a glob'
  return operand.endsWith('/') ? 'is a directory' : undefined
}

/** `git add` options the skill never uses. */
const ADD_NEVER: { flag: string; short: string; text: string }[] = [
  { flag: 'interactive', short: 'add -i', text: '`git add -i` opens an interactive session, which does not work here. Name the files: `git add <path> <path>`.' },
  { flag: 'patch', short: 'add -p', text: '`git add -p` asks which hunks to take interactively, which does not work here. Name the files: `git add <path> <path>`.' },
  { flag: 'edit', short: 'add -e', text: '`git add -e` opens an editor, which does not work here. Name the files: `git add <path> <path>`.' },
  { flag: 'pathspec-from-file', short: 'add --pathspec-from-file', text: '`--pathspec-from-file` hides which files are staged. Name the files: `git add <path> <path>`.' },
]

/** What a `git add` breaks by its options and operands, before the file system is asked. */
export function addFlagFindings(a: Parsed, options: ReadonlySet<string> | undefined): Finding[] {
  const out = ADD_NEVER.filter(n => a.flags.has(n.flag)).map(n => deny(n.short, n.text))
  if (options?.has('all') === true) return out
  if (a.flags.has('all')) out.push(deny('add -A', '`git add -A` stages every change in the repository, including other work and new files. Name this change\'s files: `git add <path> <path>`.'))
  if (a.flags.has('update') && options?.has('modified') !== true) out.push(deny('add -u', '`git add -u` stages every modified tracked file. Name this change\'s files: `git add <path> <path>`.'))
  return [...out, ...pathspecFindings(a.operands, options)]
}

/** Operands that reach past this change's files; `--all` opens them, since the user asked for everything. */
export function pathspecFindings(operands: readonly string[], options: ReadonlySet<string> | undefined): Finding[] {
  if (options?.has('all') === true) return []
  return operands.flatMap(operand => {
    const why = blanketReason(operand)
    return why === undefined ? [] : [blanketFinding(operand, why)]
  })
}

/** A staging operand that reaches past this change's files. */
export function blanketFinding(operand: string, why: string): Finding {
  return deny(`git add ${operand}`, `\`${operand}\` ${why}, so it can sweep in unrelated changes or another session's work. Name this change's files one by one: \`git add <path> <path>\`.`)
}

/** One path `git check-ignore -v` matched: the ignore file, its line, the pattern. */
export type IgnoreHit = { path: string; source: string; line: string; pattern: string }

/** Reads `git check-ignore --no-index -v -z` output; a negated pattern (`!x`) means the path is kept, not ignored. */
export function ignoreHits(stdout: string): IgnoreHit[] {
  const fields = stdout.split('\0')
  const hits: IgnoreHit[] = []
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source = '', line = '', pattern = '', path = ''] = fields.slice(i, i + 4)
    if (!pattern.startsWith('!')) hits.push({ path, source, line, pattern })
  }
  return hits
}

/** A path an ignore file names, forced into the index or held by the commit. */
export function ignoredFindings(hits: readonly IgnoreHit[], how: 'add' | 'commit'): Finding[] {
  return hits.map(h => {
    const where = `${h.source}:${h.line} (\`${h.pattern}\`)`
    const text = how === 'add'
      ? `\`git add -f\` forces \`${h.path}\`, which ${where} ignores. Leave it out of the index.`
      : `The commit holds \`${h.path}\`, which ${where} ignores. Take it out of the index with \`git rm --cached -- ${h.path}\`, or leave it out of this commit.`
    return deny(`ignored ${h.path}`, text)
  })
}

/** Staged files whose names hold credentials. */
export function secretNameFindings(paths: readonly string[]): Finding[] {
  return paths.map(p => deny(`secret file ${p}`, `The commit holds \`${p}\`, a file name that holds credentials (.env, keys, credential files). Leave it out: \`git restore --staged -- ${p}\`, and warn the user.`))
}

/** Added lines that look like credentials, named by place and kind only. */
export function secretLineFindings(hits: readonly SecretHit[]): Finding[] {
  if (hits.length === 0) return []
  const places = hits.slice(0, 10).map(h => `${h.path}:${h.line} (${h.kind})`).join(', ')
  const more = hits.length > 10 ? ` and ${hits.length - 10} more` : ''
  return [deny(`${hits.length} secret line(s)`, `The commit adds line(s) that look like credentials: ${places}${more}. Remove them or keep those files out of the commit, and warn the user.`)]
}

/** A note when the commit changes more lines than the skill's split threshold. */
export function sizeFindings(lines: number): Finding[] {
  if (lines <= 100) return []
  return [note(`${lines} lines changed`, `The commit changes ${lines} lines. The skill splits a change over 100 lines when it holds more than one concern.`)]
}

/** A note when the commit touches files in more than one package or module (the first two path segments). */
export function spreadFindings(paths: readonly string[]): Finding[] {
  const units = [...new Set(paths.map(p => p.split('/')).filter(parts => parts.length >= 3).map(parts => parts.slice(0, 2).join('/')))]
  if (units.length < 2) return []
  const named = units.slice(0, 6).join(', ') + (units.length > 6 ? `, and ${units.length - 6} more` : '')
  return [note(`${units.length} areas in one commit`, `The commit touches ${units.length} areas (${named}). The skill splits different modules or packages into separate commits.`)]
}

/** A note naming the new files a `git add` stages. */
export function untrackedFindings(paths: readonly string[]): Finding[] {
  if (paths.length === 0) return []
  const named = paths.slice(0, 10).join(', ') + (paths.length > 10 ? `, and ${paths.length - 10} more` : '')
  return [note(`${paths.length} new file(s) staged`, `git add stages ${paths.length} untracked file(s): ${named}. The skill asks the user whether new files belong in the commit, unless the user asked for them or this session created them.`)]
}

/** A push nobody asked for. */
export function pushFindings(p: Parsed, asked: boolean, options: ReadonlySet<string> | undefined): Finding[] {
  if (p.flags.has('dry-run') || p.flags.has('help')) return []
  const out: Finding[] = []
  if (!asked) out.push(deny('push not asked', 'The user did not ask for a push: the last prompt does not say push, and the skill was not opened with --push. A plain commit never pushes.'))
  if (p.flags.has('no-verify') && options?.has('no-verify') !== true) out.push(deny('push --no-verify', '`git push --no-verify` skips the pre-push hook; the skill allows it only when the user passed --no-verify.'))
  return out
}

/** A branch operation nobody asked for. */
export function branchFindings(command: string, asked: boolean): Finding[] {
  if (asked) return []
  return [deny(`${command} changes the branch`, `\`${command}\` creates, switches or renames a branch, and the user's last prompt does not ask for a branch operation. A commit stays on the current branch.`)]
}

export function configFindings(): Finding[] {
  return [deny('git config write', '`git config` here changes a setting, which the skill never does. Leave the git config as it is.')]
}

export function rebaseFindings(): Finding[] {
  return [deny('rebase -i', '`git rebase -i` opens an interactive editor, which does not work here.')]
}

/** The deny text both the model and the person read. */
export function denyText(findings: readonly Finding[]): string {
  const lines = findings.map(f => `- ${f.text}`).join('\n')
  return `stopped before it ran, because it breaks the ${SKILL} skill:\n${lines}\nThere is no way around this gate.`
}

/** The model's note after a command ran; `broken` says the mode let rule breaks run. */
export function noteText(findings: readonly Finding[]): string {
  const broken = findings.filter(f => f.level === 'deny')
  const soft = findings.filter(f => f.level === 'note')
  const parts: string[] = []
  if (broken.length > 0) parts.push(`git-commit: this command broke the ${SKILL} skill (the mode is note, so it ran):\n${broken.map(f => `- ${f.text}`).join('\n')}`)
  if (soft.length > 0) parts.push(`git-commit notes on this command:\n${soft.map(f => `- ${f.text}`).join('\n')}`)
  return parts.join('\n\n')
}

/** The person's one line: what happened and the rules by their short names. */
export function logText(findings: readonly Finding[], stopped: boolean): string {
  return `${stopped ? 'stopped' : 'noted'}: ${findings.map(f => f.short).join('; ')}`
}
