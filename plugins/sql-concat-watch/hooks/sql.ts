/** Lines of source code that build SQL by joining or interpolating strings. */

/** Files whose lines are read. */
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|php|go|rb|java|kt|cs|rs)$/

/** SQL in upper case. */
const SQL_UPPER = /\bSELECT\b.*\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\S+\s+SET\b|\bDELETE\s+FROM\b|\b(WHERE|VALUES|ORDER BY|GROUP BY|JOIN)\b/

/** SQL in any case, only in shapes English prose does not take ("select a file from the list" does not match). */
const SQL_ANY_CASE = /\bselect\s+(\*|[\w.]+(\s*,\s*[\w.]+)+)\s+from\b|\binsert\s+into\s+[\w."`]+\s*(\(|values\b|select\b)|\bdelete\s+from\s+[\w."`]+\s+where\b|\bupdate\s+[\w."`]+\s+set\s+\w+\s*=/i

/** Ways a line joins a value into a string, across the languages read. */
const JOINS = [
  /["']\s*\+\s*[\w$(]/, // "... " + value (JS, Java, Go, C#, Kotlin)
  /[\w)\]]\s*\+\s*["']/, // value + " ..."
  /\bf"[^"]*\{|\bf'[^']*\{/, // Python f-string
  /["']\s*%\s*[\w(]/, // Python % formatting
  /["']\s*\.format\(/, // Python str.format
  /"[^"]*\$[A-Za-z_{]/, // PHP and Kotlin "... $var"
  /["']\s*\.\s*\$\w|\$\w+\s*\.\s*["']/, // PHP "..." . $var
  /\$"[^"]*\{/, // C# $"... {x}"
  /"[^"]*#\{/, // Ruby "... #{x}"
  /\b(fmt\.Sprintf|String\.format|format!)\(/, // Go, Java, Rust formatting
]

/** The last name of a template tag that makes the values parameters: sql`...`, Prisma.sql`...`, prisma.$queryRaw`...`. */
const SAFE_TAG = /^(sql|SQL|\$queryRaw|\$executeRaw)$/

const isSafeTag = (tag: string): boolean => SAFE_TAG.test(tag.split('.').at(-1) ?? '')

const COMMENT = /^\s*(\/\/|#|\*|\/\*|--)/

export function isSource(path: string): boolean {
  return SOURCE.test(path)
}

function hasSql(text: string): boolean {
  return SQL_ANY_CASE.test(text) || SQL_UPPER.test(text)
}

/** A single line that holds SQL and joins a value into it; a line inside a template literal is left to `templateLines`. */
function joinsSql(line: string): boolean {
  if (COMMENT.test(line) || !hasSql(line)) return false
  const plain = line.replace(/`[^`]*`/g, '``')
  return JOINS.some(re => re.test(plain))
}

/** The lines with a `${` of each untagged or unsafe-tagged template literal that holds SQL. */
function templateLines(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/([\w.$]*)`([^`]*)`/g)) {
    const body = m[2] ?? ''
    if (isSafeTag(m[1] ?? '') ||!body.includes('${') || !hasSql(body)) continue
    const first = body.split('\n').find(l => l.includes('${')) ?? ''
    out.push(text.split('\n').find(l => l.includes(first.trim())) ?? first)
  }
  return out
}

/** The trimmed lines of `after` that build SQL from strings, without those `before` already had. */
export function sqlLines(before: string, after: string): string[] {
  const old = new Set(before.split('\n').map(l => l.trim()))
  const found = [...after.split('\n').filter(joinsSql), ...templateLines(after)].map(l => l.trim())
  return [...new Set(found)].filter(l => l !== '' && !old.has(l))
}

/** The 1-based number of the first line of `text` that holds `line`; an Edit's text can be part of a line. */
export function lineOf(text: string, line: string): number | undefined {
  const i = text.split('\n').findIndex(l => l.includes(line))
  return i < 0 ? undefined : i + 1
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
  return `sql-concat-watch: this edit builds SQL from strings: ${namedPlaces(places)}. Pass values as query parameters (?, $1, :name) instead of joining them into the SQL text.`
}

/** The transcript line: the places alone, without the instruction the model reads. The engine adds the mod name. */
export function logText(places: string[]): string {
  return `SQL built from strings: ${namedPlaces(places)}`
}

/** One sidebar line per place, so the section reads as a list. */
export function sidebarLines(places: string[]): { text: string; kind: 'error' }[] {
  return namedPlaces(places).split(' · ').map(text => ({ text, kind: 'error' }))
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
