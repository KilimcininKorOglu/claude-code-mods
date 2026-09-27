import type { DatabaseSync } from 'node:sqlite'

/** The schema this daemon writes. A database at a higher version is refused, never downgraded. */
export const SCHEMA_VERSION = 1

const PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 30000;
  PRAGMA temp_store = MEMORY;
  PRAGMA foreign_keys = ON;
`

/**
 * Version 1. `memories.data` holds the whole record as JSON and is the source of truth; the other
 * columns are copies for filtering and sorting. `memories_fts` follows `text` and `tags` through
 * triggers. `reminders` records which memory a loop of a session was already given in the
 * current context epoch, so a memory goes to a context once.
 */
const SCHEMA_V1 = `
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    kind TEXT NOT NULL,
    scope TEXT NOT NULL,
    persistence TEXT NOT NULL,
    context_policy TEXT NOT NULL,
    importance REAL NOT NULL,
    confidence REAL NOT NULL,
    freshness REAL NOT NULL,
    audience TEXT,
    tags TEXT NOT NULL,
    owner_session_id TEXT,
    canonical_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
  );
  CREATE INDEX memories_status ON memories (status, scope);
  CREATE INDEX memories_canonical ON memories (canonical_text);
  CREATE INDEX memories_rank ON memories (importance DESC, updated_at DESC);

  CREATE VIRTUAL TABLE memories_fts USING fts5 (
    text, tags,
    content = 'memories', content_rowid = 'rowid',
    tokenize = 'porter unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts (rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
  END;
  CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts (memories_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
  END;
  CREATE TRIGGER memories_fts_update AFTER UPDATE OF text, tags ON memories BEGIN
    INSERT INTO memories_fts (memories_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
    INSERT INTO memories_fts (rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
  END;

  CREATE TABLE edges (
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    relation TEXT NOT NULL,
    weight REAL NOT NULL,
    PRIMARY KEY (from_node, to_node, relation)
  );
  CREATE INDEX edges_to ON edges (to_node);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    memory_id TEXT,
    session_id TEXT,
    detail TEXT
  );

  CREATE TABLE candidates (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    status TEXT NOT NULL,
    target_memory_id TEXT,
    canonical_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX candidates_status ON candidates (status);
  CREATE INDEX candidates_target ON candidates (target_memory_id);

  CREATE TABLE vectors (
    memory_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    dims INTEGER NOT NULL,
    vector BLOB NOT NULL,
    text_hash TEXT NOT NULL
  );

  CREATE TABLE contexts (
    session_id TEXT NOT NULL,
    loop_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, loop_id)
  );

  CREATE TABLE reminders (
    session_id TEXT NOT NULL,
    loop_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    memory_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (session_id, loop_id, epoch, memory_id)
  );
`

/** Sets the connection pragmas every store runs with. */
export function applyPragmas(db: DatabaseSync): void {
  db.exec(PRAGMAS)
}

function versionOf(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
  return row ? Number(row.value) : 0
}

/** Brings a database to `SCHEMA_VERSION` in one transaction, or throws when it is newer. */
export function migrate(db: DatabaseSync): void {
  const current = versionOf(db)
  if (current > SCHEMA_VERSION) {
    throw new Error(`the database is at schema ${current}, newer than this daemon's ${SCHEMA_VERSION}`)
  }
  if (current === SCHEMA_VERSION) return
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(SCHEMA_V1)
    db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION))
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
