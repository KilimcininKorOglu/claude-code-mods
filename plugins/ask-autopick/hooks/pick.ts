/** Which option a question that waited too long gets, and the texts this mod writes. */

/** One question of an AskUserQuestion call, as far as this mod reads it. */
export type Question = { question: string; multiSelect?: boolean; options?: { label: string }[] }

/** The wait in minutes before a pick, when nothing is stored. */
export const DEFAULT_MINUTES = 10

/** The band `/ask-autopick <minutes>` takes; a value outside it is refused, never clamped. */
const MIN_MINUTES = 1
const MAX_MINUTES = 120

/**
 * The words a model writes in parentheses after the option it recommends. The tool tells it to write
 * `(Recommended)`, and in a question written in another language it writes that word in the language.
 */
const RECOMMENDED_WORDS = [
  'recommended', 'önerilen', 'empfohlen', 'recomendado', 'recomendada', 'recommandé', 'recommandée',
  'consigliato', 'consigliata', 'aanbevolen', 'zalecane', 'рекомендуется', '推荐', '推薦', '推奨', 'おすすめ', '권장', '추천',
]

/** A label that ends with one of those words in parentheses, ASCII or full-width. */
const RECOMMENDED_END = new RegExp(`[(（]\\s*(?:${RECOMMENDED_WORDS.join('|')})\\s*[)）]\\s*$`, 'iu')

export const USAGE = 'expects nothing (the status), on, off, or a number of minutes from 1 to 120'

export function isRecommended(label: string): boolean {
  return RECOMMENDED_END.test(label)
}

/**
 * The recommended label of one question: the first option, marked at the end of its label, with no other
 * option marked, because the tool tells the model to put the option it recommends first. Undefined for a
 * question that takes several answers or has no such option.
 */
function pickOf(q: Question): string | undefined {
  const [first, ...rest] = q.options ?? []
  if (q.multiSelect === true || first === undefined || !isRecommended(first.label)) return undefined
  return rest.some(o => isRecommended(o.label)) ? undefined : first.label
}

/**
 * The answers a pick gives, one recommended label per question, or undefined when a question has none:
 * such a question keeps waiting on the person.
 */
export function picksOf(questions: readonly Question[]): Record<string, string> | undefined {
  const answers: Record<string, string> = {}
  for (const q of questions) {
    const label = pickOf(q)
    if (label === undefined) return undefined
    answers[q.question] = label
  }
  return answers
}

/** The minutes a `/ask-autopick <word>` argument names, or undefined when it names none. */
export function minutesOf(arg: string): number | undefined {
  if (!/^\d{1,3}$/.test(arg)) return undefined
  const n = Number(arg)
  return n >= MIN_MINUTES && n <= MAX_MINUTES ? n : undefined
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A sidebar line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/**
 * The pick as a sidebar line: each picked answer yellow, the questions and the rest faint. The line is
 * yellow as a whole for a sidebar that draws no parts.
 */
export function pickedLine(minutes: number, answers: Record<string, string>): Line {
  const each = Object.entries(answers).flatMap(([q, a], i): Part[] => [
    ...(i === 0 ? [] : [{ text: '; ', kind: 'dim' as const }]),
    { text: `${q} → `, kind: 'dim' },
    { text: a, kind: 'warn' },
  ])
  return { ...partsLine([{ text: `no answer in ${minutes} min, picked the recommended option: `, kind: 'dim' }, ...each]), kind: 'warn' }
}

/** The pick as the person reads it: each question with the option it got. */
export function pickedLog(minutes: number, answers: Record<string, string>): string {
  return pickedLine(minutes, answers).text
}

/** The line the person reads when a question has nothing to pick. */
export function waitsLog(minutes: number): string {
  return `a question has no recommended first option or takes several answers, so it waits for you past ${minutes} min`
}

/** The waiting question as a sidebar line: yellow, because nothing failed and the person is asked. */
export function waitsLine(minutes: number): Line {
  return { text: waitsLog(minutes), kind: 'warn' }
}

/** The note the model reads after a picked answer, so it does not read the pick as the person's choice. */
export function pickedNote(minutes: number): string {
  return `ask-autopick: the person did not answer within ${minutes} minutes, so the recommended option was picked for them. Treat it as a default, not as their decision, and name the pick in your next reply.`
}

/** The `/ask-autopick` status. */
export function statusText(enabled: boolean, minutes: number): string {
  return enabled
    ? `on · a question unanswered for ${minutes} min gets its recommended option`
    : `off · questions wait for you; /ask-autopick on picks the recommended option after ${minutes} min`
}
