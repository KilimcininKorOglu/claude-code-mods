# sql-concat-watch

A Claude Code Mod that tells the model when an edit builds SQL by joining strings instead of passing query parameters. The note comes with the Edit's result and names each line, so the model rewrites the query in the same turn. Nothing is stopped.

## What it does

1. The mod hooks the Edit and Write tools. After a successful call on a source file (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.php`, `.go`, `.rb`, `.java`, `.kt`, `.cs`, `.rs`), it reads the lines the edit added: those of `new_string` that `old_string` does not have, or every line of a Write.
2. A line counts when it holds SQL and joins a value into it:

   | SQL | Joins |
   |---|---|
   | `SELECT … FROM`, `INSERT INTO`, `UPDATE … SET`, `DELETE FROM`, `WHERE`, `VALUES`, `ORDER BY`, `GROUP BY`, `JOIN` in upper case | `"…" + x` and `x + "…"` (JS, Java, Go, C#, Kotlin) |
   | `select *` or `select a, b from`, `insert into t (`, `delete from t where`, `update t set a =` in any case | Python f-strings, `%` and `.format(` |
   | | PHP `"… $var"` and `"…" . $var`, Kotlin `"… $var"` |
   | | C# `$"… {x}"`, Ruby `"… #{x}"` |
   | | `fmt.Sprintf(`, `String.format(`, `format!(` |
   | | a template literal with `${…}`, also over several lines |

   A template literal whose tag passes the values as parameters is left alone: `` sql`…` ``, `` Prisma.sql`…` ``, `` prisma.$queryRaw`…` ``, `` $executeRaw`…` ``. `$queryRawUnsafe` is not such a tag. Comment lines and English prose (`"select a file from the list: " + name`) do not count.
3. The model reads this note after the Edit's result:

       sql-concat-watch: this edit builds SQL from strings: src/db.ts:14 · src/db.ts:22. Pass values as query parameters (?, $1, :name) instead of joining them into the SQL text.

   The line number comes from the file after the edit; a Write is numbered from its own content. At most 8 places are named, the rest counted. When the file cannot be read, the path stands without a line and the error is logged once.
4. The same moment writes one line to the transcript, so you see what the model was told. The line holds the places alone, without the instruction:

       sql-concat-watch: SQL built from strings: src/db.ts:14 · src/db.ts:22

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. While the [sidebar](../sidebar) is open, those places go there instead, one line each, as an entry in its stream, and the transcript stays clean. The entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript line is written as above.

In the live check the model put `` db.query(`SELECT * FROM users WHERE id = ${id}`) `` into a file with one Edit, read the note naming `src/users.ts:3`, and named the parameterized form in its answer.

## Command

    /sql-concat-watch            on or off
    /sql-concat-watch on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sql-concat-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=sql-concat-watch}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.read (via fileText), $.session.cwd (via afterEdit), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via fileText, toPerson)

Reach L1, reads files.

    1. Reads:    the text of each Edit and Write call; the edited file after an Edit that joins SQL, for the line numbers
    2. Runs:     nothing
    3. Sends:    a note to the model after an edit that joins SQL, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting
    5. Hostile input: the edited text is only matched by regular expressions and printed as file:line, never run

## Limits

- The check is line by line with regular expressions, not a parser. A query built in a variable over several statements (`q = "SELECT …"; q += id`) is not seen.
- A value joined into a table or column name, where a parameter cannot stand, is reported too. The note asks for a reason there, it stops nothing.
- A query builder call (`knex.raw`, `DB::raw`, `whereRaw`) with a joined string is seen only when the string itself holds SQL keywords.
- An edit through Bash is not checked.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
