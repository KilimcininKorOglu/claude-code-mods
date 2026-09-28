/**
 * Reads a Bash command: the git calls it makes, each with the directory it
 * runs in, and the bodies of its heredocs.
 */

/** One heredoc of a command: its end word, the line that opened it and its body. */
export type Heredoc = { tag: string; opener: string; body: string }

const HEREDOC = /<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/

/** Drops the body and the end line of every heredoc, so text inside a commit message is not read as a command. */
export function stripHeredocs(text: string): string {
  const out: string[] = []
  let end: string | undefined
  for (const line of text.split('\n')) {
    if (end !== undefined) {
      if (line.trim() === end) end = undefined
      continue
    }
    out.push(line)
    end = HEREDOC.exec(line)?.[3]
  }
  return out.join('\n')
}

/** The heredocs of a command, in the order they appear; `<<-` drops the leading tabs of the body. */
export function heredocsOf(text: string): Heredoc[] {
  const out: Heredoc[] = []
  let open: { tag: string; opener: string; tabs: boolean; lines: string[] } | undefined
  for (const line of text.split('\n')) {
    if (open === undefined) {
      const m = HEREDOC.exec(line)
      if (m !== null) open = { tag: m[3] ?? '', opener: line, tabs: m[1] === '-', lines: [] }
      continue
    }
    if (line.trim() !== open.tag) {
      open.lines.push(open.tabs ? line.replace(/^\t+/, '') : line)
      continue
    }
    out.push({ tag: open.tag, opener: open.opener, body: open.lines.join('\n') })
    open = undefined
  }
  return out
}

type Scan = { segments: string[][]; tokens: string[]; token: string; started: boolean; quote: string | undefined }

function endToken(s: Scan): void {
  if (s.started) s.tokens.push(s.token)
  s.token = ''
  s.started = false
}

function endSegment(s: Scan): void {
  endToken(s)
  if (s.tokens.length > 0) s.segments.push(s.tokens)
  s.tokens = []
}

/** One character inside quotes; returns how many characters it used. */
function quoted(s: Scan, text: string, i: number): number {
  const c = text[i] ?? ''
  if (c === s.quote) s.quote = undefined
  else if (c === '\\' && s.quote === '"' && i + 1 < text.length) {
    s.token += text[i + 1]
    return 2
  } else s.token += c
  return 1
}

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')'])

/** An `&` that belongs to a redirection (`2>&1`, `<&3`, `&>out`), not a separator. */
function isRedirectAmp(text: string, i: number): boolean {
  return text[i] === '&' && (text[i - 1] === '>' || text[i - 1] === '<' || text[i + 1] === '>')
}

/** One character outside quotes; returns how many characters it used. */
function unquoted(s: Scan, text: string, i: number): number {
  const c = text[i] ?? ''
  if (SEPARATORS.has(c) && !isRedirectAmp(text, i)) endSegment(s)
  else if (c === ' ' || c === '\t') endToken(s)
  else if (c === '"' || c === "'") {
    s.quote = c
    s.started = true
  } else if (c === '\\' && i + 1 < text.length) {
    s.token += text[i + 1]
    s.started = true
    return 2
  } else {
    s.token += c
    s.started = true
  }
  return 1
}

/** A redirection such as `>out`, `2>&1`, `&>out`, `<in`; with a bare operator the target is the next word. */
const REDIRECT = /^(?:\d*|&)[<>]/
const BARE_REDIRECT = /^(?:\d*|&)[<>]+$/

function withoutRedirections(words: readonly string[]): string[] {
  const kept: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? ''
    if (!REDIRECT.test(word)) kept.push(word)
    else if (BARE_REDIRECT.test(word)) i++
  }
  return kept
}

/** The simple commands of a command line, each as its words with the quotes and redirections removed. */
export function splitCommand(text: string): string[][] {
  const s: Scan = { segments: [], tokens: [], token: '', started: false, quote: undefined }
  const source = stripHeredocs(text)
  for (let i = 0; i < source.length; ) i += s.quote === undefined ? unquoted(s, source, i) : quoted(s, source, i)
  endSegment(s)
  return s.segments.map(withoutRedirections).filter(words => words.length > 0)
}

