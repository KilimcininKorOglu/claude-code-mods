/** Which files are configuration, how each one is parsed, and the two texts a finding is written as. */

export type Kind = 'json' | 'yaml' | 'toml' | 'env'

/** The kind of a path, or undefined when the file is not configuration this mod reads. */
export function kindOf(path: string): Kind | undefined {
  const name = path.split('/').at(-1) ?? ''
  if (/\.json$/i.test(name)) return 'json'
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

/** The python program that parses one file of this kind; it prints nothing and fails on a bad file. */
export function pythonCode(kind: 'yaml' | 'toml'): string {
  return kind === 'yaml'
    ? 'import sys,yaml;yaml.safe_load(open(sys.argv[1],"rb"))'
    : 'import sys,tomllib;tomllib.load(open(sys.argv[1],"rb"))'
}

/** Whether the failure is a missing python or a missing module, so the kind is skipped instead of reported. */
export function isMissingTool(stderr: string): boolean {
  return /ModuleNotFoundError|No module named|command not found|ImportError/.test(stderr)
}

/** The parse error python printed: its last line, without the file name python repeats. */
export function pythonError(stderr: string): string {
  const lines = stderr.split('\n').map(l => l.trim()).filter(l => l !== '')
  const last = lines.at(-1) ?? 'the file was not parsed'
  return last.replace(/^\w*(Error|Exception):\s*/, '').slice(0, 300)
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

function label(kind: Kind): string {
  return kind === 'env' ? 'a .env file' : kind.toUpperCase()
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
