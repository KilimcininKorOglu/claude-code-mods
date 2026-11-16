import type { DatabaseSync } from 'node:sqlite'
import { selectIds, sql } from './rows.ts'
import { heldTerms, visibilityParams, type Visibility } from './search.ts'
import { cjkPairs } from './searchable.ts'

/**
 * Word evidence from the store itself. A prompt's terms are weighed by how many memories hold them,
 * counted in the text index at each request, with no word list and no language rule. A memory has
 * word evidence when the prompt terms it holds are too rare to meet by chance: with N memories, the
 * number of memories expected to hold all of them, N x the product of df/N, times the number of
 * ways to pick that many of the prompt's k known terms, C(k, held), is below 1. One shared word is
 * never enough (df x k is at least 1), and a store of one memory gives none.
 *
 * On the bench's 40 and 300 memories this took 2 and 4 of 16 English questions and 7 and 9 of 16
 * Turkish ones to their memory without embeddings (2 of 16 or fewer before), while 2 to 3 of 40
 * unrelated messages got one memory. A rule on the share of the prompt's weight a memory holds
 * gave memories to 12 to 19 of the 40, because a prompt whose known terms are all common words
 * gave a share of 1.
 */

export type WordEvidence = { chance: number; terms: string[] }

const VISIBLE_COUNT = `
  SELECT COUNT(*) AS n FROM memories m
  WHERE m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)`

/** The memories whose text holds a term; tags and audience are not the memory's words. */
const HOLDERS = `
  SELECT m.id AS id FROM memories_fts f CROSS JOIN memories m ON m.rowid = f.rowid
  WHERE memories_fts MATCH ?
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)`

type Term = { term: string; holders: ReadonlySet<string> }

function holdersOf(db: DatabaseSync, term: string, params: ReturnType<typeof visibilityParams>): Set<string> {
  return new Set(selectIds(db, HOLDERS, `search_text : ${term}`, ...params))
}

/**
 * A memory's terms with the pairs of one Chinese, Japanese or Korean word joined: a word of those
 * scripts is split into overlapping pairs, which always come together, so the pairs of one query run
 * the memory holds side by side count as one term, weighed by the memories that hold the whole
 * sequence. Counted apart, the three pairs of `必要です` made one common word look like three rare ones.
 */
function joinPairs(db: DatabaseSync, own: readonly Term[], runs: readonly string[][], id: string, params: ReturnType<typeof visibilityParams>): Term[] {
  const held = new Set(own.map(term => term.term))
  const joined = new Set<string>()
  const phrases: Term[] = []
  const close = (sequence: string[]): void => {
    if (sequence.length < 2) return
    const phrase: Term = { term: `"${sequence.join(' ')}"`, holders: holdersOf(db, `"${sequence.join(' ')}"`, params) }
    if (!phrase.holders.has(id)) return
    phrases.push(phrase)
    for (const pair of sequence) joined.add(`"${pair}"`)
  }
  for (const pairs of runs) {
    let sequence: string[] = []
    for (const pair of pairs) {
      if (held.has(`"${pair}"`)) sequence.push(pair)
      else {
        close(sequence)
        sequence = []
      }
    }
    close(sequence)
  }
  return [...own.filter(term => !joined.has(term.term)), ...phrases]
}

/**
 * The prompt's rarest terms the memories' text holds (`heldTerms`), once each: a prefix term another
 * one starts with stands for both, as `deploy` does for `deploys`.
 */
function knownTerms(db: DatabaseSync, query: string, params: ReturnType<typeof visibilityParams>): Term[] {
  const terms = new Map<string, Term>()
  for (const { term } of heldTerms(db, query, params, 'search_text').terms) terms.set(term, { term, holders: holdersOf(db, term, params) })
  const prefixOf = (term: string): string | undefined => (term.endsWith('*') ? term.slice(1, -2) : undefined)
  return [...terms.values()].filter(({ term }) => {
    const own = term.slice(1).replace(/"\*?$/, '')
    return ![...terms.keys()].some(other => other !== term && prefixOf(other) !== undefined && own.startsWith(prefixOf(other)!))
  })
}

function choose(n: number, k: number): number {
  let ways = 1
  for (let i = 1; i <= k; i++) ways = (ways * (n - k + i)) / i
  return ways
}

/** The memories of one store the prompt's words single out, each with its chance value and the terms it holds. */
export function wordEvidence(db: DatabaseSync, query: string, visibility: Visibility): Map<string, WordEvidence> {
  const params = visibilityParams(visibility)
  const size = Number((sql(db, VISIBLE_COUNT).get(...params) as { n: number }).n)
  const terms = knownTerms(db, query, params)
  const runs = cjkPairs(query.toLowerCase())
  const held = new Map<string, Term[]>()
  for (const term of terms) for (const id of term.holders) held.set(id, [...(held.get(id) ?? []), term])
  const evidence = new Map<string, WordEvidence>()
  for (const [id, pairs] of held) {
    const own = runs.length > 0 ? joinPairs(db, pairs, runs, id, params) : pairs
    const chance = own.reduce((expected, term) => expected * (term.holders.size / size), size) * choose(terms.length, own.length)
    if (chance < 1) evidence.set(id, { chance, terms: own.map(term => term.term.replace(/^"|"\*?$/g, '')) })
  }
  return evidence
}
