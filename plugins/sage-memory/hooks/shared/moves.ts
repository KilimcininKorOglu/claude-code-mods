/**
 * The file moves a shell command makes: `mv a b`, `git mv a b` and PowerShell's `Move-Item a b`.
 * Every command of a chain is read (`&&`, `||`, `;`, `|`, `&` and a line break end one), a `cd`
 * changes where the paths after it are read from, and a subshell's `cd` ends with the subshell. A
 * word the shell would expand (`$`, a backquote, a glob, a leading `~`) is not read as a path, and
 * neither is a redirection's target nor a here-document's text. Pure string code: the hooks module
 * asks the daemon only about a command that moves something, and the daemon checks each move on
 * disk, since a parse cannot know whether the command ran.
 */

/** One move: its source and target as the command wrote them, and the directories entered before it, in order. */
export type Move = { from: string; to: string; dirs: string[] }

/** A word without its quotes; `literal` is false when the shell would expand it. */
type Word = { text: string; literal: boolean }

/** A command of the chain, or the start or the end of a subshell. */
type Piece = { words: Word[] } | { open: true } | { close: true }

/** What the next word is: one of the command, a redirection's target, or a here-document's delimiter. */
type Next = 'word' | 'target' | 'heredoc' | 'heredoc-tabs'

/** A here-document whose text starts at the next line; `tabs` strips the leading tabs of its lines (`<<-`). */
type Heredoc = { delimiter: string; tabs: boolean }

type Scan = { text: string; at: number; pieces: Piece[]; words: Word[]; word: Word | undefined; next: Next; heredocs: Heredoc[] }

function append(scan: Scan, text: string, literal = true): void {
  scan.word ??= { text: '', literal: true }
  scan.word.text += text
  if (!literal) scan.word.literal = false
}

function endWord(scan: Scan): void {
  const word = scan.word
  scan.word = undefined
  if (word === undefined) return
  const next = scan.next
  scan.next = 'word'
  if (next === 'word') scan.words.push(word)
  else if (next !== 'target') scan.heredocs.push({ delimiter: word.text, tabs: next === 'heredoc-tabs' })
}

function endCommand(scan: Scan): void {
  endWord(scan)
  scan.next = 'word'
  if (scan.words.length > 0) scan.pieces.push({ words: scan.words })
  scan.words = []
}

/** The index of `close` at or after `from`, or the end of the text when it never comes. */
function closing(scan: Scan, from: number, close: string): number {
  const at = scan.text.indexOf(close, from)
  return at === -1 ? scan.text.length : at
}

/** The index just past the bracket that closes the one at `from`, nested pairs counted, or the end of the text. */
function pastClosing(scan: Scan, from: number, open: string, close: string): number {
  let depth = 0
  for (let at = from; at < scan.text.length; at++) {
    const char = scan.text[at]
    if (char === open) depth++
    else if (char === close && --depth === 0) return at + 1
  }
  return scan.text.length
}

function singleQuoted(scan: Scan): void {
  const end = closing(scan, scan.at + 1, "'")
  append(scan, scan.text.slice(scan.at + 1, end), end < scan.text.length)
  scan.at = end + 1
}

/** A double-quoted run: a backslash keeps the next character, and `$` or a backquote makes the word one the shell expands. */
function doubleQuoted(scan: Scan): void {
  scan.at++
  append(scan, '')
  while (scan.at < scan.text.length && scan.text[scan.at] !== '"') {
    const char = scan.text[scan.at] ?? ''
    const escaped = char === '\\' && scan.at + 1 < scan.text.length
    append(scan, escaped ? (scan.text[scan.at + 1] ?? '') : char, char !== '$' && char !== '`')
    scan.at += escaped ? 2 : 1
  }
  if (scan.at >= scan.text.length) append(scan, '', false)
  scan.at++
}

