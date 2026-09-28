/** The self-command tool: its name, what the model reads, the input it takes and the texts it answers. Pure code. */

export const TOOL_NAME = 'run'

/** The commands that clear, end or swap the session; the model may not run them. */
export const BLOCKED: ReadonlySet<string> = new Set(['clear', 'exit', 'quit', 'logout', 'login', 'resume', 'rewind'])

export const TOOL_DESCRIPTION = `Runs a slash command in this session as if the person typed it, such as /reload-plugins or /sage-memory triage.
A command cannot run while your turn goes on: it is queued, runs once your turn ends, and its output comes back to you as the next prompt. So call this as the last step of a turn, then end the turn.
The commands that clear, end or swap the session (${[...BLOCKED].map(c => `/${c}`).join(', ')}) are refused.`

export const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The command name without its slash, such as reload-plugins or sage-memory' },
    args: { type: 'string', description: 'Everything after the name, as the person would type it; leave it out for none' },
  },
  required: ['command'],
  additionalProperties: false,
}

export type Request = { command: string; args: string }

/**
 * The command a tool call asks for, or why it is refused. A leading slash is dropped, and a name written
 * with its arguments (`sage-memory triage`) is split at the first space when `args` is left out.
 */
export function requestOf(input: Record<string, unknown>, known: readonly string[]): Request | string {
  const [name = '', ...rest] = (typeof input.command === 'string' ? input.command : '').trim().replace(/^\//, '').split(/\s+/)
  if (name === '') return 'command is required: the command name without its slash'
  if (BLOCKED.has(name)) return `/${name} clears, ends or swaps the session, so it is not run for the model`
  if (!known.includes(name)) return `/${name} is not a command of this session`
  const args = typeof input.args === 'string' ? input.args.trim() : rest.join(' ')
  return { command: name, args }
}

const shown = (r: Request): string => (r.args === '' ? `/${r.command}` : `/${r.command} ${r.args}`)

export const queuedText = (r: Request): string =>
  `queued: ${shown(r)} runs once this turn ends, and its output comes back as the next prompt. It has not run yet, so do not report its outcome before that output arrives.`

/**
 * What the model reads once the command ran: its output, or why it did not run. It never starts with the
 * command's slash, because the engine refuses a plugin prompt that does.
 */
export function reportText(r: Request, outcome: { text?: string } | { error: string }): string {
  if ('error' in outcome) return `The command ${shown(r)}, which you ran with the self-command tool, did not run: ${outcome.error}`
  const output = outcome.text?.trim() ?? ''
  return `The command ${shown(r)}, which you ran with the self-command tool, ran. Its output:\n${output === '' ? '(no text)' : output}`
}
