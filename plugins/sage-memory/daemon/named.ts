import type { DatabaseSync } from 'node:sqlite'
import type { Memory } from '../hooks/shared/model.ts'
import { namesOf, tokensOf } from './names.ts'
import { selectMemories } from './rows.ts'
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

/**
 * Memories with a file or directory anchor whose path is the name or ends in `/` and the name, or a
 * symbol anchor whose symbol is the name.
 */
const BY_ANCHOR = `
  SELECT DISTINCT m.id AS id, m.data AS data FROM memories m, json_each(m.data, '$.anchors') a
  WHERE ((json_extract(a.value, '$.type') IN ('file', 'directory')
      AND (lower(json_extract(a.value, '$.path')) = ? OR substr(lower(json_extract(a.value, '$.path')), -length(?) - 1) = '/' || ?))
    OR (json_extract(a.value, '$.type') = 'symbol' AND lower(json_extract(a.value, '$.symbol')) = ?))
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)`

/** The memories that hold a name: in their text as a whole token, or in an anchor (a file or directory name, a symbol). */
function holdersOf(db: DatabaseSync, name: string, visibility: Visibility): Memory[] {
  const params = visibilityParams(visibility)
  const holders = new Map<string, Memory>()
  for (const memory of selectMemories(db, BY_TEXT, `"${name}"`, ...params)) if (tokensOf(memory.text).includes(name)) holders.set(memory.id, memory)
  for (const memory of selectMemories(db, BY_ANCHOR, name, name, name, name, ...params)) holders.set(memory.id, memory)
  return [...holders.values()].filter(memory => memory.kind !== 'memory_review')
}

/**
 * The memories of one store a prompt names, each with the name and how many memories hold it; a
 * memory two names point at keeps the name fewer memories hold.
 */
export function namedMemories(db: DatabaseSync, prompt: string, visibility: Visibility, blockCount: number): Named[] {
  const found = new Map<string, Named>()
  for (const name of namesOf(prompt)) {
    const holders = holdersOf(db, name, visibility)
    if (holders.length === 0 || holders.length > blockCount) continue
    for (const memory of holders) {
      const known = found.get(memory.id)
      if (known === undefined || holders.length < known.holders) found.set(memory.id, { memory, name, holders: holders.length })
    }
  }
  return [...found.values()]
}
