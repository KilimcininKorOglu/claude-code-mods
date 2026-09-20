/** The keys each language's locale files define, and the keys an edit uses that a language lacks. */
import { unescape } from './keys.ts'

/** Directories under the session directory that hold locale files. */
export const LOCALE_DIRS = ['locales', 'lang', 'i18n', 'translations', 'locale', 'config/locales', 'resources/lang', 'src/locales', 'src/i18n', 'public/locales']

export const LOCALE_EXT = /\.(json|php|ya?ml|po)$/

/** A language code: two letters, with an optional region or script (`tr`, `en-US`, `pt_BR`, `zh-Hant`). */
const LANG = /^[a-z]{2}(?:[_-][A-Za-z]{2,4})?$/

/** Defined keys per language code. */
export type Catalog = Map<string, Set<string>>

/** A key and the languages that lack it, `all` when no language has it. */
export type Missing = { key: string; langs: string[] | 'all' }

/** Whether an edit of `path` can change the catalog. */
export function isLocalePath(path: string): boolean {
  return LOCALE_EXT.test(path) && LOCALE_DIRS.some(d => path.includes(`/${d}/`))
}

/**
 * The language of a locale file and its namespace, from its path relative to the locale directory:
 * `tr/messages.php` and `tr/LC_MESSAGES/django.po` by directory, `tr.json` and `messages.tr.yaml` by name.
 */
export function fileLang(rel: string): { lang: string; ns?: string } | undefined {
  const parts = rel.split('/')
  const stem = (parts.pop() ?? '').replace(LOCALE_EXT, '')
  const dirLang = parts.find(p => LANG.test(p))
  if (dirLang !== undefined) return { lang: dirLang, ns: stem }
  const dotted = stem.split('.')
  const lang = dotted.pop() ?? ''
  if (!LANG.test(lang)) return undefined
  return dotted.length > 0 ? { lang, ns: dotted.join('.') } : { lang }
}

/** i18next plural forms: `item_one` also defines `item`, the key `t('item', { count })` names. */
const PLURAL = /_(zero|one|two|few|many|other)$/

function flatten(value: unknown, prefix: string, out: string[]): void {
  if (prefix !== '') out.push(prefix)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  for (const [k, v] of Object.entries(value)) flatten(v, prefix === '' ? k : `${prefix}.${k}`, out)
}

/** Nested JSON keys as dotted paths; a parse error throws. */
export function jsonKeys(text: string): string[] {
  const out: string[] = []
  flatten(JSON.parse(text) as unknown, '', out)
  return out.flatMap(k => (PLURAL.test(k) ? [k, k.replace(PLURAL, '')] : [k]))
}

