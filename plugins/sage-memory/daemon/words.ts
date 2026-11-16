import type { DatabaseSync } from 'node:sqlite'
import { ftsTerms, MIN_PREFIX } from './fts.ts'
import { selectIds, sql } from './rows.ts'
import { visibilityParams, type Visibility } from './search.ts'

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
  return new Set(selectIds(db, HOLDERS, `text : ${term}`, ...params))
}

/**
 * A prompt term as the store holds it: a prefix term the store does not hold is cut, letter by
 * letter, to its longest prefix of at least three letters that it holds, so `logların` finds `log`
 * and `saklanma` finds `saklanır`; undefined when no prefix is held.
 */
function heldTerm(db: DatabaseSync, term: string, params: ReturnType<typeof visibilityParams>): Term | undefined {
  const holders = holdersOf(db, term, params)
  if (holders.size > 0) return { term, holders }
  if (!term.endsWith('*')) return undefined
  const bare = term.slice(1, -2)
  for (let end = bare.length - 1; end >= MIN_PREFIX; end--) {
    const cut = `"${bare.slice(0, end)}"*`
    const shorter = holdersOf(db, cut, params)
    if (shorter.size > 0) return { term: cut, holders: shorter }
  }
  return undefined
}

/** The prompt's terms the store holds, once each: a prefix term another one starts with stands for both, as `deploy` does for `deploys`. */
function knownTerms(db: DatabaseSync, query: string, params: ReturnType<typeof visibilityParams>): Term[] {
  const terms = new Map<string, Term>()
  for (const raw of ftsTerms(query)) {
    const held = heldTerm(db, raw, params)
    if (held) terms.set(held.term, held)
  }
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
  const held = new Map<string, Term[]>()
  for (const term of terms) for (const id of term.holders) held.set(id, [...(held.get(id) ?? []), term])
  const evidence = new Map<string, WordEvidence>()
  for (const [id, own] of held) {
    const chance = own.reduce((expected, term) => expected * (term.holders.size / size), size) * choose(terms.length, own.length)
    if (chance < 1) evidence.set(id, { chance, terms: own.map(term => term.term.replace(/^"|"\*?$/g, '')) })
  }
  return evidence
}
