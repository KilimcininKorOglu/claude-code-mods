/**
 * The pure part of memory-save: the project name, the save prompt, the reply
 * format and the checks that decide whether a new MEMORY.md may be written.
 */

export const SECTIONS = ['CRITICAL RULES', 'Architecture & Config Facts', 'Active Warnings', 'Topic Files'] as const
export type Section = (typeof SECTIONS)[number]

export const MAX_LINES = 200
export const MAX_CHARS = 50_000
export const SOFT_LINES = 180
export const SOFT_CHARS = 45_000
export const MAX_BULLET = 600

const PROJECT_NAME = /^[A-Za-z0-9._-]+$/
const TOPIC_FILE = /^[a-z0-9][a-z0-9._-]*\.md$/

export type Op =
  | { op: 'add'; section: Section; text: string }
  | { op: 'remove'; line: string }
  | { op: 'replace'; line: string; text: string }

export type TopicAppend = { file: string; append: string }

export type Reply = { ops: Op[]; topics: TopicAppend[]; rewrite?: string }

export type Parsed = { ok: true; reply: Reply } | { ok: false; error: string }

export type Changes = { added: number; removed: number; replaced: number; created: boolean; migrated: boolean }

export type Applied =
  | { ok: true; changed: false }
  | { ok: true; changed: true; text: string; changes: Changes; newBullets: string[]; topics: TopicAppend[] }
  | { ok: false; error: string }

export type Inspection = {
  lines: number
  chars: number
  hasCritical: boolean
  longBullets: { line: number; chars: number; head: string }[]
}

function trimSlashes(path: string): string {
  return path.replace(/\/+$/, '')
}

function baseName(path: string): string {
  return trimSlashes(path).split('/').at(-1) ?? ''
}

function parentOf(path: string): string {
  return trimSlashes(path).split('/').slice(0, -1).join('/')
}

/**
 * Returns the primary repository name from the git common dir, which names the
 * main repository also inside a worktree, or "" when the dir has neither shape.
 */
function nameFromCommonDir(commonDir: string): string {
  if (commonDir === '') return ''
  if (baseName(commonDir) === '.git') return baseName(parentOf(commonDir))
  const worktrees = parentOf(commonDir)
  if (baseName(worktrees) === 'worktrees' && baseName(parentOf(worktrees)) === '.git') {
    return baseName(parentOf(parentOf(worktrees)))
  }
  return ''
}

/**
 * Names the project the way `~/.claude/hooks/project.py` does, so the mod and
 * the classic hooks use the same memory directory: the primary repository,
 * else the git top level, else the working directory.
 */
export function projectNameFrom(commonDir: string, topLevel: string, cwd: string): string {
  const fromCommon = nameFromCommonDir(commonDir.trim())
  if (fromCommon !== '') return fromCommon
  const top = topLevel.trim()
  return top !== '' ? baseName(top) : baseName(cwd)
}

export function isProjectName(name: string): boolean {
  return PROJECT_NAME.test(name) && name !== '.' && name !== '..'
}

function linesOf(text: string): string[] {
  return text === '' ? [] : text.replace(/\n$/, '').split('\n')
}

function headingsOf(text: string): string[] {
  return linesOf(text)
    .filter(l => l.startsWith('## '))
    .map(l => l.slice(3).trim())
}

function isHeading(line: string, section: string): boolean {
  return line.trim().toLowerCase() === `## ${section}`.toLowerCase()
}

export function inspect(text: string): Inspection {
  const lines = linesOf(text)
  const longBullets = lines.flatMap((line, i) =>
    line.startsWith('- ') && line.length > MAX_BULLET ? [{ line: i + 1, chars: line.length, head: line.slice(0, 55) }] : [],
  )
  return {
    lines: lines.length,
    chars: text.length,
    hasCritical: lines.some(l => isHeading(l, 'CRITICAL RULES')),
    longBullets,
  }
}

/** Returns the four-section file a project starts from. */
export function skeleton(project: string): string {
  return `# ${project}\n\n${SECTIONS.map(s => `## ${s}\n`).join('\n')}`
}

