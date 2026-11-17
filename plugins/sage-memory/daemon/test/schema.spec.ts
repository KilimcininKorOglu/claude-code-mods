import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, test } from 'node:test'
import { migrate, SCHEMA_V1, SCHEMA_VERSION } from '../schema.ts'
import { searchableText, splitCjk } from '../searchable.ts'
import { openDatabase } from '../stores.ts'
import { cleanUp, tempDir } from './support.ts'

after(cleanUp)

const INSERT_V1 = `INSERT INTO memories (id, data, text, status, kind, scope, persistence, context_policy, importance, confidence, freshness, tags, canonical_text, created_at, updated_at)
  VALUES (?, '{}', ?, 'active', 'fact', 'project', 'durable', 'auto', 0.5, 0.8, 1, ?, ?, ?, ?)`
const INSERT_V2 = `INSERT INTO memories (id, data, text, status, kind, scope, persistence, context_policy, importance, confidence, freshness, tags, canonical_text, created_at, updated_at, search_text)
  VALUES (?, '{}', ?, 'active', 'fact', 'project', 'durable', 'auto', 0.5, 0.8, 1, ?, ?, ?, ?, ?)`

/** A row as the write path leaves it; `searchable` false leaves out the column a schema 1 table lacks. */
function insertMemory(db: DatabaseSync, id: string, text: string, tags: string, searchable = true): void {
  const now = new Date().toISOString()
  if (searchable) db.prepare(INSERT_V2).run(id, text, tags, text.toLowerCase(), now, now, searchableText(text))
  else db.prepare(INSERT_V1).run(id, text, tags, text.toLowerCase(), now, now)
}

/** A database at schema 1, as a release before the search text column left it. */
function versionOne(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec(SCHEMA_V1)
  db.exec("CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO schema_meta VALUES ('schema_version', '1')")
  return db
}

function matches(db: DatabaseSync, query: string): string[] {
  const rows = db.prepare('SELECT m.id AS id FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? ORDER BY m.id').all(query)
  return rows.map(row => String(row.id))
}

function versionOf(db: DatabaseSync): string | undefined {
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()
  return row === undefined ? undefined : String(row.value)
}

/** A memory row with its creation time in both the column and the record. */
function insertDated(db: DatabaseSync, id: string, createdAt: string): void {
  db.prepare(INSERT_V2).run(id, id, '[]', id, createdAt, createdAt, id)
  db.prepare("UPDATE memories SET data = json_object('createdAt', ?) WHERE id = ?").run(createdAt, id)
}

function createdOf(db: DatabaseSync, id: string): [string, string] {
  const row = db.prepare("SELECT created_at AS col, json_extract(data, '$.createdAt') AS rec FROM memories WHERE id = ?").get(id) as { col: string; rec: string }
  return [row.col, row.rec]
}

describe('split parts dated back', () => {
  test('a part takes the creation time of the memory it replaced, through a second split, and other memories keep theirs', () => {
    const db = openDatabase(join(tempDir(), 'split.db'))
    try {
      const first = '2026-09-28T16:05:02.982Z'
      const split = '2026-11-17T04:20:00.000Z'
      insertDated(db, 'old', first)
      insertDated(db, 'p1', split)
      insertDated(db, 'p2', split)
      insertDated(db, 'q1', '2026-11-18T09:00:00.000Z')
      insertDated(db, 'alone', split)
      const log = db.prepare("INSERT INTO audit_log (at, action, memory_id, detail) VALUES (?, 'memory.replaced', ?, ?)")
      log.run(split, 'old', JSON.stringify({ parts: ['p1', 'p2'] }))
      log.run('2026-11-18T09:00:00.000Z', 'p2', JSON.stringify({ parts: ['q1'] }))
      migrate(db)
      for (const id of ['p1', 'p2', 'q1']) assert.deepEqual(createdOf(db, id), [first, first])
      assert.deepEqual(createdOf(db, 'alone'), [split, split])
      migrate(db)
      assert.deepEqual(createdOf(db, 'q1'), [first, first])
    } finally {
      db.close()
    }
  })
})

