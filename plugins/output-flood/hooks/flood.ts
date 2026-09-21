/** How large a Bash result was, and the narrower command that would have answered the same question. */

/** The size a result must pass to be reported, in KB, until the person sets another one. */
export const DEFAULT_LIMIT_KB = 20

/** The band `/output-flood limit <kb>` takes; a value outside it is refused, never clamped. */
export const MIN_LIMIT_KB = 1
export const MAX_LIMIT_KB = 1000

/** The characters of one KB, as this mod counts a result. */
const KB = 1024

/** How much of the command the texts name, so one long command does not fill the note. */
const MAX_COMMAND = 60

/** The size of one Bash result in characters: both streams, as the model read them. */
export function sizeOf(stdout: string, stderr: string): number {
  return stdout.length + stderr.length
}

/** The size in KB, one decimal under 10 KB. */
export function fmtKb(chars: number): string {
  const kb = chars / KB
  return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`
}

/** The command as the texts name it: one line, cut. */
export function shownCommand(command: string): string {
  const one = command.replace(/\s+/g, ' ').trim()
  return one.length <= MAX_COMMAND ? one : `${one.slice(0, MAX_COMMAND - 1)}…`
}

/** The limit a `/output-flood limit <word>` argument names, or undefined when it is not one. */
export function limitOf(arg: string): number | undefined {
  if (!/^\d{1,4}$/.test(arg)) return undefined
  const n = Number(arg)
  return n >= MIN_LIMIT_KB && n <= MAX_LIMIT_KB ? n : undefined
}

/** The answer of `/output-flood limit <kb>`, or of an argument it cannot read. */
export function limitText(limit: number | undefined): string {
  if (limit === undefined) return `limit expects a whole number of KB from ${MIN_LIMIT_KB} to ${MAX_LIMIT_KB}`
  return `limit ${limit} KB: a result over ${limit} KB is reported`
}

/**
 * The narrower command per kind of flood, matched on the command itself. Each names what to ask instead,
 * never a pipe into `tail` or `head`: a long run whose output is cut at the end hides the failure that
 * scrolled past, and the person reads the whole stream by choice.
 */
const ADVICE: readonly { when: RegExp; text: string }[] = [
  { when: /\b(pytest|jest|vitest|go test|cargo test|phpunit|mvn test|gradle test)\b/, text: 'run the one test or file this turn needs, and let the runner report only failures (pytest -x -q, go test -run, cargo test <name>, jest -t)' },
  { when: /\bgit (log|diff|show)\b/, text: 'bound it: a path, -n, --stat, or --name-only, and read the one hunk you need' },
  { when: /\b(find|ls|du|tree)\b/, text: 'bound the walk: -maxdepth, a path, or -name, and count instead of listing when a count answers it' },
  { when: /\b(npm|yarn|pnpm|bun) (install|ci|run build)\b/, text: 'run it with its quiet flag (npm ci --silent, npm run build -- --silent) and read its error file' },
  { when: /\b(cat|Read|jq|curl)\b/, text: 'read the part you need: a line range, a jq path, or the fields alone' },
  { when: /\b(docker|kubectl) logs\b/, text: 'bound it: --since and --tail as the command\'s own flags, or one container' },
]

/** The advice for one command: the first kind it matches, else the general one. */
export function adviceFor(command: string): string {
  const row = ADVICE.find(a => a.when.test(command))
  return row?.text ?? 'send the output to a file (> /tmp/run.log 2>&1) and read the range you need from it, or narrow the command itself'
}

/** The note the model reads after its own flood: what it cost, and what to run instead next time. */
export function noteText(command: string, chars: number, limit: number): string {
  return `output-flood: "${shownCommand(command)}" returned ${fmtKb(chars)} of output, over the ${limit} KB limit, and all of it is now in the context. Next time ${adviceFor(command)}.`
}

/** The transcript line the person reads: the finding alone, without the instruction. The engine adds the mod name. */
export function logText(command: string, chars: number, limit: number): string {
  return `${fmtKb(chars)} of output from "${shownCommand(command)}", over ${limit} KB`
}

/** The sidebar lines of one finding: the size on the first line, the advice faint under it. */
export function sidebarLines(command: string, chars: number, limit: number): { text: string; kind: 'error' | 'dim' }[] {
  return [
    { text: logText(command, chars, limit), kind: 'error' },
    { text: adviceFor(command), kind: 'dim' },
  ]
}

/** A sidebar section key: the subject cut to what the sidebar takes. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'flood'
}

/** The `/output-flood` answer: the setting, the limit, and what this session has flooded. */
export function statusText(enabled: boolean, limit: number, floods: number, total: number): string {
  const seen = floods === 0 ? 'no result over it yet' : `${floods} result(s) over it, ${fmtKb(total)} in all`
  return `${enabled ? 'on' : 'off'} · limit ${limit} KB · ${seen}`
}
