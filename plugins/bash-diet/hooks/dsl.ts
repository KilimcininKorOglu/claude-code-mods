/**
 * Filter rules written as data: a command pattern and the steps that shrink its output. The person's own
 * rules live in `filters.json` files; the mod's built-in rules use the same shape.
 *
 * The steps run in a fixed order: `strip_ansi`, `replace`, `match_output`, `strip_lines_matching` or
 * `keep_lines_matching`, `truncate_lines_at`, `head_lines` and `tail_lines`, `max_lines`, `on_empty`.
 */

import { cutLine, stripAnsi, type FilterResult } from './filters/common.ts'

/** Where a rule came from; a project rule runs only while its file is trusted. */
export type RuleSource = 'project' | 'global' | 'builtin'

/** One rule as a `filters.json` file writes it. */
export type RuleSpec = {
  description?: string
  /** A regex over the command's words (after variables and wrappers such as `timeout`). */
  match_command: string
  strip_ansi?: boolean
  /** Regex substitutions, applied to every line in order. */
  replace?: { pattern: string; replacement: string }[]
  /** When the whole output matches `pattern` (and not `unless`), the result is `message` alone. */
  match_output?: { pattern: string; message: string; unless?: string }[]
  strip_lines_matching?: string[]
  keep_lines_matching?: string[]
  truncate_lines_at?: number
  head_lines?: number
  tail_lines?: number
  max_lines?: number
  /** The result when nothing is left. */
  on_empty?: string
}

/** A checked rule with its patterns compiled. */
export type Rule = {
  name: string
  source: RuleSource
  match: RegExp
  stripAnsi: boolean
  replace: { pattern: RegExp; replacement: string }[]
  matchOutput: { pattern: RegExp; message: string; unless?: RegExp }[]
  lines?: { keep: boolean; patterns: RegExp[] }
  truncateAt?: number
  head?: number
  tail?: number
  max?: number
  onEmpty?: string
}

// ---------------------------------------------------------------------------------------------- checks

const isString = (v: unknown): boolean => typeof v === 'string'
const isCount = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v > 0
const isStringList = (v: unknown): boolean => Array.isArray(v) && v.every(isString)

function isObjectList(v: unknown, required: string[], optional: string[]): boolean {
  if (!Array.isArray(v)) return false
  return v.every(item => {
    if (typeof item !== 'object' || item === null) return false
    const keys = Object.keys(item)
    const values = item as Record<string, unknown>
    return required.every(k => isString(values[k])) && keys.every(k => [...required, ...optional].includes(k) && isString(values[k]))
  })
}

/** Every field a rule may carry, and the check its value must pass. */
const FIELDS: Record<keyof RuleSpec, { ok: (v: unknown) => boolean; expects: string }> = {
  description: { ok: isString, expects: 'a string' },
  match_command: { ok: isString, expects: 'a regex string' },
  strip_ansi: { ok: v => typeof v === 'boolean', expects: 'true or false' },
  replace: { ok: v => isObjectList(v, ['pattern', 'replacement'], []), expects: 'a list of { pattern, replacement }' },
  match_output: { ok: v => isObjectList(v, ['pattern', 'message'], ['unless']), expects: 'a list of { pattern, message, unless? }' },
  strip_lines_matching: { ok: isStringList, expects: 'a list of regex strings' },
  keep_lines_matching: { ok: isStringList, expects: 'a list of regex strings' },
  truncate_lines_at: { ok: isCount, expects: 'a whole number above 0' },
  head_lines: { ok: isCount, expects: 'a whole number above 0' },
  tail_lines: { ok: isCount, expects: 'a whole number above 0' },
  max_lines: { ok: isCount, expects: 'a whole number above 0' },
  on_empty: { ok: isString, expects: 'a string' },
}

/** What is wrong with one rule's fields, or an empty list. */
function specErrors(spec: Record<string, unknown>): string[] {
  const errors = Object.entries(spec).map(([key, value]) => {
    const field = FIELDS[key as keyof RuleSpec] as (typeof FIELDS)[keyof RuleSpec] | undefined
    if (field === undefined) return `unknown field ${key}`
    return field.ok(value) ? '' : `${key} expects ${field.expects}`
  })
  if (spec.match_command === undefined) errors.push('match_command is missing')
  if (spec.strip_lines_matching !== undefined && spec.keep_lines_matching !== undefined) errors.push('strip_lines_matching and keep_lines_matching exclude each other')
  return errors.filter(e => e !== '')
}

/** A regex from a rule; a leading `(?i)` turns on case-insensitive matching. */
export function regexOf(pattern: string, global = false): RegExp {
  const insensitive = pattern.startsWith('(?i)')
  return new RegExp(insensitive ? pattern.slice(4) : pattern, `${insensitive ? 'i' : ''}${global ? 'g' : ''}`)
}

