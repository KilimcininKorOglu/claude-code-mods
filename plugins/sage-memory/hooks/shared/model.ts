/**
 * The memory record and the inputs that write one: the contract the hooks module and the daemon
 * share. Pure types and constants.
 */

export const SCOPES = ['project', 'user', 'session', 'file', 'symbol'] as const
export type Scope = (typeof SCOPES)[number]

export const KINDS = [
  'fact',
  'decision',
  'convention',
  'preference',
  'warning',
  'anti_pattern',
  'workflow',
  'bug_root_cause',
  'file_note',
  'symbol_note',
  'command_note',
  'summary',
  'memory_review',
  'tool_outcome',
  'error_pattern',
  'session_digest',
  'role_operational',
  'task_outcome',
  'security_signal',
  'fleet_convention',
] as const
export type Kind = (typeof KINDS)[number]

/** Kinds that mean nothing without an anchor to bind them. */
export const STRUCTURAL_KINDS: readonly Kind[] = ['file_note', 'symbol_note', 'command_note']

export const STATUSES = ['active', 'stale', 'superseded', 'contradicted', 'archived', 'deleted'] as const
export type Status = (typeof STATUSES)[number]

/** `permanent` is never removed by an automatic pass; `long_lived` is the default. */
export const PERSISTENCES = ['permanent', 'long_lived', 'short_lived'] as const
export type Persistence = (typeof PERSISTENCES)[number]

/** `never` keeps a memory out of every automatic path to the model, `auto` lets relevance decide. */
export const CONTEXT_POLICIES = ['never', 'auto'] as const
export type ContextPolicy = (typeof CONTEXT_POLICIES)[number]

/**
 * Why a memory is stale: `verification` failed its anchors and a later passing check may restore
 * it; `manual` and `review` were decided by a person or a review, and no automatic pass restores
 * them.
 */
export const STALE_REASONS = ['verification', 'manual', 'review'] as const
export type StaleReason = (typeof STALE_REASONS)[number]

export const ANCHOR_TYPES = ['file', 'directory', 'symbol', 'package', 'command', 'test', 'git', 'agent'] as const
export type AnchorType = (typeof ANCHOR_TYPES)[number]

/** Anchor types that name a path in the project, which a `user` memory cannot hold. */
export const PATH_ANCHOR_TYPES: readonly AnchorType[] = ['file', 'directory', 'symbol', 'package', 'test', 'git']

export type Anchor = {
  type: AnchorType
  /** Relative to the project root once stored. */
  path?: string
  symbol?: string
  command?: string
  /** The subagent type an `agent` anchor names. */
  role?: string
  contentHash?: string
  gitBlobHash?: string
  lineStart?: number
  lineEnd?: number
}

