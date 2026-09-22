/** Which files are configuration, how each one is parsed, and the two texts a finding is written as. */

export type Kind = 'json' | 'yaml' | 'toml' | 'env'

/** The kind of a path, or undefined when the file is not configuration this mod reads. */
export function kindOf(path: string): Kind | undefined {
  const name = path.split('/').at(-1) ?? ''
  if (/\.jsonc?$/i.test(name)) return 'json'
  if (/\.ya?ml$/i.test(name)) return 'yaml'
  if (/\.toml$/i.test(name)) return 'toml'
  return /^\.env(\.[\w.-]+)?$/.test(name) ? 'env' : undefined
}

/** The parse error of a JSON text, or undefined when it parses. */
export function jsonError(text: string): string | undefined {
  try {
    JSON.parse(text)
    return undefined
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Whether a JSON file is read by its tool as JSON with comments: a `.jsonc` file, a TypeScript or
 * JavaScript project file, a VS Code setting and a dev container file, where `//`, `/* *\/` and a trailing
 * comma are valid.
 */
export function isJsonc(path: string): boolean {
  const name = path.split('/').at(-1) ?? ''
  return /\.jsonc$/i.test(name)
    || /^[tj]sconfig(\..+)?\.json$/i.test(name)
    || /^\.?devcontainer\.json$/i.test(name)
    || /(^|\/)\.vscode\/[^/]+\.json$/i.test(path)
}

/** A JSON string, kept as it is, or a comment, blanked; one pass, so `//` inside a string stays text. */
const STRING_OR_COMMENT = /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g

/** A JSON string, kept as it is, or a comma before a closing bracket, blanked. */
const STRING_OR_TRAILING_COMMA = /("(?:\\.|[^"\\])*")|,(?=\s*[}\]])/g

/** Every character but a line break as a space, so a parse error still names the right line and column. */
const blank = (text: string): string => text.replace(/[^\n]/g, ' ')

/** A JSON-with-comments text as plain JSON: comments and trailing commas blanked, every position kept. */
export function jsoncText(text: string): string {
  const keepString = (m: string, str: string | undefined): string => str ?? blank(m)
  return text.replace(STRING_OR_COMMENT, keepString).replace(STRING_OR_TRAILING_COMMA, keepString)
}

/** A line of a .env file that is not a comment, an empty line or `KEY=value`. */
const ENV_LINE = /^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/

/** The first line of a .env text that is not a setting, or undefined when every line is one. */
export function envError(text: string): string | undefined {
  const lines = text.split('\n')
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || ENV_LINE.test(line)) continue
    return `line ${i + 1} is not a setting: ${trimmed.slice(0, 60)}`
  }
  return undefined
}

/**
 * The YAML program: every document of a `---` stream is read, and an application tag (`!Ref`, `!GetAtt`,
 * `!vault`) builds nothing instead of failing, because both are valid YAML that `safe_load` refuses.
 */
const YAML_CODE = [
  'import sys,yaml',
  'class L(yaml.SafeLoader):pass',
  'L.add_multi_constructor("",lambda l,s,n:None)',
  'for _ in yaml.load_all(open(sys.argv[1],"rb"),L):pass',
].join('\n')

/** The python program that parses one file of this kind; it prints nothing and fails on a bad file. */
export function pythonCode(kind: 'yaml' | 'toml'): string {
  return kind === 'yaml' ? YAML_CODE : 'import sys,tomllib;tomllib.load(open(sys.argv[1],"rb"))'
}

/** Whether the failure is a missing python or a missing module, so the kind is skipped instead of reported. */
export function isMissingTool(stderr: string): boolean {
  return /ModuleNotFoundError|No module named|command not found|ImportError/.test(stderr)
}

/** The line a python exception starts at, `yaml.scanner.ScannerError: ...`, not a `raise` line of the traceback. */
const EXCEPTION_LINE = /^[\w.]*(Error|Exception):\s/

/** A PyYAML mark line, `in "<file>", line 1, column 5`, whose position is kept and whose file name is not. */
const MARK_LINE = /^in ".*", (line \d+, column \d+)$/

