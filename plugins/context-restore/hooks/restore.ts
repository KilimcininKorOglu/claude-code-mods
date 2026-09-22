/** How the engine expands a skill or command file for the model, and the texts this mod writes. */

const BASE_DIR = /^Base directory for this skill: ([^\n]+)/
const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/
const RULE_HEADER = /^Contents of (.+?) \(/gm
/** What the engine fills in when it expands a file: its arguments, a `${...}` variable, or a shell command's output. */
const PLACEHOLDER = /\$ARGUMENTS|\$\d|\$\{|!`/
/** What the engine adds after a file with no placeholder when the call carries arguments (measured on 2.1.280). */
const ARGUMENTS_TAIL = '\n\nARGUMENTS: '

/** The SKILL.md a skill's text names in its first line, or undefined for a text that names none. */
export function skillFileOf(text: string): string | undefined {
  const dir = BASE_DIR.exec(text)?.[1]
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
 * The text the model reads for one call of a skill or command, when the engine's copy is older than the file.
 * A file with no placeholder is compared as it is, and its text takes the place of a different engine text,
 * with the call's arguments kept. A file with placeholders cannot be compared, so the engine's text stays
 * with the new file text after it, once the file was written after the session started. Undefined: the
 * engine's text is current.
 */
export function currentText(engineText: string, fileBody: string, path: string, writtenSinceStart: boolean): string | undefined {
  if (PLACEHOLDER.test(fileBody)) return writtenSinceStart ? `${engineText.trimEnd()}\n\n${appendedNote(path, fileBody)}` : undefined
  const { head, tail } = splitArguments(engineText)
  if (fileBody.trimEnd() === head.trimEnd()) return undefined
  return tail === '' ? fileBody : `${fileBody.trimEnd()}\n${tail}`
}

/** The rules files an `instructions` attachment carries, by the `Contents of <path> (` line each starts with. */
export function rulePathsOf(text: string): string[] {
  return [...text.matchAll(RULE_HEADER)].map(m => m[1] ?? '').filter(p => p.includes('/rules/'))
}

/** The last part of a path, as the texts name a file. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The line the person reads when a call got the file's current text in place of the engine's older copy. */
export function currentLog(name: string): string {
  return `changed on disk, the call got the current text: ${name}`
}

/** The line the person reads when rules files changed on disk: what the model was handed again. */
export function changedLog(labels: readonly string[]): string {
  return `changed on disk, the new text went to the model: ${labels.join(', ')}`
}

/** The note the model reads for one rules file that changed on disk after the session read it. */
export function changedNote(label: string, path: string, text: string): string {
  return `context-restore: ${label} (${path}) changed on disk after this session read it. Its current text follows and replaces the earlier one; follow it from now on.\n\n${text}`
}

/** A sidebar line, as the sidebar mod's contract names it. */
type Line = { text: string; kind: 'ok' }

export function sidebarLines(text: string): Line[] {
  return [{ text, kind: 'ok' }]
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