export const SOURCE_TYPES = ['user', 'session', 'tool_result', 'project_instruction', 'file', 'test', 'command', 'legacy_memory'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export type Source = { type: SourceType; sessionId?: string; toolUseId?: string; path?: string; command?: string; excerptHash?: string }

/** Who gets a memory automatically: subagent types (`roles`) and permission modes (`modes`). */
export type Audience = { roles?: string[]; modes?: string[] }
export const AUDIENCE_KEYS = ['roles', 'modes'] as const

export type Memory = {
  id: string
  revision: number
  scope: Scope
  kind: Kind
  status: Status
  contextPolicy: ContextPolicy
  persistence: Persistence
  text: string
  importance: number
  confidence: number
  freshness: number
  tags: string[]
  anchors: Anchor[]
  audience?: Audience
  sources: Source[]
  supersedes?: string[]
  supersededBy?: string
  contradicts?: string[]
  createdAt: string
  updatedAt: string
  lastAccessedAt?: string
  lastVerifiedAt?: string
  lastUsedAt?: string
  staleReason?: StaleReason
  expiresAt?: string
  reminderCount?: number
  useCount?: number
  /** The Claude Code session a `session` memory belongs to. */
  ownerSessionId?: string
}

export type RememberInput = {
  text: string
  scope?: Scope
  kind?: Kind
  persistence?: Persistence
  contextPolicy?: ContextPolicy
  tags?: string[]
  audience?: Audience
  importance?: number
  confidence?: number
  freshness?: number
  anchors?: Anchor[]
  sources?: Source[]
  /** Ids this memory replaces; the ones still active or stale become superseded by it. */
  supersedes?: string[]
  contradicts?: string[]
  ownerSessionId?: string
  expiresAt?: string
}

/** What `remember` did: a new memory, or a merge into an equal or near-equal one. */
export type RememberResult = {
  memory: Memory
  outcome: 'added' | 'merged'
  nearDuplicate: boolean
  reactivated: boolean
  /** The ids this write moved to `superseded`. */
  superseded: string[]
}

export type UpdatePatch = {
  /** Moves a project memory to the user store or back, keeping its id; no other scope moves. */
  scope?: 'project' | 'user'
  text?: string
  tags?: string[]
  persistence?: Persistence
  contextPolicy?: ContextPolicy
  kind?: Kind
  anchors?: Anchor[]
  /** `{}` removes the audience. */
  audience?: Audience
  importance?: number
  confidence?: number
  freshness?: number
  status?: Status
  /** Why a move to `stale` happened: `manual` (the default) or `review`. */
  staleReason?: 'manual' | 'review'
  supersedes?: string[]
  contradicts?: string[]
  /** The memory that replaces this one; needs the resulting status `superseded`. */
  supersededBy?: string
  /** Needed for `status: 'deleted'`, which then takes no other field. */
  force?: boolean
}

/** What `update` did: the record as stored, and the ids a new `supersedes` entry moved to `superseded`. */
export type UpdateResult = { memory: Memory; superseded: string[] }

export const CANDIDATE_STATUSES = ['pending', 'accepted', 'rejected'] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

export const DECISIONS = ['delete', 'archive', 'keep'] as const
export type Decision = (typeof DECISIONS)[number]

export const SUGGESTED_ACTIONS = ['delete', 'archive', 'keep', 'investigate', 'update'] as const
export type SuggestedAction = (typeof SUGGESTED_ACTIONS)[number]

/**
 * A proposal: a new memory to accept, or (kind `memory_review`) a review of an existing memory
 * that a decision resolves.
 */
export type Candidate = {
  id: string
  status: CandidateStatus
  text: string
  kind: Kind
  scope: Scope
  confidence: number
  importance: number
  tags: string[]
  anchors: Anchor[]
  audience?: Audience
  sources: Source[]
  createdAt: string
  updatedAt: string
  /** The memory an accepted proposal became. */
  memoryId?: string
  /** Why the candidate was rejected or how it was resolved. */
  reason?: string
  targetMemoryId?: string
  reviewReason?: string
  suggestedAction?: SuggestedAction
  ownerSessionId?: string
}

export type ProposeInput = Omit<RememberInput, 'persistence' | 'contextPolicy' | 'supersedes' | 'contradicts' | 'freshness' | 'expiresAt'> & {
  targetMemoryId?: string
  reviewReason?: string
  suggestedAction?: SuggestedAction
}

export type Resolution = {
  candidateId: string
  decision: Decision
  targetMemoryId?: string
  /** Whether the target changed: false for a permanent target of `delete`, or a candidate without a target. */
  applied: boolean
  alreadyResolved?: boolean
}

export type BackfillFilter = {
  ids?: string[]
  kinds?: Kind[]
  scopes?: Scope[]
  updatedAfter?: string
  updatedBefore?: string
  /** Skip tombstones with no sources and no anchors. Default true. */
  requireProvenance?: boolean
}

export type BackfillRecord = {
  originalId: string
  newActiveId?: string
  reason: string
  kind: Kind
  scope: Scope
  textPreview: string
  deletedAt: string
}

export type BackfillReport = {
  apply: boolean
  examined: number
  recoverable: number
  recovered: number
  skipped: number
  recoverableRecords: BackfillRecord[]
  skippedRecords: BackfillRecord[]
  byReason: Record<string, number>
}

export type AuditEntry = { at: string; action: string; memoryId?: string; sessionId?: string; detail?: unknown }

/**
 * A memory a reminder may carry: how strongly it relates to the request (0 to 1), its reminder
 * score, and the evidence that brought it (`anchor:`, `query:` and `graph:` reasons).
 */
export type Ranked = { memory: Memory; relationStrength: number; score: number; reasons: string[] }

/** A candidate a gate held back from a reminder, and why. */
export type Rejection = { id: string; gate: 'duplicate' | 'belowScore' | 'reminded'; reason: string }

/** What the daemon ranks for one reminder, best first, and what its gates held back. */
export type Ranking = { candidates: Ranked[]; rejected: Rejection[] }

/** The memories a subagent starts with: the ones written for its role or mode, then the ones about its task. */
export type SubagentRanking = { audience: Memory[]; task: Ranked[] }

/** One edge of the memory graph. */
export type GraphEdge = { from: string; to: string; relation: string; weight: number; createdAt: string }

/** One search hit with its score per channel; the vector channel stays empty until embeddings are set up. */
export type SearchHit = { memory: Memory; lexicalScore: number | null; vectorScore: number | null; finalScore: number; source: 'lexical' | 'vector' | 'both' }

export type FileMatchVia = 'scope_file' | 'anchor_file' | 'scope_symbol' | 'anchor_symbol' | 'anchor_directory' | 'mention'

/** A pending review of a memory, shown beside it. */
export type PendingReview = { candidateId: string; reason: string; suggestedAction: 'delete' | 'archive' | 'update' | 'investigate'; ageDays: number }

export type FileMatch = { memory: Memory; matchedVia: FileMatchVia; matchStrength: number; supersededByActiveId?: string; pendingReview?: PendingReview }

/** The memories about one file: anchored to it or its directories, to a symbol in it, or naming it. */
export type FileMemories = {
  filePath: string
  primaryMatches: FileMatch[]
  symbolMatches: FileMatch[]
  relatedMatches: FileMatch[]
  totalCount: number
  activeCount: number
  supersededCount: number
  reviewPendingCount: number
}

/** One page of a listing, newest change first; `nextCursor` reads the next page. */
export type MemoryPage = { memories: Memory[]; nextCursor: string | null; total: number; statusCounts: Record<string, number> }

/** A page of memories with the graph edges of its first ten. */
export type GatheredPage = MemoryPage & { relations: GraphEdge[]; relationsScanned: number }

export type StoreStats = { total: number; byStatus: Record<Status, number>; byKind: Record<string, number>; edges: number }

/**
 * How deep a check reads an anchor: `existence` whether its path is there and of the right kind,
 * `content` also its content hash, symbol, command and agent, `git` also its git blob.
 */
export const VERIFY_DEPTHS = ['existence', 'content', 'git'] as const
export type VerifyDepth = (typeof VERIFY_DEPTHS)[number]

/** `verified` passed every check its depth runs, `stale` found the anchor broken, `unknown` could not tell. */
export type VerificationStatus = 'verified' | 'stale' | 'unknown'

export type AnchorVerification = { anchor: Anchor; status: VerificationStatus; reason: string; contentHash?: string; gitBlobHash?: string }

export type MemoryVerification = { memoryId: string; status: VerificationStatus; checkedAt: string; anchors: AnchorVerification[] }

/** What a verification found and changed: the memories it moved to stale, and the ones it moved back to active. */
export type VerifyReport = { results: MemoryVerification[]; staled: string[]; reactivated: string[] }

/** The settings of a hygiene run; a field left out takes SAGE's default. */
export type HygieneOptions = {
  /** Check the anchors of the active memories and of the ones verification made stale. Default true. */
  verify?: boolean
  /** Default `existence`. */
  verifyDepth?: VerifyDepth
  /** Merge memories of one kind that say the same thing in other words. Default true. */
  nearDedup?: boolean
  /** A stale memory untouched this many days gets a review. Default 90. */
  staleReviewDays?: number
  /** A memory under 0.5 confidence untouched this many days gets a review. Default 30. */
  lowConfidenceReviewDays?: number
  /** A memory reminded `unusedMinReminders` times and never used gets a review this many days after it was last reminded. Default 30. */
  unusedReviewDays?: number
  /** Default 10. */
  unusedMinReminders?: number
  /** A session memory without `expiresAt` is deleted this many days after its last change. Default 7. */
  sessionRetentionDays?: number
  /** Tombstones this many days old are removed for good. Off unless given. */
  purgeDeletedAfterDays?: number
}

/** What one hygiene run changed in one store; every count is of memories written, or of sessions for `sessionsForgotten`. */
export type HygieneReport = {
  store: 'project' | 'user'
  automatic: boolean
  startedAt: string
  completedAt: string
  depth: VerifyDepth | 'off'
  checked: number
  verified: number
  staled: number
  reactivated: number
  /** Superseded by an active memory of the same text. */
  merged: number
  /** Superseded by a near-duplicate. */
  nearMerged: number
  /** Survivors of a near-duplicate merge that took a longer text, and were embedded again. */
  rewritten: number
  contradictions: number
  reviewsOpened: number
  sessionDeleted: number
  purged: number
  /** Sessions whose transcripts Claude Code deleted, and whose reminder records went with them. */
  sessionsForgotten: number
  /** What the run left undone, and why. */
  notes: string[]
  /** The daemon closed before the run ended; the counts are what it did until then. */
  stopped?: boolean
}

/** What a hygiene request did in one store: ran it, started it in the background, or found one that runs now or ran within the hour. */
export type HygieneRun = { state: 'done'; report: HygieneReport } | { state: 'started' } | { state: 'running' } | { state: 'recent'; lastAt: string }

/** A move that took anchors with it, as paths relative to the project root, and the memories whose anchors moved. */
export type RemapMove = { from: string; to: string; memories: string[] }

/**
 * What a remap did: the moves that took anchors with them, how many moves the hourly limit held
 * back, and what checking the moved memories again changed.
 */
export type RemapReport = { moves: RemapMove[]; limited: number; staled: string[]; reactivated: string[] }
