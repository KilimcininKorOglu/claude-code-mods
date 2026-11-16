/**
 * The 15 memory tools the model can call: the spec each is declared with, and the daemon route and
 * body each call becomes. The model reads every description and schema on each request, so each says
 * what the tool does, when to call it and the rule the daemon holds it to, and nothing more. Pure
 * code; `register.tsx` makes every call.
 */
import { openingOf, scopeLabel, wordLine, type Line } from './link'
import { ANCHOR_TYPES, kindGuide, KINDS, MAX_NOTE_CHARS, MODEL_KINDS, MODEL_SOURCES, PERSISTENCES, SCOPES, sourceTypeOf, STATUSES, VERIFY_DEPTHS, type Memory, type RememberResult, type SimilarMemory } from './shared/model'

type Schema = Record<string, unknown>

export type ToolDef = { name: string; description: string; inputSchema: Schema; listed: boolean }

/** The prefix the engine gives every tool this plugin declares. */
export const TOOL_PREFIX = 'mcp__sage-memory__'

const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required, additionalProperties: false })
const text = (description: string): Schema => ({ type: 'string', minLength: 1, description })
const number = (minimum: number, maximum: number, description?: string): Schema => ({ type: 'number', minimum, maximum, ...(description === undefined ? {} : { description }) })
const choice = (values: readonly string[], description?: string): Schema => ({ type: 'string', enum: [...values], ...(description === undefined ? {} : { description }) })
const texts = (description: string): Schema => ({ type: 'array', items: { type: 'string' }, description })
const yes = (description: string): Schema => ({ type: 'boolean', description })

const ANCHORS: Schema = {
  type: 'array',
  description:
    'The code the memory is about; it is verified and reminded through these, and a memory without one is never checked against the code. Name the narrowest: symbol for a function or class, file for one file, directory for a module, command for a CLI command, test for a test file, package for a dependency, git for a branch or commit, agent for a subagent type.',
  items: object(
    {
      type: choice(ANCHOR_TYPES),
      path: text('Project-relative path, for file, directory, package, test and git.'),
      symbol: text('For symbol.'),
      command: text('For command.'),
      role: text('Subagent type, for agent.'),
    },
    ['type'],
  ),
}

const AUDIENCE: Schema = object({
  roles: texts('Subagent types that get the memory when they start, such as Explore for a rule only a search agent needs; it then stays out of search and reminders.'),
  modes: texts('Permission modes the memory is for, such as plan for a rule that holds only while planning.'),
})

const PERSISTENCE = choice(
  PERSISTENCES,
  'permanent: an invariant that never changes; long_lived (default): durable knowledge; short_lived: a state that holds now (a running version, a broken service, a workaround) and needs expiresAt.',
)

const EXPIRES_AT = text('ISO date the state a short_lived memory describes is expected to end; the daily cleanup deletes it then. Required with short_lived.')

const KIND = choice(MODEL_KINDS, `The most specific kind. ${kindGuide()}.`)

const SCOPE = choice(
  SCOPES,
  'project (default): this repository; user: holds in every project; session: this session only, deleted after 7 days; file: one file only, needs a file anchor; symbol: one function or class only, needs a symbol anchor.',
)

const SOURCE = choice(MODEL_SOURCES, 'Where the fact comes from: user (the person said it), tool_result, file, test, command, project_instruction (CLAUDE.md or another instruction file). Leave it out for what you concluded yourself.')

const IMPORTANCE = number(0, 1, '0.9 or more: breaking it causes damage; 0.6: default; 0.3: rarely needed.')
const CONFIDENCE = number(0, 1, '1: verified in code or output; 0.8: default; 0.5: inferred.')

