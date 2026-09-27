import {
  ANCHOR_TYPES,
  AUDIENCE_KEYS,
  CONTEXT_POLICIES,
  KINDS,
  PERSISTENCES,
  SCOPES,
  SOURCE_TYPES,
  STRUCTURAL_KINDS,
  type Anchor,
  type Audience,
  type Kind,
  type RememberInput,
  type Scope,
  type Source,
} from '../hooks/shared/model.ts'
import { collapseSpace, tokenize } from '../hooks/shared/text.ts'
import { refused } from './errors.ts'

/**
 * The rules a memory is written under: what is refused, what is capped, and when two texts are
 * the same memory. Pure code, ported from SAGE's store helpers.
 */

export const MAX_TEXT_CHARS = 20_000
export const MIN_TEXT_CHARS = 4
export const MAX_ITEMS = 128
const MAX_VALUE_CHARS = 256

/**
 * Provider credential shapes and `key: value` secrets. A match refuses the write; nothing is
 * masked, so no half-redacted secret is ever stored.
 */
const SECRET = new RegExp(
  [
    '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    '\\b(?:api[_-]?key|secret|token|password)\\b\\s*[:=]\\s*[\'"]?[A-Za-z0-9_\\-./+=]{16,}',
    '\\b[A-Za-z0-9_]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\b',
    '\\b(?:sk-(?:ant-)?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{16,}\\b',
    '\\bAKIA[0-9A-Z]{16}\\b',
    '\\bAIza[0-9A-Za-z_-]{35}\\b',
    '\\bhf_[A-Za-z0-9]{20,}\\b',
    '\\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\\b',
    '\\bnpm_[A-Za-z0-9]{36,}\\b',
    '\\b[MNO][A-Za-z\\d]{23,}\\.[A-Za-z\\d_-]{6,}\\.[A-Za-z\\d_-]{27,}\\b',
  ].join('|'),
  'i',
)

function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach(item => stringsOf(item, out))
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(item => stringsOf(item, out))
  return out
}

/** Refuses an input any string of which looks like a secret or a credential. */
export function rejectSecrets(value: unknown): void {
  if (stringsOf(value).some(text => SECRET.test(text))) {
    throw refused('the input looks like it holds a secret or a credential, so nothing was stored')
  }
}

/**
 * Progress chatter that does not belong in long-term memory. A leading WIP/TODO word is chatter
 * only as a marker ("TODO implement retries"), not as the subject ("Todo list items sync with the
 * board").
 */
const EPHEMERAL: readonly RegExp[] = [
  /^(wip|todo|fixme|hack)\b(?![\s-]*(?:lists?|items?|tools?|boards?|panels?|sync(?:s|ing)?|entr(?:y|ies)|comments?|markers?|tracking|widgets?|views?|state|mode)\b)/i,
  /\b(still working on|looking into|need to (?:fix|check|investigate)|will (?:fix|look|check) (?:this|that|it) later)\b/i,
  /^(debugging|investigating|checking|reading) (the )?(file|code|issue|bug)\b/i,
  /^(fixed|updated|changed) (the )?(bug|issue|test|file)\.?$/i,
]

export function isEphemeral(text: string): boolean {
  return EPHEMERAL.some(pattern => pattern.test(text))
}

export const EPHEMERAL_REFUSAL =
  'the text reads as progress chatter (WIP, TODO, "still working on"), which only the session scope keeps; store a durable fact, decision, convention or root cause, and keep task state in the task list'

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function oneOf<T extends string>(values: readonly T[], value: unknown, name: string): void {
  if (value !== undefined && !values.includes(value as T)) throw refused(`${name} must be one of: ${values.join(', ')}`)
}

