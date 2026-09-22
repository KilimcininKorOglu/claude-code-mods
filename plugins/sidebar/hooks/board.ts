/**
 * The pure part of sidebar: the board of sections other mods wrote, their order, and the limits that
 * keep one mod from filling the pane.
 */

import type { SidebarButton, SidebarLine, SidebarSection, SidebarUntil } from '../types/index.d.ts'

/** Lines one section may draw; the rest are counted. */
export const MAX_SECTION_LINES = 50

/** Lines the whole pane may draw. */
export const MAX_BOARD_LINES = 200

/** Entries the stream keeps in memory; the pane draws only as many as its rows take. */
export const MAX_STREAM = 100

/** Entries one consumer keeps in the stream; its own oldest drops first, never another mod's. */
export const MAX_STREAM_PER_CONSUMER = 20

/** Rows one consumer draws of the stream at least, while other consumers write too. */
export const MIN_STREAM_SHARE = 2

/** Buttons one section may draw. */
export const MAX_BUTTONS = 5

/** The order of a section that names none. */
export const DEFAULT_ORDER = 100

const NAME = /^[A-Za-z0-9._:-]+$/

/** A section as the board keeps it: read, cut to the limits, with its own id. */
export type Kept = {
  id: string
  consumer: string
  key: string
  title: string
  lines: SidebarLine[]
  buttons: SidebarButton[]
  until: SidebarUntil
  order: number
  /** Lines over `MAX_SECTION_LINES`, counted instead of drawn. */
  more: number
  /** When the entry was written, in milliseconds since the epoch; a stream entry alone carries it. */
  at?: number
}

export type Board = Map<string, Kept>

function oneLine(text: string): string {
  return text.replace(/[\n\r\t]+/g, ' ').trimEnd()
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && NAME.test(value)
}

function lineOf(value: unknown): SidebarLine | undefined {
  if (typeof value === 'string') return { text: oneLine(value) }
  if (typeof value !== 'object' || value === null) return undefined
  const { text, kind } = value as { text?: unknown; kind?: unknown }
  if (typeof text !== 'string') return undefined
  const ok = kind === 'ok' || kind === 'warn' || kind === 'error' || kind === 'dim'
  return ok ? { text: oneLine(text), kind } : { text: oneLine(text) }
}

function buttonOf(value: unknown): SidebarButton | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { label, command, args } = value as { label?: unknown; command?: unknown; args?: unknown }
  if (typeof label !== 'string' || label.trim() === '' || !isName(command)) return undefined
  return { label: oneLine(label), command, ...(typeof args === 'string' ? { args } : {}) }
}

function listOf<T>(value: unknown, read: (item: unknown) => T | undefined, max: number): T[] {
  if (!Array.isArray(value)) return []
  const out: T[] = []
  for (const item of value.slice(0, max)) {
    const read1 = read(item)
    if (read1 !== undefined) out.push(read1)
  }
  return out
}

export function sectionId(consumer: string, key: string): string {
  return `${consumer}:${key}`
}

function untilOf(value: unknown): SidebarUntil {
  if (value === 'turn') return 'turn'
  return value === 'stream' ? 'stream' : 'session'
}

/**
 * Reads a section another mod handed over. The input is untrusted: a field of another shape is
 * dropped, and the lines and buttons are cut to the limits.
 */
export function readSection(input: SidebarSection): Kept | string {
  if (!isName(input.consumer)) return 'consumer must be 1-64 characters of letters, digits, . _ : or -'
  if (!isName(input.key)) return 'key must be 1-64 characters of letters, digits, . _ : or -'
  if (typeof input.title !== 'string' || input.title.trim() === '') return 'title must be a non-empty string'
  const all = Array.isArray(input.lines) ? input.lines.length : 0
  const lines = listOf(input.lines, lineOf, MAX_SECTION_LINES)
  return {
    id: sectionId(input.consumer, input.key),
    consumer: input.consumer,
    key: input.key,
    title: oneLine(input.title),
    lines,
    buttons: listOf(input.buttons, buttonOf, MAX_BUTTONS),
    until: untilOf(input.until),
    order: typeof input.order === 'number' && Number.isFinite(input.order) ? input.order : DEFAULT_ORDER,
    more: Math.max(0, all - lines.length),
  }
}

/** A section that stays for the session sorts before one that goes at the turn's end. */
const rank = (s: Kept): number => (s.until === 'session' ? 0 : 1)

/**
 * The sections in drawing order: the session's own first, then by `order`, then by consumer and key.
 * A section that comes and goes with the turn never moves a standing one, so the pane does not jump.
 */
export function ordered(board: Board): Kept[] {
  return [...board.values()].sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.consumer.localeCompare(b.consumer) || a.key.localeCompare(b.key))
}

/** Drops every section of a turn; answers whether the board changed. */
export function dropTurn(board: Board): boolean {
  let dropped = false
  for (const [id, section] of board) {
    if (section.until === 'turn' && board.delete(id)) dropped = true
  }
  return dropped
}

