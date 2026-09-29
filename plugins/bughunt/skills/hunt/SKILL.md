---
name: hunt
description: >
  Finds real bugs in source code and, inside a /bughunt round, proves, fixes and
  verifies one of them. Invoke it at the start of every /bughunt round, and when
  the user asks to hunt for bugs, audit files for defects, check for leaks,
  races or unhandled errors, or wants a clean pass before a release.
license: MIT
metadata:
  author: KilimcininKorOglu
---

# Bug hunt

The bughunt mod holds each `/bughunt` round to this skill. While a round runs, the mod refuses Edit, Write and NotebookEdit until this skill was opened in the round and the `mcp__bughunt__proof` tool recorded a failing proof. It refuses every subagent spawn. A refusal names the rule; satisfy it and try again.

## Rules

- Every finding carries a `file:line` you actually read.
- A search hit is a candidate, not a finding. A candidate becomes a finding only when you can name the input that triggers it and what breaks.
- Do not scan `node_modules`, `vendor`, build output (`dist`, `build`, `target`, `out`), lockfiles, minified or generated files, snapshots or `.git`.
- Style is not a bug.
- Do not inflate severity. Between two levels, pick the lower one.

## Confirm each candidate

Answer three questions from the code, not from memory:

1. Can the triggering value come from a caller, a user or the environment?
2. Is the path reachable from a real entry point?
3. Is it already handled nearby (a guard, a caller's check, a wrapper)?

Write down what the correct behaviour rests on: a contract, a caller's need, a test, a document.

## Severity

- **critical:** security breach, data loss, crash.
- **high:** wrong result, race, memory leak.
- **medium:** error-handling gap, type unsafety at a boundary.
- **low:** a small defect with a real consequence.

Low reachability lowers the level; a wide blast radius raises it.

## Patterns worth a candidate

| Pattern | Confirm by reading |
|---|---|
| Promise without `await` or `.catch` | Nothing awaits or catches it on any path |
| Listener, timer or subscription never removed | The owner is disposed and the callback still runs |
| `AbortSignal` accepted but not honoured | Work continues after abort |
| Global or sticky regex reused (`lastIndex`) | Two calls share the object |
| Check-then-act on shared state or files | Another actor can change it between the two steps |
| Off-by-one, empty input, boundary values | The boundary value reaches the code |
| Swallowed error (empty catch, fallback value) | The caller cannot tell failure from success |
| Unbounded growth (map, queue, retry, recursion) | Input or time grows it without a cap |
| Hardcoded secret | Not a test fixture, not an example value |
| Injection (SQL, shell, path, HTML) | Untrusted text reaches the sink unescaped |
| `any`, casts or unchecked JSON at a trust boundary | The unchecked shape is used |
| Resource not closed on the error path | The error path is reachable |
| Integer overflow, float equality, unit mismatch | The values reach the range |
| Time zone, locale or encoding assumption | A real input differs |

## Mode 1: scan (default outside a round)

Report only. Do not edit files. Deliver findings under severity headings, each as `[KIND] file:line` and a short explanation with the trigger and the consequence, then a summary table. When more than 30% of candidates turned out to be noise, add a false-positive rate line.

## Mode 2: proof-driven round (`/bughunt`)

A round is an investigation budget, not a quota. Do not invent a bug. One round handles at most one proven root cause.

1. **Survey and separate.** Record the starting revision (`git rev-parse HEAD`), the dirty paths, the platform and the scope the mod gave. Keep other people's uncommitted changes untouched. Read the previous rounds' fingerprints and do not count the same root cause twice.
2. **Prove the unfixed bug.** Work in the round's proof directory, which the mod names. Write a proof that calls the real production code path, asserts the correct behaviour, prints a line starting with `FAIL` with the reason, and exits non-zero. Also run an unaffected control case. Then call `mcp__bughunt__proof` with `phase: "before"` and the proof command's `argv`. The mod runs it and records the FAIL only when the exit code is non-zero and a `FAIL` line is present. A setup error, an import error or a timeout is not a proof. When no proof can be built, do not change production code.
3. **Surgical fix.** Change the least code that removes the root cause. No retries, broad catches, loosened assertions or test-only branches.
4. **Verify.** Make the same proof print a `PASS` line and exit 0 with the same assertions, and call `mcp__bughunt__proof` with `phase: "after"` and the same `argv`. Move a permanent regression test into the project's test suite. Run the focused tests, the type and build checks, and the full test command when it is affordable. Delete only the round's own proof directory after the report is written.
5. **Report and stop.** Begin the answer with exactly one of these lines:
   - `fixed-and-verified`
   - `fixed-verification-incomplete`
   - `no-proven-bug`
   - `blocked`

   Then give the root cause, the FAIL output, the fix, the PASS output, the skills loaded and a one-line root-cause fingerprint as `fingerprint: <file>:<symbol>: <cause>`. End the round there. The mod starts the next round itself; do not ask for confirmation and do not take a second issue in the same round.

## Mode 3: collab scanner

When the mod spawns you as `bughunt:scanner`, you are read-only. Report each finding at once with `mcp__bughunt__found` (`file`, `line`, `severity`, `description`, optional `suggestedFix`), then answer with a short markdown report.

## Out of scope

Design and style review, dependency audits and writing tests outside a round belong to other skills.
