/**
 * The hooks module's side of a memory reminder: which tool calls bring one, the paths and query they
 * give the daemon, the budget the context leaves, the pick that fits it, the text the model reads,
 * and whether an answer used what it was reminded of. Pure code; `register.tsx` makes every call.
 */
import { wordLine, type Line } from './link.ts'
import type { Anchor, Memory, Ranked } from './shared/model.ts'
import { collapseSpace, textKey } from './shared/text.ts'

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

/**
 * The part of a path that says which file it is: the path under the project root, or the file name
 * of a path outside it. The root's own words (home directory, repository name) are the same for every
 * file, so as query terms they matched every memory that names the project.
 */
function ownPath(path: string, root: string): string {
  if (root !== '' && path.startsWith(`${root}/`)) return path.slice(root.length + 1)
  return path.startsWith('/') ? (path.split('/').pop() ?? '') : path
}

/** The query of a tool reminder: the paths spelled out as terms, the patterns, and the tasks in progress. */
export function queryOf(calls: readonly ToolCall[], paths: readonly string[], tasks: readonly string[], root: string): string {
  const pathTerms = paths.map(path => ownPath(path, root).split(/[/\\._-]+/).join(' '))
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

/** An attribute value, escaped so it cannot close the attribute or the element. */
function attribute(name: string, value: string): string {
  return ` ${name}="${escaped(value).replace(/"/g, '&quot;')}"`
}

/** How much a memory weighs, by its importance (SAGE's labels); none below high. */
function priorityOf(memory: Memory): string | undefined {
  if (memory.importance >= 0.9) return 'critical'
  return memory.importance >= 0.75 ? 'high' : undefined
}

/** What the first anchor names: a path with its symbol, a path, a symbol, a command or an agent role. */
function aboutOf(memory: Memory): string | undefined {
  const anchor = memory.anchors.find(a => a.path ?? a.symbol ?? a.command ?? a.role)
  if (!anchor) return undefined
  const target = anchor.path && anchor.symbol ? `${anchor.path}#${anchor.symbol}` : (anchor.path ?? anchor.symbol ?? anchor.command ?? anchor.role)
  return `${anchor.type} ${target}`
}

/** The optional attributes: priority, a permanent persistence, the first anchor and up to three tags. */
function detailAttributes(memory: Memory): string {
  const priority = priorityOf(memory)
  const about = aboutOf(memory)
  const tags = memory.tags.slice(0, 3)
  return [
    priority ? attribute('priority', priority) : '',
    memory.persistence === 'permanent' ? attribute('persistence', 'permanent') : '',
    about ? attribute('about', about) : '',
    tags.length > 0 ? attribute('tags', tags.join(',')) : '',
  ].join('')
}

/**
 * One memory as the model reads it, inside its own fence. The anchor tells the model which file or
 * symbol to check the note against, and the priority tells a critical warning from an ordinary note.
 */
export function memoryEntry(memory: Memory): string {
  return `<memory id="${memory.id}" kind="${memory.kind}" scope="${memory.scope}" status="${memory.status}"${detailAttributes(memory)}>\n${escaped(memory.text)}\n</memory>`
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
export const SYSTEM_NOTE = `The user installed the sage-memory plugin. It keeps notes about this project across sessions and adds the relevant ones to the conversation in [sage-memory] blocks, each note inside a <memory> element: after file tools, with the user's prompt, and when a subagent starts. Every note of the user scope is a global rule of the user: all of them come with the first prompt of a context and again after a compaction, and they hold in every task. ${LOOKUP} Use the notes as background; a note may be out of date, so check it against the files before relying on it. ${FIX} ${SAVE}`

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

/**
 * The user's global rules, every active user memory, with no count or size limit: the user chose
 * that they reach each context on their own, not only when a prompt or a file makes them relevant.
 */
export function globalReminder(rules: readonly Memory[], framed: boolean): { text: string; sent: Memory[] } {
  return reminderBlock("the user's global rules, which hold in every project and every task", rules, Number.POSITIVE_INFINITY, framed)
}

/**
 * What a subagent starts with: the user's global rules in full, then the memories written for its
 * role or mode and the ones about its task, each once and within the subagent budget. `rules` names
 * the global rules it sent, which are recorded apart from the rest.
 */
export function subagentReminder(rules: readonly Memory[], audience: readonly Memory[], task: readonly Ranked[]): { text: string; sent: Memory[]; rules: Memory[] } {
  const global = globalReminder(rules, true)
  const all = [...audience, ...task.map(item => item.memory)].filter(memory => !rules.some(rule => rule.id === memory.id))
  const memories = all.filter((memory, i) => all.findIndex(other => other.id === memory.id) === i)
  const own = reminderBlock('project memory for this agent and its task', memories, SUBAGENT_CHARS, global.sent.length === 0)
  const blocks = [global, own].filter(block => block.sent.length > 0)
  return { text: blocks.map(block => block.text).join('\n\n'), sent: blocks.flatMap(block => block.sent), rules: global.sent }
}

/** The prompt that goes to a subagent: the reminder block first, then the task as it was written. */
export function spawnPrompt(block: string, prompt: string): string {
  return `${block}\n\n${prompt}`
}

/**
 * The reminded memories an answer names by id. Words the answer shares with a memory are no
 * evidence: they depend on the language of each, and an answer that says a memory is wrong shares them too.
 */
export function usedBy(answer: string, reminded: readonly Memory[]): Memory[] {
  return reminded.filter(memory => answer.includes(memory.id))
}

/** The shortest anchored command a Bash command must hold to act on it, so `ls` does not match every listing. */
const COMMAND_MIN = 4

/** A path without its trailing slashes and a leading `./`. */
function trimmedPath(path: string): string {
  return path.replace(/\/+$/, '').replace(/^\.\//, '')
}

/** Whether a changed path is the anchored file (a project-relative path the absolute one ends with) or lies under the anchored directory. */
function changes(path: string, anchor: Anchor): boolean {
  const target = trimmedPath(anchor.path ?? '')
  if (target === '' || target === '.') return false
  if (anchor.type === 'directory') return path.startsWith(`${target}/`) || path.includes(`/${target}/`)
  return path === target || path.endsWith(`/${target}`)
}

/** Whether a Bash command runs the anchored command. */
function runs(command: string, anchor: Anchor): boolean {
  const target = anchor.command?.trim() ?? ''
  return anchor.type === 'command' && target.length >= COMMAND_MIN && command.includes(target)
}

/**
 * The reminded memories a tool call acted on: an edit of a file a memory is anchored to (or of a file
 * under its directory), or a Bash command that runs its anchored command. A read is not counted,
 * because reading the file is what brings its memories.
 */
export function actedOn(call: ToolCall, reminded: readonly Memory[]): Memory[] {
  const paths = CHANGE_TOOLS.has(call.tool_name) ? pathsOf(call).map(trimmedPath) : []
  const command = call.tool_name === 'Bash' ? (stringField(call.tool_input, 'command') ?? '') : ''
  if (paths.length === 0 && command === '') return []
  return reminded.filter(memory => memory.anchors.some(anchor => paths.some(path => changes(path, anchor)) || (command !== '' && runs(command, anchor))))
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