const REMEMBER_DESCRIPTION = [
  'Save one durable fact for later sessions: a convention, a decision with its reason, a warning, a bug root cause, a command, or a user preference.',
  `Write it in English, in at most ${MAX_NOTE_CHARS} characters (spaces included; a longer text is refused), with the exact paths, symbols or commands, and anchor it to them; save a larger fact as several memories, each stating one part on its own. file_note, symbol_note and command_note need an anchor.`,
  'Not for task progress (WIP or TODO text is refused), one-off debugging, or what the code already shows. To change a memory, call update instead of saving a near-duplicate.',
  'A fact a stored memory already states, in any words or language or as a case of its rule, is not saved again; new information joins the memory on its subject when both fit, and the answer says which happened.',
].join(' ')

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'remember',
    listed: true,
    description: REMEMBER_DESCRIPTION,
    inputSchema: object(
      {
        text: text(`The fact, in English, at most ${MAX_NOTE_CHARS} characters.`),
        kind: KIND,
        scope: SCOPE,
        tags: texts('1-3 stable tags, without #.'),
        anchors: ANCHORS,
        audience: AUDIENCE,
        importance: IMPORTANCE,
        confidence: CONFIDENCE,
        persistence: PERSISTENCE,
        expiresAt: EXPIRES_AT,
        source: SOURCE,
        supersedes: texts('Ids of older memories this one replaces; they become superseded.'),
        contradicts: texts('Ids this contradicts.'),
      },
      ['text'],
    ),
  },
  {
    name: 'search',
    listed: true,
    description: "Search memories by the words of their text and tags, and by meaning once embeddings are set up. Anchors are not searched: for a file's memories call for_file.",
    inputSchema: object({ query: text('Words, a name, a tag or a question.'), limit: number(1, 100, '20 by default.'), include_stale: yes('Include stale memories.') }, ['query']),
  },
  {
    name: 'search_explain',
    listed: false,
    description: "search, with each result's lexical, vector and fused score. Call it to say why a result matched.",
    inputSchema: object({ query: text('Words, a name, a tag or a question.'), limit: number(1, 100, '20 by default.'), include_stale: yes('Include stale memories.') }, ['query']),
  },
  {
    name: 'for_file',
    listed: true,
    description: 'Every memory on a file: anchored to it or its directory, anchored to its symbols (those in lineStart-lineEnd first), and the ones that mention it.',
    inputSchema: object(
      {
        path: text('Project-relative file path.'),
        lineStart: { type: 'integer', minimum: 1, description: 'First line of the range.' },
        lineEnd: { type: 'integer', minimum: 1, description: 'Last line of the range.' },
        limit: number(1, 200, 'Per group, 50 by default.'),
        showSuperseded: yes('true by default.'),
        showDeleted: yes('false by default.'),
      },
      ['path'],
    ),
  },
  {
    name: 'for_path',
    listed: false,
    description: 'Memories on a path and its parent directories.',
    inputSchema: object({ path: text('Project-relative file or directory path.'), limit: number(1, 50) }, ['path']),
  },
  {
    name: 'graph',
    listed: false,
    description: 'Walk the links between memories, files, symbols and commands.',
    inputSchema: object({ query: text('Memory id, path, symbol or search text.'), depth: number(1, 6), limit: number(1, 500) }, ['query']),
  },
  {
    name: 'gather',
    listed: false,
    description: 'List memories page by page by status, kind or text, for bulk review; the first ten carry their links.',
    inputSchema: object({
      statuses: { type: 'array', items: choice(STATUSES), description: 'All but deleted by default.' },
      kind: choice(KINDS),
      query: text('Substring of the text, any case.'),
      limit: number(1, 500),
      cursor: text("The previous page's nextCursor."),
      includeRelations: yes('true by default.'),
    }),
  },
  {
    name: 'update',
    listed: true,
    description:
      'Change one memory by id: its text, tags, kind, anchors, audience, scores, persistence, contextPolicy, status, links, or scope. When a memory states a value you confirmed is out of date, rewrite its text here; delete one that holds no correct value.',
    inputSchema: object(
      {
        id: text('The memory id.'),
        scope: choice(['project', 'user'], 'Move it to this scope; the id stays. A move to user drops path anchors, so a file_note or symbol_note left without one needs a new kind in the same call.'),
        text: text(`Replacement text, at most ${MAX_NOTE_CHARS} characters.`),
        tags: texts('Replacement tags, without #.'),
        kind: KIND,
        anchors: ANCHORS,
        audience: AUDIENCE,
        importance: IMPORTANCE,
        confidence: CONFIDENCE,
        freshness: number(0, 1),
        persistence: PERSISTENCE,
        expiresAt: EXPIRES_AT,
        contextPolicy: choice(['never', 'auto'], 'never: no automatic reminder; auto: when relevant.'),
        status: choice(STATUSES),
        supersedes: texts('Ids this replaces.'),
        contradicts: texts('Ids this contradicts.'),
        force: yes('Required for status deleted.'),
      },
      ['id'],
    ),
  },
  {
    name: 'delete',
    listed: true,
    description: 'Delete one memory you confirmed is wrong or obsolete when no correct value replaces it. Needs force: true; the reason goes to the audit log, and recover undoes it.',
    inputSchema: object(
      {
        id: text('The memory id.'),
        reason: text('Why, for the audit log.'),
        force: yes('Must be true.'),
        neverRemind: yes('Never show this memory to the model again (privacy ban).'),
      },
      ['id', 'force'],
    ),
  },
  {
    name: 'forget',
    listed: false,
    description: 'Delete every memory of a scope whose text, tag or anchor holds the query, in any case. Needs force: true. Call search first to see the matches; for one memory, call delete.',
    inputSchema: object(
      {
        query: { type: 'string', minLength: 3, description: 'Substring, tag or id; 3 characters or more.' },
        scope: choice(SCOPES, 'project by default.'),
        force: yes('Must be true.'),
      },
      ['query', 'force'],
    ),
  },
  {
    name: 'recover',
    listed: false,
    description: 'Make a deleted memory active again. A superseded id answers with its newest version.',
    inputSchema: object({ id: text('The memory id.'), reason: text('Why, for the audit log.') }, ['id']),
  },
  {
    name: 'backfill_recoverable',
    listed: false,
    description: 'Find deleted memories that can still be restored. It previews them; with apply: true it restores each as a new active version that supersedes the original.',
    inputSchema: object({
      filter: object({
        kinds: { type: 'array', items: choice(KINDS), description: 'Only these kinds.' },
        scopes: { type: 'array', items: choice(SCOPES), description: 'Only these scopes.' },
        updatedAfter: text('ISO-8601 lower bound of the update time.'),
        updatedBefore: text('ISO-8601 upper bound of the update time.'),
        requireProvenance: yes('true by default: skip a record with no source and no anchor.'),
      }),
      apply: yes('false by default (preview).'),
    }),
  },
  {
    name: 'verify',
    listed: false,
    description: "Check memories' anchors: a failed check marks a memory stale, a passing one makes it active again.",
    inputSchema: object({ memory_id: text('One memory; leave it out for all.') }),
  },
  {
    name: 'hygiene',
    listed: false,
    description:
      'Clean the store: check anchors, merge memories with the same text, mark contradictions, open reviews for stale and low-confidence memories, and remove expired session memories. It never deletes a live project or user memory.',
    inputSchema: object({
      verify: yes('true by default.'),
      verifyDepth: choice(VERIFY_DEPTHS, 'existence by default.'),
      staleReviewDays: number(0, 3650),
      lowConfidenceReviewDays: number(0, 3650),
      sessionRetentionDays: number(0, 3650),
      purgeDeletedAfterDays: number(0, 3650, 'Remove the deleted memories older than this for good; leave it out to keep them.'),
    }),
  },
  {
    name: 'candidates',
    listed: false,
    description: "The review queue: list, accept, reject, propose (file a review of a memory) or resolve (apply delete, archive or keep to the review's memory). Prefer propose and resolve to a direct delete.",
    inputSchema: object({
      action: choice(['list', 'accept', 'reject', 'propose', 'resolve'], 'list by default.'),
      candidate_id: text('For accept, reject and resolve.'),
      reason: text('The rejection reason, the review reason (propose) or the resolution note (resolve).'),
      include_resolved: yes('List resolved reviews too.'),
      text: text('For propose.'),
      kind: choice(MODEL_KINDS, 'For propose; the kinds are those of remember.'),
      scope: choice(SCOPES, 'For propose; the scopes are those of remember.'),
      tags: texts('For propose.'),
      anchors: ANCHORS,
      importance: IMPORTANCE,
      confidence: CONFIDENCE,
      suggested_action: choice(['delete', 'archive', 'investigate', 'update'], 'For propose.'),
      memory_id: text('The memory the review is about (propose).'),
      decision: choice(['delete', 'archive', 'keep'], 'For resolve.'),
    }),
  },
]

