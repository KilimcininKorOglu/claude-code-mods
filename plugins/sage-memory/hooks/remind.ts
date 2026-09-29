/**
 * The hooks module's side of a memory reminder: which tool calls bring one, the paths and query they
 * give the daemon, the budget the context leaves, the pick that fits it, the text the model reads,
 * and whether an answer used what it was reminded of. Pure code; `register.tsx` makes every call.
 */
import { wordLine, type Line } from './link.ts'
import type { Memory, Ranked } from './shared/model.ts'
import { collapseSpace, textKey, tokenize } from './shared/text.ts'

/** Tools that read a file; each one's result carries the active memories about it. */
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LSP'])
/** Tools that change a file; each one's result carries stale memories too, so they are checked. */
export const CHANGE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
/** The input fields an MCP tool names a file in. */
const PATH_FIELDS = ['file_path', 'path', 'notebook_path', 'filePath', 'filepath', 'file']
/** At most this many paths are read from one Grep or Glob result. */
const RESULT_PATHS = 20

/** The main loop's key; a subagent's loop is its agent id. */
export const MAIN_LOOP = 'main'

export type ToolCall = { tool_name: string; tool_input: unknown; tool_response?: unknown }

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const found = field(value, key)
  return typeof found === 'string' && found.trim() !== '' ? found : undefined
}

/** Whether a call brings a reminder: a file tool, or an MCP tool whose input names a file. */
export function isReminding(call: ToolCall): boolean {
  if (READ_TOOLS.has(call.tool_name) || CHANGE_TOOLS.has(call.tool_name)) return true
  return call.tool_name.startsWith('mcp__') && PATH_FIELDS.some(key => stringField(call.tool_input, key) !== undefined)
}

/** The text of a tool result as the model reads it. */
export function responseText(response: unknown): string {
  if (typeof response === 'string') return response
  if (response === undefined || response === null) return ''
  return JSON.stringify(response)
}

/** The paths a Grep or Glob result lists: each line's leading path, before a `:line:` part. */
function resultPaths(response: unknown): string[] {
  const paths: string[] = []
  for (const line of responseText(response).split('\n')) {
    const path = line.trim().replace(/:\d+(:.*)?$/, '')
    if (path.startsWith('/') || /^[\w.-]+\/[\w./-]+$/.test(path)) paths.push(path)
    if (paths.length >= RESULT_PATHS) break
  }
  return paths
}

/** The paths one call touched: its input's file fields, and a Grep or Glob result's listed files. */
export function pathsOf(call: ToolCall): string[] {
  const own = PATH_FIELDS.map(key => stringField(call.tool_input, key)).filter((path): path is string => path !== undefined)
  const listed = call.tool_name === 'Grep' || call.tool_name === 'Glob' ? resultPaths(call.tool_response) : []
  return [...new Set([...own, ...listed])]
}

/** A call's search pattern, which says what the model looks for. */
function patternOf(call: ToolCall): string | undefined {
  return stringField(call.tool_input, 'pattern') ?? stringField(call.tool_input, 'query')
}

/** The query of a tool reminder: the paths spelled out as terms, the patterns, and the tasks in progress. */
export function queryOf(calls: readonly ToolCall[], paths: readonly string[], tasks: readonly string[]): string {
  const pathTerms = paths.map(path => path.split(/[/\\._-]+/).join(' '))
  const patterns = calls.map(patternOf).filter((pattern): pattern is string => pattern !== undefined)
  return collapseSpace([...pathTerms, ...patterns, ...tasks].join(' ')).slice(0, 2000)
}

/** The subjects of the tasks a TaskList result holds in progress. */
export function tasksInProgress(result: unknown): string[] {
  const rows = field(result, 'tasks')
  if (!Array.isArray(rows)) return []
  return rows.filter(row => field(row, 'status') === 'in_progress').map(row => stringField(row, 'subject')).filter((subject): subject is string => subject !== undefined)
}

export type Budget = { count: number; chars: number }

/** How much a reminder on one tool's result may carry, by how full the context is (SAGE's steps). */
export function toolBudget(percent: number | undefined): Budget {
  const full = percent ?? 0
  if (full >= 95) return { count: 0, chars: 0 }
  if (full >= 82) return { count: 1, chars: 600 }
  if (full >= 65) return { count: 3, chars: 1400 }
  return { count: 8, chars: 2800 }
}