/**
 * The parse error python printed: the exception and every line after it, each mark folded into the line
 * before it without the file name python repeats. PyYAML prints the mark last, so the last line alone
 * would be the position without the error.
 */
export function pythonError(stderr: string): string {
  const lines = stderr.split('\n').map(l => l.trim()).filter(l => l !== '')
  const start = lines.findLastIndex(l => EXCEPTION_LINE.test(l))
  // Without an exception line (a message from python itself), the last line is the message.
  const from = start >= 0 ? start : Math.max(lines.length - 1, 0)
  const parts: string[] = []
  for (const line of lines.slice(from)) {
    const mark = MARK_LINE.exec(line)
    if (mark !== null && parts.length > 0) parts[parts.length - 1] += ` (${mark[1]})`
    else parts.push(line)
  }
  const text = parts.join('; ') || 'the file was not parsed'
  return text.replace(/^\w*(Error|Exception):\s*/, '').slice(0, 300)
}

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit`, `git push` or `git merge` the model runs, not one it only asks about. */
const GUARDED = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+(commit|push|merge)\b`)
const ASKING = /\s(--dry-run|--help|-h)(\s|$)/

/** Whether the gate stops this command while a finding is open. */
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

/** What the deny says: why the command stopped, and the one setting that turns the gate off. */
export function denyText(open: readonly string[]): string {
  const named = open.slice(0, MAX_NAMED)
  if (open.length > MAX_NAMED) named.push(`${open.length - MAX_NAMED} more`)
  return `stopped: ${open.length} file(s) do not parse: ${named.join(' · ')}. Fix them and run the command again; there is no way around this gate.`
}

/**
 * The note the model reads at the next prompt while a finding stands, so a finding it did not close
 * reaches it again instead of standing in the pane alone. The person reads the pane and needs no line.
 */
export function openNote(open: readonly string[]): string {
  const named = open.slice(0, MAX_NAMED)
  if (open.length > MAX_NAMED) named.push(`${open.length - MAX_NAMED} more`)
  return `config-parse: ${open.length} file(s) still do not parse: ${named.join(' · ')}. Fix them.`
}

/** At most this many files are named in the deny text, the rest counted. */
const MAX_NAMED = 8

/** The mode of the mod: a note only, or a note and a gate on git commit, push and merge. */
export type Mode = 'note' | 'deny'

/** The mode a `/config-parse mode <word>` argument names, or undefined when it is not one. */
export function modeOf(arg: string): Mode | undefined {
  return arg === 'note' || arg === 'deny' ? arg : undefined
}

/** `path` shown relative to the session directory when it is inside it. */
export function shownPath(path: string, cwd: string): string {
  const base = `${cwd.replace(/\/+$/, '')}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

export function noteText(kind: Kind, shown: string, error: string): string {
  return `config-parse: ${shown} does not parse as ${label(kind)} after this edit: ${error}. Fix the file before you go on; a build or a service that reads it fails on this.`
}

/** The transcript line: the file and the error, without the instruction the model reads. */
export function logText(kind: Kind, shown: string, error: string): string {
  return `${shown} does not parse as ${label(kind)}: ${error}`
}

export function doneLog(kind: Kind, shown: string): string {
  return `${shown} parses as ${label(kind)} again`
}

export const sidebarLines = (error: string): { text: string; kind: 'error' }[] => [{ text: error.slice(0, 200), kind: 'error' }]

export const doneLines = (shown: string): { text: string; kind: 'ok' }[] => [{ text: `${shown} parses again`, kind: 'ok' }]

/** The closing of a file that was deleted: nothing reads it any more, so nothing fails on it. */
export function goneLog(shown: string): string {
  return `${shown} is gone, and its parse error with it`
}

export const goneLines = (shown: string): { text: string; kind: 'ok' }[] => [{ text: goneLog(shown), kind: 'ok' }]

function label(kind: Kind): string {
  return kind === 'env' ? 'a .env file' : kind.toUpperCase()
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
