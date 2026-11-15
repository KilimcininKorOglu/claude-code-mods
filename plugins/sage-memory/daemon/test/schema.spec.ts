import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, test } from 'node:test'
import { migrate, SCHEMA_VERSION } from '../schema.ts'
import { openDatabase } from '../stores.ts'
import { cleanUp, tempDir } from './support.ts'

after(cleanUp)

function insertMemory(db: DatabaseSync, id: string, text: string, tags: string): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO memories (id, data, text, status, kind, scope, persistence, context_policy, importance, confidence, freshness, tags, canonical_text, created_at, updated_at)
     VALUES (?, '{}', ?, 'active', 'fact', 'project', 'durable', 'auto', 0.5, 0.8, 1, ?, ?, ?, ?)`,
  ).run(id, text, tags, text.toLowerCase(), now, now)
}

function matches(db: DatabaseSync, query: string): string[] {
  const rows = db.prepare('SELECT m.id AS id FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? ORDER BY m.id').all(query)
  return rows.map(row => String(row.id))
}

function versionOf(db: DatabaseSync): string | undefined {
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()
  return row === undefined ? undefined : String(row.value)
}

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
      db.prepare("UPDATE memories SET text = 'Run the seeders with pnpm' WHERE id = 'm1'").run()
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
