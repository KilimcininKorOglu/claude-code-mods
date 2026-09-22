/** Lines of source code that keep browser data in localStorage or sessionStorage instead of a cookie. */

/** Files whose lines are read: JavaScript, TypeScript and the component files that hold them. */
const SOURCE = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|vue|svelte|astro|html)$/

/** The storage named as code: `localStorage.setItem`, `window.sessionStorage`, `{ localStorage }`. */
const STORAGE = /\b(local|session)Storage\b/

/** The storage named in brackets: `window['localStorage']`. */
const BRACKET = /\[\s*(['"`])(local|session)Storage\1\s*\]/

/** A line that starts as a comment in JavaScript, TypeScript or HTML. */
const COMMENT = /^\s*(\/\/|\*|\/\*|<!--)/

/** Quoted string literals, template literals, and what is left of a line after a comment starts on it. */
const QUOTED = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g
const TEMPLATE = /`(?:\\.|[^`\\])*`/g
const INTERPOLATION = /\$\{[^}]*\}/g
const TAIL_COMMENT = /\/\/.*$|\/\*.*?\*\//g

export function isSource(path: string): boolean {
  return SOURCE.test(path)
}

/** The line without its string text; a template literal keeps its `${...}` parts, which are code. */
function codeOf(line: string): string {
  return line
    .replace(TEMPLATE, t => (t.match(INTERPOLATION) ?? []).join(' '))
    .replace(QUOTED, '""')
    .replace(TAIL_COMMENT, '')
}

/** Whether the line uses the storage as code; a word inside a string or a comment is not a use. */
function usesStorage(line: string): boolean {
  if (COMMENT.test(line)) return false
  return BRACKET.test(line) || STORAGE.test(codeOf(line))
}

/** The reported lines the file still uses the storage on; a line now commented out counts as fixed. */
export function stillUsed(text: string, lines: string[]): string[] {
  const used = text.split('\n').filter(usesStorage)
  return lines.filter(l => used.some(u => u.includes(l)))
}

/** The trimmed lines of `after` that use the storage, without those `before` already had. */
export function storageLines(before: string, after: string): string[] {
  const old = new Set(before.split('\n').map(l => l.trim()))
  const found = after.split('\n').filter(usesStorage).map(l => l.trim())
  return [...new Set(found)].filter(l => l !== '' && !old.has(l))
}

/** The 1-based number of the first line of `text` that holds `line`; an Edit's text can be part of a line. */
export function lineOf(text: string, line: string): number | undefined {
  const i = text.split('\n').findIndex(l => l.includes(line))
  return i < 0 ? undefined : i + 1
}

/** Each line as a place in the file: `file:line`, or the file alone when the text was not read. */
export function placesOf(shown: string, text: string | undefined, lines: string[]): string[] {
  return lines.map(l => {
    const n = text === undefined ? undefined : lineOf(text, l)
    return n === undefined ? shown : `${shown}:${n}`
  })
}

/** `path` shown relative to the session directory when it is inside it. */
export function shownPath(path: string, cwd: string): string {
  const base = `${cwd.replace(/\/+$/, '')}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** At most this many places are named, the rest counted. */
const MAX_NAMED = 8

function namedPlaces(places: string[]): string {
  const named = places.slice(0, MAX_NAMED)
  if (places.length > MAX_NAMED) named.push(`${places.length - MAX_NAMED} more`)
  return named.join(' · ')
}

export function noteText(places: string[]): string {
  return `storage-guard: this edit stores data in the browser with localStorage or sessionStorage: ${namedPlaces(places)}. Store it in a cookie instead (document.cookie, or the server's Set-Cookie).`
}

/**
 * The note the model reads at the next prompt while a finding stands, so a finding it did not close
 * reaches it again instead of standing in the pane alone. The person reads the pane and needs no line.
 */
export function openNote(places: string[]): string {
  return `storage-guard: ${places.length} place(s) still store data in localStorage or sessionStorage: ${namedPlaces(places)}. Move the data to a cookie, or take the lines out.`
}

/** The transcript line: the places alone, without the instruction the model reads. The engine adds the mod name. */
export function logText(places: string[]): string {
  return `browser storage instead of a cookie: ${namedPlaces(places)}`
}

/** One sidebar line per place, so the section reads as a list. */
export function sidebarLines(places: string[]): { text: string; kind: 'error' }[] {
  return namedPlaces(places).split(' · ').map(text => ({ text, kind: 'error' }))
}

/** The transcript line of a finding a later edit closed. */
export function doneLog(file: string, places: string[]): string {
  return `the browser storage is gone from ${file}: ${namedPlaces(places)}`
}

/** The sidebar lines of a closed finding: the file, then the places the storage left. */
export function doneLines(file: string, places: string[]): { text: string; kind: 'ok' }[] {
  return [{ text: file, kind: 'ok' }, ...namedPlaces(places).split(' · ').map(text => ({ text, kind: 'ok' as const }))]
}

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit`, `git push` or `git merge` the gate stops while a finding is open. */
const GUARDED = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+(commit|push|merge)\b`)
const ASKING = /\s(--dry-run|--help|-h)(\s|$)/

export function isGuarded(command: string): boolean {
  return GUARDED.test(command) && !ASKING.test(command)
}

/** Whether the command is a `git commit`, the one guarded command whose own files can be measured. */
export function isCommit(command: string): boolean {
  return GUARDED.exec(command)?.[2] === 'commit'
}

/**
 * Whether the index alone says what this commit holds. A `-a` or `-am` commit stages the tracked files
 * as it runs, and a pathspec after `--` commits paths the index does not hold, so neither is narrowed.
 */
export function isNarrowable(command: string): boolean {
  const words = command.split(/\s+/)
  return !words.includes('--') && !words.some(w => w === '--all' || /^-[A-Za-z]*a/.test(w))
}

/** The mode of the mod: a note only, or a note and a gate on git commit, push and merge. */
export type Mode = 'note' | 'deny'

/** The mode a `/storage-guard mode <word>` argument names, or undefined when it is not one. */
export function modeOf(arg: string): Mode | undefined {
  return arg === 'note' || arg === 'deny' ? arg : undefined
}

/** The deny text both the model and the person read: where the storage is used, and the one way out. */
export function denyText(places: readonly string[]): string {
  return `stopped: ${places.length} place(s) store data in localStorage or sessionStorage: ${namedPlaces([...places])}. Move the data to a cookie, then run the command again; there is no way around this gate.`
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
