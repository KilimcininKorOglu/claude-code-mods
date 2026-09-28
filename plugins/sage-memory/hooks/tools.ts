/**
 * The 15 memory tools the model can call: the spec each is declared with, and the daemon route and
 * body each call becomes. Descriptions are SAGE's, with the tool names of this plugin and the
 * sentences the code does not keep corrected. Pure code; `register.tsx` makes every call.
 */
import { ANCHOR_TYPES, KINDS, PERSISTENCES, SCOPES, STATUSES, VERIFY_DEPTHS } from './shared/model.ts'

type Schema = Record<string, unknown>

export type ToolDef = { name: string; description: string; inputSchema: Schema; listed: boolean }

/** The prefix the engine gives every tool this plugin declares. */
export const TOOL_PREFIX = 'mcp__sage-memory__'

const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required, additionalProperties: false })
const text = (description: string): Schema => ({ type: 'string', minLength: 1, description })
const number = (minimum: number, maximum: number, description?: string): Schema => ({ type: 'number', minimum, maximum, ...(description === undefined ? {} : { description }) })
const choice = (values: readonly string[], description: string): Schema => ({ type: 'string', enum: [...values], description })
const texts = (description: string): Schema => ({ type: 'array', items: { type: 'string' }, description })
const yes = (description: string): Schema => ({ type: 'boolean', description })

const ANCHORS: Schema = {
  type: 'array',
  description: 'Bind this memory to concrete code locations so it can be verified and reminded of later.',
  items: object(
    {
      type: choice(ANCHOR_TYPES, 'Anchor kind.'),
      path: text('Project-relative path (required for file/directory/package/test/git).'),
      symbol: text('Symbol name (required for symbol anchors).'),
      command: text('Shell command (required for command anchors).'),
      role: text('Subagent type (required for agent anchors).'),
    },
    ['type'],
  ),
}

const AUDIENCE: Schema = object({
  roles: texts('Subagent types, for example Explore, Plan or a plugin agent, that get this memory when they start.'),
  modes: texts('Permission modes, for example default or plan.'),
})

const PERSISTENCE = choice(PERSISTENCES, 'Retention class. Prefer long_lived; permanent is only for explicit invariants.')

