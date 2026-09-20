/** Which prompt is too long, where its file goes, and what the model reads in its place. */

/** The prompt is offloaded above this many characters, until a /prompt-offload limit says otherwise. */
export const DEFAULT_LIMIT = 2000

/** A limit under this keeps too little of the prompt to be worth a file. */
export const MIN_LIMIT = 500

/** How many characters of the prompt stay in the message. */
export const HEAD = 200

/** A name for the file, from the prompt and the time it was sent, FNV-1a 32. */
export function fileName(text: string, now: number): string {
  let h = 0x811c9dc5
  for (const ch of `${text}\0${now}`) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return `${h.toString(16).padStart(8, '0')}.txt`
}

/** The start of the prompt, cut at the last line break of the head when there is one. */
export function head(text: string, count = HEAD): string {
  const cut = text.slice(0, count)
  const line = cut.lastIndexOf('\n')
  return (line > count / 2 ? cut.slice(0, line) : cut).trimEnd()
}

/** What the model reads: the start of the prompt, then where the whole of it is. */
export function offloadText(text: string, path: string): string {
  const lines = text.split('\n').length
  return `${head(text)}\n\n[prompt-offload] The message was ${text.length} characters, so it was written to ${path} (${lines} line(s)) and this prompt holds its first ${head(text).length}. Read that file before you answer.`
}

/** The line the person reads in the transcript. */
export function logText(text: string, path: string): string {
  return `${text.length} characters written to ${path}; the model reads the first ${head(text).length} here`
}

/** The limit a `/prompt-offload limit <n>` argument names, or undefined when it is not one. */
export function limitOf(arg: string): number | undefined {
  const n = Number(arg)
  return /^\d+$/.test(arg) && n >= MIN_LIMIT ? n : undefined
}

/** Whether this prompt is long enough to be written to a file. */
export const isLong = (text: string, limit: number): boolean => text.length > limit