/** `[ stop ] sleep 600` cut to the body's width, so a long line does not wrap the pane. */
export function cut(text: string, columns: number): string {
  const width = Math.max(8, columns)
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`
}

/** What a wrapped line's second and further rows are written under, so a list reads as one finding. */
const INDENT = '  '

/** Rows one line may take; a line longer than that is cut, so one finding cannot fill the pane. */
export const MAX_WRAP_ROWS = 4

/**
 * Where a row of at most `room` characters ends: after the last space that fits, so a word is not
 * broken, and at `room` itself when the space sits too far left to be a break worth taking.
 */
function breakAt(text: string, room: number): number {
  const space = text.lastIndexOf(' ', room)
  return space > Math.floor(room / 2) ? space : room
}

/**
 * One line as the rows the pane draws: the text is wrapped at the body's width instead of cut, so the
 * person reads all of it. Every row after the first is indented. A line that asks for more than
 * `MAX_WRAP_ROWS` rows has its last row cut, because one line must not take the whole pane.
 */
export function wrapped(text: string, columns: number): string[] {
  const width = Math.max(8, columns)
  const out: string[] = []
  let rest = text.trimEnd()
  while (out.length + 1 < MAX_WRAP_ROWS) {
    const room = width - INDENT.length
    if (rest.length <= (out.length === 0 ? width : room)) break
    const at = breakAt(rest, out.length === 0 ? width : room)
    out.push(out.length === 0 ? rest.slice(0, at).trimEnd() : INDENT + rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  out.push(out.length === 0 ? cut(rest, width) : INDENT + cut(rest, width - INDENT.length))
  return out
}

/** One drawn line of a section, with the tone it is drawn in. */
export type Row = { text: string; tone?: SidebarLine['kind'] }

/** One section as the pane draws it: its heading, its lines cut to the width, and its buttons. */
export type Drawn = { id: string; head: string; rows: Row[]; buttons: SidebarButton[] }

const pad = (n: number): string => String(n).padStart(2, '0')

/** When a stream entry was written, in the machine's own time zone: `21.09 14:32`. */
export function stamp(at: number): string {
  const d = new Date(at)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The heading of one section: the consumer and the title, and for a stream entry the day and time it
 * was written, because that log keeps every entry and the person reads it after the fact.
 */
export function headText(section: Kept): string {
  const head = `${section.consumer}: ${section.title}`
  return section.at === undefined ? head : `${head} (${stamp(section.at)})`
}

function drawSection(section: Kept, columns: number, left: number): Drawn {
  const rows: Row[] = []
  let drawn = 0
  for (const line of section.lines) {
    const wrap = wrapped(line.text, columns)
    if (rows.length + wrap.length > Math.max(0, left)) break
    for (const text of wrap) rows.push({ text, ...(line.kind === undefined ? {} : { tone: line.kind }) })
    drawn += 1
  }
  const hidden = section.more + (section.lines.length - drawn)
  if (hidden > 0 && rows.length < left) rows.push({ text: cut(`+${hidden} more line(s)`, columns), tone: 'dim' })
  return { id: section.id, head: cut(headText(section), columns), rows, buttons: section.buttons }
}

/** Draws one section into `out` with `left` rows to spend; answers the rows it took, 0 for none. */
function addSection(out: Drawn[], section: Kept, columns: number, left: number): number {
  if (left <= 1) return 0
  const one = drawSection(section, columns, left - 1)
  out.push(one)
  return 1 + one.rows.length
}

/** The rows a stream entry asks for: its heading and its lines. */
const cost = (s: Kept): number => 1 + s.lines.length

/**
 * The stream entries the pane draws, in the stream's own order. Each consumer takes at most its share
 * of the rows while another consumer writes too, so one talkative mod cannot push every other mod's
 * entry off the pane. A second pass hands the rows the shares left over to the entries they held
 * back, so a consumer writing alone still fills the whole area.
 */
export function picked(stream: readonly Kept[], rows: number): Kept[] {
  const names = new Set(stream.map(s => s.consumer))
  if (names.size < 2) return [...stream]
  const share = Math.max(MIN_STREAM_SHARE, Math.floor(rows / names.size))
  const used = new Map<string, number>()
  const keep = new Set<Kept>()
  const later: Kept[] = []
  let left = rows
  for (const entry of stream) {
    const before = used.get(entry.consumer) ?? 0
    if (before + cost(entry) > share) {
      later.push(entry)
      continue
    }
    used.set(entry.consumer, before + cost(entry))
    left -= cost(entry)
    keep.add(entry)
  }
  for (const entry of later) {
    if (left <= 1) break
    left -= cost(entry)
    keep.add(entry)
  }
  return stream.filter(e => keep.has(e))
}

/**
 * The pane's content: the standing sections first, then the stream newest first, cut to `columns` and
 * to `rows`, the pane's own height. The stream's oldest entries are the ones the rows run out on, so
 * a new entry pushes the oldest off the pane. A section the room left over is too small for is left
 * out, and what it left out is counted in its own last row.
 */
export function drawn(board: Board, stream: readonly Kept[], columns: number, rows: number): Drawn[] {
  const out: Drawn[] = []
  let left = Math.min(Math.max(0, rows), MAX_BOARD_LINES)
  for (const section of ordered(board)) {
    const spent = addSection(out, section, columns, left)
    if (spent === 0) return out
    left -= spent
  }
  for (const entry of picked(stream, left)) {
    const spent = addSection(out, entry, columns, left)
    if (spent === 0) break
    left -= spent
  }
  return out
}

/**
 * The stream with the new entry at its head, cut to what it keeps in memory. A consumer over its own
 * count drops its own oldest entry, so a talkative mod never evicts another mod's finding.
 */
export function pushed(stream: readonly Kept[], entry: Kept): Kept[] {
  const mine = stream.filter(s => s.consumer === entry.consumer)
  const drop = new Set(mine.slice(MAX_STREAM_PER_CONSUMER - 1))
  const kept = drop.size === 0 ? stream : stream.filter(s => !drop.has(s))
  return [entry, ...kept].slice(0, MAX_STREAM)
}

/** The line a pane with no section draws. */
export const EMPTY_TEXT = 'No mod wrote anything yet. A mod writes here while the sidebar is open.'

/** Lines one day's log file keeps; the oldest go when the file passes it. */
export const LOG_MAX = 500

/** Stream entries a new session takes back from the log. */
export const LOG_RESTORE = 10

/** One logged entry: what a stream entry was, and when it was written. */
export type Logged = { at: number; section: SidebarSection }

/** The project a directory names, as the log file's own name spells it. */
export function projectOf(cwd: string): string {
  const last = cwd.split('/').filter(p => p !== '').pop() ?? 'project'
  return last.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 64) || 'project'
}

/** The day a time falls on, as the log file's own name spells it: `2026-09-21`. */
export function dayOf(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The log file of one project and one day. */
export function logName(project: string, at: number): string {
  return `${project}-${dayOf(at)}.log`
}

/** Whether a file name is the log of that project, so another project's log is left alone. */
export function isLogOf(project: string, name: string): boolean {
  return name.startsWith(`${project}-`) && name.endsWith('.log')
}

/** One line of the log: the entry as data, on one line, so a log is read back line by line. */
export function logLineOf(entry: Kept): string {
  const { consumer, key, title, lines } = entry
  return JSON.stringify({ at: entry.at ?? 0, consumer, key, title, lines })
}

/**
 * The log line of a `clear` that took stream entries down. The entries stay in the log as history, and
 * this line keeps a later session from taking them back, so a closed finding does not return beside its
 * own closing line.
 */
export function clearLineOf(consumer: string, key: string, at: number): string {
  return JSON.stringify({ at, cleared: { consumer, key } })
}

/** The section id a clear line took down, or undefined for a line of another shape. */
function clearedOf(line: string): string | undefined {
  try {
    const read = JSON.parse(line) as { cleared?: { consumer?: unknown; key?: unknown } }
    const { consumer, key } = read.cleared ?? {}
    return isName(consumer) && isName(key) ? sectionId(consumer, key) : undefined
  } catch {
    return undefined
  }
}

/** The entries a log text still holds up, oldest first: an entry a later clear line took down is left out. */
export function readLive(text: string): Logged[] {
  let out: Logged[] = []
  for (const line of text.split('\n')) {
    const gone = clearedOf(line)
    if (gone !== undefined) {
      out = out.filter(one => sectionId(one.section.consumer, one.section.key) !== gone)
      continue
    }
    const one = line.trim() === '' ? undefined : loggedOf(line)
    if (one !== undefined) out.push(one)
  }
  return out
}

/** The log's own lines, newest last, cut to what one file keeps. */
export function logKept(lines: readonly string[], line: string): string[] {
  return [...lines, line].slice(-LOG_MAX)
}

/**
 * The entries one log file holds, oldest first. A line of another shape is dropped without a word,
 * because a log file is read as untrusted data: a hand-edited or truncated line must not stop a session.
 */
export function readLog(text: string): Logged[] {
  const out: Logged[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const one = loggedOf(line)
    if (one !== undefined) out.push(one)
  }
  return out
}

function loggedOf(line: string): Logged | undefined {
  try {
    const read = JSON.parse(line) as { at?: unknown; consumer?: unknown; key?: unknown; title?: unknown; lines?: unknown }
    if (typeof read.at !== 'number' || !isName(read.consumer) || !isName(read.key) || typeof read.title !== 'string') return undefined
    const lines = listOf(read.lines, lineOf, MAX_SECTION_LINES)
    return { at: read.at, section: { consumer: read.consumer, key: read.key, title: read.title, lines, until: 'stream' } }
  } catch {
    return undefined
  }
}

/** The `/sidebar log` answer: where the log is, and its newest entries with their own times. */
export function tailText(path: string, entries: readonly Logged[]): string {
  if (entries.length === 0) return `${path}: no entry yet`
  const rows = entries.slice(-LOG_RESTORE).reverse()
  return [path, ...rows.map(one => `${stamp(one.at)} ${one.section.consumer}: ${one.section.title}`)].join('\n')
}