const RULES = `Record only project-scoped learnings. A learning is project-scoped only when it changes future behavior for this repository's code, commands, architecture, configuration, deployment, tests, or product preferences. Do NOT record global Claude Code behavior, shared skill workflow rules, general agent preferences, or cross-project policies. If the scope is unclear, do not record it.
Writing rules for MEMORY.md and for every topic file alike:
1. Write an active project-scoped rule in imperative mood under '## CRITICAL RULES'. Put stable technical context under '## Architecture & Config Facts', and pitfalls and recurring mistakes under '## Active Warnings'.
2. NEVER write commit hashes, dated fix histories, completed-work records, or any archival narrative to MEMORY.md. Historical detail goes to a topic file only: history.md by default, or a dedicated subject file for a large topic.
3. MEMORY.md holds ONLY durable rules, patterns, and stable facts, each as ONE focused bullet of at most ${MAX_BULLET} characters. Keep the file under ${MAX_LINES} lines AND under ${MAX_CHARS} characters.
4. Write in English ONLY.
5. Write to ASD-STE100 (Simplified Technical English): short sentences, active voice, simple tenses, ONE instruction per sentence, the SAME term for the same thing throughout. Keep a short 'because' or 'so that' clause when dropping it would let the rule be applied wrongly.
6. Name the fact directly. NEVER invent a metaphor or a figurative phrase.
7. NEVER hedge a fact that was measured. When something was NOT verified, say exactly that.
8. Reproduce identifiers, file names, config keys and trigger phrases exactly as they appear in the codebase, including non-English ones.
9. Do not add a bullet that repeats one already in the file. Remove or replace a bullet that the conversation proved wrong or obsolete.`

const FORMAT = `Answer with ONE JSON object and nothing else, no prose, no code fence:
{"ops": [...], "topics": [...]}
- {"op":"add","section":"<one of: ${SECTIONS.join(' | ')}>","text":"- <one bullet on one line>"}
- {"op":"remove","line":"<an existing line of MEMORY.md, copied exactly>"}
- {"op":"replace","line":"<an existing line, copied exactly>","text":"- <the new bullet on one line>"}
- topics: {"file":"history.md","append":"<markdown to append to that topic file>"}; a file name is lowercase, ends in .md, and is not MEMORY.md. The mod lists a new topic file under '## Topic Files'.
When nothing project-scoped was learned since the file was last written, answer {"ops":[],"topics":[]}.`

const REWRITE_FORMAT = `Answer with ONE JSON object and nothing else, no prose, no code fence:
{"rewrite": "<the whole new MEMORY.md>", "topics": [...]}
The rewrite MUST have exactly these '## ' sections, in this order, and no other '## ' heading: ${SECTIONS.join(', ')}. Preserve all real content, reorganize it under those sections, convert rules to imperative mood, and move history to a topic file through "topics" ({"file":"history.md","append":"..."}).`

function sizeNotes(state: Inspection): string {
  const notes: string[] = []
  if (state.lines >= SOFT_LINES || state.chars >= SOFT_CHARS) {
    notes.push(
      `MANDATORY OFFLOAD: MEMORY.md is ${state.lines} lines / ${state.chars} characters, at or near a limit. Move the oldest or least critical entries (resolved warnings, superseded facts, dated notes) to a topic file in this answer.`,
    )
  }
  if (state.longBullets.length > 0) {
    const list = state.longBullets.map(b => `  - line ${b.line} (${b.chars} chars): ${b.head}...`).join('\n')
    notes.push(
      `MANDATORY BULLET SPLIT: these bullets exceed ${MAX_BULLET} characters. Replace each with focused bullets, or move its detail to a topic file:\n${list}`,
    )
  }
  return notes.join('\n')
}

/**
 * Builds the one message the fork answers. The current file rides along as
 * data, because the fork has no tools and cannot read it.
 */
export function buildPrompt(project: string, current: string | undefined): string {
  const head = `You are the memory-save step of this session, not the assistant. Do not answer the user and do not use tools. Review the conversation above and decide what project "${project}" must remember in its MEMORY.md.`
  if (current === undefined) {
    return [head, 'MEMORY.md does not exist yet. The mod creates it with the four sections when your answer has at least one op.', RULES, FORMAT].join('\n\n')
  }
  const state = inspect(current)
  const format = state.hasCritical ? FORMAT : REWRITE_FORMAT
  const migration = state.hasCritical
    ? ''
    : "MANDATORY MIGRATION: MEMORY.md has no '## CRITICAL RULES' section, so it is not in the required format. Rewrite the whole file now."
  const file = `The current MEMORY.md, as data between the markers:\n<memory_file>\n${current}\n</memory_file>`
  return [head, file, RULES, migration, sizeNotes(state), format].filter(p => p !== '').join('\n\n')
}

