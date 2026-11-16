import type { DatabaseSync } from 'node:sqlite'
import type { Memory } from '../hooks/shared/model.ts'
import { namesOf, tokensOf } from './names.ts'
import { selectMemories, sql } from './rows.ts'
import { visibilityParams, type Visibility } from './search.ts'

/**
 * Memories a prompt names: a name in the prompt that a memory's text holds as a whole token, the
 * name of one of its file or directory anchors, or the symbol of a symbol anchor. A name singles memories out only when no more memories
 * hold it than the reminder can carry; a name most of the store holds (a project's own name, a file
 * name every module has) names none of them, and their meaning decides instead. The count is taken
 * from the store at each request, so it follows the store as it grows.
 */

export type Named = { memory: Memory; name: string; holders: number }

/** Memories whose text the text index finds for the name's tokens in order; the whole-token check follows. */
const BY_TEXT = `
  SELECT m.id AS id, m.data AS data FROM memories_fts f CROSS JOIN memories m ON m.rowid = f.rowid
  WHERE memories_fts MATCH ?
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)`

/** Every anchor of the visible memories, read once per request. */
const ANCHORS = `
  SELECT m.id AS id, json_extract(a.value, '$.type') AS type, lower(json_extract(a.value, '$.path')) AS path, lower(json_extract(a.value, '$.symbol')) AS symbol
  FROM memories m, json_each(m.data, '$.anchors') a
  WHERE m.kind != 'memory_review'
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)`

const BY_IDS = 'SELECT id, data FROM memories WHERE id IN (SELECT value FROM json_each(?))'

type AnchorRow = { id: string; type: string; path: string | null; symbol: string | null }

/**
 * The ids of the memories each anchor name points at: a file or directory path under itself and under
 * every tail after a `/` (`src/a.ts` under `src/a.ts` and `a.ts`), a symbol under itself. One scan per
 * request: a scan per name took 55 s for the 15,000 names of a 5,000-line paste on 3,000 memories.
 */
function anchorIndex(db: DatabaseSync, visibility: Visibility): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const add = (key: string, id: string): void => {
    index.set(key, (index.get(key) ?? new Set()).add(id))
  }
  for (const row of sql(db, ANCHORS).all(...visibilityParams(visibility)) as AnchorRow[]) {
    if ((row.type === 'file' || row.type === 'directory') && row.path) {
      add(row.path, row.id)
      for (let at = row.path.indexOf('/'); at !== -1; at = row.path.indexOf('/', at + 1)) add(row.path.slice(at + 1), row.id)
    }
    if (row.type === 'symbol' && row.symbol) add(row.symbol, row.id)
  }
  return index
}

/** The memories that hold a name: in their text as a whole token, or in an anchor (a file or directory name, a symbol). */
function holdersOf(db: DatabaseSync, name: string, visibility: Visibility, anchors: ReadonlyMap<string, ReadonlySet<string>>): Memory[] {
  const holders = new Map<string, Memory>()
  for (const memory of selectMemories(db, BY_TEXT, `"${name}"`, ...visibilityParams(visibility))) if (tokensOf(memory.text).includes(name)) holders.set(memory.id, memory)
  const anchored = [...(anchors.get(name) ?? [])].filter(id => !holders.has(id))
  if (anchored.length > 0) for (const memory of selectMemories(db, BY_IDS, JSON.stringify(anchored))) holders.set(memory.id, memory)
  return [...holders.values()].filter(memory => memory.kind !== 'memory_review')
}

/**
 * The memories of one store a prompt names, each with the name and how many memories hold it; a
 * memory two names point at keeps the name fewer memories hold.
 */
export function namedMemories(db: DatabaseSync, prompt: string, visibility: Visibility, blockCount: number): Named[] {
  const found = new Map<string, Named>()
  const anchors = anchorIndex(db, visibility)
  for (const name of namesOf(prompt)) {
    const holders = holdersOf(db, name, visibility, anchors)
    if (holders.length === 0 || holders.length > blockCount) continue
    for (const memory of holders) {
      const known = found.get(memory.id)
      if (known === undefined || holders.length < known.holders) found.set(memory.id, { memory, name, holders: holders.length })
    }
  }
  return [...found.values()]
}