export type Input = Record<string, unknown>

/** A daemon call a tool makes: the route and its body, without the project and session every body carries. */
export type Call = { path: string; body: Record<string, unknown> }

const MIN_FORGET = 3

function required(input: Input, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} is required`)
  return value
}

function forced(input: Input, what: string): void {
  if (input.force !== true) throw new Error(`force: true is required to ${what}. Pass force: true to authorize; the override is audit-logged.`)
}

/** Only the keys the input gave, so the daemon reads its own defaults for the rest. */
function picked(input: Input, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(key => input[key] !== undefined).map(key => [key, input[key]]))
}

const REMEMBER_KEYS = ['text', 'kind', 'scope', 'tags', 'anchors', 'audience', 'importance', 'confidence', 'persistence', 'expiresAt', 'supersedes', 'contradicts']
const PATCH_KEYS = ['scope', 'text', 'tags', 'kind', 'anchors', 'audience', 'importance', 'confidence', 'freshness', 'persistence', 'expiresAt', 'contextPolicy', 'status', 'supersedes', 'contradicts', 'force']
const HYGIENE_KEYS = ['verify', 'verifyDepth','staleReviewDays', 'lowConfidenceReviewDays', 'sessionRetentionDays', 'purgeDeletedAfterDays']

/** A memory the model writes: a session memory belongs to this session, and each carries its source and this session. */
function rememberCall(input: Input, sessionId: string): Call {
  const memory = picked(input, REMEMBER_KEYS)
  const owner = memory.scope === 'session' ? { ownerSessionId: sessionId } : {}
  return { path: '/memory/remember', body: { input: { ...memory, ...owner, sources: [{ type: sourceTypeOf(input.source), sessionId }] } } }
}

function updateCall(input: Input): Call {
  const patch = picked(input, PATCH_KEYS)
  if (Object.keys(patch).filter(key => key !== 'force').length === 0) throw new Error('at least one field to update is required')
  return { path: '/memory/update', body: { id: required(input, 'id'), patch } }
}

function forgetCall(input: Input): Call {
  const query = required(input, 'query').trim()
  if (query.length < MIN_FORGET) throw new Error(`query must be at least ${MIN_FORGET} characters; a shorter query deletes nearly everything in the scope. Use delete with an id for one memory.`)
  forced(input, 'bulk-delete memories')
  return { path: '/memory/forget', body: { query, scope: input.scope, force: true } }
}

function deleteCall(input: Input): Call {
  forced(input, 'delete a memory')
  return { path: '/memory/delete', body: { id: required(input, 'id'), reason: input.reason, force: true, neverRemind: input.neverRemind === true } }
}

function proposeCall(input: Input): Call {
  const proposal = { ...picked(input, ['text', 'kind', 'scope', 'tags', 'anchors', 'importance', 'confidence']), targetMemoryId: input.memory_id, reviewReason: input.reason, suggestedAction: input.suggested_action }
  required(input, 'text')
  return { path: '/candidates/propose', body: { input: proposal } }
}

function resolveCall(input: Input): Call {
  const decision = required(input, 'decision')
  return { path: '/candidates/resolve', body: { id: required(input, 'candidate_id'), decision, reason: input.reason } }
}

const CANDIDATE_CALLS: Record<string, (input: Input) => Call> = {
  list: input => ({ path: '/candidates/list', body: { includeResolved: input.include_resolved === true } }),
  accept: input => ({ path: '/candidates/accept', body: { id: required(input, 'candidate_id') } }),
  reject: input => ({ path: '/candidates/reject', body: { id: required(input, 'candidate_id'), reason: input.reason ?? 'rejected by the model' } }),
  propose: proposeCall,
  resolve: resolveCall,
}

function candidatesCall(input: Input): Call {
  const action = typeof input.action === 'string' ? input.action : 'list'
  const call = CANDIDATE_CALLS[action]
  if (call === undefined) throw new Error(`unknown action ${action}`)
  return call(input)
}

const statuses = (input: Input): string[] => (input.include_stale === true ? ['active', 'stale'] : ['active'])

const CALLS: Record<string, (input: Input, sessionId: string) => Call> = {
  remember: rememberCall,
  search: input => ({ path: '/memory/search', body: { query: required(input, 'query'), limit: input.limit, includeStale: statuses(input).length > 1 } }),
  search_explain: input => ({ path: '/memory/explain', body: { query: required(input, 'query'), limit: input.limit, includeStale: statuses(input).length > 1 } }),
  for_file: input => ({ path: '/memory/for-file', body: { ...picked(input, ['lineStart', 'lineEnd', 'limit', 'showSuperseded', 'showDeleted']), path: required(input, 'path') } }),
  for_path: input => ({ path: '/memory/for-path', body: { path: required(input, 'path'), limit: input.limit } }),
  graph: input => ({ path: '/memory/graph', body: { query: required(input, 'query'), depth: input.depth, limit: input.limit } }),
  gather: input => ({ path: '/memory/gather', body: picked(input, ['statuses', 'kind', 'query', 'limit', 'cursor', 'includeRelations']) }),
  update: updateCall,
  delete: deleteCall,
  forget: forgetCall,
  recover: input => ({ path: '/memory/recover', body: { id: required(input, 'id'), reason: input.reason } }),
  backfill_recoverable: input => ({ path: '/memory/backfill', body: { filter: input.filter, apply: input.apply === true } }),
  verify: input => ({ path: '/memory/verify', body: { id: input.memory_id } }),
  hygiene: input => ({ path: '/memory/hygiene', body: { options: picked(input, HYGIENE_KEYS) } }),
  candidates: candidatesCall,
}

/** The keys the engine carries beside a tool's own arguments. */
const RESERVED = new Set(['tool', 'tool_use_id', 'agentId'])

/**
 * Refuses a field the tool's schema does not name. The engine does not hold a call to the schema, and a
 * dropped field made a wrong call answer as a success (an update with a scope it then took no field for).
 */
function checkFields(name: string, input: Input): void {
  const properties = (TOOLS.find(tool => tool.name === name)?.inputSchema.properties ?? {}) as Record<string, unknown>
  const unknown = Object.keys(input).filter(key => !RESERVED.has(key) && input[key] !== undefined && !(key in properties))
  if (unknown.length > 0) throw new Error(`${name} takes no ${unknown.join(', ')}; its fields are ${Object.keys(properties).join(', ')}`)
}

/** The daemon call a tool call becomes; a call the tool's own rules refuse throws with the reason. */
export function callOf(name: string, input: Input, sessionId: string): Call {
  const call = CALLS[name]
  if (call === undefined) throw new Error(`sage-memory has no tool ${name}`)
  checkFields(name, input)
  return call(input, sessionId)
}

/** A line about a change the model made; only the verb is coloured: an addition green, a change yellow, a deletion red. */
const modelLine = (verb: string, kind: 'ok' | 'warn' | 'error', after: string): Line => wordLine('the model ', verb, kind, after)

/** Whether a call wrote a new memory, which the session counts as added. */
export function addedBy(name: string, value: unknown): boolean {
  return name === 'remember' && (value as Partial<RememberResult>).outcome === 'added'
}

/** The similar memories a remember answered instead of writing, or undefined for any other answer. */
function similarOf(value: unknown): SimilarMemory[] | undefined {
  const result = value as Partial<{ outcome: string; similar: SimilarMemory[] }>
  return result.outcome === 'similar' && Array.isArray(result.similar) ? result.similar : undefined
}

function rememberedLine(input: Input, value: unknown): Line | undefined {
  const similar = similarOf(value)
  if (similar !== undefined) return modelLine('held', 'warn', ` a memory close to ${similar.map(memory => memory.id).join(', ')}: ${openingOf(String(input.text ?? ''))}`)
  const memory = (value as { memory?: Memory }).memory
  if (memory === undefined) return undefined
  const opening = openingOf(memory.text)
  return addedBy('remember', value) ? modelLine('added', 'ok', ` (${scopeLabel(memory.scope)}): ${opening}`) : modelLine('merged', 'warn', ` into ${memory.id}: ${opening}`)
}

/** `: <reason>` when the model gave one. */
function reasonOf(input: Input): string {
  const reason = String(input.reason ?? '').trim()
  return reason === '' ? '' : `: ${reason}`
}

function forgotLine(input: Input, value: unknown): Line | undefined {
  const removed = (value as { removed?: unknown }).removed
  return Array.isArray(removed) && removed.length > 0 ? modelLine('forgot', 'error', ` ${removed.length} memory(ies) matching "${String(input.query).trim()}"`) : undefined
}

const EDIT_LINES: Record<string, (input: Input, value: unknown) => Line | undefined> = {
  remember: rememberedLine,
  update: input => modelLine('updated', 'warn', ` ${String(input.id)}${typeof input.text === 'string' ? `: "${input.text.slice(0, 80)}"` : ''}`),
  delete: input => modelLine('deleted', 'error', ` ${String(input.id)}${reasonOf(input)}`),
  forget: forgotLine,
}

/** The line the person reads after the model added, merged, rewrote, deleted or forgot memories, or undefined for any other call. */
export function editLine(name: string, input: Input, value: unknown): Line | undefined {
  return EDIT_LINES[name]?.(input, value)
}

/** The tool's short name from the name the engine lists, or undefined for another plugin's tool. */
export function toolName(listed: string): string | undefined {
  return listed.startsWith(TOOL_PREFIX) ? listed.slice(TOOL_PREFIX.length) : undefined
}

/** The most characters of a tool's answer the model reads. */
const MAX_RESULT = 60_000

/** A daemon answer as the model reads it: JSON, cut with a note past `MAX_RESULT`. */
export function resultText(value: unknown): string {
  const text = JSON.stringify(value, null, 1) ?? 'null'
  return text.length <= MAX_RESULT ? text : `${text.slice(0, MAX_RESULT)}\n[cut at ${MAX_RESULT} of ${text.length} characters; narrow the request with limit or a filter]`
}

/** What the model reads when a remember was held: the similar memories and the two ways on. */
export function similarText(similar: readonly SimilarMemory[]): string {
  const lines = similar.map(memory => `- ${memory.id} (${memory.kind}, ${memory.cosine === undefined ? 'close by words' : `cosine ${memory.cosine.toFixed(2)}`}): ${memory.text}`)
  return [
    'Not saved: these memories are close in meaning to yours.',
    ...lines,
    'If one states the same fact, call update on it with a text that keeps everything else it states and holds your current value. If yours is a different fact, call remember again with distinct: true.',
  ].join('\n')
}

/** A tool's answer as the model reads it: a held remember as its instruction, anything else as JSON. */
export function answerText(name: string, value: unknown): string {
  const similar = name === 'remember' ? similarOf(value) : undefined
  return similar === undefined ? resultText(value) : similarText(similar)
}

/** The answer a call gets while the mod is off. */
export const OFF_TEXT = 'sage-memory is off; the person turns it on with /sage-memory on.'
