/**
 * The full output of a filtered call, kept in a file the model can open with Read: the engine's own file
 * when it already wrote one, else one under `$TMPDIR/bash-diet`.
 */

/** A failed call's output shorter than this reads whole after filtering; it needs no file. */
export const MIN_KEPT_BYTES = 500

/** How many files the directory keeps, and for how long; the oldest go first. */
export const MAX_FILES = 200
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Whether a call's full output is worth a file: the filter left something out, or a long run failed. */
export function needsFile(elided: boolean, exitCode: number, rawLength: number): boolean {
  return elided || (exitCode !== 0 && rawLength >= MIN_KEPT_BYTES)
}

/** The SHA-256 of a text in hex. */
export async function sha256Of(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
}

/** The first 12 hex digits of the SHA-256 of the command and its output, as the file's name. */
export async function hashOf(command: string, output: string): Promise<string> {
  return (await sha256Of(`${command}\0${output}`)).slice(0, 12)
}

/**
 * Whether the engine cut a failed call's text before the hook read it: it keeps 10,000 characters around
 * `... [N characters truncated] ...` and writes the middle nowhere.
 */
export const isCut = (text: string): boolean => /\.\.\. \[\d+ characters truncated\] \.\.\./.test(text)

/** The line the model reads under the filtered text; a cut output's file holds only what reached the hook. */
export function fullOutputLine(path: string, cut: boolean): string {
  return cut ? `[output cut by Claude Code at 10000 characters; the middle is lost: ${path}]` : `[full output: ${path}]`
}

/** The files to delete from a listing: over the age limit, then the oldest past the count limit. */
export function staleFiles(files: { name: string; mtimeMs: number }[], now: number): string[] {
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
  return sorted.filter((f, i) => i >= MAX_FILES || now - f.mtimeMs > MAX_AGE_MS).map(f => f.name)
}
