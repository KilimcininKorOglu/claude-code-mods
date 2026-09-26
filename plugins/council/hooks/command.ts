/** The argument of /council and the lines it prints. */
import { parseMembers } from './members.ts'

export const ENABLED_KEY = 'enabled'
export const MEMBERS_KEY = 'members'

export type Command =
  | { kind: 'status' }
  | { kind: 'set'; enabled: boolean }
  | { kind: 'members' }
  | { kind: 'setMembers'; members: string[] }
  | { kind: 'resetMembers' }
  | { kind: 'ask'; question: string }
  | { kind: 'error'; text: string }

function membersCommand(rest: readonly string[]): Command {
  if (rest.length === 0) return { kind: 'members' }
  if (rest.length === 1 && rest[0] === 'reset') return { kind: 'resetMembers' }
  const parsed = parseMembers(rest)
  return 'error' in parsed ? { kind: 'error', text: parsed.error } : { kind: 'setMembers', members: parsed.members }
}

/** `on`, `off`, `status` and `members ...` are commands; any other text is a question for the council. */
export function parseCommand(args: string): Command {
  const text = args.trim()
  if (text === '' || text === 'status') return { kind: 'status' }
  if (text === 'on' || text === 'off') return { kind: 'set', enabled: text === 'on' }
  const [first, ...rest] = text.split(/\s+/)
  return first === 'members' ? membersCommand(rest) : { kind: 'ask', question: text }
}

export function changeText(enabled: boolean): string {
  return enabled
    ? 'on: the model can call the council tool now; the system prompt note that says when comes at /clear or the next session'
    : 'off: a call answers that the council is off; the note leaves at /clear or the next session, the tool at the next session; /council <question> still runs'
}

export function membersText(labels: readonly string[]): string {
  return `members: ${labels.join(', ')}`
}

export function convenedText(count: number): string {
  return `convened: ${count} members; the verdict comes as a message when they have answered`
}

export const OFF_DENY = 'the council is off; the user can turn it on with /council on'
