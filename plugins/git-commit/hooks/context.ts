/**
 * The repository state the mod appends to the skill's text, so the model
 * starts from the branch, the status and the style without running them.
 */
import type { Style } from './message.ts'

/** The paths of `git status`, by what the commit would do with them. */
export type Status = { branch: string; staged: string[]; unstaged: string[]; untracked: string[]; conflicted: string[] }

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

/** Files one status entry adds to. */
function sort(s: Status, code: string, path: string): void {
  if (code === '??') s.untracked.push(path)
  else if (CONFLICT.has(code)) s.conflicted.push(path)
  else {
    if (code[0] !== ' ') s.staged.push(path)
    if (code[1] !== ' ') s.unstaged.push(path)
  }
}

/** Reads `git status --porcelain=v1 -z --branch`: the `## ` branch entry, then `XY path` entries; a rename carries its source next. */
export function parseStatus(stdout: string): Status {
  const s: Status = { branch: '', staged: [], unstaged: [], untracked: [], conflicted: [] }
  const entries = stdout.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? ''
    if (entry.startsWith('## ')) s.branch = entry.slice(3)
    else if (entry.length > 3) {
      const code = entry.slice(0, 2)
      sort(s, code, entry.slice(3))
      if (/[RC]/.test(code[0] ?? '')) i++
    }
  }
  return s
}

/** Reads `git diff --numstat -z --no-renames`: the paths and the lines added and deleted; a binary file counts no lines. */
export function readNumstat(stdout: string): { names: string[]; lines: number } {
  const names: string[] = []
  let lines = 0
  for (const entry of stdout.split('\0')) {
    const [added = '', deleted = '', ...path] = entry.split('\t')
    if (path.length === 0) continue
    names.push(path.join('\t'))
    lines += (Number(added) || 0) + (Number(deleted) || 0)
  }
  return { names, lines }
}

const SHOWN = 40

/** One list of paths, cut at 40. */
function listLine(label: string, paths: readonly string[]): string {
  if (paths.length === 0) return `${label}: none`
  const cut = paths.length > SHOWN ? `, and ${paths.length - SHOWN} more (run git status for the whole list)` : ''
  return `${label} (${paths.length}): ${paths.slice(0, SHOWN).join(', ')}${cut}`
}

/** The style line: what the recent subjects follow, and the skill's default when they follow nothing. */
export function styleLine(style: Style): string {
  if (style.count === 0) return 'Style: no commits yet; the skill\'s default is `type(scope): subject`'
  if (!style.isConventional) return `Style: ${style.conventional} of the last ${style.count} subjects are conventional; follow the style the subjects below show, or the skill's default \`type(scope): subject\` when they show none`
  const cased = style.lowercase === true ? ', the description starts lowercase' : style.lowercase === false ? ', the description starts uppercase' : ''
  return `Style: conventional commits (${style.conventional} of the last ${style.count} subjects)${cased}`
}

/** The block the model reads after the skill's text. */
export function stateBlock(status: Status, subjects: readonly string[], style: Style, options: ReadonlySet<string>, warnings: readonly string[]): string {
  const lines = [
    '## Current repository state (git-commit)',
    '',
    `Branch: ${status.branch === '' ? 'unknown' : status.branch}`,
    listLine('Staged', status.staged),
    listLine('Unstaged', status.unstaged),
    listLine('Untracked', status.untracked),
    listLine('Conflicted', status.conflicted),
    `Options this skill was opened with: ${options.size === 0 ? 'none' : [...options].map(o => `--${o}`).join(' ')}`,
    styleLine(style),
    'Recent subjects:',
    ...(subjects.length === 0 ? ['  (none)'] : subjects.slice(0, 10).map(s => `  ${s}`)),
  ]
  if (warnings.length > 0) lines.push('Warnings:', ...warnings.map(w => `  - ${w}`))
  return lines.join('\n')
}
