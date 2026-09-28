/** The council's members: how a typed token names a model, the defaults, and the labels the person reads. */

/** A Claude model asked through the session's own client, or a Gemini model asked through gemini-core. */
export type Member = { kind: 'claude' | 'gemini'; id: string; label: string }

const ALIASES = new Map([
  ['opus', 'claude-opus-5-5'],
  ['sonnet', 'claude-sonnet-5-5'],
  ['fable', 'claude-fable-5-1'],
  ['haiku', 'claude-haiku-4-5-20251001'],
])

const LABELS = new Map([
  ['claude-opus-5-5', 'opus 5.5'],
  ['claude-sonnet-5-5', 'sonnet 5.5'],
  ['claude-sonnet-5', 'sonnet 5'],
  ['claude-fable-5-1', 'fable 5.1'],
  ['claude-haiku-4-5-20251001', 'haiku 4.5'],
])

/**
 * The members of a fresh install. `gemini-3.1-pro-preview` is left out, because a free-tier key has no
 * quota for it: all 34 free keys of a check answered HTTP 429 (measured on 2.1.283).
 */
export const DEFAULT_MEMBERS: readonly string[] = ['opus', 'sonnet', 'fable', 'haiku', 'gemini-3.8-flash']

/** A model id goes into a URL path for Gemini, so only a plain id is taken. */
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{0,79}$/

const GEMINI_PREFIX = /^(?:gemini|gemma)-/

export const MEMBER_HINT = 'use opus, sonnet, fable, haiku, a claude- model id, or a gemini- or gemma- model id'

/** What a typed token names, or undefined when it names no model. */
export function memberOf(token: string): Member | undefined {
  const id = ALIASES.get(token) ?? token
  if (!MODEL_ID.test(id)) return undefined
  const label = LABELS.get(id) ?? id
  if (id.startsWith('claude-')) return { kind: 'claude', id, label }
  return GEMINI_PREFIX.test(id) ? { kind: 'gemini', id, label } : undefined
}

/** The tokens of `/council members <tokens>`, each once, or why they are refused. */
export function parseMembers(tokens: readonly string[]): { members: string[] } | { error: string } {
  if (tokens.length === 0) return { error: `members takes one or more models: ${MEMBER_HINT}` }
  const unknown = tokens.find(t => memberOf(t) === undefined)
  if (unknown !== undefined) return { error: `${unknown} is not a model: ${MEMBER_HINT}` }
  return { members: [...new Set(tokens)] }
}

/** The stored member tokens, or the defaults when the store holds none that name a model. */
export function storedMembers(value: unknown): Member[] {
  const tokens = Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : []
  const members = tokens.map(memberOf).filter((m): m is Member => m !== undefined)
  return members.length > 0 ? members : DEFAULT_MEMBERS.map(memberOf).filter((m): m is Member => m !== undefined)
}

/** A model id without the context-window mark the engine adds (`claude-opus-5-5[1m]`). */
export function bare(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '')
}

/** A model id without its release date (`claude-haiku-4-5-20251001`). */
function undated(model: string): string {
  return bare(model).replace(/-\d{8}$/, '')
}

/** Whether a member is the model the session's main loop runs on, dated id or not. */
export function isSessionModel(member: Member, sessionModel: string | undefined): boolean {
  if (member.kind !== 'claude' || sessionModel === undefined) return false
  return undated(member.id) === undated(sessionModel)
}

/** The label of a model the session runs on, as a member of that model would read. */
export function labelOfModel(model: string): string {
  return LABELS.get(bare(model)) ?? bare(model)
}
