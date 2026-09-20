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

/** One drawn line of a section, with the tone it is drawn in. */
export type Row = { text: string; tone?: SidebarLine['kind'] }

/** One section as the pane draws it: its heading, its lines cut to the width, and its buttons. */
export type Drawn = { id: string; head: string; rows: Row[]; buttons: SidebarButton[] }

function drawSection(section: Kept, columns: number, left: number): Drawn {
  const rows: Row[] = section.lines
    .slice(0, Math.max(0, left))
    .map(line => ({ text: cut(line.text, columns), ...(line.kind === undefined ? {} : { tone: line.kind }) }))
  const hidden = section.more + Math.max(0, section.lines.length - rows.length)
  if (hidden > 0 && rows.length < left) rows.push({ text: cut(`+${hidden} more line(s)`, columns), tone: 'dim' })
  return { id: section.id, head: cut(`${section.consumer}: ${section.title}`, columns), rows, buttons: section.buttons }
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
