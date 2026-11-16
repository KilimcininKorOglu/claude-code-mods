/**
 * Scores what a sage-memory build really sends, on the synthetic project of `fixtures.ts`: the
 * prompt block of `promptReminder` and the file tool block of `toolReminder`, with the real
 * embedding model. Usage, from the mod's directory:
 *   node --import ./daemon/bench/resolve.mjs daemon/bench/run.ts [build dir] [--size n] [--notes en|tr|ja] [--words-only] [--why]
 * The build directory defaults to this checkout, so an older release unpacked elsewhere can be
 * scored by the same fixtures. `--why` prints, per question, the target's cosine, its cosine rank
 * and the stage that dropped it, and the best cosine any unrelated or topic-less message reached.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { CHOOSE, LANGUAGES, LONG_LEAD, NAMED, NOTES, QUESTIONS, TOOL_PATHS, TOPICLESS, TOPIC_TAGS, TRANSLATED, UNRELATED, filler, type Language, type Note, type StoreLanguage } from './fixtures.ts'

type Memory = { id: string; scope: string }
type Ranked = { memory: Memory }
type Rejected = { id: string; gate: string }
type Ranking = { candidates: Ranked[]; rejected: Rejected[] }
type Score = { asked: number; hit: number; sibling: number; other: number }
type Embedder = { embed: (texts: string[]) => Promise<number[][]> }

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name)
  return at < 0 ? undefined : args[at + 1]
}
const values = new Set([flag('--size'), flag('--notes')])
const build = resolve(args.find(arg => !arg.startsWith('--') && !values.has(arg)) ?? '.')
const size = Number(flag('--size') ?? NOTES.length)
const storeLanguage = (flag('--notes') ?? 'en') as StoreLanguage
const wordsOnly = args.includes('--words-only')
const why = args.includes('--why')

const { world } = await import(join(build, 'daemon/test/world.ts'))
const { rankForPrompt, rankForTools } = await import(join(build, 'daemon/remind.ts'))
const { createEmbeddings } = await import(join(build, 'daemon/embeddings.ts'))
const { transformersRuntime } = await import(join(build, 'daemon/embedder.ts'))
const { layoutOf } = await import(join(build, 'hooks/shared/layout.ts'))
const hooks = await import(join(build, 'hooks/remind.ts'))

/** A note as the store under test holds it: translated, or in English with its long lead. */
function textOf(note: Note): string {
  if (storeLanguage !== 'en') return TRANSLATED[storeLanguage][note.key] ?? note.text
  return (LONG_LEAD[note.key] ?? '') + note.text
}

const runtime = transformersRuntime(layoutOf(join(homedir(), '.claude', 'sage-memory')))
const w = world()
const embeddings = createEmbeddings(runtime)
const notes: Note[] = [...NOTES, ...filler(Math.max(0, size - NOTES.length))]
const keyOf = new Map<string, Note>()
for (const note of notes) {
  const written = await w.remember({ text: textOf(note), anchors: note.anchors, tags: [...(TOPIC_TAGS[note.topic] ?? [])], distinct: true })
  keyOf.set(written.memory.id, note)
}
if (!wordsOnly) await embeddings.fill(w.project)

async function readers(query: string): Promise<unknown> {
  const base = w.readers('bench', 'main')
  return wordsOnly ? base : { ...base, semantic: await embeddings.semantic(query, []) }
}

const timings: number[] = []
/** The ranking, timed as the fastest of three runs, so one slow tick does not decide the line. */
function timedRank(read: unknown, text: string): Ranking {
  let best = Number.POSITIVE_INFINITY
  let ranking: Ranking = { candidates: [], rejected: [] }
  for (let run = 0; run < 3; run++) {
    const started = performance.now()
    ranking = rankForPrompt(read, { query: text, limit: 24 }) as Ranking
    best = Math.min(best, performance.now() - started)
  }
  timings.push(best)
  return ranking
}

async function promptSent(text: string): Promise<{ ranking: Ranking; sent: Note[] }> {
  const ranking = timedRank(await readers(text), text)
  const own = ranking.candidates.filter(item => item.memory.scope !== 'user')
  return { ranking, sent: (hooks.promptReminder(own, '') as { sent: Memory[] }).sent.map(memory => keyOf.get(memory.id)!) }
}

const topicOf = (note: Note): string => note.topic.replace(/^filler-/, '')

function tally(score: Score, sent: readonly Note[], want: string | undefined): void {
  const target = NOTES.find(note => note.key === want)
  score.asked++
  for (const note of sent) {
    if (note.key === want) score.hit++
    else if (target !== undefined && topicOf(note) === target.topic) score.sibling++
    else score.other++
  }
}