describe('schema', () => {
  test('a new database gets the pragmas and the current schema', () => {
    const db = openDatabase(join(tempDir(), 'a.db'))
    try {
      assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal')
      assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1)
      assert.equal(db.prepare('PRAGMA busy_timeout').get()?.timeout, 30000)
      assert.equal(versionOf(db), String(SCHEMA_VERSION))
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => String(row.name))
      for (const name of ['audit_log', 'candidates', 'contexts', 'edges', 'memories', 'memories_fts', 'reminders', 'sentence_vectors', 'vectors']) {
        assert.ok(tables.includes(name), `${name} exists`)
      }
    } finally {
      db.close()
    }
  })

  test('the full-text index follows inserts, text edits, tag edits and deletes', () => {
    const db = openDatabase(join(tempDir(), 'b.db'))
    try {
      insertMemory(db, 'm1', 'Run the migrations with pnpm', 'build')
      insertMemory(db, 'm2', 'Deploys go through the staging branch', 'deploy')
      assert.deepEqual(matches(db, 'migrations'), ['m1'])
      assert.deepEqual(matches(db, 'running'), ['m1'], 'porter stems running to run')
      db.prepare("UPDATE memories SET text = 'Run the seeders with pnpm', search_text = 'Run the seeders with pnpm' WHERE id = 'm1'").run()
      assert.deepEqual(matches(db, 'migrations'), [])
      assert.deepEqual(matches(db, 'seeders'), ['m1'])
      db.prepare("UPDATE memories SET tags = 'release' WHERE id = 'm2'").run()
      assert.deepEqual(matches(db, 'deploy'), ['m2'], 'the text still names deploys')
      assert.deepEqual(matches(db, 'release'), ['m2'])
      db.prepare("DELETE FROM memories WHERE id = 'm2'").run()
      assert.deepEqual(matches(db, 'staging'), [])
    } finally {
      db.close()
    }
  })

  test('a second migration of a current database changes nothing', () => {
    const db = openDatabase(join(tempDir(), 'c.db'))
    try {
      insertMemory(db, 'm1', 'Keep the lockfile in the commit', 'git')
      migrate(db)
      assert.equal(versionOf(db), String(SCHEMA_VERSION))
      assert.deepEqual(matches(db, 'lockfile'), ['m1'])
    } finally {
      db.close()
    }
  })

  test('opening a store turns a memory and a candidate of a retired kind into a fact and leaves the rest', () => {
    const file = join(tempDir(), 'r.db')
    const db = openDatabase(file)
    const now = new Date().toISOString()
    const rows: [string, string][] = [['m1', 'summary'], ['m2', 'task_outcome'], ['m3', 'session_digest'], ['m4', 'decision']]
    for (const [id, kind] of rows) {
      db.prepare(
        `INSERT INTO memories (id, data, text, status, kind, scope, persistence, context_policy, importance, confidence, freshness, tags, canonical_text, created_at, updated_at)
         VALUES (?, ?, 'text', 'active', ?, 'project', 'long_lived', 'auto', 0.5, 0.8, 1, '', 'text', ?, ?)`,
      ).run(id, JSON.stringify({ id, kind }), kind, now, now)
    }
    db.prepare("INSERT INTO candidates (id, data, status, canonical_text, created_at, updated_at) VALUES ('c1', ?, 'pending', 'text', ?, ?)").run(JSON.stringify({ kind: 'summary' }), now, now)
    db.close()
    const again = openDatabase(file)
    try {
      const rows = again.prepare("SELECT id, kind, json_extract(data, '$.kind') AS stored FROM memories ORDER BY id").all()
      assert.deepEqual(rows.map(row => `${String(row.id)}:${String(row.kind)}:${String(row.stored)}`), ['m1:fact:fact', 'm2:fact:fact', 'm3:fact:fact', 'm4:decision:decision'])
      assert.equal(again.prepare("SELECT json_extract(data, '$.kind') AS kind FROM candidates").get()?.kind, 'fact')
      assert.equal(versionOf(again), String(SCHEMA_VERSION), 'the schema version stays, so an older daemon still opens it')
    } finally {
      again.close()
    }
  })

  test('a database of a newer schema is refused, not downgraded', () => {
    const file = join(tempDir(), 'd.db')
    const db = openDatabase(file)
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION + 1))
    db.close()
    assert.throws(() => openDatabase(file), new RegExp(`schema ${SCHEMA_VERSION + 1}, newer than this daemon's ${SCHEMA_VERSION}`))
  })

  test('a schema 1 store moves to schema 2: Japanese words, camelCase words and the rest are found', () => {
    const file = join(tempDir(), 'v1.db')
    const old = versionOne(file)
    insertMemory(old, 'm1', 'アプリケーションのログは90日間保存した後、削除します。', '', false)
    insertMemory(old, 'm2', 'Call retryLimit before each send', '', false)
    insertMemory(old, 'm3', 'Run the migrations with pnpm', 'build', false)
    old.close()
    const db = openDatabase(file)
    try {
      assert.equal(versionOf(db), '2')
      assert.deepEqual(matches(db, splitCjk('ログ')), ['m1'])
      assert.deepEqual(matches(db, splitCjk('保存')), ['m1'])
      assert.deepEqual(matches(db, 'retry AND limit'), ['m2'])
      assert.deepEqual(matches(db, 'migrations'), ['m3'])
      insertMemory(db, 'm4', 'ディスク使用率のアラート', '')
      assert.deepEqual(matches(db, splitCjk('アラート')), ['m4'], 'a write after the move is indexed the same way')
    } finally {
      db.close()
    }
  })

  test('an update of the record alone, as the usage counters write it, leaves the text index untouched', () => {
    const db = openDatabase(join(tempDir(), 'counters.db'))
    try {
      insertMemory(db, 'm1', 'Run the migrations with pnpm', 'build')
      const changes = (): number => Number(db.prepare('SELECT total_changes() AS n').get()?.n)
      const before = changes()
      db.prepare("UPDATE memories SET data = json_set(data, '$.reminderCount', 1) WHERE id = 'm1'").run()
      assert.equal(changes() - before, 1, 'one row of memories, no delete and insert in the index')
      assert.deepEqual(matches(db, 'migrations'), ['m1'])
      const edit = changes()
      db.prepare("UPDATE memories SET text = 'Run the seeders', search_text = 'Run the seeders' WHERE id = 'm1'").run()
      assert.ok(changes() - edit > 1, 'a text edit rewrites the index rows too')
      assert.deepEqual(matches(db, 'seeders'), ['m1'])
    } finally {
      db.close()
    }
  })

  test('a move to schema 2 that fails leaves schema 1 and its index', () => {
    const file = join(tempDir(), 'v1-broken.db')
    const old = versionOne(file)
    insertMemory(old, 'm1', 'Run the migrations with pnpm', 'build', false)
    old.exec('DROP TRIGGER memories_fts_update')
    assert.throws(() => migrate(old), /no such trigger: memories_fts_update/)
    try {
      assert.equal(versionOf(old), '1')
      assert.deepEqual(matches(old, 'migrations'), ['m1'])
      assert.equal(old.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('memories') WHERE name = 'search_text'").get()?.n, 0)
    } finally {
      old.close()
    }
  })

  test('a migration that fails leaves the database as it was', () => {
    const db = new DatabaseSync(join(tempDir(), 'e.db'))
    try {
      db.exec('CREATE TABLE memories (x TEXT)')
      assert.throws(() => migrate(db), /memories already exists/)
      assert.equal(versionOf(db), undefined)
      const edges = db.prepare("SELECT name FROM sqlite_master WHERE name = 'edges'").get()
      assert.equal(edges, undefined)
    } finally {
      db.close()
    }
  })
})