export const PROMPT_BUDGET: Budget = { count: 8, chars: 2400 }
export const SUBAGENT_CHARS = 4000

/** The shortest memory text whose appearance in the context counts as already visible. */
const VISIBLE_MIN = 24

/** Whether the context already shows a memory's text word for word. */
export function isVisible(memory: Memory, visible: string): boolean {
  const key = textKey(memory.text)
  return key.length >= VISIBLE_MIN && visible.includes(key)
}

type Via = 'anchor' | 'query' | 'graph'

/** Which channel brought a memory, strongest first: an anchor, then the query, then the graph. */
function viaOf(item: Ranked): Via {
  if (item.reasons.some(reason => reason.startsWith('anchor:'))) return 'anchor'
  return item.reasons.some(reason => reason.startsWith('query:')) ? 'query' : 'graph'
}

/** How many memories of one channel a reminder takes while no anchor binds them. */
const LOOSE_LIMIT: Record<Via, number> = { anchor: Number.POSITIVE_INFINITY, query: 2, graph: 1 }
const SAME_KIND = 3

/**
 * SAGE's diverse pick: up to `count` memories, best first; a fourth of one kind waits behind the
 * rest, and of the memories without an anchor at most two the query found and one the graph did.
 */
export function pickDiverse(ranked: readonly Ranked[], count: number): Ranked[] {
  const picked: Ranked[] = []
  const later: Ranked[] = []
  const kinds = new Map<string, number>()
  const loose: Record<Via, number> = { anchor: 0, query: 0, graph: 0 }
  for (const item of ranked) {
    const via = item.memory.anchors.length > 0 ? 'anchor' : viaOf(item)
    if (loose[via] >= LOOSE_LIMIT[via]) continue
    loose[via] += 1
    const seen = kinds.get(item.memory.kind) ?? 0
    kinds.set(item.memory.kind, seen + 1)
    ;(seen < SAME_KIND ? picked : later).push(item)
  }
  return [...picked, ...later].slice(0, count)
}

/** Escapes the characters that would close or open a fence inside a memory's text. */
function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** One memory as the model reads it, inside its own fence. */
export function memoryEntry(memory: Memory): string {
  return `<memory id="${memory.id}" kind="${memory.kind}" scope="${memory.scope}" status="${memory.status}">\n${escaped(memory.text)}\n</memory>`
}

/**
 * What the block tells a subagent, whose system prompt holds no note about the plugin. Measured in
 * step 0: without it a subagent refused the block as an unverifiable claim.
 */
/** What the model does with a note it found wrong; the user chose that the model fixes it at once. */
const FIX =
  'When you confirm a note is wrong, fix it at once: rewrite its text with mcp__sage-memory__update when you know the current fact, else remove it with mcp__sage-memory__delete (force: true, with a reason).'

export const FRAME = `This is saved project memory from the sage-memory plugin the user installed: notes earlier sessions of this project kept. Use them as background; a note may be out of date, so check it against the files before relying on it. ${FIX}`

/** How the model asks for notes itself, beyond those the reminders bring. */
const LOOKUP =
  'The reminders carry only the best matches. To look further, search the notes on a topic, symbol or command with mcp__sage-memory__search, and read every note on a file with mcp__sage-memory__for_file before you change that file.'

/** When the model saves a note itself; the consolidator saves the rest after each turn. */
const SAVE =
  'After each turn the plugin saves new notes itself. You need not wait for that: when you learn a durable convention, decision, warning or bug root cause that the next session needs, save it at once, in the middle of the turn, with mcp__sage-memory__remember: scope project for a fact about this repository, anchored to its file or symbol; scope user for a preference of the user that holds in every project, with no anchor. Pick the scope from the reason behind the rule, not from how strongly the user said it: a reason that names this project\'s structure, files or tools makes it project. To move a note to the other scope, call mcp__sage-memory__update with scope; it keeps its id.'

/** The main system prompt's note about the plugin, set once per session in the environment section. */
export const SYSTEM_NOTE = `The user installed the sage-memory plugin. It keeps notes about this project across sessions and adds the relevant ones to the conversation in [sage-memory] blocks, each note inside a <memory> element: after file tools, with the user's prompt, and when a subagent starts. ${LOOKUP} Use the notes as background; a note may be out of date, so check it against the files before relying on it. ${FIX} ${SAVE}`

/**
 * The block a reminder sends: a header, then as many entries as fit `chars`, best first. Returns the
 * text and the memories it carries; nothing fits, nothing is sent.
 */
