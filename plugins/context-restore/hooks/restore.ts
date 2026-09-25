/** How the engine expands a skill or command file for the model, and the texts this mod writes. */

const BASE_DIR = /^Base directory for this skill: ([^\n]+)/

/** The directory a skill's text names in its first line, or undefined for a text that names none. */
export function skillDirOf(text: string): string | undefined {
  return BASE_DIR.exec(text)?.[1]
}
const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/
const RULE_HEADER = /^Contents of (.+?) \(/gm
/** What the engine fills in when it expands a file: its arguments, a `${...}` variable, or a shell command's output. */
const PLACEHOLDER = /\$ARGUMENTS|\$\d|\$\{|!`/
/** The placeholders a file cannot be read back from: a positional argument, a variable, a shell command's output. */
const OPAQUE_PLACEHOLDER = /\$\d|\$\{|!`/
const ARGUMENTS = '$ARGUMENTS'
/** What the engine adds after a file with no placeholder when the call carries arguments (measured on 2.1.280). */
const ARGUMENTS_TAIL = '\n\nARGUMENTS: '

/** The SKILL.md a skill's text names in its first line, or undefined for a text that names none. */
export function skillFileOf(text: string): string | undefined {
  const dir = skillDirOf(text)
  return dir === undefined ? undefined : `${dir}/SKILL.md`
}

/** A skill or command file as the engine hands it to the model: no frontmatter, a skill with its directory first. */
export function bodyOfFile(fileText: string, dir?: string): string {
  const body = fileText.replace(FRONTMATTER, '')
  return dir === undefined ? body : `Base directory for this skill: ${dir}\n\n${body}`
}

/** The note that follows the engine's text when the file changed and holds text the engine fills in. */
export function appendedNote(path: string, body: string): string {
  return `context-restore: ${path} changed on disk after this session loaded it. Its current text follows, with its placeholders not filled in. It replaces the instructions above; the arguments above still apply.\n\n${body}`
}

/** The engine's text of a file with no placeholder, split before the `ARGUMENTS:` part it adds for a call with arguments. */
function splitArguments(engineText: string): { head: string; tail: string } {
  const at = engineText.lastIndexOf(ARGUMENTS_TAIL)
  return at < 0 ? { head: engineText, tail: '' } : { head: engineText.slice(0, at), tail: engineText.slice(at) }
}

/**
 * Whether the engine's text is the file with each `$ARGUMENTS` filled in: every other part word for word,
 * each `$ARGUMENTS` any text.
 */
export function fitsArguments(engineText: string, fileBody: string): boolean {
  const parts = fileBody.trimEnd().split(ARGUMENTS).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${parts.join('[\\s\\S]*')}$`).test(engineText.trimEnd())
}

/** The engine's filled text with the file's current text after it. */
function withNote(engineText: string, fileBody: string, path: string): string {
  return `${engineText.trimEnd()}\n\n${appendedNote(path, fileBody)}`
}

/**
 * The text the model reads for one call of a skill or command whose file holds placeholders. A file whose only
 * placeholder is `$ARGUMENTS` is compared as a template, so the note follows exactly when the engine's copy
 * differs. Any other placeholder cannot be read back, so the note follows once the file was written after
 * the session started.
 */
function placeholderText(engineText: string, fileBody: string, path: string, writtenSinceStart: boolean): string | undefined {
  if (!OPAQUE_PLACEHOLDER.test(fileBody)) return fitsArguments(engineText, fileBody) ? undefined : withNote(engineText, fileBody, path)
  return writtenSinceStart ? withNote(engineText, fileBody, path) : undefined
}

/**
 * The text the model reads for one call of a skill or command, when the engine's copy is older than the file.
 * A file with no placeholder is compared as it is, and its text takes the place of a different engine text,
 * with the call's arguments kept. A file with placeholders keeps the engine's filled text, with the new file
 * text after it (`placeholderText`). Undefined: the engine's text is current.
 */
export function currentText(engineText: string, fileBody: string, path: string, writtenSinceStart: boolean): string | undefined {
  if (PLACEHOLDER.test(fileBody)) return placeholderText(engineText, fileBody, path, writtenSinceStart)
  const { head, tail } = splitArguments(engineText)
  if (fileBody.trimEnd() === head.trimEnd()) return undefined
  return tail === '' ? fileBody : `${fileBody.trimEnd()}\n${tail}`
}

/**
 * The watched files an `instructions` attachment carries, by the `Contents of <path> (` line each starts
 * with: every rules file, and the user's global CLAUDE.md. A project's CLAUDE.md is not watched.
 */
export function rulePathsOf(text: string, globalFile: string): string[] {
  return [...text.matchAll(RULE_HEADER)].map(m => m[1] ?? '').filter(p => p.includes('/rules/') || p === globalFile)
}

/** The files a skill's directory holds besides its SKILL.md, out of `paths`, relative to the directory. */
export function skillFilesIn(paths: Iterable<string>, dir: string): string[] {
  return [...paths].filter(p => p.startsWith(`${dir}/`) && p !== `${dir}/SKILL.md`).map(p => p.slice(dir.length + 1))
}

/** The line a skill call ends with when files of its directory the model read changed on disk since. */
export function rereadNote(files: readonly string[]): string {
  return `context-restore: these files of this skill's base directory changed on disk after this session read them, so the copies read earlier are out of date; read them again before you use them: ${files.join(', ')}`
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A sidebar line, as the sidebar mod's contract names it; `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/**
 * A line the person reads: what the mod did about files that changed on disk, faint, and which files, in
 * `tone`. Its `text` is the transcript line.
 */
function onDisk(done: string, names: readonly string[], tone?: Tone, tail: Part[] = []): Line {
  return partsLine([part(`changed on disk${done}: `, 'dim'), part(names.join(', '), tone), ...tail])
}

/** The line the person reads when a skill call asked the model to read changed files again; the files are yellow. */
export function rereadLog(skill: string, files: readonly string[]): Line {
  return onDisk(' since the model read it, the call asks to read again', files, 'warn', [part(` (${skill})`, 'dim')])
}

/** The last part of a path, as the texts name a file. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The line the person reads when a call got the file's current text in place of the engine's older copy. */
export function currentLog(name: string): Line {
  return onDisk(', the call got the current text', [name])
}

/** The line the person reads when rules files changed on disk: what the model was handed again. */
export function changedLog(labels: readonly string[]): Line {
  return onDisk(', the new text went to the model', labels)
}

/** The note the model reads for one rules file that changed on disk after the session read it. */
export function changedNote(label: string, path: string, text: string): string {
  return `context-restore: ${label} (${path}) changed on disk after this session read it. Its current text follows and replaces the earlier one; follow it from now on.\n\n${text}`
}

/** A sidebar section key: the subject cut to what the sidebar takes. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'restore'
}

/** The `/context-restore` answer: the setting, what is watched, and the last thing done. */
export function statusText(enabled: boolean, rules: number, last: string | undefined): string {
  const done = last === undefined ? '' : ` · last: ${last}`
  return `${enabled ? 'on' : 'off'} · every skill and command call is checked against its file, ${rules} rules file(s) watched${done}`
}
