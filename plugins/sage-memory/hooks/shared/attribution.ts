/**
 * Who decided or said a fact, written into a memory's text: a name or "the user" before a verb of
 * deciding or wanting, a possessive of a rule or a choice, or a "Decision:" label. The record's
 * source field says the person stated the fact and every reminder shows it, so the text keeps only
 * the fact. The verbs are those of a person, never of a program ("requires", "expects" stay out),
 * so "Deploy requires a tag" is not taken for one. Shared by the daemon, which enforces the rewrite,
 * and the hooks, which name the phrases to the job model.
 */

const VERBS = 'wants|wanted|prefers|preferred|chose|chooses|decided|decides|asked|asks|said|says|hates|dislikes|likes|objects|objected|rejects|rejected|insists|insisted|forbids|forbade|approved|refuses|refused'
const NOUNS = 'rule|rules|preference|preferences|choice|choices|decision|decisions|request|requests|style|answers|wish|wishes'

const PHRASES = [
  new RegExp(`\\b(?:[A-Z][a-z]+|[Tt]he user)(?: (?:strongly|explicitly|also|still|repeatedly|now))? (?:${VERBS})\\b`, 'g'),
  new RegExp(`\\b(?:[A-Z][a-z]+|[Tt]he user)'s (?:\\w+ )?(?:${NOUNS})\\b`, 'g'),
  /^(?:Decision|User preference|Preference|User rule)\s*:/g,
]

const PRONOUNS = /\b(?:he|him|his|she|her|hers)\b/gi

/**
 * What a rewrite of `old` must no longer hold once it names who decided it: the names its phrases
 * start with ("Alex" of "Alex chose", never "The" or "It") and the personal pronouns.
 */
export function personWordsIn(old: string, text: string): string[] {
  const names = attributionsOf(old)
    .map(phrase => /^([A-Z][a-z]+)\b/.exec(phrase)?.[1])
    .filter((name): name is string => name !== undefined && !['The', 'It', 'Decision', 'User', 'Preference'].includes(name))
  // A quoted or backticked span is the fact's own wording ("start each reply with \"Alex,\""), so a name there stays.
  const prose = text.replace(/"[^"]*"|`[^`]*`|“[^”]*”/g, ' ')
  const left = new Set(names.filter(name => new RegExp(`\\b${name}\\b`).test(prose)))
  for (const match of prose.matchAll(PRONOUNS)) left.add(match[0].toLowerCase())
  return [...left]
}

/** The phrases of `text` that name who decided or said it, as the text writes them. */
export function attributionsOf(text: string): string[] {
  const found = new Set<string>()
  for (const pattern of PHRASES) for (const match of text.matchAll(pattern)) found.add(match[0])
  return [...found]
}
