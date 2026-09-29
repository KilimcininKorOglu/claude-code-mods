export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]
export type Finding = { file: string; line: number; severity: Severity; description: string; suggestedFix?: string }

export type Step = 'scanner' | 'planner' | 'critic'
export type StepStatus = 'done' | 'timed-out' | 'failed' | 'skipped'
export type StepResult = { step: Step; status: StepStatus; answer: string; reason?: string }
export type CollabVerdict = 'approve' | 'revise' | 'reject' | 'no-verdict'

export const FOUND_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string', description: 'Path of the file, as read' },
    line: { type: 'integer', minimum: 1, description: 'Line the finding is on' },
    severity: { type: 'string', enum: [...SEVERITIES] },
    description: { type: 'string', description: 'The trigger and what breaks' },
    suggestedFix: { type: 'string' },
  },
  required: ['file', 'line', 'severity', 'description'],
} as const

export const COLLAB_SCHEMA = {
  type: 'object',
  properties: { paths: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Files or directories to examine' } },
  required: ['paths'],
} as const

type Raw = { file?: unknown; line?: unknown; severity?: unknown; description?: unknown; suggestedFix?: unknown }

/** A finding from the found tool's input, or why it is refused. */
export function findingOf(e: Raw): Finding | string {
  const broken = FINDING_CHECKS.find(([ok]) => !ok(e))
  if (broken !== undefined) return broken[1]
  const f: Finding = { file: e.file as string, line: e.line as number, severity: e.severity as Severity, description: e.description as string }
  return typeof e.suggestedFix === 'string' ? { ...f, suggestedFix: e.suggestedFix } : f
}

const text = (v: unknown) => typeof v === 'string' && v.trim() !== ''

const FINDING_CHECKS: [(e: Raw) => boolean, string][] = [
  [e => text(e.file), 'file must be a non-empty string'],
  [e => Number.isInteger(e.line) && (e.line as number) >= 1, 'line must be a whole number from 1'],
  [e => SEVERITIES.includes(e.severity as Severity), `severity must be one of ${SEVERITIES.join(', ')}`],
  [e => text(e.description), 'description must be a non-empty string'],
  [e => e.suggestedFix === undefined || typeof e.suggestedFix === 'string', 'suggestedFix must be a string'],
]

/**
 * A subagent's hand-back as the main loop receives it: a peer prompt `<agent-message from="<id>">`, the
 * engine's frame, then the report indented by two spaces after `The report follows:` (measured on 2.1.284).
 */
export function handBackOf(text: string): { from: string; report: string } | undefined {
  const m = /^\s*<agent-message from="([^"]+)">/.exec(text)
  if (m === null) return undefined
  const at = text.indexOf('The report follows:')
  const body = at < 0 ? text.slice(m[0].length) : text.slice(at + 'The report follows:'.length)
  const report = body.replace(/<\/agent-message>\s*$/, '').split('\n').map(l => l.replace(/^ {2}/, '')).join('\n').trim()
  return { from: m[1], report }
}

/** The `verdict:` line of the critic's answer. */
export function verdictOf(answer: string): CollabVerdict {
  const m = /^[\s*`#>-]*verdict[*`]*\s*:[*`\s]*(approve|revise|reject)\b/im.exec(answer)
  return m === null ? 'no-verdict' : (m[1].toLowerCase() as CollabVerdict)
}

export function findingLine(f: Finding): string {
  const fix = f.suggestedFix === undefined ? '' : ` Fix: ${f.suggestedFix}`
  return `- [${f.severity}] ${f.file}:${f.line}: ${f.description}${fix}`
}

function findingsBlock(findings: readonly Finding[]): string {
  return findings.length === 0 ? '(none reported)' : findings.map(findingLine).join('\n')
}

export const SCANNER_PROMPT = [
  'You are the bughunt scanner. You are read-only: you read files and report bugs, you never edit.',
  'Apply the bughunt skill in its collab scanner mode: every finding carries a file:line you read, a named trigger and a consequence; style is not a bug.',
  'Report each finding at once with the mcp__bughunt__found tool, then answer with a short markdown report.',
].join('\n')

export const PLANNER_PROMPT = [
  'You are the bughunt planner. You are read-only.',
  'You receive the scanner\'s findings. Read the code they point at and write a fix plan: one step per root cause, ordered by severity, each naming the files and the smallest change.',
  'Mark a finding you could not confirm from the code as unconfirmed instead of planning a fix for it.',
].join('\n')

export const CRITIC_PROMPT = [
  'You are the bughunt critic. You are read-only.',
  'You receive the findings and the fix plan. Check each against the code: is the finding real, does the plan fix the root cause, does it break a caller?',
  'Begin your answer with exactly one line: "verdict: approve", "verdict: revise" or "verdict: reject". Then give the reasons.',
].join('\n')

export function scannerTask(paths: readonly string[]): string {
  return `Scan these paths for bugs:\n${paths.map(p => `- ${p}`).join('\n')}`
}

export function plannerTask(paths: readonly string[], findings: readonly Finding[], report: string): string {
  return [`Paths: ${paths.join(', ')}`, '', 'Findings:', findingsBlock(findings), '', 'Scanner report:', report || '(none)'].join('\n')
}

export function criticTask(paths: readonly string[], findings: readonly Finding[], plan: string): string {
  return [`Paths: ${paths.join(', ')}`, '', 'Findings:', findingsBlock(findings), '', 'Fix plan:', plan || '(none)'].join('\n')
}

function stepLine(r: StepResult): string {
  return `- ${r.step}: ${r.status}${r.reason === undefined ? '' : ` (${r.reason})`}`
}

/** The collab report the model reads. */
export function reportText(paths: readonly string[], findings: readonly Finding[], steps: readonly StepResult[], verdict: CollabVerdict): string {
  const answer = (s: Step) => steps.find(r => r.step === s)?.answer.trim() || '(no answer)'
  return [
    `# bughunt collab report`,
    '',
    `Paths: ${paths.join(', ')}`,
    `Verdict: ${verdict}${verdict === 'no-verdict' ? ' (the critic gave no verdict line; this is not an approval)' : ''}`,
    '',
    '## Steps',
    ...steps.map(stepLine),
    '',
    `## Findings (${findings.length})`,
    findingsBlock(findings),
    '',
    '## Plan',
    answer('planner'),
    '',
    '## Critique',
    answer('critic'),
  ].join('\n')
}