const cosine = (a: readonly number[], b: readonly number[]): number => a.reduce((sum, value, i) => sum + value * b[i]!, 0)
const embedder: Embedder | undefined = why && !wordsOnly ? await runtime.load({ allowRemote: false, onProgress: () => {} }) : undefined
const noteVectors = embedder ? await embedder.embed(notes.map(textOf)) : []

/** Why a target did not arrive: its cosine and rank among all notes, and where the pipeline dropped it. */
async function explain(text: string, want: string, ranking: Ranking, sent: readonly Note[]): Promise<void> {
  const index = notes.findIndex(note => note.key === want)
  const id = [...keyOf].find(([, note]) => note.key === want)![0]
  const stage = sent.some(note => note.key === want) ? 'sent' : ranking.candidates.some(item => item.memory.id === id) ? 'block' : (ranking.rejected.find(item => item.id === id)?.gate ?? 'not found')
  if (!embedder) return console.log(`  ${want} ${stage.padEnd(12)} ${text}`)
  const [query] = await embedder.embed([text])
  const scores = noteVectors.map(vector => cosine(query!, vector))
  const rank = scores.filter(score => score > scores[index]!).length + 1
  console.log(`  ${want} cos ${scores[index]!.toFixed(2)} rank ${String(rank).padStart(4)} ${stage.padEnd(12)} ${text}`)
}

async function bestCosine(texts: readonly string[]): Promise<number> {
  if (!embedder) return Number.NaN
  const vectors = await embedder.embed([...texts])
  return Math.max(...vectors.flatMap(query => noteVectors.map(vector => cosine(query, vector))))
}

const fresh = (): Score => ({ asked: 0, hit: 0, sibling: 0, other: 0 })
const groups = { choose: fresh(), accept: fresh(), same: fresh(), named: fresh(), unrelated: fresh(), topicless: fresh(), tool: fresh() }
const byLanguage = Object.fromEntries(LANGUAGES.map(lang => [lang, fresh()])) as Record<Language, Score>

for (const [want, texts] of Object.entries(QUESTIONS)) {
  for (const lang of LANGUAGES) {
    const { ranking, sent } = await promptSent(texts[lang])
    tally(CHOOSE.has(lang) ? groups.choose : groups.accept, sent, want)
    tally(byLanguage[lang], sent, want)
    if (lang === storeLanguage) tally(groups.same, sent, want)
    if (why && !sent.some(note => note.key === want)) await explain(texts[lang], want, ranking, sent)
  }
}
for (const prompt of NAMED) {
  const { ranking, sent } = await promptSent(prompt.text)
  tally(groups.named, sent, prompt.want)
  if (why && !sent.some(note => note.key === prompt.want)) await explain(prompt.text, prompt.want, ranking, sent)
}
for (const lang of LANGUAGES) {
  for (const text of UNRELATED[lang]) tally(groups.unrelated, (await promptSent(text)).sent, undefined)
  for (const text of TOPICLESS[lang]) tally(groups.topicless, (await promptSent(text)).sent, undefined)
}
for (const { path, want } of TOOL_PATHS) {
  const file = join(w.root, path)
  const query = hooks.queryOf([{ tool_name: 'Read', tool_input: { file_path: file } }], [file], [], w.root) as string
  const ranking = rankForTools(await readers(query), { paths: [file], query, mutation: false, limit: 24 }) as Ranking
  const sent = (hooks.toolReminder(ranking.candidates, '', hooks.toolBudget(undefined), false, false) as { sent: Memory[] }).sent
  tally(groups.tool, sent.map(memory => keyOf.get(memory.id)!), want)
}
const unrelatedBest = await bestCosine(LANGUAGES.flatMap(lang => UNRELATED[lang]))
const topiclessBest = await bestCosine(LANGUAGES.flatMap(lang => TOPICLESS[lang]))
w.close()

const line = (name: string, s: Score): string =>
  `${name.padEnd(10)} asked ${String(s.asked).padStart(3)}  wanted sent ${String(s.hit).padStart(3)}  same-topic others ${(s.sibling / Math.max(1, s.asked)).toFixed(2)}/prompt  other ${(s.other / Math.max(1, s.asked)).toFixed(2)}/prompt`
console.log(`build ${build}  notes ${notes.length} in ${storeLanguage}  ${wordsOnly ? 'words only' : 'embeddings'}`)
for (const [name, score] of Object.entries(groups)) console.log(line(name, score))
for (const lang of LANGUAGES) console.log(line(`  ${lang}`, byLanguage[lang]))
if (embedder) console.log(`best cosine of an unrelated message ${unrelatedBest.toFixed(2)}, of a topic-less one ${topiclessBest.toFixed(2)}`)
timings.sort((a, b) => a - b)
console.log(`rankForPrompt ms: median ${timings[Math.floor(timings.length / 2)]!.toFixed(1)}  p95 ${timings[Math.floor(timings.length * 0.95)]!.toFixed(1)}`)