const BRACKETS: Readonly<Record<string, [string, string]>> = { '$(': ['(', ')'], '${': ['{', '}'] }

/** Where an expansion ends: past a backquoted command, past the bracket that closes `$(` or `${`, or past a lone `$`. */
function expansionEnd(scan: Scan): number {
  if (scan.text[scan.at] === '`') return closing(scan, scan.at + 1, '`') + 1
  const pair = BRACKETS[scan.text.slice(scan.at, scan.at + 2)]
  return pair === undefined ? scan.at + 1 : pastClosing(scan, scan.at + 1, pair[0], pair[1])
}

/** An expansion (`$name`, `${...}`, `$(...)`, a backquoted command), taken whole into a word the shell expands. */
function expansion(scan: Scan): void {
  const end = expansionEnd(scan)
  append(scan, scan.text.slice(scan.at, end), false)
  scan.at = end
}

const REDIRECTION = /^(?:&>>|&>|<<<|<<-|<<|<>|<&|>>|>&|>\||<|>)/

/** A redirection: its operator and the word it names are dropped, and so is a descriptor number written just before it. */
function redirection(scan: Scan): void {
  const descriptor = scan.word?.literal === true && /^\d+$/.test(scan.word.text) && scan.text[scan.at] !== '&'
  if (descriptor) scan.word = undefined
  else endWord(scan)
  const operator = REDIRECTION.exec(scan.text.slice(scan.at))?.[0] ?? '>'
  scan.at += operator.length
  if (operator === '<<') scan.next = 'heredoc'
  else if (operator === '<<-') scan.next = 'heredoc-tabs'
  else scan.next = 'target'
}

function operator(scan: Scan, piece?: Piece): void {
  const doubled = piece === undefined && scan.text[scan.at + 1] === scan.text[scan.at]
  endCommand(scan)
  if (piece !== undefined) scan.pieces.push(piece)
  scan.at += doubled ? 2 : 1
}

