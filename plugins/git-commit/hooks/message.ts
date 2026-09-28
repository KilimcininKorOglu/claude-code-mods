/**
 * The message a `git commit` records, read from the command, and the skill's
 * rules for it measured against the repository's own style.
 */
import type { Heredoc } from './command.ts'
import { deny, note, type Finding } from './finding.ts'
import type { Parsed } from './gitargs.ts'

/** The message the commit records, or why the command does not say it. */
export type Message = { text: string } | { unknown: string }

/** The heredoc a `$(cat <<'EOF'` value stands for: the first unused one with that end word. */
function heredocFor(value: string, heredocs: readonly Heredoc[], used: Set<number>): string | undefined {
  const tag = /<<-?\s*['"]?([A-Za-z_]\w*)/.exec(value)?.[1]
  const at = heredocs.findIndex((h, i) => !used.has(i) && h.tag === tag && h.opener.includes('$('))
  if (tag === undefined || at < 0) return undefined
  used.add(at)
  return heredocs[at]?.body
}

/** The heredoc a `-F -` reads: the first unused one that is not inside a `$(...)`. */
function stdinHeredoc(heredocs: readonly Heredoc[], used: Set<number>): string | undefined {
  const at = heredocs.findIndex((h, i) => !used.has(i) && !h.opener.includes('$('))
  if (at < 0) return undefined
  used.add(at)
  return heredocs[at]?.body
}

/** One `-m` value as git receives it, or undefined when the shell builds it at run time. */
function messagePart(value: string, heredocs: readonly Heredoc[], used: Set<number>): string | undefined {
  if (value.includes('<<')) return heredocFor(value, heredocs, used)
  return /\$[({A-Za-z_]|`/.test(value) ? undefined : value
}

/** The text of the `-m` values, joined as git joins them, or why one of them cannot be read. */
function fromMessages(values: readonly string[], heredocs: readonly Heredoc[], used: Set<number>): Message {
  const parts: string[] = []
  for (const value of values) {
    const part = messagePart(value, heredocs, used)
    if (part === undefined) return { unknown: 'the shell builds the message when the command runs' }
    parts.push(part.trim())
  }
  return { text: parts.join('\n\n') }
}

/** The text a `-F <file>` names: the heredoc for `-F -`, else the file's text as the caller read it. */
function fromFile(file: string, heredocs: readonly Heredoc[], used: Set<number>, fileText: string | undefined): Message {
  const text = file === '-' ? stdinHeredoc(heredocs, used) : fileText
  if (text !== undefined) return { text }
  return { unknown: file === '-' ? 'the message comes from standard input' : `the message file ${file} was not read` }
}

/**
 * The message a commit records. `fileText` is the text of the `-F` file when the caller read it.
 * `--trailer` values join the text, since git appends them as trailer lines.
 */
export function messageOf(c: Parsed, heredocs: readonly Heredoc[], used: Set<number>, fileText?: string): Message {
  if (['reuse', 'fixup', 'squash'].some(flag => c.flags.has(flag))) return { unknown: 'the message comes from another commit' }
  const messages = c.values.get('message') ?? []
  const file = c.values.get('file')?.[0]
  let found: Message = { unknown: c.flags.has('amend') ? 'the commit keeps the message of the commit it amends' : 'no message was given, so git opens an editor' }
  if (messages.length > 0) found = fromMessages(messages, heredocs, used)
  else if (file !== undefined) found = fromFile(file, heredocs, used, fileText)
  const trailers = c.values.get('trailer') ?? []
  if (!('text' in found) || trailers.length === 0) return found
  return { text: `${found.text}\n\n${trailers.join('\n')}` }
}

/** The types the skill lists, core and extended. */
export const TYPES = new Set([
  'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci', 'security', 'hotfix', 'revert',
  'lint', 'move', 'arch', 'deps-add', 'deps-remove', 'deps-pin',
  'format', 'patch', 'catch', 'remove', 'typo', 'comments', 'deprecate',
  'init', 'seed', 'ux', 'a11y', 'i18n', 'animation', 'ui', 'responsive',
  'db', 'analytics', 'logs', 'logs-remove', 'backup', 'metrics', 'flags',
  'release', 'wip', 'ci-fix', 'ci-build', 'merge', 'license', 'breaking',
  'experiment', 'mock', 'snapshots', 'experimental', 'dx',
  'docs-api', 'docs-readme', 'types', 'business', 'assets', 'gitignore',
  'dead', 'cleanup', 'validation', 'thread', 'offline',
])

/** A conventional subject: its type, its scope, and the first character of its description. */
const CONVENTIONAL = /^([a-z][a-z0-9-]*)(\([^()]*\))?!?: (\S)/

/**
 * The style of the repository's recent subjects. `conventional` needs three subjects and a majority;
 * `lowercase` says how a subject starts after its prefix, undefined when neither case leads.
 */
export type Style = { count: number; conventional: number; isConventional: boolean; lowercase?: boolean }

export function styleOf(subjects: readonly string[]): Style {
  const firsts = subjects.map(s => CONVENTIONAL.exec(s)?.[3]).filter((c): c is string => c !== undefined)
  const lower = firsts.filter(c => c !== c.toUpperCase()).length
  const upper = firsts.filter(c => c !== c.toLowerCase()).length
  const style: Style = { count: subjects.length, conventional: firsts.length, isConventional: subjects.length >= 3 && firsts.length * 2 > subjects.length }
  if (lower !== upper) style.lowercase = lower > upper
  return style
}

const AI = String.raw`(?:claude|anthropic|openai|chatgpt|gpt|copilot|gemini|codex|cursor|\bai\b|assistant|llm)`

/** Lines that sign a commit as the work of an AI tool. */
const SIGNATURES = [
  new RegExp(String.raw`^co-authored-by:[^\n]*${AI}`, 'im'),
  new RegExp(String.raw`^[^A-Za-z0-9\n]*(?:generated|created|written|authored|made)\s+(?:with|by|using)\b[^\n]*${AI}`, 'im'),
  /noreply@anthropic\.com/i,
  /🤖/u,
]

/** The first line that signs the commit as AI work, or undefined. */
export function signatureLine(text: string): string | undefined {
  for (const re of SIGNATURES) {
    const m = re.exec(text)
    if (m === null) continue
    const start = text.lastIndexOf('\n', m.index) + 1
    const end = text.indexOf('\n', m.index)
    return text.slice(start, end < 0 ? undefined : end).trim()
  }
  return undefined
}

/** Imperative verbs that end like a past tense or a gerund. */
const IMPERATIVE_ED_ING = new Set(['embed', 'need', 'seed', 'feed', 'bleed', 'breed', 'exceed', 'proceed', 'succeed', 'shed', 'shred', 'speed', 'bring', 'ring', 'sing', 'sting', 'string', 'swing', 'spring', 'fling', 'cling', 'ping'])

/** The hard rules of the first line: present, at most 72 characters, no closing period. */
function lineFindings(subject: string): Finding[] {
  const length = [...subject].length
  if (length === 0) return [deny('empty subject', 'The commit message has an empty first line. Write a subject line.')]
  const out: Finding[] = []
  if (length > 72) out.push(deny('subject over 72 characters', `The subject line is ${length} characters long; the skill's limit is 72. Shorten it and move the detail into the body.`))
  if (subject.endsWith('.')) out.push(deny('subject ends with a period', 'The subject line ends with a period, which the skill does not allow. Drop the period.'))
  return out
}

/** The conventional rules, where the repository's recent subjects follow them. */
function styleFindings(subject: string, style: Style): Finding[] {
  if (!style.isConventional) return []
  const m = CONVENTIONAL.exec(subject)
  const share = `${style.conventional} of the last ${style.count} subjects`
  if (m === null) return [deny('subject is not type(scope): subject', `This repository writes conventional subjects (${share}), and this subject is not \`type(scope): subject\`. Rewrite it, for example \`fix(parser): handle empty input\`.`)]
  const type = m[1] ?? ''
  if (!TYPES.has(type)) return [deny(`unknown type ${type}`, `\`${type}\` is not a type the commit skill lists. Use one of its types, such as feat, fix, docs, refactor, test or chore.`)]
  const first = m[3] ?? ''
  const isLower = first !== first.toUpperCase()
  const isUpper = first !== first.toLowerCase()
  if (style.lowercase === true && isUpper) return [note('subject case', `This repository starts its subjects lowercase after the type (${share}), and this one starts uppercase.`)]
  if (style.lowercase === false && isLower) return [note('subject case', `This repository starts its subjects uppercase after the type (${share}), and this one starts lowercase.`)]
  return []
}

/** A note when the subject's first word reads as a past tense or a gerund, not an imperative. */
function moodFindings(subject: string): Finding[] {
  const word = (subject.replace(CONVENTIONAL, '$3').split(/\s+/)[0] ?? '').toLowerCase()
  if (!/^[a-z]+(?:ed|ing)$/.test(word) || IMPERATIVE_ED_ING.has(word)) return []
  return [note('subject not imperative', `The subject starts with "${word}"; the skill writes subjects in the imperative mood ("add", not "added" or "adding").`)]
}

/** Every rule of the skill the message breaks, measured against the repository's style. */
export function messageFindings(text: string, style: Style): Finding[] {
  const subject = (text.split('\n')[0] ?? '').trim()
  const signature = signatureLine(text)
  const signed = signature === undefined ? [] : [deny('AI signature in the message', `The message carries an AI signature line (\`${signature}\`), which the skill never adds. Remove that line.`)]
  const line = lineFindings(subject)
  if (subject === '') return [...signed, ...line]
  return [...signed, ...line, ...styleFindings(subject, style), ...moodFindings(subject)]
}
