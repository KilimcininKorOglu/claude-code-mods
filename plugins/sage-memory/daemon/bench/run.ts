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
import { CHOOSE, EXTRA_ANCHORS, IN_LANGUAGE, LANGUAGES, LOG_LINES, LONG, LONG_LEAD, NAMED, NOTES, QUESTIONS, SHARED, SHARED_NAME, SHARED_NAME_KEYS, SUBAGENT_TASKS, TOOL_PATHS, TOPICLESS, TOPIC_TAGS, TRANSLATED, UNRELATED, filler, type Language, type Note, type StoreLanguage } from './fixtures.ts'

type Memory = { id: string; scope: string }
type Ranked = { memory: Memory; reasons?: string[] }
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
/** `--sent` prints every prompt and every note it sent, with the note's class and cosine, one line each. */
const listSent = args.includes('--sent')

const { world } = await import(join(build, 'daemon/test/world.ts'))
const { rankForPrompt, rankForTools, rankForSubagent } = await import(join(build, 'daemon/remind.ts'))
const { createEmbeddings } = await import(join(build, 'daemon/embeddings.ts'))
const { transformersRuntime } = await import(join(build, 'daemon/embedder.ts'))
const { layoutOf } = await import(join(build, 'hooks/shared/layout.ts'))
const hooks = await import(join(build, 'hooks/remind.ts'))
const { searchHybrid } = await import(join(build, 'daemon/hybrid.ts'))
const { EVERY_POLICY } = await import(join(build, 'daemon/search.ts'))

/** A note as the store under test holds it: translated, or in English with its long lead. */
function textOf(note: Note): string {
  const text = storeLanguage === 'en' ? (LONG_LEAD[note.key] ?? '') + note.text : (TRANSLATED[storeLanguage][note.key] ?? note.text)
  return SHARED_NAME_KEYS.has(note.key) ? `${text} (${SHARED_NAME})` : text
}

const runtime = transformersRuntime(layoutOf(join(homedir(), '.claude', 'sage-memory')))
const w = world()
const embeddings = createEmbeddings(runtime)
const notes: Note[] = [...NOTES, ...filler(Math.max(0, size - NOTES.length))]
const keyOf = new Map<string, Note>()
for (const note of notes) {
  const anchors = [...(note.anchors ?? []), ...(EXTRA_ANCHORS[note.key] ?? [])]
  const written = await w.remember({ text: textOf(note), anchors, tags: [...(TOPIC_TAGS[note.topic] ?? [])], distinct: true })
  keyOf.set(written.memory.id, note)
}
if (!wordsOnly) await embeddings.fill(w.project)

/** How long each query took to embed, the prompt's own vector and its pieces, apart from the ranking. */
const embedTimings: number[] = []

/** The readers of one query; `byPiece` as the prompt and subagent routes ask, the tool route not. */
async function readers(query: string, byPiece = true): Promise<unknown> {
  const base = w.readers('bench', 'main')
  if (wordsOnly) return base
  const started = performance.now()
  const semantic = await embeddings.semantic(query, [], byPiece)
  embedTimings.push(performance.now() - started)
  return { ...base, semantic }
}

const timings: number[] = []
const toolTimings: number[] = []
const searchTimings: number[] = []

/** The fastest of three runs of `work`, so one slow tick does not decide the line. */
function fastest<T>(work: () => T, into: number[]): T {
  let best = Number.POSITIVE_INFINITY
  let result = work()
  for (let run = 0; run < 3; run++) {
    const started = performance.now()
    result = work()
    best = Math.min(best, performance.now() - started)
  }
  into.push(best)
  return result
}

/**
 * The prompt ranking, timed; the same text also times the other two paths a store answers at every
 * request, a file tool's ranking (on a file no memory names) and the search tool, as their routes call them.
 */
function timedRank(read: unknown, text: string): Ranking {
  const readers = read as { project: { store: { db: unknown } }; user: { store: { db: unknown } }; semantic?: unknown }
  fastest(() => rankForTools(read, { paths: ['src/bench/unnamed.ts'], query: text, mutation: false, limit: 24 }), toolTimings)
  const visibility = { statuses: ['active'], policies: EVERY_POLICY, audienceScoped: true }
  fastest(() => searchHybrid([readers.project.store.db, readers.user.store.db], text, visibility, 20, readers.semantic, 0.45), searchTimings)
  return fastest(() => rankForPrompt(read, { query: text, limit: 24, blockCount: 8 }) as Ranking, timings)
}

/** The median and p95 line of one path's timings. */
function timingLine(name: string, values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b)
  return `${name} ms: median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)}  p95 ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(1)}`
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

let promptIndex = 0
/** The class of a sent note for the prompt that wanted `want`. */
function classOf(note: Note, want: string | undefined): string {
  const target = NOTES.find(item => item.key === want)
  return note.key === want ? 'wanted' : target !== undefined && topicOf(note) === target.topic ? 'same-topic' : 'other'
}