const PHP_KEY = /^\s*(['"])(.+?)\1\s*=>\s*(.*)$/
const PHP_OPEN = /^(\[|array\()\s*(\/\/.*)?$/
const PHP_CLOSE = /^\s*[\])]/

/** Keys of a PHP array file, one `'key' => ...` per line; an array that opens at the end of a line nests. */
export function phpKeys(text: string): string[] {
  const stack: string[] = []
  const out: string[] = []
  for (const line of text.split('\n')) {
    const m = PHP_KEY.exec(line)
    if (m === null) {
      if (PHP_CLOSE.test(line)) stack.pop()
      continue
    }
    const key = m[2] ?? ''
    out.push([...stack, key].join('.'))
    if (PHP_OPEN.test((m[3] ?? '').trim())) stack.push(key)
  }
  return out
}

const YAML_KEY = /^( *)(["']?)([^\s#'"-][^:]*?)\2:(?:\s|$)/

/** Keys of a YAML mapping by indent; a Rails file's top key, the language, is also left out. */
export function yamlKeys(text: string, lang: string): string[] {
  const stack: { indent: number; key: string }[] = []
  const out: string[] = []
  for (const line of text.split('\n')) {
    const m = YAML_KEY.exec(line)
    if (m === null) continue
    const indent = (m[1] ?? '').length
    while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop()
    stack.push({ indent, key: m[3] ?? '' })
    out.push(stack.map(s => s.key).join('.'))
  }
  return out.flatMap(k => (k.startsWith(`${lang}.`) ? [k, k.slice(lang.length + 1)] : [k]))
}

/** The `msgid` strings of a gettext file, with continuation lines joined. */
export function poKeys(text: string): string[] {
  const out: string[] = []
  let current: string | undefined
  for (const line of text.split('\n')) {
    const id = /^msgid\s+"(.*)"\s*$/.exec(line)
    const more = /^"(.*)"\s*$/.exec(line)
    if (id !== null) current = unescape(id[1] ?? '')
    else if (more !== null && current !== undefined) current += unescape(more[1] ?? '')
    else {
      if (current) out.push(current)
      current = undefined
    }
  }
  if (current) out.push(current)
  return out
}

function fileKeys(rel: string, text: string, lang: string): string[] {
  if (rel.endsWith('.json')) return jsonKeys(text)
  if (rel.endsWith('.php')) return phpKeys(text)
  if (rel.endsWith('.po')) return poKeys(text)
  return yamlKeys(text, lang)
}

/** Adds one locale file; a key of a namespace file is also added as `ns.key` and `ns:key`. A JSON parse error throws. */
export function addFile(catalog: Catalog, rel: string, text: string): void {
  const where = fileLang(rel)
  if (where === undefined) return
  // Keys first, so a file that does not parse adds no empty language.
  const keys = fileKeys(rel, text, where.lang)
  const set = catalog.get(where.lang) ?? new Set<string>()
  catalog.set(where.lang, set)
  for (const key of keys) {
    set.add(key)
    if (where.ns !== undefined) set.add(`${where.ns}.${key}`).add(`${where.ns}:${key}`)
  }
}

/** The keys some language lacks; nothing when the catalog has no language. */
export function missingKeys(catalog: Catalog, keys: string[]): Missing[] {
  const langs = [...catalog.keys()].sort()
  const out: Missing[] = []
  for (const key of keys) {
    const lacking = langs.filter(l => catalog.get(l)?.has(key) !== true)
    if (lacking.length > 0) out.push({ key, langs: lacking.length === langs.length ? 'all' : lacking })
  }
  return out
}

/** At most this many keys are named in the note, the rest counted. */
const MAX_NAMED = 10

function namedKeys(missing: Missing[]): string {
  const named = missing.slice(0, MAX_NAMED).map(m => `${m.key} (missing in ${m.langs === 'all' ? 'every locale' : m.langs.join(', ')})`)
  if (missing.length > MAX_NAMED) named.push(`${missing.length - MAX_NAMED} more`)
  return named.join(' · ')
}

export function noteText(missing: Missing[]): string {
  return `i18n-watch: this edit uses translation keys the locale files lack: ${namedKeys(missing)}. Add them to each locale file.`
}

/** The transcript line: the keys alone, without the instruction the model reads. The engine adds the mod name. */
export function logText(missing: Missing[]): string {
  return `keys the locale files lack: ${namedKeys(missing)}`
}

/** One sidebar line per missing key, so the section reads as a list. */
export function sidebarLines(missing: Missing[]): { text: string; kind: 'error' }[] {
  return namedKeys(missing).split(' · ').map(text => ({ text, kind: 'error' }))
}

/** The keys a file's finding holds open after a new report: the earlier ones and the new ones, each once. */
export function openKeys(before: string[] | undefined, missing: Missing[]): string[] {
  return [...new Set([...(before ?? []), ...missing.map(m => m.key)])]
}

function namedPlain(keys: string[]): string {
  const named = keys.slice(0, MAX_NAMED)
  if (keys.length > MAX_NAMED) named.push(`${keys.length - MAX_NAMED} more`)
  return named.join(' · ')
}

/** The transcript line of a finding an edit of a locale file closed. */
export function doneLog(file: string, keys: string[]): string {
  return `every locale now has the keys ${file} lacked: ${namedPlain(keys)}`
}

/** The sidebar lines of a closed finding: the file, then the keys every locale now has. */
export function doneLines(file: string, keys: string[]): { text: string; kind: 'ok' }[] {
  return [{ text: file, kind: 'ok' }, ...namedPlain(keys).split(' · ').map(text => ({ text, kind: 'ok' as const }))]
}

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit`, `git push` or `git merge` the gate stops while a finding is open. */
const GUARDED = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+(commit|push|merge)\b`)
const ASKING = /\s(--dry-run|--help|-h)(\s|$)/

export function isGuarded(command: string): boolean {
  return GUARDED.test(command) && !ASKING.test(command)
}

/** The mode of the mod: a note only, or a note and a gate on git commit, push and merge. */
export type Mode = 'note' | 'deny'

/** The mode a `/i18n-watch mode <word>` argument names, or undefined when it is not one. */
export function modeOf(arg: string): Mode | undefined {
  return arg === 'note' || arg === 'deny' ? arg : undefined
}

/** The deny text both the model and the person read: which file lacks which keys, and the one way out. */
export function denyText(open: readonly { file: string; keys: string[] }[]): string {
  const named = open.slice(0, MAX_NAMED).map(o => `${o.file} (${namedPlain(o.keys)})`)
  if (open.length > MAX_NAMED) named.push(`${open.length - MAX_NAMED} more`)
  return `stopped: ${open.length} file(s) use translation keys the locale files lack: ${named.join(' · ')}. Add the keys to every locale file, then run the command again; there is no way around this gate, and only the person turns it off with /i18n-watch mode note.`
}

/** `path` shown relative to the session's directory when it is inside it. */
export function shownPath(path: string, cwd: string): string {
  const base = `${cwd.replace(/\/+$/, '')}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