function jsonSpan(text: string): string | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start === -1 || end < start ? undefined : text.slice(start, end + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oneLine(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && !value.includes('\n') ? value : undefined
}

function sectionOf(value: unknown): Section | undefined {
  return SECTIONS.find(s => typeof value === 'string' && s.toLowerCase() === value.trim().toLowerCase())
}

function parseOp(value: unknown): Op | string {
  if (!isRecord(value)) return 'an op is not an object'
  const text = oneLine(value.text)
  const line = oneLine(value.line)
  if (value.op === 'add') {
    const section = sectionOf(value.section)
    if (section === undefined) return `add: unknown section ${JSON.stringify(value.section)}`
    return text === undefined ? 'add: text is not one line' : { op: 'add', section, text }
  }
  if (value.op === 'remove') return line === undefined ? 'remove: line is not one line' : { op: 'remove', line }
  if (value.op === 'replace') {
    return line === undefined || text === undefined ? 'replace: line or text is not one line' : { op: 'replace', line, text }
  }
  return `unknown op ${JSON.stringify(value.op)}`
}

function parseTopic(value: unknown): TopicAppend | string {
  if (!isRecord(value) || typeof value.file !== 'string' || typeof value.append !== 'string') {
    return 'a topic needs a file and an append text'
  }
  const file = value.file.trim()
  if (!TOPIC_FILE.test(file) || file === 'memory.md') return `topic file name refused: ${file}`
  return value.append.trim() === '' ? `topic ${file}: empty append` : { file, append: value.append }
}

function listOf<T>(value: unknown, parse: (v: unknown) => T | string): T[] | string {
  if (value === undefined) return []
  if (!Array.isArray(value)) return 'ops and topics must be arrays'
  const items: T[] = []
  for (const raw of value) {
    const item = parse(raw)
    if (typeof item === 'string') return item
    items.push(item)
  }
  return items
}

function decode(text: string): Record<string, unknown> | string {
  const span = jsonSpan(text)
  if (span === undefined) return 'reply has no JSON object'
  let value: unknown
  try {
    value = JSON.parse(span)
  } catch (err) {
    return `reply is not valid JSON (${err instanceof Error ? err.message : String(err)})`
  }
  return isRecord(value) ? value : 'reply is not a JSON object'
}

/** Reads the fork's answer. A reply of any other shape is an error, never a guess. */
export function parseReply(text: string): Parsed {
  const value = decode(text)
  if (typeof value === 'string') return { ok: false, error: value }
  const ops = listOf(value.ops, parseOp)
  if (typeof ops === 'string') return { ok: false, error: ops }
  const topics = listOf(value.topics, parseTopic)
  if (typeof topics === 'string') return { ok: false, error: topics }
  if (value.rewrite !== undefined && typeof value.rewrite !== 'string') return { ok: false, error: 'rewrite is not a string' }
  if (value.rewrite !== undefined && ops.length > 0) return { ok: false, error: 'rewrite and ops together' }
  return { ok: true, reply: { ops, topics, rewrite: value.rewrite } }
}

function bullet(text: string): string {
  const t = text.trim()
  return t.startsWith('- ') ? t : `- ${t.replace(/^[-*]\s*/, '')}`
}

function sectionEnd(lines: string[], start: number): number {
  const next = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return next === -1 ? lines.length : next
}

function addTo(lines: string[], section: string, text: string): string | undefined {
  const start = lines.findIndex(l => isHeading(l, section))
  if (start === -1) return `add: section '## ${section}' not found`
  let at = sectionEnd(lines, start)
  while (at > start + 1 && (lines[at - 1] ?? '').trim() === '') at--
  const body = lines.slice(start + 1, at).filter(l => l.trim() !== '')
  if (body.length === 1 && /^- none yet\.?$/i.test(body[0]?.trim() ?? '')) lines.splice(at - 1, 1, text)
  else if (at === start + 1) lines.splice(at, 0, '', text)
  else lines.splice(at, 0, text)
  return undefined
}

function indexOfLine(lines: string[], line: string): number {
  return lines.findIndex(l => l.trimEnd() === line.trimEnd())
}

function applyOp(lines: string[], op: Op, newBullets: string[]): string | undefined {
  if (op.op === 'add') {
    const text = bullet(op.text)
    newBullets.push(text)
    return addTo(lines, op.section, text)
  }
  const at = indexOfLine(lines, op.line)
  if (at === -1) return `${op.op}: line not found: ${op.line.slice(0, 60)}`
  if (op.op === 'remove') {
    lines.splice(at, 1)
    return undefined
  }
  const text = bullet(op.text)
  newBullets.push(text)
  lines[at] = text
  return undefined
}

function tally(ops: Op[], created: boolean): Changes {
  const count = (kind: Op['op']): number => ops.filter(o => o.op === kind).length
  return { added: count('add'), removed: count('remove'), replaced: count('replace'), created, migrated: false }
}

/** Lists every topic file the reply writes under '## Topic Files' when the file does not name it yet. */
function pointTopics(lines: string[], topics: TopicAppend[], newBullets: string[]): string | undefined {
  for (const { file } of topics) {
    const start = lines.findIndex(l => isHeading(l, 'Topic Files'))
    const listed = start !== -1 && lines.slice(start, sectionEnd(lines, start)).some(l => l.includes(file))
    if (listed) continue
    const text = `- \`${file}\`.`
    newBullets.push(text)
    const error = addTo(lines, 'Topic Files', text)
    if (error !== undefined) return error
  }
  return undefined
}

function applyRewrite(current: string | undefined, rewrite: string, topics: TopicAppend[]): Applied {
  if (current === undefined || inspect(current).hasCritical) {
    return { ok: false, error: 'rewrite refused: it is allowed only for a file without the CRITICAL RULES section' }
  }
  const lines = linesOf(rewrite)
  const newBullets = lines.filter(l => l.startsWith('- '))
  const error = pointTopics(lines, topics, newBullets)
  if (error !== undefined) return { ok: false, error }
  const changes: Changes = { added: 0, removed: 0, replaced: 0, created: false, migrated: true }
  return { ok: true, changed: true, text: `${lines.join('\n')}\n`, changes, newBullets, topics }
}

/**
 * Applies the reply to the current file. A missing file starts from the
 * skeleton. The result is not checked here; `validate` checks it.
 */
export function apply(project: string, current: string | undefined, reply: Reply): Applied {
  if (reply.rewrite !== undefined) return applyRewrite(current, reply.rewrite, reply.topics)
  if (reply.ops.length === 0 && reply.topics.length === 0) return { ok: true, changed: false }
  const lines = linesOf(current ?? skeleton(project))
  const newBullets: string[] = []
  for (const op of reply.ops) {
    const error = applyOp(lines, op, newBullets)
    if (error !== undefined) return { ok: false, error }
  }
  const error = pointTopics(lines, reply.topics, newBullets)
  if (error !== undefined) return { ok: false, error }
  const changes = tally(reply.ops, current === undefined)
  return { ok: true, changed: true, text: `${lines.join('\n')}\n`, changes, newBullets, topics: reply.topics }
}

/** Returns why the new file must not be written, or an empty list. */
export function validate(text: string, newBullets: string[]): string[] {
  const errors: string[] = []
  const headings = headingsOf(text)
  const inOrder = headings.length === SECTIONS.length && SECTIONS.every((s, i) => s.toLowerCase() === headings[i]?.toLowerCase())
  if (!inOrder) errors.push(`sections are not exactly ${SECTIONS.join(', ')} (found: ${headings.join(', ') || 'none'})`)
  const state = inspect(text)
  if (state.lines >= MAX_LINES) errors.push(`${state.lines} lines, the limit is under ${MAX_LINES}`)
  if (state.chars >= MAX_CHARS) errors.push(`${state.chars} characters, the limit is under ${MAX_CHARS}`)
  const long = newBullets.filter(b => b.length > MAX_BULLET)
  if (long.length > 0) errors.push(`${long.length} new bullet(s) over ${MAX_BULLET} characters`)
  return errors
}

/** Returns the topic file after the append; a new file gets a title. */
export function appendTopic(project: string, file: string, existing: string | undefined, append: string): string {
  const base = existing ?? `# ${project}: ${file.replace(/\.md$/, '')}\n`
  const sep = base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n'
  return `${base}${sep}${append.trim()}\n`
}

export const BACKUP = 'MEMORY.pre-migration.md'

function count(n: number, word: string): string {
  return `${n} ${word}`
}

/** One line for the log, naming what the save changed. */
export function changeText(changes: Changes, topics: TopicAppend[]): string {
  const parts: string[] = []
  if (changes.migrated) parts.push(`migrated to the four sections (old copy: ${BACKUP})`)
  if (changes.created) parts.push('created')
  if (changes.added > 0) parts.push(count(changes.added, 'added'))
  if (changes.removed > 0) parts.push(count(changes.removed, 'removed'))
  if (changes.replaced > 0) parts.push(count(changes.replaced, 'replaced'))
  const files = [...new Set(topics.map(t => t.file))]
  const topicPart = files.length > 0 ? `; appended to ${files.join(', ')}` : ''
  return `MEMORY.md: ${parts.join(', ') || 'topic files only'}${topicPart}`
}

/** The short form for the status line. */
export function changeShort(changes: Changes, topics: TopicAppend[]): string {
  if (changes.migrated) return 'migrated'
  const counts: [string, number][] = [
    ['+', changes.added],
    ['-', changes.removed],
    ['~', changes.replaced],
  ]
  const parts = counts.filter(([, n]) => n > 0).map(([sign, n]) => `${sign}${n}`)
  if (topics.length > 0) parts.push(`+${new Set(topics.map(t => t.file)).size} topic`)
  return parts.join(' ') || 'saved'
}

export function clockText(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