/** The collapsed text, refused when it is not a string, too long, empty or too short. */
export function checkedText(text: unknown): string {
  if (typeof text !== 'string') throw refused('text must be a string')
  if (text.length > MAX_TEXT_CHARS) throw refused(`the text is over ${MAX_TEXT_CHARS} characters`)
  const collapsed = collapseSpace(text)
  if (collapsed === '') throw refused('the text is empty')
  if (collapsed.length < MIN_TEXT_CHARS) throw refused(`the text is under ${MIN_TEXT_CHARS} characters, too short for a memory`)
  return collapsed
}

function checkListLengths(lists: Record<string, unknown>): void {
  for (const [name, list] of Object.entries(lists)) {
    if (list === undefined) continue
    if (!Array.isArray(list)) throw refused(`${name} must be an array`)
    if (list.length > MAX_ITEMS) throw refused(`${name} holds more than ${MAX_ITEMS} items`)
  }
}

export function checkTags(tags: unknown): void {
  if (tags === undefined) return
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || tag.length > MAX_VALUE_CHARS)) {
    throw refused(`every tag is a string of at most ${MAX_VALUE_CHARS} characters`)
  }
}

export function checkIds(ids: unknown, name: string): void {
  if (ids === undefined) return
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || id.trim() === '')) throw refused(`${name} must be an array of memory ids`)
}

/** A score is a finite number; the store keeps it clamped to 0..1. */
export function checkScore(value: unknown, name: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) throw refused(`${name} must be a number from 0 to 1`)
}

const AGENT_ROLE = /^[a-z0-9][a-z0-9._-]{0,95}$/i

function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function checkPathAnchor(anchor: Anchor): void {
  if (!filled(anchor.path)) throw refused(`a ${anchor.type} anchor needs a path`)
  if (anchor.type === 'symbol' && !filled(anchor.symbol)) throw refused('a symbol anchor needs a symbol')
}

/** What each anchor type needs besides its type: a command, a role, or a path. */
const TARGET_CHECKS: Partial<Record<Anchor['type'], (anchor: Anchor) => void>> = {
  command: anchor => {
    if (!filled(anchor.command)) throw refused('a command anchor needs a command')
  },
  agent: anchor => {
    if (typeof anchor.role !== 'string' || !AGENT_ROLE.test(anchor.role.trim())) throw refused("an agent anchor needs a role of 1 to 96 letters, digits, '.', '_' or '-'")
  },
}

function checkAnchorTarget(anchor: Anchor): void {
  const check = TARGET_CHECKS[anchor.type]
  if (check) check(anchor)
  else checkPathAnchor(anchor)
}

function checkAnchorLengths(anchor: Anchor): void {
  const long = (anchor.path?.length ?? 0) > 4096 || (anchor.symbol?.length ?? 0) > 1024 || (anchor.command?.length ?? 0) > 8192
  if (long) throw refused('an anchor path is at most 4096 characters, a symbol 1024 and a command 8192')
}

export function checkAnchors(anchors: unknown): void {
  if (anchors === undefined) return
  if (!Array.isArray(anchors)) throw refused('anchors must be an array')
  for (const anchor of anchors as Anchor[]) {
    if (anchor === null || typeof anchor !== 'object') throw refused('every anchor is an object')
    oneOf(ANCHOR_TYPES, anchor.type ?? '', 'anchor type')
    checkAnchorTarget(anchor)
    checkAnchorLengths(anchor)
  }
}

function checkSources(sources: unknown): void {
  for (const source of (sources ?? []) as Source[]) {
    if (source === null || typeof source !== 'object') throw refused('every source is an object')
    oneOf(SOURCE_TYPES, source.type ?? '', 'source type')
  }
}

function normalizedValues(values: unknown, key: string): string[] {
  if (!Array.isArray(values) || values.some(item => typeof item !== 'string')) throw refused(`audience.${key} must be an array of strings`)
  if (values.length > MAX_ITEMS) throw refused(`audience.${key} holds more than ${MAX_ITEMS} items`)
  const items = [...new Set((values as string[]).map(item => item.normalize('NFKC').trim().toLowerCase()).filter(Boolean))]
  if (items.some(item => item.length > MAX_VALUE_CHARS)) throw refused(`audience values are at most ${MAX_VALUE_CHARS} characters`)
  return items.sort()
}