/** Skips a here-document's text, up to and with the line that holds its delimiter alone. */
function skipBody(scan: Scan, heredoc: Heredoc): void {
  while (scan.at < scan.text.length) {
    const end = closing(scan, scan.at, '\n')
    const line = scan.text.slice(scan.at, end)
    scan.at = end + 1
    if ((heredoc.tabs ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) return
  }
}

/** A line break ends the command, and the here-documents it opened take the lines after it. */
function lineEnd(scan: Scan): void {
  endCommand(scan)
  scan.at++
  for (const heredoc of scan.heredocs.splice(0)) skipBody(scan, heredoc)
}

type Handler = (scan: Scan, char: string) => void

const plain: Handler = (scan, char) => {
  append(scan, char)
  scan.at++
}

const blank: Handler = scan => {
  endWord(scan)
  scan.at++
}

const glob: Handler = (scan, char) => {
  append(scan, char, false)
  scan.at++
}

/** Whether the character after the current one ends a word, as it does after the `{` that opens a group. */
function wordEndsNext(scan: Scan): boolean {
  const next = scan.text[scan.at + 1]
  return next === undefined || next === ' ' || next === '\t' || next === '\n'
}

const HANDLERS: Readonly<Record<string, Handler>> = {
  ' ': blank,
  '\t': blank,
  '\n': lineEnd,
  ';': scan => operator(scan),
  '|': scan => operator(scan),
  '&': scan => (scan.text[scan.at + 1] === '>' ? redirection(scan) : operator(scan)),
  '(': scan => operator(scan, { open: true }),
  ')': scan => operator(scan, { close: true }),
  '<': redirection,
  '>': redirection,
  "'": singleQuoted,
  '"': doubleQuoted,
  $: expansion,
  '`': expansion,
  '*': glob,
  '?': glob,
  '[': glob,
  '{': (scan, char) => (scan.word === undefined && wordEndsNext(scan) ? plain(scan, char) : glob(scan, char)),
  '~': (scan, char) => (scan.word === undefined ? glob(scan, char) : plain(scan, char)),
  '#': (scan, char) => {
    if (scan.word === undefined) scan.at = closing(scan, scan.at, '\n')
    else plain(scan, char)
  },
  '\\': scan => {
    if (scan.text[scan.at + 1] !== '\n') append(scan, scan.text[scan.at + 1] ?? '')
    scan.at += 2
  },
}

/** The commands of a chain and the subshells around them, in order. */
function piecesOf(command: string): Piece[] {
  const scan: Scan = { text: command, at: 0, pieces: [], words: [], word: undefined, next: 'word', heredocs: [] }
  while (scan.at < scan.text.length) {
    const char = scan.text[scan.at] ?? ''
    ;(HANDLERS[char] ?? plain)(scan, char)
  }
  endCommand(scan)
  return scan.pieces
}

/** The paths of a move once its flags are read; undefined when a flag it does not know may take one of them as its value. */
function operandsAfter(args: readonly Word[], isFlag: (text: string) => boolean): Word[] | undefined {
  const operands: Word[] = []
  let flags = true
  for (const arg of args) {
    const flag = flags && arg.literal && arg.text.startsWith('-') && arg.text !== '-'
    if (flag && arg.text === '--') flags = false
    else if (flag && !isFlag(arg.text)) return undefined
    else if (!flag) operands.push(arg)
  }
  return operands
}

/** One source and one target, both words the shell leaves as they are; a move of several sources is not read. */
function pairOf(operands: readonly (Word | undefined)[] | undefined, dirs: readonly string[]): Move | undefined {
  if (operands?.length !== 2) return undefined
  const [from, to] = operands
  if (!from?.literal || !to?.literal) return undefined
  return { from: from.text, to: to.text, dirs: [...dirs] }
}

const MV_FLAGS = /^-[bfhinuv]+$/
const MV_LONG = new Set(['--force', '--interactive', '--no-clobber', '--verbose', '--update', '--backup'])

function mvMove(args: readonly Word[], dirs: readonly string[]): Move | undefined {
  return pairOf(
    operandsAfter(args, text => MV_FLAGS.test(text) || MV_LONG.has(text)),
    dirs,
  )
}

const GIT_MV_FLAGS = /^-[fknv]+$/
const GIT_MV_LONG = new Set(['--force', '--dry-run', '--verbose'])

/** The options of `git` itself that take a value: `-C <dir>` and `-c <key=value>`. */
const GIT_OPTIONS = new Set(['-C', '-c'])

function isOption(word: Word | undefined): word is Word {
  return word !== undefined && word.literal && word.text.startsWith('-')
}

/** Where `git` runs its subcommand: past `-C <dir>` (a directory entered) and `-c <key=value>`; undefined past any other option. */
function gitSubcommand(args: readonly Word[]): { at: number; dirs: string[] } | undefined {
  const dirs: string[] = []
  let at = 0
  for (let option = args[0]; isOption(option); option = args[at]) {
    const value = args[at + 1]
    if (!GIT_OPTIONS.has(option.text) || value?.literal !== true) return undefined
    if (option.text === '-C') dirs.push(value.text)
    at += 2
  }
  return { at, dirs }
}

function gitMove(args: readonly Word[], dirs: readonly string[]): Move | undefined {
  const sub = gitSubcommand(args)
  const name = sub === undefined ? undefined : args[sub.at]
  if (sub === undefined || name?.literal !== true || name.text !== 'mv') return undefined
  const operands = operandsAfter(args.slice(sub.at + 1), text => GIT_MV_FLAGS.test(text) || GIT_MV_LONG.has(text))
  return pairOf(operands, [...dirs, ...sub.dirs])
}

/** The parameters of Move-Item that take a path, and the switches that take nothing. */
const PS_PATHS: Readonly<Record<string, 'path' | 'destination'>> = { '-path': 'path', '-literalpath': 'path', '-destination': 'destination' }
const PS_SWITCHES = new Set(['-force', '-passthru', '-whatif', '-confirm', '-verbose'])

type Named = { path?: Word; destination?: Word; positional: Word[] }

/** Sorts Move-Item's arguments into its named paths and its positional ones; undefined for a parameter it does not know. */
function namedArgs(args: readonly Word[]): Named | undefined {
  const named: Named = { positional: [] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? { text: '', literal: false }
    const name = arg.literal ? arg.text.toLowerCase() : ''
    const slot = PS_PATHS[name]
    if (slot !== undefined) named[slot] = args[++i]
    else if (name.startsWith('-') && !PS_SWITCHES.has(name)) return undefined
    else if (!PS_SWITCHES.has(name)) named.positional.push(arg)
  }
  return named
}

function moveItem(args: readonly Word[], dirs: readonly string[]): Move | undefined {
  const named = namedArgs(args)
  if (named === undefined) return undefined
  const from = named.path ?? named.positional.shift()
  const to = named.destination ?? named.positional.shift()
  return named.positional.length > 0 ? undefined : pairOf([from, to], dirs)
}

function moveOf(name: string, args: readonly Word[], dirs: readonly string[]): Move | undefined {
  if (name === 'mv') return mvMove(args, dirs)
  if (name === 'git') return gitMove(args, dirs)
  return name === 'move-item' ? moveItem(args, dirs) : undefined
}

/** Where the commands are read from: the directories entered, and the ones before the last `cd`, for `cd -`. */
type Place = { dirs: readonly string[]; previous?: readonly string[] }

const CD = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location'])
const CD_FLAGS = new Set(['-L', '-P', '-e', '-@', '--'])

/** The commands after which the directory is not known: a pop from the directory stack. */
const LOST = new Set(['popd', 'pop-location'])

/**
 * Where a `cd` leads; undefined when the shell decides: no directory or more than one, a word it
 * expands, a directory-stack entry (`+1`, `-2`), or `cd -` with no directory entered before.
 */
function entered(args: readonly Word[], place: Place): Place | undefined {
  const targets = args.filter(arg => !(arg.literal && CD_FLAGS.has(arg.text)))
  const target = targets[0]
  if (targets.length !== 1 || target?.literal !== true) return undefined
  if (target.text === '-') return place.previous === undefined ? undefined : { dirs: place.previous, previous: place.dirs }
  if (/^[-+]/.test(target.text)) return undefined
  return { dirs: [...place.dirs, target.text], previous: place.dirs }
}

/** The words that may stand before a command's name: shell keywords, a group's `{`, and variable assignments. */
const PREFIXES = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', 'time'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function isPrefix(word: Word): boolean {
  return (word.literal && PREFIXES.has(word.text)) || ASSIGNMENT.test(word.text)
}

/** Reads one command: a `cd` moves the place, a move is collected; undefined once the place is no longer known. */
function step(words: readonly Word[], place: Place, moves: Move[]): Place | undefined {
  const start = words.findIndex(word => !isPrefix(word))
  const name = words[start]
  if (name === undefined || !name.literal) return place
  const command = name.text.toLowerCase()
  const args = words.slice(start + 1)
  if (CD.has(command)) return entered(args, place)
  if (LOST.has(command)) return undefined
  const move = moveOf(command, args, place.dirs)
  if (move !== undefined) moves.push(move)
  return place
}

/** The moves a shell command makes, in order, each with the directories entered before it. */
export function movesOf(command: string): Move[] {
  const moves: Move[] = []
  const outer: Place[] = []
  let place: Place | undefined = { dirs: [] }
  for (const piece of piecesOf(command)) {
    if ('open' in piece) outer.push(place)
    else if ('close' in piece) place = outer.pop() ?? place
    else place = step(piece.words, place, moves)
    if (place === undefined) break
  }
  return moves
}
