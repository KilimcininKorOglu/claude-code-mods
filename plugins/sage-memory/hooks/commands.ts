/**
 * The words of `/sage-memory`: its argument split into words and flags, the flags turned into the
 * input `remember` and `update` take, the lines the answers print, and the bullets `import` reads
 * from a markdown file. Pure code; `register.tsx` asks the daemon.
 */
import {
  CONTEXT_POLICIES,
  KINDS,
  PERSISTENCES,
  SCOPES,
  STATUSES,
  type Anchor,
  type AuditEntry,
  type Candidate,
  type ContextPolicy,
  type FileMemories,
  type GraphEdge,
  type HygieneReport,
  type Kind,
  type Memory,
  type Persistence,
  type RememberInput,
  type Scope,
  type Status,
  type StoreStats,
  type UpdatePatch,
  type VerifyReport,
} from './shared/model.ts'

/** Splits an argument into words; a word in double or single quotes keeps its spaces. */
export function wordsOf(args: string): string[] {
  const words: string[] = []
  for (const match of args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) words.push(match[1] ?? match[2] ?? match[3] ?? '')
  return words
}

/** What the flags of `remember` and `update` say; `errors` names each flag it could not read. */
export type Flags = {
  text: string
  kind?: Kind
  scope?: Scope
  status?: Status
  persistence?: Persistence
  contextPolicy?: ContextPolicy
  tags?: string[]
  anchors?: Anchor[]
  roles?: string[]
  modes?: string[]
  importance?: number
  confidence?: number
  freshness?: number
  supersedes?: string[]
  contradicts?: string[]
  errors: string[]
}

const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/
const PERSON_KINDS = KINDS.filter(kind => kind !== 'memory_review')

const csv = (value: string): string[] =>
  value
    .split(',')
    .map(part => part.trim())
    .filter(part => part !== '')

function choice<T extends string>(flags: Flags, name: string, values: readonly T[], value: string): T | undefined {
  if ((values as readonly string[]).includes(value)) return value as T
  flags.errors.push(`--${name} must be one of: ${values.join(', ')}`)
  return undefined
}

function score(flags: Flags, name: string, value: string): number | undefined {
  const parsed = DECIMAL.test(value) ? Number(value) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed
  flags.errors.push(`--${name} must be a number from 0 to 1 (got "${value}")`)
  return undefined
}

function symbolAnchor(flags: Flags, value: string): Anchor | undefined {
  const hash = value.lastIndexOf('#')
  if (hash > 0 && hash < value.length - 1) return { type: 'symbol', path: value.slice(0, hash), symbol: value.slice(hash + 1) }
  flags.errors.push('--symbol must be path#SymbolName')
  return undefined
}

function addAnchor(flags: Flags, anchor: Anchor | undefined): void {
  if (anchor !== undefined) flags.anchors = [...(flags.anchors ?? []), anchor]
}

const FLAG_READERS: Record<string, (flags: Flags, value: string) => void> = {
  kind: (f, v) => (f.kind = choice(f, 'kind', PERSON_KINDS, v)),
  scope: (f, v) => (f.scope = choice(f, 'scope', SCOPES, v)),
  status: (f, v) => (f.status = choice(f, 'status', STATUSES, v)),
  persistence: (f, v) => (f.persistence = choice(f, 'persistence', PERSISTENCES, v)),
  policy: (f, v) => (f.contextPolicy = choice(f, 'policy', CONTEXT_POLICIES, v)),
  tag: (f, v) => (f.tags = [...(f.tags ?? []), ...csv(v)]),
  anchor: (f, v) => addAnchor(f, { type: 'file', path: v }),
  directory: (f, v) => addAnchor(f, { type: 'directory', path: v }),
  symbol: (f, v) => addAnchor(f, symbolAnchor(f, v)),
  command: (f, v) => addAnchor(f, { type: 'command', command: v }),
  agent: (f, v) => addAnchor(f, { type: 'agent', role: v }),
  role: (f, v) => (f.roles = [...(f.roles ?? []), ...csv(v)]),
  mode: (f, v) => (f.modes = [...(f.modes ?? []), ...csv(v)]),
  importance: (f, v) => (f.importance = score(f, 'importance', v)),
  confidence: (f, v) => (f.confidence = score(f, 'confidence', v)),
  freshness: (f, v) => (f.freshness = score(f, 'freshness', v)),
  supersedes: (f, v) => (f.supersedes = [...(f.supersedes ?? []), ...csv(v)]),
  contradicts: (f, v) => (f.contradicts = [...(f.contradicts ?? []), ...csv(v)]),
}

const FLAG_ALIASES: Record<string, string> = { tags: 'tag', file: 'anchor', dir: 'directory', roles: 'role', modes: 'mode', 'context-policy': 'policy' }