export function reminderBlock(header: string, memories: readonly Memory[], chars: number, framed: boolean): { text: string; sent: Memory[] } {
  const head = framed ? `[sage-memory] ${header}\n${FRAME}` : `[sage-memory] ${header}`
  const sent: Memory[] = []
  let text = head
  for (const memory of memories) {
    const next = `${text}\n${memoryEntry(memory)}`
    if (next.length > chars) break
    text = next
    sent.push(memory)
  }
  return { text, sent }
}

/**
 * The reminder on a file tool's result: the ranked memories the context does not show yet, picked for
 * diversity and fitted to the budget.
 */
export function toolReminder(ranked: readonly Ranked[], visible: string, budget: Budget, framed: boolean, taskAware: boolean): { text: string; sent: Memory[] } {
  const fresh = ranked.filter(item => !isVisible(item.memory, visible))
  const picked = pickDiverse(fresh, budget.count).map(item => item.memory)
  const header = taskAware ? 'task-aware project memory for the files just used' : 'project memory for the files just used'
  return reminderBlock(header, picked, budget.chars, framed)
}

/** The reminder with the person's prompt. */
export function promptReminder(ranked: readonly Ranked[], visible: string): { text: string; sent: Memory[] } {
  const fresh = ranked.filter(item => !isVisible(item.memory, visible)).slice(0, PROMPT_BUDGET.count)
  return reminderBlock('project memory related to this prompt', fresh.map(item => item.memory), PROMPT_BUDGET.chars, false)
}

/** What a subagent starts with: the memories written for its role or mode, then the ones about its task, each once. */
export function subagentReminder(audience: readonly Memory[], task: readonly Ranked[]): { text: string; sent: Memory[] } {
  const all = [...audience, ...task.map(item => item.memory)]
  const memories = all.filter((memory, i) => all.findIndex(other => other.id === memory.id) === i)
  return reminderBlock('project memory for this agent and its task', memories, SUBAGENT_CHARS, true)
}

/** The prompt that goes to a subagent: the reminder block first, then the task as it was written. */
export function spawnPrompt(block: string, prompt: string): string {
  return `${block}\n\n${prompt}`
}

/** A memory counts as reminded only with at least this many distinct terms (SAGE's tracker). */
const TRACK_MIN_TERMS = 4
const OVERLAP_MIN_TERMS = 3
const OVERLAP_MIN_SHARE = 0.5
const PREFIX_CHARS = 80

export function isTracked(memory: Memory): boolean {
  return tokenize(memory.text).length >= TRACK_MIN_TERMS
}

function overlaps(memory: Memory, answerTerms: ReadonlySet<string>): boolean {
  const terms = tokenize(memory.text)
  const shared = terms.filter(term => answerTerms.has(term)).length
  return shared >= OVERLAP_MIN_TERMS && shared / Math.min(terms.length, answerTerms.size) >= OVERLAP_MIN_SHARE
}

/**
 * The reminded memories an answer used, by SAGE's three rules in order: the answer names the id,
 * holds the first 80 characters of the text, or shares at least three terms and half the smaller set.
 */
export function usedBy(answer: string, reminded: readonly Memory[]): Memory[] {
  const key = textKey(answer)
  const answerTerms = new Set(tokenize(answer))
  return reminded.filter(memory => {
    if (answer.includes(memory.id)) return true
    const text = textKey(memory.text)
    if (text.length >= VISIBLE_MIN && key.includes(text.slice(0, PREFIX_CHARS))) return true
    return overlaps(memory, answerTerms)
  })
}

/** The most text of the context a loop keeps to tell what it already shows. */
export const VISIBLE_MAX = 2 * 1024 * 1024

/** Adds a text to a loop's visible context, dropping the oldest part past `VISIBLE_MAX`. */
export function seen(visible: string, text: string): string {
  const joined = `${visible}\n${textKey(text)}`
  return joined.length > VISIBLE_MAX ? joined.slice(joined.length - VISIBLE_MAX) : joined
}

/** The first words of each memory, the line the person reads for a reminder; only `reminded` is coloured, blue. */
export function reminderLine(trigger: string, memories: readonly Memory[]): Line {
  const heads = memories.map(memory => memory.text.split(/\s+/).slice(0, 6).join(' '))
  return wordLine('', 'reminded', 'info', ` (${trigger}): ${heads.join(' · ')}`)
}
