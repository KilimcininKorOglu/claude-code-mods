import { BUILTIN_RULES } from './builtin-rules.ts'
import { read, type Target } from './command.ts'
import { applyRule, ruleFor, type Rule } from './dsl.ts'
import type { Filter, FilterResult } from './filters/common.ts'
import { GENERIC } from './filters/generic.ts'
import { filterFor } from './filters/index.ts'
import { classify, type Classified } from './rules.ts'

/** What to do with one Bash call: which filter reads its output, and the flags it asks for. */
export type Plan = {
  /** The family a gain record is counted under: `git status`, `cargo test`, or `other`. */
  family: string
  filter: Filter
  args: string[]
  flags: string[]
  target?: Target
  /** The index, in the target's words, of the word the flags follow. */
  nameEnd: number
}

const OTHER = (args: string[] = []): Plan => ({ family: 'other', filter: GENERIC, args, flags: [], nameEnd: -1 })

/**
 * The plan for a command: undefined for one that is left alone (raw, opaque), the generic cleanup for a
 * chain, else the first of: the person's rules, the command's own filter, a built-in rule, the cleanup.
 */
export function planFor(command: string, rules: readonly Rule[] = []): Plan | undefined {
  const reading = read(command)
  if (reading.kind === 'raw' || reading.kind === 'opaque') return undefined
  if (reading.kind === 'mixed') return OTHER()
  return targetPlan(reading.target, rules)
}

/** A plan that runs a data rule; a rule asks for no flags. */
function rulePlan(rule: Rule, target: Target): Plan {
  return { family: `${rule.source} rule ${rule.name}`, filter: { run: input => applyRule(rule, input.text) }, args: target.words.slice(1), flags: [], target, nameEnd: -1 }
}

/** The plan for one command: the person's rule, its table's filter and flags, a built-in rule, or the cleanup. */
function targetPlan(target: Target, rules: readonly Rule[]): Plan {
  const own = ruleFor(rules, target.words)
  if (own !== undefined) return rulePlan(own, target)
  const c = classify(target.words)
  const filter = c === undefined ? undefined : filterFor(c)
  if (c !== undefined && filter !== undefined) return tablePlan(c, filter, target)
  const builtin = ruleFor(BUILTIN_RULES, target.words)
  return builtin === undefined ? { ...OTHER(target.words.slice(1)), target } : rulePlan(builtin, target)
}

/** A plan that runs a table's filter, with the flags it asks for when the command may take them. */
function tablePlan(c: Classified, filter: Filter, target: Target): Plan {
  const flags = target.canAddFlags ? (filter.flags?.(c.args) ?? []) : []
  const family = c.sub === '' ? c.tool : `${c.tool} ${c.sub}`
  return { family, filter, args: c.args, flags, target, nameEnd: c.nameEnd }
}

/** Runs a plan's filter; a filter that throws leaves the output to the generic cleanup. */
export function runFilter(plan: Plan, text: string, exitCode: number, flagged: boolean): FilterResult {
  try {
    return plan.filter.run({ args: flagged ? [...plan.args, ...plan.flags] : plan.args, text, exitCode })
  } catch {
    // A filter that cannot read this output: the cleanup still drops escapes and repeats.
    return GENERIC.run({ args: plan.args, text, exitCode })
  }
}

/** The least a filter must save for its text to replace the output: a share of it, and characters. */
export const MIN_SAVED_SHARE = 0.05
export const MIN_SAVED_CHARS = 40

/**
 * Whether the filtered text replaces the output: only when it saves at least `MIN_SAVED_SHARE` of the
 * output and `MIN_SAVED_CHARS` characters, trailing whitespace left out, because a smaller saving only
 * changes what the model reads and counts a shrink nobody gains from. Flags that changed the command's
 * format always replace it, because then the raw output is a format the model did not ask for.
 */
export function replaces(raw: string, filtered: string, flagged: boolean): boolean {
  const before = raw.trimEnd().length
  const saved = before - filtered.trimEnd().length
  return flagged || (saved >= MIN_SAVED_CHARS && saved >= before * MIN_SAVED_SHARE)
}

/** A failed call's error text split into its exit code and output: `Exit code 3\n...`; else undefined. */
export function failureOf(text: string): { exitCode: number; output: string } | undefined {
  const m = /^Exit code (\d+)\n?/.exec(text)
  return m === null ? undefined : { exitCode: Number(m[1]), output: text.slice(m[0].length) }
}

/** The path of the full output the engine kept when a result was too large, from its model text. */
export function persistedPathOf(text: string): string | undefined {
  return /<persisted-output>[\s\S]*?Full output saved to: (\S+)/.exec(text)?.[1]
}

/** The full output the model would have read: stdout, then stderr on its own line when there is any. */
export function joined(stdout: string, stderr: string): string {
  if (stderr === '') return stdout
  return stdout === '' ? stderr : `${stdout.replace(/\n$/, '')}\n${stderr}`
}