/** Reads `--flag value` pairs; every other word is text. */
export function flagsOf(words: readonly string[]): Flags {
  const flags: Flags = { text: '', errors: [] }
  const text: string[] = []
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? ''
    if (!word.startsWith('--')) {
      text.push(word)
      continue
    }
    const name = word.slice(2).toLowerCase()
    const reader = FLAG_READERS[FLAG_ALIASES[name] ?? name]
    const value = words[i + 1]
    if (reader === undefined) flags.errors.push(`unknown flag ${word}`)
    else if (value === undefined || value.startsWith('--')) flags.errors.push(`${word} needs a value`)
    else {
      reader(flags, value)
      i += 1
    }
  }
  flags.text = text.join(' ').trim()
  return flags
}

function audienceOf(flags: Flags): RememberInput['audience'] {
  if (flags.roles === undefined && flags.modes === undefined) return undefined
  return { ...(flags.roles !== undefined ? { roles: flags.roles } : {}), ...(flags.modes !== undefined ? { modes: flags.modes } : {}) }
}

/** Only the fields the flags gave, so the daemon keeps its defaults for the rest. */
function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** A memory the person writes: a session memory belongs to this session, and the person is its source. */
export function rememberInputOf(flags: Flags, sessionId: string): RememberInput {
  const input = {
    text: flags.text,
    kind: flags.kind,
    scope: flags.scope,
    persistence: flags.persistence,
    contextPolicy: flags.contextPolicy,
    tags: flags.tags,
    anchors: flags.anchors,
    audience: audienceOf(flags),
    importance: flags.importance,
    confidence: flags.confidence,
    freshness: flags.freshness,
    supersedes: flags.supersedes,
    contradicts: flags.contradicts,
    ownerSessionId: flags.scope === 'session' ? sessionId : undefined,
    sources: [{ type: 'user' as const, sessionId }],
  }
  return defined(input) as RememberInput
}

export function patchOf(flags: Flags): UpdatePatch {
  const patch = {
    text: flags.text === '' ? undefined : flags.text,
    kind: flags.kind,
    status: flags.status,
    persistence: flags.persistence,
    contextPolicy: flags.contextPolicy,
    tags: flags.tags,
    anchors: flags.anchors,
    audience: audienceOf(flags),
    importance: flags.importance,
    confidence: flags.confidence,
    freshness: flags.freshness,
    supersedes: flags.supersedes,
    contradicts: flags.contradicts,
  }
  return defined(patch) as UpdatePatch
}

// ── Lines ──────────────────────────────────────────────────────────────

export function memoryLine(m: Memory): string {
  return `${m.id} [${m.kind} · ${m.scope} · ${m.status}] ${m.text.replace(/\s+/g, ' ').slice(0, 160)}`
}

export function listText(memories: readonly Memory[], empty: string): string {
  return memories.length === 0 ? empty : memories.map(memoryLine).join('\n')
}

function anchorText(a: Anchor): string {
  return [a.type, a.path, a.symbol !== undefined ? `#${a.symbol}` : undefined, a.command, a.role].filter(part => part !== undefined).join(' ')
}

/** The optional lines of a memory's detail, each present only when the memory carries the field. */
function detailExtras(m: Memory): (string | undefined)[] {
  return [
    m.tags.length > 0 ? `  tags: ${m.tags.join(', ')}` : undefined,
    m.anchors.length > 0 ? `  anchors: ${m.anchors.map(anchorText).join('; ')}` : undefined,
    m.audience !== undefined ? `  audience: ${JSON.stringify(m.audience)}` : undefined,
    (m.supersedes ?? []).length > 0 ? `  supersedes: ${(m.supersedes ?? []).join(', ')}` : undefined,
    m.supersededBy !== undefined ? `  superseded by: ${m.supersededBy}` : undefined,
    m.staleReason !== undefined ? `  stale for: ${m.staleReason}` : undefined,
  ]
}

export function detailText(m: Memory): string {
  const lines = [
    memoryLine(m),
    `  importance ${m.importance} · confidence ${m.confidence} · freshness ${m.freshness} · ${m.persistence} · policy ${m.contextPolicy} · revision ${m.revision}`,
    `  reminded ${m.reminderCount ?? 0}x · used ${m.useCount ?? 0}x · updated ${m.updatedAt}${m.lastVerifiedAt !== undefined ? ` · verified ${m.lastVerifiedAt}` : ''}`,
    ...detailExtras(m),
    `  ${m.text}`,
  ]
  return lines.filter((line): line is string => line !== undefined).join('\n')
}

export function fileText(f: FileMemories): string {
  const group = (title: string, matches: FileMemories['primaryMatches']): string[] => (matches.length === 0 ? [] : [`${title}:`, ...matches.map(match => `  ${memoryLine(match.memory)} (${match.matchedVia})`)])
  const lines = [...group('attached', f.primaryMatches), ...group('symbols', f.symbolMatches), ...group('mentioned in', f.relatedMatches)]
  return lines.length === 0 ? `no memory about ${f.filePath}` : [`${f.filePath}: ${f.activeCount} active of ${f.totalCount}`, ...lines].join('\n')
}

export function graphText(edges: readonly GraphEdge[]): string {
  return edges.length === 0 ? 'no relation found' : edges.map(edge => `${edge.from} ${edge.relation} ${edge.to}`).join('\n')
}