/**
 * The audience with lowercased, distinct and sorted values, so one audience has one stored form;
 * undefined when it names nobody (`{}` included).
 */
export function normalizeAudience(value: unknown): Audience | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw refused('audience must be an object')
  const unknown = Object.keys(value).filter(key => !(AUDIENCE_KEYS as readonly string[]).includes(key))
  if (unknown.length > 0) throw refused(`audience takes ${AUDIENCE_KEYS.join(' and ')} only, not ${unknown.join(', ')}`)
  const audience: Audience = {}
  for (const key of AUDIENCE_KEYS) {
    const values = (value as Audience)[key]
    if (values === undefined) continue
    const items = normalizedValues(values, key)
    if (items.length > 0) audience[key] = items
  }
  return Object.keys(audience).length > 0 ? audience : undefined
}

function checkEnums(input: RememberInput): void {
  oneOf(SCOPES, input.scope, 'scope')
  oneOf(KINDS, input.kind, 'kind')
  oneOf(PERSISTENCES, input.persistence, 'persistence')
  oneOf(CONTEXT_POLICIES, input.contextPolicy, 'contextPolicy')
}

function checkShape(input: RememberInput): void {
  checkListLengths({ tags: input.tags, anchors: input.anchors, sources: input.sources, supersedes: input.supersedes, contradicts: input.contradicts })
  checkTags(input.tags)
  checkIds(input.supersedes, 'supersedes')
  checkIds(input.contradicts, 'contradicts')
  for (const name of ['importance', 'confidence', 'freshness'] as const) checkScore(input[name], name)
  if (input.expiresAt !== undefined && (typeof input.expiresAt !== 'string' || !Number.isFinite(Date.parse(input.expiresAt)))) {
    throw refused('expiresAt must be an ISO-8601 time')
  }
}

function checkMeaning(input: RememberInput, text: string): void {
  const scope: Scope = input.scope ?? 'project'
  if (scope === 'session' && !input.ownerSessionId) throw refused('a session memory needs ownerSessionId, the session it belongs to')
  if (input.kind && STRUCTURAL_KINDS.includes(input.kind) && !(input.anchors && input.anchors.length > 0)) {
    throw refused(`a ${input.kind} needs at least one anchor`)
  }
  if (scope !== 'session' && isEphemeral(text)) throw refused(EPHEMERAL_REFUSAL)
}

/** Refuses an input `remember` cannot store; answers its collapsed text. */
export function checkRemember(input: RememberInput): string {
  if (input === null || typeof input !== 'object') throw refused('the input must be an object')
  const text = checkedText(input.text)
  checkEnums(input)
  checkShape(input)
  checkMeaning(input, text)
  normalizeAudience(input.audience)
  checkAnchors(input.anchors)
  checkSources(input.sources)
  return text
}

export type Caps = { confidence: number; importance: number; reasons: string[] }

type QualityInput = { text: string; kind: Kind; anchors: readonly Anchor[]; tags: readonly string[]; scope: Scope }

/**
 * Caps for scores the caller left to their defaults, so unanchored, short or chatty memories rank
 * below anchored, durable ones. A score the caller gave is never capped.
 */
export function assessQuality(input: QualityInput): Caps {
  const caps: Caps = { confidence: 1, importance: 1, reasons: [] }
  const cap = (confidence: number, importance: number, reason: string): void => {
    caps.confidence = Math.min(caps.confidence, confidence)
    caps.importance = Math.min(caps.importance, importance)
    caps.reasons.push(reason)
  }
  const unanchored = input.anchors.length === 0
  if (input.text.length < 12) cap(0.55, 0.55, 'short_text')
  if (tokenize(input.text).length < 3) cap(0.6, 0.6, 'few_tokens')
  if (unanchored) cap(0.75, input.scope === 'session' || input.scope === 'user' ? 1 : 0.7, 'unanchored')
  if (input.tags.length === 0) caps.reasons.push('untagged')
  if (input.kind === 'bug_root_cause' && unanchored) cap(0.65, 0.75, 'root_cause_unanchored')
  if (isEphemeral(input.text)) cap(0.35, 0.35, 'ephemeral_pattern')
  return caps
}

