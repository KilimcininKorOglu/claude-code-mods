/** One line per event on stderr, which the launcher points at daemon.log. */
export function log(text: string): void {
  process.stderr.write(`${new Date().toISOString()} ${text}\n`)
}

/** The message of a thrown value. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The `code` of a Node system error, or undefined. */
export function codeOf(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}
