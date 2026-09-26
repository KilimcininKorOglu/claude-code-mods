import { describe, expect, test, tier } from 'claude-code/testing'

import { denyText, doneLines, isGuarded, lineOf, modeOf, noteText, placesOf, sidebarLines, sqlLines, stillBuilt } from '../hooks/sql.ts'

tier('user')

describe('sql', () => {
  test('finds each language form of SQL joined from strings', () => {
    const flagged = [
      'db.query(`SELECT * FROM users WHERE id = ${id}`)',
      'const q = "SELECT name FROM users WHERE id = " + id',
      'String q = "DELETE FROM orders WHERE id=" + orderId;',
      'cur.execute(f"SELECT * FROM t WHERE name = \'{name}\'")',
      'cur.execute("SELECT * FROM t WHERE id = %s" % uid)',
      'cur.execute("UPDATE t SET a = {}".format(a))',
      '$db->query("SELECT * FROM users WHERE email = \'$email\'");',
      "$db->query('DELETE FROM users WHERE id = ' . $id);",
      'q := fmt.Sprintf("SELECT * FROM users WHERE id = %d", id)',
      'User.find_by_sql("SELECT * FROM users WHERE name = \'#{name}\'")',
      'var q = $"INSERT INTO logs VALUES ({msg})";',
      'prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${id}`)',
      'const q = "select id, name from users where id = " + id',
    ]
    for (const line of flagged) expect([line, sqlLines('', line)]).toEqual([line, [line]])
  })

  test('leaves parameters, safe tags, comments and prose alone', () => {
    const clean = [
      'db.query("SELECT * FROM users WHERE id = ?", [id])',
      'db.query("SELECT * FROM users WHERE id = $1", [id])',
      'await sql`SELECT * FROM users WHERE id = ${id}`',
      'await prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`',
      'db.execute(sql`DELETE FROM t WHERE id = ${id}`)',
      '// const q = "SELECT * FROM t WHERE id = " + id',
      'const msg = "Please select a file from the list: " + name',
      'const label = `where to go: ${place}`',
      'const total = a + " items"',
      // A PHP or Ruby parameter array after the string's closing quote is not part of the SQL.
      '$status = \\Database::fetchRow("SELECT status FROM email_queue WHERE id = ?", [$id])[\'status\'] ?? null;',
      'User.find_by_sql(["SELECT * FROM users WHERE name = ?", name]) # #{note}',
      '$db->query("SELECT * FROM users WHERE note = \\"x\\" AND id = ?", [$id]);',
    ]
    for (const line of clean) expect([line, sqlLines('', line)]).toEqual([line, []])
  })

  test('reads a template literal over several lines, and skips lines the old text had', () => {
    const after = 'const q = `\n  SELECT *\n  FROM users\n  WHERE id = ${id}\n`\nconst r = "DELETE FROM t WHERE id = " + id'
    expect(sqlLines('', after)).toEqual(['const r = "DELETE FROM t WHERE id = " + id', 'WHERE id = ${id}'])
    expect(sqlLines('const r = "DELETE FROM t WHERE id = " + id', after)).toEqual(['WHERE id = ${id}'])
    expect(lineOf(after, 'WHERE id = ${id}')).toBe(4)
    expect(lineOf(after, 'nope')).toBe(undefined)
  })

  test('measures the reported lines in the file as it is now', () => {
    const joined = 'db.query("SELECT * FROM t WHERE id = " + id)'
    const template = 'db.query(`SELECT * FROM t WHERE id = ${id}`)'
    expect(stillBuilt(`${joined}\n${template}\n`, [joined, template])).toEqual([joined, template])
    expect(stillBuilt(`// ${joined}\n  // ${template}\n`, [joined, template])).toEqual([])
    expect(stillBuilt('db.query("SELECT * FROM t WHERE id = ?", [id])\n', [joined])).toEqual([])
    expect(placesOf('a.ts', `x\n${joined}\n`, [joined])).toEqual(['a.ts:2'])
    expect(placesOf('a.ts', undefined, [joined])).toEqual(['a.ts'])
  })

  test('the note names at most eight places', () => {
    expect(noteText(['src/db.ts:14', 'src/db.ts:22'])).toBe(
      'sql-concat-watch: this edit builds SQL from strings: src/db.ts:14 · src/db.ts:22. Pass values as query parameters (?, $1, :name) instead of joining them into the SQL text.',
    )
    expect(noteText(Array.from({ length: 10 }, (_, i) => `a.ts:${i}`))).toContain('a.ts:7 · 2 more.')
  })

  test('the places past eight are one faint count in the sidebar, not one more red place', () => {
    const places = Array.from({ length: 10 }, (_, i) => `a.ts:${i}`)
    expect(sidebarLines(places).slice(-2)).toEqual([{ text: 'a.ts:7', kind: 'error' }, { text: '2 more', kind: 'dim' }])
    expect(doneLines('a.ts', places).slice(-2)).toEqual([{ text: 'a.ts:7', kind: 'ok' }, { text: '2 more', kind: 'dim' }])
    expect(sidebarLines(['a.ts:1'])).toEqual([{ text: 'a.ts:1', kind: 'error' }])
  })

  test('the gate stops a commit, a push and a merge, and says why', () => {
    for (const command of ['git commit -m x', 'git push origin main', 'git merge main']) expect(isGuarded(command), command).toBe(true)
    for (const command of ['git status', 'git push --dry-run', 'git log']) expect(isGuarded(command), command).toBe(false)
    expect(modeOf('deny')).toBe('deny')
    expect(modeOf('x')).toBe(undefined)
    expect(denyText(['src/db.ts:14'])).toBe(
      'stopped: 1 place(s) build SQL from strings: src/db.ts:14. Pass the values as query parameters (?, $1, :name), then run the command again; there is no way around this gate.',
    )
  })
})