/** Compiles a checked spec; a pattern that does not compile throws with its field. */
function compiled(name: string, source: RuleSource, spec: RuleSpec): Rule {
  const lines = spec.keep_lines_matching ?? spec.strip_lines_matching
  return {
    name,
    source,
    match: regexOf(spec.match_command),
    stripAnsi: spec.strip_ansi === true,
    replace: (spec.replace ?? []).map(r => ({ pattern: regexOf(r.pattern, true), replacement: r.replacement })),
    matchOutput: (spec.match_output ?? []).map(m => ({ pattern: regexOf(m.pattern), message: m.message, unless: m.unless === undefined ? undefined : regexOf(m.unless) })),
    lines: lines === undefined ? undefined : { keep: spec.keep_lines_matching !== undefined, patterns: lines.map(p => regexOf(p)) },
    truncateAt: spec.truncate_lines_at,
    head: spec.head_lines,
    tail: spec.tail_lines,
    max: spec.max_lines,
    onEmpty: spec.on_empty,
  }
}

/** One named rule compiled, or the errors that keep it out. */
export function ruleOf(name: string, source: RuleSource, spec: unknown): { rule?: Rule; errors: string[] } {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return { errors: [`${name}: expects an object`] }
  const errors = specErrors(spec as Record<string, unknown>)
  if (errors.length > 0) return { errors: errors.map(e => `${name}: ${e}`) }
  try {
    return { rule: compiled(name, source, spec as RuleSpec), errors: [] }
  } catch (err) {
    return { errors: [`${name}: ${err instanceof Error ? err.message : String(err)}`] }
  }
}

/** Every rule of a `filters.json` text: `{ "filters": { "<name>": { ... } } }`, and what kept any out. */
export function rulesOf(text: string, source: RuleSource): { rules: Rule[]; errors: string[] } {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch (err) {
    return { rules: [], errors: [`not valid JSON: ${err instanceof Error ? err.message : String(err)}`] }
  }
  const filters = (doc as { filters?: unknown } | null)?.filters
  if (typeof filters !== 'object' || filters === null || Array.isArray(filters)) return { rules: [], errors: ['expects { "filters": { "<name>": { ... } } }'] }
  const results = Object.entries(filters).map(([name, spec]) => ruleOf(name, source, spec))
  return { rules: results.flatMap(r => (r.rule === undefined ? [] : [r.rule])), errors: results.flatMap(r => r.errors) }
}

/** The first rule whose pattern matches the command's words. */
export function ruleFor(rules: readonly Rule[], words: string[]): Rule | undefined {
  const line = words.join(' ')
  return rules.find(r => r.match.test(line))
}

// ----------------------------------------------------------------------------------------------- steps

/** The message of the first `match_output` entry the output matches and its `unless` does not. */
function shortCircuit(rule: Rule, text: string): string | undefined {
  return rule.matchOutput.find(m => m.pattern.test(text) && !(m.unless?.test(text) ?? false))?.message
}

function selected(rule: Rule, lines: string[]): string[] {
  const l = rule.lines
  if (l === undefined) return lines
  return lines.filter(line => l.patterns.some(p => p.test(line)) === l.keep)
}

/** Whether `head` and `tail` leave lines out, and the first `head` and last `tail` lines with a count between. */
function headTail(head: number | undefined, tail: number | undefined, lines: string[]): string[] | undefined {
  const h = head ?? 0
  const t = tail ?? 0
  if ((head === undefined && tail === undefined) || lines.length <= h + t) return undefined
  return [...lines.slice(0, h), `… ${lines.length - h - t} lines left out`, ...lines.slice(lines.length - t)]
}

/** The line steps: cut long lines, keep the head and the tail, then cap the count. */
function cut(rule: Rule, lines: string[]): { lines: string[]; elided: boolean } {
  const at = rule.truncateAt
  const short = at === undefined ? lines : lines.map(l => cutLine(l, at))
  const ends = headTail(rule.head, rule.tail, short)
  const kept = ends ?? short
  const max = rule.max
  const over = max !== undefined && kept.length > max
  const capped = over ? [...kept.slice(0, max), `… +${kept.length - max} more lines`] : kept
  return { lines: capped, elided: over || ends !== undefined || short.some((l, i) => l !== lines[i]) }
}

/** Runs a rule over a command's output. */
export function applyRule(rule: Rule, text: string): FilterResult {
  const raw = text.replace(/\n+$/, '').split('\n')
  const clean = rule.stripAnsi ? raw.map(stripAnsi) : raw
  const lines = clean.map(line => rule.replace.reduce((l, r) => l.replace(r.pattern, r.replacement), line))
  const message = shortCircuit(rule, lines.join('\n'))
  if (message !== undefined) return { text: message, elided: true }
  const c = cut(rule, selected(rule, lines))
  const out = c.lines.join('\n')
  return { text: out.trim() === '' && rule.onEmpty !== undefined ? rule.onEmpty : out, elided: c.elided }
}
