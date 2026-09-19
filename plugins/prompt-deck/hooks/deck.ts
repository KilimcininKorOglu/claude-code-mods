/** Which prompts the person sends often, counted from what they type. */

/** Uses and the time of the last use, per prompt text. */
export type Counts = Record<string, { n: number; last: number }>

/** A prompt longer than this is not a one-press prompt. */
export const MAX_CHARS = 80

/** The deck keeps at most this many prompts; the least used and oldest go first. */
export const MAX_KEPT = 200

/** A prompt reaches the band from this many uses. */
export const MIN_USES = 3

/** The band draws at most this many prompts, on the hotkeys 1 to 5. */
export const BAND_SIZE = 5

/** The prompt as it is counted, or undefined for a prompt the deck does not keep. */
export function normalize(text: string): string | undefined {
  const t = text.trim()
  if (t === '' || t.length > MAX_CHARS || t.includes('\n') || t.startsWith('/')) return undefined
  return t
}

const byUse = ([, a]: [string, { n: number; last: number }], [, b]: [string, { n: number; last: number }]): number => b.n - a.n || b.last - a.last

/** Every kept prompt, the most used first, the latest first on a tie. */
export function ranked(counts: Counts): string[] {
  return Object.entries(counts).sort(byUse).map(([text]) => text)
}

/** The store key of one project's counts; each project counts its own prompts. */
export function countsKey(project: string): string {
  return `counts:${project}`
}

/** The last part of a path, without a trailing slash: the project name. */
export function projectName(path: string): string {
  return path.replace(/\/+$/, '').split('/').at(-1) ?? path
}

/** Both sets of counts in one: a prompt in both keeps the higher count and the later use. */
export function mergeCounts(a: Counts, b: Counts): Counts {
  const out: Counts = { ...a }
  for (const [text, use] of Object.entries(b)) {
    const had = out[text]
    out[text] = had === undefined ? use : { n: Math.max(had.n, use.n), last: Math.max(had.last, use.last) }
  }
  return Object.fromEntries(Object.entries(out).sort(byUse).slice(0, MAX_KEPT))
}

/** The counts after one more use of `text`, trimmed to MAX_KEPT. */
export function record(counts: Counts, text: string, now: number): Counts {
  const next: Counts = { ...counts, [text]: { n: (counts[text]?.n ?? 0) + 1, last: now } }
  const kept = Object.entries(next).sort(byUse).slice(0, MAX_KEPT)
  return Object.fromEntries(kept)
}

/** The prompts the band draws. */
export function band(counts: Counts): string[] {
  return ranked(counts).filter(t => (counts[t]?.n ?? 0) >= MIN_USES).slice(0, BAND_SIZE)
}

/** One band label cut to fit `count` buttons across `columns` cells; `N: ` and a gap take 5 cells each. */
export function fit(text: string, count: number, columns: number): string {
  const width = Math.max(8, Math.floor(columns / Math.max(count, 1)) - 5)
  return text.length <= width ? text : `${text.slice(0, width - 1).trimEnd()}…`
}

/** The `/deck` list: every kept prompt with its uses, the number `/deck remove` takes. */
export function listText(counts: Counts): string {
  const all = ranked(counts)
  if (all.length === 0) return `no prompt counted yet; a prompt reaches the band after ${MIN_USES} uses`
  return all.map((t, i) => `${i + 1}. ${t} (${counts[t]?.n ?? 0})`).join('\n')
}

/** The counts without the prompt at 1-based place `place` of the `/deck` list, or undefined for no such place. */
export function removeAt(counts: Counts, place: number): Counts | undefined {
  const text = ranked(counts)[place - 1]
  if (text === undefined) return undefined
  return Object.fromEntries(Object.entries(counts).filter(([t]) => t !== text))
}
