# sql-concat-watch

A Claude Code Mod that tells the model when an edit builds SQL by joining strings instead of passing query parameters. The note comes with the Edit's result and names each line, so the model rewrites the query in the same turn. By default nothing is stopped; in `deny` mode a commit, a push and a merge stop while a file still joins SQL.

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

   The line number comes from the file after the edit; a Write is numbered from its own content. At most 8 places are named, the rest counted. When the file cannot be read, the path stands without a line and the error is logged once. The path is written against the directory the session started in when the file is inside it. That directory is read once at the session's start, because a Bash `cd` moves the session's own directory.
4. The same moment writes one line to the transcript, so you see what the model was told. The line holds the places alone, without the instruction:

       sql-concat-watch: SQL built from strings: src/db.ts:14 · src/db.ts:22

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. While the [sidebar](../sidebar) is open, those places go there instead, one line each, as an entry in its stream, and the transcript stays clean. The entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript line is written as above.

7. A finding stays open until the file no longer holds those lines. After a later Edit or Write the mod reads each open file again, and a file whose lines are all gone closes:

       sql-concat-watch: the SQL built from strings is gone from src/db.ts: src/db.ts:14 · src/db.ts:22

   With the sidebar closed the same text is one transcript line. The model reads nothing of this: it rewrote the query itself.

8. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while a file still builds SQL from strings. Before it stops one it reads each open file again, so a file the model fixed opens the gate itself. There is no bypass; only the person turns the gate off with `/sql-concat-watch mode note`. `note` mode is the default and stops nothing.

In the live check the model put `` db.query(`SELECT * FROM users WHERE id = ${id}`) `` into a file with one Edit, read the note naming `src/users.ts:3`, and named the parameterized form in its answer.

## Command

    /sql-concat-watch                 on or off, the mode, and the files still joining SQL
    /sql-concat-watch on | off        on by default
    /sql-concat-watch mode note       note only; the default
    /sql-concat-watch mode deny       a commit, a push and a merge also stop while a file joins SQL

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sql-concat-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=sql-concat-watch}, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.read (via fileText), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via fileText, toPerson)

Reach L1, reads files.

    1. Reads:    the text of each Edit and Write call; the Bash command text; the edited file after an Edit that joins SQL, for the line numbers, and each open file again while a finding stands
    2. Runs:     nothing
    3. Sends:    a note to the model after an edit that joins SQL, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the mode
    5. Hostile input: the edited text is only matched by regular expressions and printed as file:line, never run

## Limits

- The check is line by line with regular expressions, not a parser. A query built in a variable over several statements (`q = "SELECT …"; q += id`) is not seen.
- A value joined into a table or column name, where a parameter cannot stand, is reported too. The note asks for a reason there, it stops nothing.
- A query builder call (`knex.raw`, `DB::raw`, `whereRaw`) with a joined string is seen only when the string itself holds SQL keywords.
- An edit through Bash is not checked.
- A finding closes when the reported lines are gone from the file. A line moved to another file keeps it open.
- The `deny` mode has no bypass. When a finding cannot be fixed, the person turns the gate off with `/sql-concat-watch mode note`.
- The gate reads the command text. A commit through a script or an alias that hides `git commit` is not stopped.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