/**
 * One git call of a command. `where` is the directory it runs in, relative to the directory the command
 * starts in ('' for that directory itself) or absolute, and null when a `cd` went somewhere the command
 * text does not say (`cd -`, `cd ~`, `cd $DIR`).
 */
export type GitCall = { env: string[]; configs: string[]; where: string | null; sub: string; args: string[] }

/** Words that run the command after them. */
const WRAPPERS = new Set(['command', 'exec', 'time', 'nohup', 'env'])

/** Where the command's words begin: past the wrappers and the leading variable assignments (`NAME=value`). */
function commandStart(words: readonly string[]): { env: string[]; at: number } {
  const env: string[] = []
  let at = 0
  for (;;) {
    const word = words[at] ?? ''
    if (WRAPPERS.has(word)) at++
    else if (/^[A-Za-z_]\w*=/.test(word)) env.push(words[at++] ?? '')
    else return { env, at }
  }
}

/** git's own options that take the next word as their value. */
const GIT_VALUES = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix'])

type GitHead = { dir: string; configs: string[]; at: number }

/** git's own options before the subcommand, from `start`: the `-C` directories, the `-c` settings, and where the subcommand is. */
function gitOptions(words: readonly string[], start: number): GitHead {
  const head: GitHead = { dir: '', configs: [], at: start }
  while ((words[head.at] ?? '').startsWith('-')) {
    const option = words[head.at++] ?? ''
    if (!GIT_VALUES.has(option)) continue
    const value = words[head.at++] ?? ''
    if (option === '-C') head.dir = joinPath(head.dir, value)
    else if (option === '-c') head.configs.push(value)
  }
  return head
}

/** The git call of one simple command, or undefined when it runs no git subcommand. */
function gitCall(words: readonly string[], cwd: string | null): GitCall | undefined {
  const { env, at } = commandStart(words)
  if (!/(^|\/)git$/.test(words[at] ?? '')) return undefined
  const head = gitOptions(words, at + 1)
  const sub = words[head.at]
  if (sub === undefined) return undefined
  const where = cwd === null || /[$~]/.test(head.dir) ? null : joinPath(cwd, head.dir)
  return { env, configs: head.configs, where, sub, args: words.slice(head.at + 1) }
}

/** The directory after a `cd`, or null when the command text does not say where it goes. */
function cdTarget(words: readonly string[], cwd: string | null): string | null {
  const target = words[1]
  if (cwd === null || target === undefined || words.length > 2) return null
  if (target === '-' || target.startsWith('~') || target.includes('$')) return null
  return joinPath(cwd, target)
}

/** The git calls of a command in the order they run, each with the directory it runs in. */
export function gitCalls(command: string): GitCall[] {
  const calls: GitCall[] = []
  let cwd: string | null = ''
  for (const words of splitCommand(command)) {
    if (words[0] === 'cd') cwd = cdTarget(words, cwd)
    const call = gitCall(words, cwd)
    if (call !== undefined) calls.push(call)
  }
  return calls
}

/** Adds one path segment: `.` and empty ones drop, `..` takes the last segment back where there is one. */
function pushPart(parts: string[], part: string, absolute: boolean): void {
  if (part === '' || part === '.') return
  const last = parts[parts.length - 1]
  if (part !== '..') parts.push(part)
  else if (last !== undefined && last !== '..') parts.pop()
  else if (!absolute) parts.push(part)
}

/** `rel` read from `base`, with `.` and `..` resolved; an absolute `rel` stands alone, and '' is `base` itself. */
export function joinPath(base: string, rel: string): string {
  const start = rel.startsWith('/') || base === '' ? rel : `${base}/${rel}`
  const absolute = start.startsWith('/')
  const parts: string[] = []
  for (const part of start.split('/')) pushPart(parts, part, absolute)
  const joined = parts.join('/')
  return absolute ? `/${joined}` : joined
}
