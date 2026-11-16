/**
 * Scores what a sage-memory build really sends, on the synthetic project of `fixtures.ts`: the
 * prompt block of `promptReminder` and the file tool block of `toolReminder`, with the real
 * embedding model. Usage, from the mod's directory:
 *   node --import ./daemon/bench/resolve.mjs daemon/bench/run.ts [build dir] [--size 40|300|3000] [--words-only]
 * The build directory defaults to this checkout, so an older release unpacked elsewhere can be
 * scored by the same fixtures.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { CHOOSE, LANGUAGES, NAMED, NOTES, QUESTIONS, TOOL_PATHS, TOPICLESS, UNRELATED, filler, type Language, type Note } from './fixtures.ts'

type Sent = { sent: Array<{ id: string }> }
type Ranked = { memory: { id: string; scope: string } }
type Score = { asked: number; hit: number; sibling: number; other: number }

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name)
  return at < 0 ? undefined : args[at + 1]
}
const build = resolve(args.find(arg => !arg.startsWith('--') && arg !== flag('--size')) ?? '.')
const size = Number(flag('--size') ?? NOTES.length)
const wordsOnly = args.includes('--words-only')

const { world } = await import(join(build, 'daemon/test/world.ts'))
const { rankForPrompt, rankForTools } = await import(join(build, 'daemon/remind.ts'))
const { createEmbeddings } = await import(join(build, 'daemon/embeddings.ts'))
const { transformersRuntime } = await import(join(build, 'daemon/embedder.ts'))
const { layoutOf } = await import(join(build, 'hooks/shared/layout.ts'))
const hooks = await import(join(build, 'hooks/remind.ts'))

const w = world()
const embeddings = createEmbeddings(transformersRuntime(layoutOf(join(homedir(), '.claude', 'sage-memory'))))
const notes: Note[] = [...NOTES, ...filler(Math.max(0, size - NOTES.length))]
const keyOf = new Map<string, Note>()
for (const note of notes) {
  const written = await w.remember({ text: note.text, anchors: note.anchors, distinct: true })
  keyOf.set(written.memory.id, note)
}
if (!wordsOnly) await embeddings.fill(w.project)

async function readers(query: string): Promise<unknown> {
  const base = w.readers('bench', 'main')
  return wordsOnly ? base : { ...base, semantic: await embeddings.semantic(query, []) }
}

const timings: number[] = []
async function promptSent(text: string): Promise<Note[]> {
  const read = await readers(text)
  const started = performance.now()
  const ranking = rankForPrompt(read, { query: text, limit: 24 })
  timings.push(performance.now() - started)
  const own = (ranking.candidates as Ranked[]).filter(item => item.memory.scope !== 'user')
  return (hooks.promptReminder(own, '') as Sent).sent.map(memory => keyOf.get(memory.id)!)
}

function tally(score: Score, sent: readonly Note[], want: string | undefined): void {
  const target = NOTES.find(note => note.key === want)
  score.asked++
  for (const note of sent) {
    if (note.key === want) score.hit++
    else if (target !== undefined && note.topic === target.topic) score.sibling++
    else score.other++
  }
}

const fresh = (): Score => ({ asked: 0, hit: 0, sibling: 0, other: 0 })
const groups = { choose: fresh(), accept: fresh(), named: fresh(), unrelated: fresh(), topicless: fresh(), tool: fresh() }
const byLanguage = Object.fromEntries(LANGUAGES.map(lang => [lang, fresh()])) as Record<Language, Score>

for (const [want, texts] of Object.entries(QUESTIONS)) {
  for (const lang of LANGUAGES) {
    const sent = await promptSent(texts[lang])
    tally(CHOOSE.has(lang) ? groups.choose : groups.accept, sent, want)
    tally(byLanguage[lang], sent, want)
  }
}
for (const prompt of NAMED) tally(groups.named, await promptSent(prompt.text), prompt.want)
for (const lang of LANGUAGES) {
  for (const text of UNRELATED[lang]) tally(groups.unrelated, await promptSent(text), undefined)
  for (const text of TOPICLESS[lang]) tally(groups.topicless, await promptSent(text), undefined)
}
for (const { path, want } of TOOL_PATHS) {
  const call = { tool_name: 'Read', tool_input: { file_path: join(w.root, path) } }
  const query = hooks.queryOf([call], [join(w.root, path)], [], w.root) as string
  const ranking = rankForTools(await readers(query), { paths: [join(w.root, path)], query, mutation: false, limit: 24 })
  tally(groups.tool, (hooks.toolReminder(ranking.candidates, '', hooks.toolBudget(undefined), false, false) as Sent).sent.map(memory => keyOf.get(memory.id)!), want)
}
w.close()

const line = (name: string, s: Score): string =>
  `${name.padEnd(10)} asked ${String(s.asked).padStart(3)}  wanted sent ${String(s.hit).padStart(3)}  same-topic others ${(s.sibling / s.asked).toFixed(2)}/prompt  other ${(s.other / s.asked).toFixed(2)}/prompt`
console.log(`build ${build}  notes ${notes.length}  ${wordsOnly ? 'words only' : 'embeddings'}`)
for (const [name, score] of Object.entries(groups)) console.log(line(name, score))
for (const lang of LANGUAGES) console.log(line(`  ${lang}`, byLanguage[lang]))
timings.sort((a, b) => a - b)
console.log(`rankForPrompt ms: median ${timings[Math.floor(timings.length / 2)]!.toFixed(1)}  p95 ${timings[Math.floor(timings.length * 0.95)]!.toFixed(1)}`)