export function auditText(entries: readonly AuditEntry[]): string {
  return entries.length === 0 ? 'the audit log is empty' : entries.map(e => `${e.at} ${e.action}${e.memoryId !== undefined ? ` ${e.memoryId}` : ''}`).join('\n')
}

function statsLine(name: string, s: StoreStats): string {
  const statuses = Object.entries(s.byStatus)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${status}`)
    .join(', ')
  return `${name}: ${s.total} memories (${statuses || 'none'}), ${s.edges} graph edges`
}

export function statsText(stats: { project: StoreStats; user: StoreStats }): string {
  return [statsLine('project', stats.project), statsLine('user', stats.user)].join('\n')
}

export function candidatesText(candidates: readonly Candidate[]): string {
  if (candidates.length === 0) return 'no pending candidate'
  return candidates.map(c => `${c.id} [${c.kind}${c.suggestedAction !== undefined ? ` · ${c.suggestedAction}` : ''}${c.targetMemoryId !== undefined ? ` · for ${c.targetMemoryId}` : ''}] ${c.text.slice(0, 120)}${c.reviewReason !== undefined ? ` (${c.reviewReason})` : ''}`).join('\n')
}

export function verifyText(report: VerifyReport): string {
  const unknown = report.results.filter(r => r.status === 'unknown').length
  return `checked ${report.results.length} memories: ${report.staled.length} went stale, ${report.reactivated.length} came back, ${unknown} could not be checked`
}

export function hygieneText(report: HygieneReport): string {
  const counts = `${report.checked} checked, ${report.staled} staled, ${report.reactivated} reactivated, ${report.merged + report.nearMerged} merged, ${report.contradictions} contradiction(s), ${report.reviewsOpened} review(s) opened, ${report.sessionDeleted} session memory(ies) deleted, ${report.purged} purged`
  return [`${report.store}: ${counts}`, ...report.notes.map(note => `  ${note}`)].join('\n')
}

// ── Import ─────────────────────────────────────────────────────────────

/** The lines under a heading, up to the next heading of the same or a higher level; the whole text without one. */
function sectionOf(markdown: string, heading: string | undefined): string[] | undefined {
  const lines = markdown.split('\n')
  if (heading === undefined) return lines
  const wanted = heading.trim().toLowerCase()
  const start = lines.findIndex(line => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, '').trim().toLowerCase() === wanted)
  if (start === -1) return undefined
  const level = /^#+/.exec(lines[start] ?? '')?.[0].length ?? 1
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end)
}

/** The bullets of a section: each `- ` or `* ` line at the start, its indented lines joined to it. */
export function bulletsOf(markdown: string, heading: string | undefined): string[] | undefined {
  const lines = sectionOf(markdown, heading)
  if (lines === undefined) return undefined
  const bullets: string[] = []
  for (const line of lines) {
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet !== null) bullets.push(bullet[1] ?? '')
    else if (/^\s+\S/.test(line) && bullets.length > 0) bullets[bullets.length - 1] = `${bullets.at(-1)} ${line.trim()}`
  }
  return bullets.map(bullet => bullet.trim()).filter(bullet => bullet !== '')
}

/** The flags of `import`: the file, the section, and what every imported memory becomes. */
export type ImportFlags = { path: string; section?: string; always: boolean; kind?: Kind; scope: 'project' | 'user'; errors: string[] }

function importErrors(words: readonly string[], at: number, flags: Flags, path: string): string[] {
  const section = words[at + 1]
  const errors = [...flags.errors]
  if (at !== -1 && (section === undefined || section.startsWith('--'))) errors.push('--section needs a heading')
  if (flags.scope !== undefined && flags.scope !== 'project' && flags.scope !== 'user') errors.push('--scope must be project or user')
  if (path === '') errors.push('import needs a file path')
  return errors
}

/** Takes `--section <heading>` and `--always` out of the words; the rest are the path and the `--kind`/`--scope` flags. */
export function importFlagsOf(words: readonly string[]): ImportFlags {
  const at = words.indexOf('--section')
  const rest = words.filter((word, i) => word !== '--always' && (at === -1 || (i !== at && i !== at + 1)))
  const flags = flagsOf(rest)
  const path = flags.text.split(' ')[0] ?? ''
  const section = at === -1 ? undefined : words[at + 1]
  return { path, section, always: words.includes('--always'), kind: flags.kind, scope: flags.scope === 'user' ? 'user' : 'project', errors: importErrors(words, at, flags, path) }
}

/** One imported bullet as a memory: the file is its source, `--always` puts it in every start. */
export function importInput(text: string, flags: ImportFlags, sessionId: string): RememberInput {
  return {
    text,
    scope: flags.scope,
    kind: flags.kind ?? 'convention',
    persistence: 'long_lived',
    ...(flags.always ? { contextPolicy: 'always' as const } : {}),
    sources: [{ type: 'legacy_memory', path: flags.path, sessionId }],
  }
}
