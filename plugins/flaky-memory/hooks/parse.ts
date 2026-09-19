/** Which Bash commands run tests, and which tests a run's output names as passed or failed. */

/** A command that runs one of the supported test runners, directly or through npm, make or a vendor path. */
const TEST_COMMAND =
  /(^|[\s;&|(/])(go\s+test|pytest|python3?\s+-m\s+pytest|jest|vitest|bun\s+test|cargo\s+(test|nextest)|phpunit|(npm|pnpm|yarn)\s+(run\s+)?test|make\s+test)(\s|$|[;&|)])/

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command)
}

/** The tests one run names, each id prefixed with its runner so two runners never share an id. */
export type Outcome = { passed: string[]; failed: string[] }

type LineRule = { runner: string; pattern: RegExp; ok: boolean }

/** A trailing duration that jest, vitest and bun print after a test name. */
const DURATION = /\s*(\[[\d.]+\s?m?s\]|\(\d+(\.\d+)?\s?m?s\)|\d+(\.\d+)?m?s)\s*$/

const RULES: readonly LineRule[] = [
  { runner: 'go', pattern: /^\s*--- FAIL: (\S+)/, ok: false },
  { runner: 'go', pattern: /^\s*--- PASS: (\S+)/, ok: true },
  { runner: 'pytest', pattern: /^(?:FAILED|ERROR) (\S+::\S+)/, ok: false },
  { runner: 'pytest', pattern: /^(\S+::\S+) PASSED\b/, ok: true },
  { runner: 'pytest', pattern: /^PASSED (\S+::\S+)/, ok: true },
  { runner: 'cargo', pattern: /^test (\S+) \.\.\. FAILED$/, ok: false },
  { runner: 'cargo', pattern: /^test (\S+) \.\.\. ok$/, ok: true },
  { runner: 'phpunit', pattern: /^\d+\) ([\w\\]+::\w+)/, ok: false },
  { runner: 'js', pattern: /^\s*(?:✕|×|✗|\(fail\))\s+(.+)$/, ok: false },
  { runner: 'js', pattern: /^\s*(?:✓|√|\(pass\))\s+(.+)$/, ok: true },
]

/** A vitest file summary (`✓ src/a.test.ts (3 tests) 5ms`) names a file, not a test. */
const FILE_SUMMARY = /\(\d+ tests?(?: \|[^)]*)?\)/

function testId(rule: LineRule, name: string): string | undefined {
  if (rule.runner !== 'js') return `${rule.runner}:${name}`
  if (FILE_SUMMARY.test(name)) return undefined
  const bare = name.replace(DURATION, '').trim()
  return bare === '' ? undefined : `js:${bare}`
}

function ruleFor(line: string): { rule: LineRule; name: string } | undefined {
  for (const rule of RULES) {
    const m = rule.pattern.exec(line)
    if (m?.[1] !== undefined) return { rule, name: m[1] }
  }
  return undefined
}

/** Reads the passed and failed tests a run prints; a test named both ways counts as failed. */
export function parseOutput(text: string): Outcome {
  const passed = new Set<string>()
  const failed = new Set<string>()
  for (const line of text.split('\n')) {
    const hit = ruleFor(line)
    if (hit === undefined) continue
    const id = testId(hit.rule, hit.name)
    if (id !== undefined) (hit.rule.ok ? passed : failed).add(id)
  }
  for (const id of failed) passed.delete(id)
  return { passed: [...passed], failed: [...failed] }
}