/** Shared terms over the terms of the smaller text (the overlap coefficient). */
export function tokenOverlap(a: string, b: string): number {
  const left = new Set(tokenize(a))
  const right = new Set(tokenize(b))
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const term of left) if (right.has(term)) shared++
  return shared / Math.min(left.size, right.size)
}

const NEAR_DUPLICATE = 0.88
const NEAR_DUPLICATE_ANCHORED = 0.72
const NEAR_DUPLICATE_MIN_TERMS = 5

/** The identity of an anchor for "the same file, symbol, command or agent". */
export function structuralKey(anchor: Anchor): string | undefined {
  if (anchor.type === 'command' && anchor.command) return `command:${anchor.command.normalize('NFKC').trim().toLowerCase()}`
  if (anchor.type === 'agent' && anchor.role) return `agent:${anchor.role.toLowerCase()}`
  const path = anchor.path?.toLowerCase()
  if (anchor.type === 'symbol' && anchor.symbol) return `symbol:${path ?? ''}#${anchor.symbol.trim().toLowerCase()}`
  return path ? `${anchor.type}:${path}` : undefined
}

function shareAnchor(a: readonly Anchor[], b: readonly Anchor[]): boolean {
  const keys = new Set(a.map(structuralKey).filter(key => key !== undefined))
  return b.some(anchor => {
    const key = structuralKey(anchor)
    return key !== undefined && keys.has(key)
  })
}

type Comparable = { text: string; kind: Kind; anchors: readonly Anchor[] }

/**
 * Two memories of one kind are the same memory in other words when their terms overlap by 0.88,
 * or by 0.72 while they share an anchor. Short texts never match.
 */
export function isNearDuplicate(left: Comparable, right: Comparable): boolean {
  if (left.kind !== right.kind) return false
  if (tokenize(left.text).length < NEAR_DUPLICATE_MIN_TERMS || tokenize(right.text).length < NEAR_DUPLICATE_MIN_TERMS) return false
  const overlap = tokenOverlap(left.text, right.text)
  return overlap >= NEAR_DUPLICATE || (overlap >= NEAR_DUPLICATE_ANCHORED && shareAnchor(left.anchors, right.anchors))
}

/** Negation cues; contraction stems count because tokenizing splits "doesn't" into "doesn" and "t". */
const NEGATIONS = new Set([
  'not',
  'never',
  'none',
  'neither',
  'nor',
  'cannot',
  'cant',
  'no_longer',
  'don',
  'doesn',
  'isn',
  'aren',
  'wasn',
  'weren',
  'hasn',
  'haven',
  'didn',
  'couldn',
  'shouldn',
  'wouldn',
])

/**
 * Two near-identical claims of opposite polarity ("is stable" and "is not stable"): both of at
 * least five terms, overlapping by 0.72, and a negation cue among the terms only one of them has.
 * Such a pair is never merged.
 */
export function isPossiblyContradictory(a: string, b: string): boolean {
  const left = new Set(tokenize(a))
  const right = new Set(tokenize(b))
  if (left.size < 5 || right.size < 5) return false
  if (tokenOverlap(a, b) < NEAR_DUPLICATE_ANCHORED) return false
  const onlyLeft = [...left].filter(term => !right.has(term))
  const onlyRight = [...right].filter(term => !left.has(term))
  const negates = (terms: string[]): boolean => terms.some(term => NEGATIONS.has(term))
  if (onlyLeft.length === 0) return negates(onlyRight)
  if (onlyRight.length === 0) return negates(onlyLeft)
  return negates(onlyLeft) !== negates(onlyRight)
}