const REMEMBER_DESCRIPTION = [
  'Persist structured project knowledge into long-term memory. Bind it to files, symbols, or commands with `anchors` so it can be verified and reminded of later.',
  '',
  'EFFECTIVENESS RULES (follow strictly):',
  '1. One durable fact per call, self-contained for a reader with zero session context.',
  '2. Always prefer anchors (file/symbol/command/package). Unanchored memories are rarely reminded of.',
  '3. Use exact paths/symbols/commands in the text so path and text retrieval can match them.',
  '4. Add 1-3 stable tags (package name, domain: auth, build, testing).',
  '5. Write WHAT + WHERE + WHY/consequence in 1-4 tight sentences, in English.',
  '6. Update with `update` instead of near-duplicate `remember` calls.',
  '',
  'WHEN TO USE:',
  '- Project conventions discovered during a task (build tool, lint rules, code style)',
  '- Architecture decisions made (chose X over Y, decided to use pattern Z)',
  '- User preferences expressed (prefers short names, always uses pnpm)',
  '- Anti-patterns / warnings identified (never do X, avoid pattern Y)',
  '- Bug root-causes and file/symbol notes useful across sessions',
  '',
  'WHEN NOT TO USE:',
  '- Temporary task state or progress: use the task list (WIP and todo chatter is rejected)',
  '- One-off debugging notes and "fixed the bug" summaries',
  '- Information already obvious from the codebase',
  '- `file_note` / `symbol_note` / `command_note` without anchors (hard reject)',
  '',
  'Pick the most specific `kind`. Default persistence is `long_lived`; use `permanent` only for explicit project/user invariants.',
  '',
  'AUDIENCE: pass `audience: { roles: [...] }` to give a memory to specific subagent types. Such memories reach matching subagents when they start, and are left out of ordinary search and reminders.',
].join('\n')

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'remember',
    listed: true,
    description: REMEMBER_DESCRIPTION,
    inputSchema: object(
      {
        text: text('The fact or note to remember. Concise and factual, in English.'),
        kind: choice(KINDS, 'Category: the most specific kind that fits.'),
        scope: choice(SCOPES, 'project (shared, default), user (personal, every project), session (this session only), file, or symbol.'),
        tags: texts('Hashtag-style tags for grouping and search (omit the #).'),
        anchors: ANCHORS,
        audience: AUDIENCE,
        importance: number(0, 1),
        confidence: number(0, 1),
        persistence: PERSISTENCE,
        supersedes: texts('Memory ids this replaces (they become superseded).'),
        contradicts: texts('Memory ids this contradicts.'),
      },
      ['text'],
    ),
  },
  {
    name: 'search',
    listed: true,
    description: 'Search structured project memory using lexical, tag, path, and anchor signals, and meaning once embeddings are set up.',
    inputSchema: object({ query: text('Search text, symbol, tag, command, or path.'), limit: number(1, 100), include_stale: yes('Include stale memories.') }, ['query']),
  },
  {
    name: 'search_explain',
    listed: false,
    description:
      'Like `search` but each result carries a per-channel score breakdown: lexical score, vector score, RRF final score, and a `source` attribution (`lexical` | `vector` | `both`). Use when you need to weigh channels or to say WHY a result is in the list.',
    inputSchema: object({ query: text('Search text, symbol, tag, command, or path.'), limit: number(1, 100), include_stale: yes('Include stale memories.') }, ['query']),
  },
  {
    name: 'for_file',
    listed: false,
    description:
      'Retrieve memories attached to a file, grouped by how they match: `primaryMatches` (file scope or file/directory anchor), `symbolMatches` (symbol scope or anchor, boosted under `lineStart`/`lineEnd`), `relatedMatches` (text mentions).',
    inputSchema: object(
      {
        path: text('Project-relative file path.'),
        lineStart: { type: 'integer', minimum: 1, description: 'Optional first line; with `lineEnd`, symbol anchors overlapping the range rank first.' },
        lineEnd: { type: 'integer', minimum: 1, description: 'Optional last line. Pair with `lineStart`.' },
        limit: number(1, 200, 'Per-bucket cap. Default 50.'),
        showSuperseded: yes('Default true. Set false to hide superseded memories.'),
        showDeleted: yes('Default false. Set true to include deleted memories for recovery.'),
      },
      ['path'],
    ),
  },
  {
    name: 'for_path',
    listed: false,
    description: 'Retrieve project knowledge for a path and its ancestor directories.',
    inputSchema: object({ path: text('Project-relative file or directory path.'), limit: number(1, 50) }, ['path']),
  },
  {
    name: 'graph',
    listed: false,
    description: 'Traverse relationships between memories, files, symbols, and commands.',
    inputSchema: object({ query: text('A memory id, graph node, path, symbol, or search query.'), depth: number(1, 6), limit: number(1, 500) }, ['query']),
  },
  {
    name: 'gather',
    listed: false,
    description:
      'Gather a bounded batch of memories with optional graph relations, for bulk review and cleanup: enumerates memories by status, kind, or text substring, and includes the graph edges of the first ten.',
    inputSchema: object({
      statuses: { type: 'array', items: choice(STATUSES, 'Status.'), description: 'Statuses to include. Default: all except deleted.' },
      kind: choice(KINDS, 'Optional kind filter.'),
      query: text('Case-insensitive substring match against memory text.'),
      limit: number(1, 500),
      cursor: text("Opaque cursor from a previous page's `nextCursor`."),
      includeRelations: yes('Include graph edges among gathered memories. Default true.'),
    }),
  },
  {
    name: 'update',
    listed: false,
    description:
      'Update a single memory by id: edit text, tags, kind, anchors, audience, importance/confidence, persistence, context policy, status, or relationships. Refine or re-scope an existing memory instead of creating a near-duplicate; find the id with `search` or `for_file`. Set `status` to "stale" or "archived" to retire a memory without deleting it.',
    inputSchema: object(
      {
        id: text('The memory id to update.'),
        text: text('Replacement text.'),
        tags: texts('Replacement tags (omit the #).'),
        kind: choice(KINDS, 'New kind.'),
        anchors: ANCHORS,
        audience: AUDIENCE,
        importance: number(0, 1),
        confidence: number(0, 1),
        freshness: number(0, 1),
        persistence: PERSISTENCE,
        contextPolicy: choice(['never', 'auto', 'always'], 'never: no automatic reminder; auto: when relevant; always: at every session start and compaction.'),
        status: choice(STATUSES, 'New lifecycle status.'),
        supersedes: texts('Memory ids this replaces.'),
        contradicts: texts('Memory ids this contradicts.'),
        force: yes('Required to set status to "deleted"; the override is audit-logged.'),
      },
      ['id'],
    ),
  },
  {
    name: 'delete',
    listed: false,
    description:
      'Delete one memory by id (soft-delete with graph cleanup). Requires force: true; every deletion is audited. Provide a short `reason`. For a non-destructive review, use `candidates` with action "propose" instead, which the user resolves.',
    inputSchema: object(
      {
        id: text('The memory id to delete.'),
        reason: text('Reason recorded in the audit log.'),
        force: yes('Required for ALL deletions: authorizes the removal and is recorded in the audit log.'),
        neverRemind: yes('Absolute privacy/safety ban: this memory must never reach the model again.'),
      },
      ['id', 'force'],
    ),
  },
  {
    name: 'forget',
    listed: false,
    description:
      'Soft-delete every memory in a scope whose text, tag or anchor matches the query (case-insensitive). Requires force: true, because it deletes every match at once; use `delete` with an id for a single entry, and `search` first to see what would match.',
    inputSchema: object(
      {
        query: { type: 'string', minLength: 3, description: 'Substring, tag or id to match; at least 3 characters.' },
        scope: choice(SCOPES, 'Which scope to search. Defaults to project.'),
        force: yes('Required: authorizes deleting every memory matching the query. Recorded in the audit log.'),
      },
      ['query', 'force'],
    ),
  },
  {
    name: 'recover',
    listed: false,
    description: 'Restore a deleted memory to active status. A superseded memory resolves to the head of its version chain without a write. Provide a short `reason` for the audit log.',
    inputSchema: object({ id: text('The memory id to recover.'), reason: text('Reason recorded in the audit log.') }, ['id']),
  },
  {
    name: 'backfill_recoverable',
    listed: false,
    description:
      'Find deleted memories that are still recoverable and either preview them (default) or restore them as fresh active versions linked to the originals with `supersedes`. Pass `apply: true` to write.',
    inputSchema: object({
      filter: object({
        kinds: { type: 'array', items: choice(KINDS, 'Kind.'), description: 'Only memories of these kinds.' },
        scopes: { type: 'array', items: choice(SCOPES, 'Scope.'), description: 'Only memories of these scopes.' },
        updatedAfter: text('ISO-8601 cutoff: only memories updated at or after this.'),
        updatedBefore: text('ISO-8601 cutoff: only memories updated at or before this.'),
        requireProvenance: yes('Default true. Set false to consider records with neither sources nor anchors.'),
      }),
      apply: yes('Default false (preview). Set true to create the new active versions.'),
    }),
  },
  {
    name: 'verify',
    listed: false,
    description: 'Verify file, directory, symbol, content-hash, and git-blob anchors and update stale state: a failed check makes a memory stale, a passing one brings a verification-stale memory back.',
    inputSchema: object({ memory_id: text('Optional memory id; omit to verify every anchored memory.') }),
  },
  {
    name: 'hygiene',
    listed: false,
    description:
      'Verify anchors, supersede exact and near duplicates, mark contradictions, open review candidates for stale, low-confidence and unused memories, delete expired session memories, and forget the reminder records of sessions whose transcripts are gone. Never deletes a live project or user memory; `purgeDeletedAfterDays` removes tombstones older than N days for good.',
    inputSchema: object({
      verify: yes('Check anchors. Default true.'),
      verifyDepth: choice(VERIFY_DEPTHS, 'existence (default), content, or git.'),
      nearDedup: yes('Merge near duplicates. Default true.'),
      staleReviewDays: number(0, 3650),
      lowConfidenceReviewDays: number(0, 3650),
      unusedReviewDays: number(0, 3650),
      sessionRetentionDays: number(0, 3650),
      purgeDeletedAfterDays: number(0, 3650, 'Opt-in: remove tombstones deleted more than this many days ago. Omit to keep them.'),
    }),
  },
  {
    name: 'candidates',
    listed: false,
    description:
      "List, accept, reject, propose, or resolve memory candidates. Proposing files a non-destructive review of a memory; resolving applies the decision (delete/archive/keep) to the proposal's target memory, the preferred path over a raw `delete`.",
    inputSchema: object({
      action: choice(['list', 'accept', 'reject', 'propose', 'resolve'], 'Default list.'),
      candidate_id: text('Required for accept, reject, or resolve.'),
      reason: text('Reason for rejection, the review reason for propose, or the resolution note for resolve.'),
      include_resolved: yes('List resolved candidates too.'),
      text: text('Candidate text (required for propose).'),
      kind: choice(KINDS, 'Memory kind for propose.'),
      scope: choice(SCOPES, 'Scope for propose.'),
      tags: texts('Extra tags for propose.'),
      anchors: ANCHORS,
      importance: number(0, 1),
      confidence: number(0, 1),
      suggested_action: choice(['delete', 'archive', 'investigate', 'update'], 'Review action suggested for propose.'),
      memory_id: text('Id of the memory this proposal targets (propose).'),
      decision: choice(['delete', 'archive', 'keep'], 'Review decision to apply to the target memory (required for resolve).'),
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

const REMEMBER_KEYS = ['text', 'kind', 'scope', 'tags', 'anchors', 'audience', 'importance', 'confidence', 'persistence', 'supersedes', 'contradicts']
const PATCH_KEYS = ['text', 'tags', 'kind', 'anchors', 'audience', 'importance', 'confidence', 'freshness', 'persistence', 'contextPolicy', 'status', 'supersedes', 'contradicts', 'force']
const HYGIENE_KEYS = ['verify', 'verifyDepth', 'nearDedup', 'staleReviewDays', 'lowConfidenceReviewDays', 'unusedReviewDays', 'sessionRetentionDays', 'purgeDeletedAfterDays']

/** A memory the model writes: a session memory belongs to this session, and each carries this session as its source. */
function rememberCall(input: Input, sessionId: string): Call {
  const memory = picked(input, REMEMBER_KEYS)
  const owner = memory.scope === 'session' ? { ownerSessionId: sessionId } : {}
  return { path: '/memory/remember', body: { input: { ...memory, ...owner, sources: [{ type: 'session', sessionId }] } } }
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

/** The daemon call a tool call becomes; a call the tool's own rules refuse throws with the reason. */
export function callOf(name: string, input: Input, sessionId: string): Call {
  const call = CALLS[name]
  if (call === undefined) throw new Error(`sage-memory has no tool ${name}`)
  return call(input, sessionId)
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

/** The answer a call gets while the mod is off. */
export const OFF_TEXT = 'sage-memory is off; the person turns it on with /sage-memory on.'
