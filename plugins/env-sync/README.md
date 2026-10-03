# env-sync

The model adds `process.env.STRIPE_KEY` to the code, commits, and `.env.example` still does not mention it. The next person who clones the repository starts the app and wonders why payments fail. This mod checks each commit: after every `git commit` the model runs, it reads the lines the commit added, and adds the env variables the reference file does not list to the commit's result. The commit itself is never stopped.

## What it does

1. It watches the Bash tool. A command that runs `git commit` is checked, also `git -C <dir> commit` or with git's global flags in front, but not with `--dry-run`, `--help` or `-h`.
2. Before the command runs, it finds the repository root from the session's directory, the last `cd` before the commit and the commit's `git -C`, and records `HEAD`.
3. After a successful command that moved `HEAD`, it reads the first reference file at the root: `.env.example`, else `.env.sample`, else `.env.dist`. A repository without one gets nothing.
4. It reads the added lines with `git show --format= --unified=0 HEAD` and looks for these env reads:

   | Language | Reads |
   |---|---|
   | JavaScript, TypeScript | `process.env.X`, `process.env['X']`, `import.meta.env.X` |
   | Python | `os.getenv('X')`, `os.environ['X']`, `os.environ.get('X')`, `getenv('X')` |
   | Go | `os.Getenv("X")`, `os.LookupEnv("X")` |
   | PHP, Laravel | `env('X')`, `getenv('X')`, `$_ENV['X']`, `$_SERVER['X']` |
   | Rust | `std::env::var("X")`, `env::var("X")`, `env::var_os("X")` |
   | Ruby | `ENV['X']`, `ENV.fetch('X')` |
   | Java, Kotlin | `System.getenv("X")` |

   A name is upper case (`[A-Z][A-Z0-9_]*`). `NODE_ENV`, `HOME`, `PATH`, `USER`, `PWD`, `SHELL`, `TMPDIR`, `TERM`, `LANG` and `CI` are skipped, and so are the request values a web server sets in `$_SERVER` (`HTTP_*`, `REQUEST_*`, `SERVER_*` and the like, plus `HTTPS`, `AUTH_TYPE` and `UNIQUE_ID`, which carry no prefix). Lines of prose files (`.md`, `.txt`, `.rst` and the like) are not read.
5. A variable counts as listed when the reference file has an `X=`, `export X=` or commented `# X=` line. For the rest, the model reads this note right after the commit's result:

       env-sync: this commit reads env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4). Add them to .env.example with a placeholder value, never a real secret.

   Each variable is named once, at its first added line. At most 10 are named, the rest are counted.
6. At the same moment you get one line in the transcript, so you see what the model was told. It holds the variables alone, without the instruction:

       env-sync: env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4)

   The note and the line are separate channels: the model never reads the line, and you never read the note.
7. With the [sidebar](../sidebar) open, the variables go into its stream instead, one line per variable (the name red, where it is read faint), and the transcript stays clean. The entry stays until newer ones push it off the pane. Without the sidebar, the line lands in the transcript as above.
8. A finding is never a remembered answer. Each measure, after every later commit and before a guarded git command, reads both sources again, so a finding closes in two ways:

   - the reference file now lists the variable;
   - the file whose added lines read it no longer reads it, because the code was changed or reverted. A file that is gone reads nothing either.

   A variable that settled leaves the finding at once, and the entry is cleared when nothing is left. A green entry says why:

       env-sync: .env.example now lists the variables it lacked: STRIPE_KEY · REDIS_URL
       env-sync: the code no longer reads: STRIPE_KEY

   With the sidebar closed the same text is one transcript line. The model reads none of this: the finding closed through its own work, so a note would only repeat what it just did. A file that is there but cannot be read keeps its variable open, because an unread file proves nothing.
9. A finding the model did not close is measured again at the end of each main-loop turn, and whatever is left reaches the model as one note with your next prompt:

       env-sync: .env.example still lacks 1 env variable(s) the code reads: STRIPE_KEY (src/pay.ts). Add them to .env.example with a placeholder value, or take the reads out.

   That is one note per turn, not one per prompt. Without it the finding would be said once, at the commit, and then sit in the pane while the model forgot about it. You read nothing new, because the pane already shows the same finding.
10. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while a finding is open. Before it stops one it measures both sources again, so a commit that added the variables, or one that took the reads out, opens the gate by itself. A `git commit` answers for its own files alone: the mod reads the index (`git diff --cached --name-only -z`) and lets the commit run when it holds none of the files that read the missing variables, with one line telling you how many still stand. A `push` and a `merge` have no index to read, so every finding counts there. There is no bypass; only you turn the gate off, with `/env-sync mode note`. `note` mode is the default and stops nothing.

A git error is written as a yellow entry (a transcript line with the sidebar closed), once until a different error comes, and the commit's result stays as it was.

In the live check the model added `process.env.STRIPE_KEY` to a file in a repository whose `.env.example` listed only `DB_URL`, committed it, and quoted the note word for word.

## Command

    /env-sync                 on or off, the mode, and the variables still missing
    /env-sync on | off        on by default
    /env-sync mode note       note only; the default
    /env-sync mode deny       a commit, a push and a merge also stop while a variable is missing

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install env-sync@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=env-sync}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via referenceFile, stillRead), $.fs.read (via commitNote, gate, recheckNow, stillRead), $.process.run (via git, scopeOf), $.session.cwd (via beforeCommit, recheckNow), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via denyFor, toPerson)

Reach L2: it runs processes.

    1. Reads:    the Bash command text; the reference file at the repository root; each file an open finding came from, again, also at the turn's end; through git, the commit's added lines
    2. Runs:     git rev-parse, git show and git diff --cached --name-only -z, read-only, by argv, at most four times per commit, and git rev-parse at the turn's end while a finding stands
    3. Sends:    a note to the model after the commit's result, one more with the next prompt while a finding stands, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the mode
    5. Hostile input: the directory comes from the command text and reaches git only as the working directory, never through a shell; the note names variables, never a value from .env.example

## Limits

- A variable read through a config layer (Laravel `config('x')`, a settings class, `dotenv` schema files) is not seen, and neither is a name built at run time (`process.env[name]`).
- Only the reference file at the repository root is read. A monorepo package with its own `.env.example` is checked against the root file.
- The mod reads the command as text, so a commit through a script or an alias that hides `git commit` is not seen and passes the gate.
- A `cd` or `git -C` whose directory the shell expands first (`cd $D`, `cd ~/x`, a backquote) names no directory the mod can tell. That commit is not checked, and the yellow line names the word, for example `the commit's directory is not known: cd $D`. A single-quoted word stays literal.
- A merge commit's combined diff is not read.
- The `deny` mode has no bypass. When a finding cannot be fixed, you turn the gate off with `/env-sync mode note`.
- A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed to the index, because they commit files the index does not hold yet. Every open finding counts for those.
- A finding is measured against the file the commit read the variable in. A read moved to another file counts as gone there, and the commit that adds it elsewhere reports it again.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
