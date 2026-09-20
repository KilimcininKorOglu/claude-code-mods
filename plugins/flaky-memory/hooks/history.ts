/** Each test's recent runs, and whether one of them passed and failed on the same code. */
import type { Outcome } from './parse.ts'

export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_RUNS = 50
const MAX_COMMANDS = 50

export type Run = { at: number; fp: string; ok: boolean }

/**
 * `tests`: the runs of each test. `failedBy`: the tests each command failed at
 * its last failing run, so a later run of the same command that exits 0 counts
 * them as passed even when its output names no passing test.
 */
export type History = { tests: Record<string, Run[]>; failedBy: Record<string, string[]> }

export function emptyHistory(): History {
  return { tests: {}, failedBy: {} }
}

function isRun(v: unknown): v is Run {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.at === 'number' && typeof r.fp === 'string' && typeof r.ok === 'boolean'
}

function isRecordOf(v: unknown, item: (x: unknown) => boolean): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(x => Array.isArray(x) && x.every(item))
}

/** The stored history, or undefined when the value has another shape. */
export function readHistory(value: unknown): History | undefined {
  if (value === undefined) return emptyHistory()
  if (typeof value !== 'object' || value === null) return undefined
  const h = value as Record<string, unknown>
  const ok = isRecordOf(h.tests, isRun) && isRecordOf(h.failedBy, x => typeof x === 'string')
  return ok ? (value as History) : undefined
}

function recent(runs: readonly Run[], now: number): Run[] {
  return runs.filter(r => now - r.at <= WINDOW_MS).slice(-MAX_RUNS)
}

/** Keeps the newest commands only, so the map does not grow without end. */
function trimCommands(failedBy: Record<string, string[]>): Record<string, string[]> {
  const entries = Object.entries(failedBy)
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_COMMANDS)))
}

/** One run of `command` on the tree `fp`: what it printed, and whether it exited 0. */
export type Recorded = { now: number; fp: string; command: string; outcome: Outcome; exitedOk: boolean }

/**
 * The history after one run, older runs than the window dropped. A pass is
 * kept only for a test that has failed in the window, so a suite of thousands
 * of passing tests stores nothing; a flaky test shows once it fails and later
 * passes on the same code.
 */
export function record(h: History, r: Recorded): History {
  const failed = new Set(r.outcome.failed)
  const inferred = r.exitedOk ? (h.failedBy[r.command] ?? []).filter(id => !failed.has(id)) : []
  const tests: Record<string, Run[]> = {}
  for (const [id, runs] of Object.entries(h.tests)) tests[id] = recent(runs, r.now)
  const passed = new Set([...r.outcome.passed, ...inferred].filter(id => tests[id]?.some(run => !run.ok) === true))
  for (const id of passed) tests[id] = [...(tests[id] ?? []), { at: r.now, fp: r.fp, ok: true }]
  for (const id of failed) tests[id] = [...(tests[id] ?? []), { at: r.now, fp: r.fp, ok: false }]
  const failedBy = { ...h.failedBy }
  delete failedBy[r.command]
  if (failed.size > 0) failedBy[r.command] = [...failed]
  const kept = Object.fromEntries(Object.entries(tests).filter(([, runs]) => runs.length > 0))
  return { tests: kept, failedBy: trimCommands(failedBy) }
}

/** A test's runs in the window, and on how many trees it both passed and failed. */
export type Verdict = { runs: number; failures: number; sameCode: number }

export function verdictOf(runs: readonly Run[], now: number): Verdict {
  const inWindow = recent(runs, now)
  const byTree = new Map<string, Set<boolean>>()
  for (const r of inWindow) byTree.set(r.fp, (byTree.get(r.fp) ?? new Set()).add(r.ok))
  const sameCode = [...byTree.values()].filter(s => s.size === 2).length
  return { runs: inWindow.length, failures: inWindow.filter(r => !r.ok).length, sameCode }
}

function times(n: number): string {
  return n === 1 ? 'once' : `${n} times`
}

/** The finding both channels carry: what the runs of one test say, without any instruction. */
function findingText(id: string, v: Verdict): string {
  return `${id} failed ${v.failures} of ${v.runs} runs in the last 7 days and both passed and failed on the same code ${times(v.sameCode)}`
}

/** What the model reads after a run in which a flaky test failed. */
export function noteText(id: string, v: Verdict): string {
  return `flaky-memory: ${findingText(id, v)}. It may be flaky rather than broken by this change: run it again before you change code for it.`
}

/** The transcript line: the finding alone, without the instruction the model reads. The engine adds the mod name. */
export function logText(id: string, v: Verdict): string {
  return findingText(id, v)
}

/** The finding as sidebar lines. */
export function sidebarLines(id: string, v: Verdict): { text: string; kind: 'error' }[] {
  return [{ text: findingText(id, v), kind: 'error' }]
}

/** The transcript line of a finding the window no longer holds. */
export function doneLog(id: string): string {
  return `${id} is no longer flaky: nothing in the last 7 days has it passing and failing on the same code`
}

export function doneLines(id: string): { text: string; kind: 'ok' }[] {
  return [{ text: doneLog(id), kind: 'ok' }]
}

/** Whether the test still both passed and failed on one tree inside the window. */
export function isFlaky(h: History, id: string, now: number): boolean {
  return verdictOf(h.tests[id] ?? [], now).sameCode > 0
}

/** The tests this run failed that have passed and failed on the same code, with their verdicts. */
export function findingsFor(h: History, failed: readonly string[], now: number): { id: string; v: Verdict }[] {
  return failed.flatMap(id => {
    const v = verdictOf(h.tests[id] ?? [], now)
    return v.sameCode > 0 ? [{ id, v }] : []
  })
}

/** A sidebar section key: the test id cut to what the sidebar takes, so one test keeps one key. */
export function sectionKey(id: string): string {
  return id.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'test'
}

/** The /flaky-memory listing: every flaky test of the project, the most failing first. */
export function listText(h: History, now: number): string {
  const rows = Object.entries(h.tests)
    .map(([id, runs]) => ({ id, v: verdictOf(runs, now) }))
    .filter(r => r.v.sameCode > 0)
    .sort((a, b) => b.v.failures / b.v.runs - a.v.failures / a.v.runs)
  if (rows.length === 0) return `no flaky test in the last 7 days (${Object.keys(h.tests).length} tests seen)`
  return rows.map(r => `${r.id} · failed ${r.v.failures}/${r.v.runs} · same code ${times(r.v.sameCode)}`).join('\n')
}
