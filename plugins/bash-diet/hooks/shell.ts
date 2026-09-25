/**
 * Reads a Bash command the way a shell splits it, far enough to know which command's output the model
 * will read. Nothing here runs a command. A construct whose output this reading cannot attribute to one
 * command (a heredoc, a command substitution, a subshell, a process substitution, `|&`) makes the whole
 * command opaque, and an opaque command is never filtered.
 */

/** One word or operator of a command, with its place in the text; a word's text is unquoted. */
export type Token = { kind: 'word' | 'op'; text: string; start: number; end: number }

/** One redirect of a stage: the operator with its file descriptor prefix, and the word after it. */
export type Redirect = { op: string; target: string }

/** One command of a pipeline: its words and its redirects. */
export type Stage = { words: Token[]; redirects: Redirect[] }

/** A list of stages joined by `|`, ended by `&&`, `||`, `;`, `&` or the end of the text. */
export type Segment = { stages: Stage[]; background: boolean }

export type Parsed = { segments: Segment[]; opaque: boolean }

/** Longest first, so `&&` is read before `&`. */
const OPS = ['&&', '||', '|&', '>>', '<<', '>&', '&>', '<(', '>(', ';', '|', '&', '<', '>', '(', ')']
const OPAQUE_OPS = new Set(['|&', '<<', '<(', '>(', '(', ')'])
const SEPARATORS = new Set(['&&', '||', ';', '&'])

type Lex = { src: string; i: number; tokens: Token[]; word: string; wordStart: number; opaque: boolean }

/** Splits a command into words and operators; `opaque` when a construct hides where output comes from. */
export function lex(src: string): { tokens: Token[]; opaque: boolean } {
  const s: Lex = { src, i: 0, tokens: [], word: '', wordStart: -1, opaque: false }
  while (s.i < src.length && !s.opaque) step(s)
  flush(s)
  return { tokens: s.tokens, opaque: s.opaque }
}

const opaque = (s: Lex): void => { s.opaque = true }
const blank = (s: Lex): void => { flush(s); s.i += 1 }

/** The characters that start something other than a plain word character. */
const HANDLERS: Record<string, (s: Lex) => void> = {
  "'": single, '"': double, '\\': escape, '`': opaque, '\n': newline, ' ': blank, '\t': blank,
}

function step(s: Lex): void {
  const c = s.src[s.i] ?? ''
  const handler = HANDLERS[c]
  if (handler !== undefined) return handler(s)
  if (c === '$' && s.src[s.i + 1] === '(') return opaque(s)
  if (c === '#' && s.wordStart < 0) return comment(s)
  if ('&|;<>()'.includes(c)) return operator(s)
  add(s, c, 1)
}

function add(s: Lex, text: string, length: number): void {
  if (s.wordStart < 0) s.wordStart = s.i
  s.word += text
  s.i += length
}

function flush(s: Lex): void {
  if (s.wordStart < 0) return
  s.tokens.push({ kind: 'word', text: s.word, start: s.wordStart, end: s.i })
  s.word = ''
  s.wordStart = -1
}

function single(s: Lex): void {
  const close = s.src.indexOf("'", s.i + 1)
  if (close < 0) { s.opaque = true; return }
  add(s, s.src.slice(s.i + 1, close), close + 1 - s.i)
}

/** A double-quoted part: `\` escapes only `"`, `\`, `$` and a backtick; `$(` or a backtick inside is opaque. */
function double(s: Lex): void {
  let j = s.i + 1
  let text = ''
  while (j < s.src.length && s.src[j] !== '"') {
    const part = quotedChar(s.src, j)
    if (part === undefined) return opaque(s)
    text += part.text
    j += part.length
  }
  if (j >= s.src.length) return opaque(s)
  add(s, text, j + 1 - s.i)
}

/** One character inside double quotes and how many it took, or undefined for a substitution. */
function quotedChar(src: string, j: number): { text: string; length: number } | undefined {
  const c = src[j] ?? ''
  const after = src[j + 1] ?? ''
  if (c === '`' || (c === '$' && after === '(')) return undefined
  const escaped = c === '\\' && '"\\$`'.includes(after)
  return escaped ? { text: after, length: 2 } : { text: c, length: 1 }
}

/** A backslash keeps the next character; before a newline it joins the two lines. */
function escape(s: Lex): void {
  const next = s.src[s.i + 1] ?? ''
  if (next === '\n') { s.i += 2; return }
  add(s, next, 2)
}

function comment(s: Lex): void {
  const end = s.src.indexOf('\n', s.i)
  s.i = end < 0 ? s.src.length : end
}

/** A newline ends a command as `;` does. */
function newline(s: Lex): void {
  flush(s)
  s.tokens.push({ kind: 'op', text: ';', start: s.i, end: s.i + 1 })
  s.i += 1
}

/** An operator; digits right before `<` or `>` are its file descriptor (`2>&1`), not a word. */
function operator(s: Lex): void {
  const c = s.src[s.i] ?? ''
  const fd = s.wordStart >= 0 && /^\d+$/.test(s.word) && (c === '<' || c === '>') ? s.word : ''
  const start = fd === '' ? s.i : s.wordStart
  if (fd === '') flush(s)
  else { s.word = ''; s.wordStart = -1 }
  const op = OPS.find(o => s.src.startsWith(o, s.i)) ?? c
  if (OPAQUE_OPS.has(op)) { s.opaque = true; return }
  s.i += op.length
  s.tokens.push({ kind: 'op', text: fd + op, start, end: s.i })
}

/** Groups the tokens into segments and stages; a redirect takes the word after it. */
export function parse(src: string): Parsed {
  const { tokens, opaque } = lex(src)
  const segments: Segment[] = []
  let segment: Segment = { stages: [{ words: [], redirects: [] }], background: false }
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] as Token
    const stage = segment.stages[segment.stages.length - 1] as Stage
    if (t.kind === 'word') stage.words.push(t)
    else if (t.text === '|') segment.stages.push({ words: [], redirects: [] })
    else if (SEPARATORS.has(t.text)) {
      segment.background = t.text === '&'
      segments.push(segment)
      segment = { stages: [{ words: [], redirects: [] }], background: false }
    } else {
      stage.redirects.push({ op: t.text, target: tokens[i + 1]?.text ?? '' })
      i += 1
    }
  }
  segments.push(segment)
  return { segments: segments.filter(g => g.stages.some(st => st.words.length > 0)), opaque }
}

/**
 * Whether a redirect sends standard output away from the result: into a file, not to /dev/null or to
 * another descriptor. `2>err.log` leaves stdout where it was.
 */
export function hidesStdout(r: Redirect): boolean {
  if (!r.op.includes('>')) return false
  if (r.target === '/dev/null') return false
  if (r.op.startsWith('&')) return true
  const fd = /^\d*/.exec(r.op)?.[0] || '1'
  return fd === '1' && !r.op.endsWith('&')
}

/** A word that sets a variable for the command after it: `FOO=bar`. */
export function isAssignment(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
}
