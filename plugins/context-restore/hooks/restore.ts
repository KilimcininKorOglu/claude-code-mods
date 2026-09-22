/** How the engine writes the skills it hands back after a compaction, and the texts this mod writes. */

const BASE_DIR = /^Base directory for this skill: ([^\n]+)/
const SECTION_START = /^### Skill: /gm
const SECTION = /^(### Skill: ([^\n]*)\nPath: ([^\n]*)\n\n)([\s\S]*?)(\n\n---\n\n|\s*)$/
const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/
const RULE_HEADER = /^Contents of (.+?) \(/gm

/** One skill or command of an `invoked_skills` attachment; `body` is undefined when its head was not read. */
export type Section = { name: string; path: string; head: string; body?: string; tail: string; raw: string }

/** An `invoked_skills` attachment: the engine's lead paragraphs, then one section per skill. */
export type Parsed = { lead: string; sections: Section[] }

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

function sectionOf(raw: string): Section {
  const m = SECTION.exec(raw)
  if (m === null) return { name: '', path: '', head: '', tail: '', raw }
  return { name: m[2] ?? '', path: m[3] ?? '', head: m[1] ?? '', body: m[4] ?? '', tail: m[5] ?? '', raw }
}

/** Splits the attachment at each `### Skill: ` line. A section whose head reads otherwise is kept whole. */
export function sectionsOf(text: string): Parsed {
  const starts = [...text.matchAll(SECTION_START)].map(m => m.index)
  const first = starts[0] ?? text.length
  const sections = starts.map((at, i) => sectionOf(text.slice(at, starts[i + 1] ?? text.length)))
  return { lead: text.slice(0, first), sections }
}

/**
 * Puts the full text of every section it knows in place of the body the engine carried, and answers the
 * text and the names whose body changed. A section it knows no text of stays as the engine wrote it.
 */
export function rebuild(parsed: Parsed, full: ReadonlyMap<string, string>): { text: string; changed: string[] } {
  const changed: string[] = []
  const parts = parsed.sections.map(s => {
    const text = full.get(s.name)
    if (s.body === undefined || text === undefined || text.trimEnd() === s.body.trimEnd()) return s.raw
    changed.push(s.name)
    return `${s.head}${text.trimEnd()}${s.tail}`
  })
  return { text: parsed.lead + parts.join(''), changed }
}

/** The rules files an `instructions` attachment carries, by the `Contents of <path> (` line each starts with. */
export function rulePathsOf(text: string): string[] {
  return [...text.matchAll(RULE_HEADER)].map(m => m[1] ?? '').filter(p => p.includes('/rules/'))
}

/** The last part of a path, as the texts name a file. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The line the person reads after a compaction: the skills whose full text was put back. */
export function restoredLog(names: readonly string[]): string {
  return `restored after compaction: ${names.join(', ')}`
}

/** The line the person reads when files changed on disk: what the model was handed again. */
export function changedLog(labels: readonly string[]): string {
  return `changed on disk, the new text went to the model: ${labels.join(', ')}`
}

/** The note the model reads for one file that changed on disk after the session read it. */
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
export function statusText(enabled: boolean, skills: number, rules: number, last: string | undefined): string {
  const done = last === undefined ? '' : ` · last: ${last}`
  return `${enabled ? 'on' : 'off'} · ${skills} skill(s) and command(s), ${rules} rules file(s) watched${done}`
}