/** Tallies a prompt in its group and, with `--sent`, prints it and each note it sent with the cosine its reasons give. */
function count(group: keyof typeof groups, sent: readonly Note[], want: string | undefined, ranked: readonly Ranked[], lang = '-'): void {
  tally(groups[group], sent, want)
  if (!listSent) return
  promptIndex++
  console.log(`asked\t${group}\t${lang}\t${promptIndex}`)
  for (const note of sent) {
    const reasons = ranked.find(item => keyOf.get(item.memory.id) === note)?.reasons ?? []
    const cos = reasons.map(reason => /^query:semantic-cosine:(\d\.\d+)$/.exec(reason)?.[1]).find(value => value !== undefined) ?? '-'
    console.log(`sent\t${group}\t${lang}\t${promptIndex}\t${classOf(note, want)}\t${note.key}\t${cos}\t${reasons[0] ?? '-'}`)
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
const groups = { choose: fresh(), accept: fresh(), same: fresh(), named: fresh(), shared: fresh(), suffixed: fresh(), long: fresh(), logonly: fresh(), subagent: fresh(), unrelated: fresh(), topicless: fresh(), tool: fresh() }
/** Notes the shared-name prompts sent that the name points at, besides the one wanted. */
let sharedAlso = 0
const byLanguage = Object.fromEntries(LANGUAGES.map(lang => [lang, fresh()])) as Record<Language, Score>

for (const [want, texts] of Object.entries(QUESTIONS)) {
  for (const lang of LANGUAGES) {
    const { ranking, sent } = await promptSent(texts[lang])
    count(CHOOSE.has(lang) ? 'choose' : 'accept', sent, want, ranking.candidates, lang)
    tally(byLanguage[lang], sent, want)
    if (lang === storeLanguage) tally(groups.same, sent, want)
    if (why && !sent.some(note => note.key === want)) await explain(texts[lang], want, ranking, sent)
  }
}
for (const prompt of NAMED) {
  const { ranking, sent } = await promptSent(prompt.text)
  count('named', sent, prompt.want, ranking.candidates)
  if (why && !sent.some(note => note.key === prompt.want)) await explain(prompt.text, prompt.want, ranking, sent)
}
for (const prompt of SHARED) {
  const { ranking, sent } = await promptSent(prompt.text)
  count('shared', sent, prompt.want, ranking.candidates)
  sharedAlso += sent.filter(note => prompt.also.includes(note.key)).length
}
for (const prompt of IN_LANGUAGE.filter(row => row.store === storeLanguage)) {
  const { ranking, sent } = await promptSent(prompt.text)
  count('suffixed', sent, prompt.want, ranking.candidates)
  if (why && !sent.some(note => note.key === prompt.want)) await explain(prompt.text, prompt.want, ranking, sent)
}
/** The ranking time of each long pasted prompt: three of about 180 prompts, so the p95 line hides them. */
const longTimings: number[] = []
const longEmbedTimings: number[] = []
for (const prompt of LONG) {
  const { ranking, sent } = await promptSent(prompt.text)
  longTimings.push(timings.at(-1)!)
  if (embedTimings.length > 0) longEmbedTimings.push(embedTimings.at(-1)!)
  count('long', sent, prompt.want, ranking.candidates)
}
for (const task of SUBAGENT_TASKS) {
  const ranking = rankForSubagent(await readers(task.text), { task: task.text, audienceLimit: 20, taskLimit: 8 }) as { audience: Memory[]; task: Ranked[] }
  const sent = (hooks.subagentReminder([], ranking.audience, ranking.task) as { sent: Memory[] }).sent
  count('subagent', sent.map(memory => keyOf.get(memory.id)!), task.want, ranking.task)
}
{
  const { ranking, sent } = await promptSent(LOG_LINES)
  count('logonly', sent, undefined, ranking.candidates)
}
for (const lang of LANGUAGES) {
  for (const [group, texts] of [['unrelated', UNRELATED[lang]], ['topicless', TOPICLESS[lang]]] as const) {
    for (const text of texts) {
      const { ranking, sent } = await promptSent(text)
      count(group, sent, undefined, ranking.candidates, lang)
    }
  }
}
for (const { path, want } of TOOL_PATHS) {
  const file = join(w.root, path)
  const query = hooks.queryOf([{ tool_name: 'Read', tool_input: { file_path: file } }], [file], [], w.root) as string
  const ranking = rankForTools(await readers(query, false), { paths: [file], query, mutation: false, limit: 24 }) as Ranking
  const sent = (hooks.toolReminder(ranking.candidates, '', hooks.toolBudget(undefined), false, false) as { sent: Memory[] }).sent
  count('tool', sent.map(memory => keyOf.get(memory.id)!), want, ranking.candidates, path)
}
const unrelatedBest = await bestCosine(LANGUAGES.flatMap(lang => UNRELATED[lang]))
const topiclessBest = await bestCosine(LANGUAGES.flatMap(lang => TOPICLESS[lang]))
w.close()

const line = (name: string, s: Score): string =>
  `${name.padEnd(10)} asked ${String(s.asked).padStart(3)}  wanted sent ${String(s.hit).padStart(3)}  same-topic others ${(s.sibling / Math.max(1, s.asked)).toFixed(2)}/prompt  other ${(s.other / Math.max(1, s.asked)).toFixed(2)}/prompt`
console.log(`build ${build}  notes ${notes.length} in ${storeLanguage}  ${wordsOnly ? 'words only' : 'embeddings'}`)
for (const [name, score] of Object.entries(groups)) console.log(line(name, score))
console.log(`shared-name prompts sent ${sharedAlso} notes the name points at besides the wanted one`)
for (const lang of LANGUAGES) console.log(line(`  ${lang}`, byLanguage[lang]))
if (embedder) console.log(`best cosine of an unrelated message ${unrelatedBest.toFixed(2)}, of a topic-less one ${topiclessBest.toFixed(2)}`)
console.log(`rankForPrompt ms of the long prompts: ${longTimings.map(ms => ms.toFixed(1)).join(', ')}`)
if (longEmbedTimings.length > 0) console.log(`embedding ms of the long prompts: ${longEmbedTimings.map(ms => ms.toFixed(1)).join(', ')}`)
if (embedTimings.length > 0) console.log(`embedding ms of every query: max ${Math.max(...embedTimings).toFixed(1)}`)
console.log(timingLine('rankForPrompt', timings))
console.log(timingLine('rankForTools', toolTimings))
console.log(timingLine('search', searchTimings))
