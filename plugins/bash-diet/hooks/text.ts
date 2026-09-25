import { RAW_VARIABLE } from './command.ts'

/**
 * The note the model reads at the session's start, after /clear and after a compaction, so it knows a
 * condensed result is complete and how to reach every byte.
 */
export const AWARENESS = [
  'Bash results in this session pass through a filter that condenses known commands (git, test runners, linters, compilers, package managers, containers, file listings and searches): passing tests collapse to a count, progress and noise lines drop, long lists end with a count of the rest.',
  'Treat a condensed result as complete. A result that left something out ends with `[full output: <path>]`; open that file with the Read tool when you need what was left out.',
  `When you need the exact bytes (a patch to apply, output to parse), prefix the command with \`${RAW_VARIABLE}=1\`, and the result comes back unfiltered.`,
].join(' ')

export const USAGE = 'expects nothing (the status), on, off, exclude <prefix | ^regex>, include <prefix | ^regex>, excludes, filters, trust, untrust, gain [project | daily | graph | history] or cost'

/** A rule file as the person reads it, and the names of its rules. */
export type RuleFileView = { shown: string; source: 'project' | 'global'; exists: boolean; trusted: boolean; names: string[] }

/** `/bash-diet filters`: every rule file with its state and rules, then the built-in rules. */
export function filtersText(files: RuleFileView[], builtin: string[]): string {
  const rows = files.map(f => {
    if (!f.exists) return `${f.source}: ${f.shown} (none)`
    const state = f.source === 'project' && !f.trusted ? ' (not trusted: /bash-diet trust runs it)' : ''
    return `${f.source}: ${f.shown}${state}: ${f.names.length === 0 ? 'no rules' : f.names.join(', ')}`
  })
  return [...rows, `built-in: ${builtin.join(', ')}`].join('\n')
}

/** Characters per token, as the gain is estimated: no tokenizer runs here. */
export const CHARS_PER_TOKEN = 4

export function tokensOf(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/** A token count as `830`, `12.4k` or `1.2M`. */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** The session's gain: how many results shrank and the tokens they saved. */
export function sessionText(calls: number, rawChars: number, shownChars: number): string {
  if (calls === 0) return 'no Bash result shrunk yet'
  const saved = tokensOf(rawChars - shownChars)
  const pct = rawChars === 0 ? 0 : Math.round(((rawChars - shownChars) / rawChars) * 100)
  return `${calls} result(s) shrunk · ~${fmtTokens(saved)} tokens saved (${pct}%)`
}

export function statusText(enabled: boolean, excludes: string[], session: string): string {
  const ex = excludes.length === 0 ? '' : ` · ${excludes.length} exclude(s)`
  return `${enabled ? 'on' : 'off'}${ex} · ${session}`
}

/** Whether a pattern is a valid exclude: a plain prefix, or a `^` regex that compiles. */
export function patternError(pattern: string): string | undefined {
  if (pattern === '') return 'expects a command prefix or a ^regex'
  if (!pattern.startsWith('^')) return undefined
  try {
    new RegExp(pattern)
    return undefined
  } catch (err) {
    return `not a valid regex: ${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * Whether an exclude matches a command: a plain pattern matches the command's words from the start at a
 * word boundary (`npm` matches `npm test`, not `npmx`), a `^` pattern is a regex over the same words.
 */
export function isExcluded(patterns: string[], words: string[]): boolean {
  const text = words.join(' ')
  return patterns.some(p => {
    if (p.startsWith('^')) return new RegExp(p).test(text)
    return text === p || text.startsWith(`${p} `)
  })
}
