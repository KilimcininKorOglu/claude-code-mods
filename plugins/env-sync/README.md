# env-sync

A Claude Code Mod that tells the model when a commit reads env variables that `.env.example` lacks. After each `git commit` the model runs, the mod reads the lines the commit added, and adds the variables the reference file does not list to the commit's result. The commit is never stopped.

## What it does

1. The mod hooks the Bash tool. A command that runs `git commit` (also `git -C <dir> commit`, not `--dry-run` or `--help`) is checked.
2. Before the command runs, it finds the repository root from the session's directory, the last `cd` before the commit and the commit's `git -C`, and records `HEAD`.
3. After a successful command that moved `HEAD`, it reads the first reference file at the root: `.env.example`, else `.env.sample`, else `.env.dist`. A repository without one gets nothing.
4. It reads the added lines with `git show --format= --unified=0 HEAD` and finds these env reads:

   | Language | Reads |
   |---|---|
   | JavaScript, TypeScript | `process.env.X`, `process.env['X']`, `import.meta.env.X` |
   | Python | `os.getenv('X')`, `os.environ['X']`, `os.environ.get('X')`, `getenv('X')` |
   | Go | `os.Getenv("X")`, `os.LookupEnv("X")` |
   | PHP, Laravel | `env('X')`, `getenv('X')`, `$_ENV['X']`, `$_SERVER['X']` |
   | Rust | `std::env::var("X")`, `env::var("X")`, `env::var_os("X")` |
   | Ruby | `ENV['X']`, `ENV.fetch('X')` |
   | Java, Kotlin | `System.getenv("X")` |

   A name is upper case (`[A-Z][A-Z0-9_]*`). `NODE_ENV`, `HOME`, `PATH`, `USER`, `PWD`, `SHELL`, `TMPDIR`, `TERM`, `LANG` and `CI` are skipped, and so are the request values of `$_SERVER` (`HTTP_*`, `REQUEST_*`, `SERVER_*` and the like). Lines of prose files (`.md`, `.txt`, `.rst` and the like) are not read.
5. A variable counts as listed when the reference file has `X=`, `export X=` or a commented `# X=` line. The model reads this note after the commit's result:

       env-sync: this commit reads env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4). Add them to .env.example with a placeholder value, never a real secret.

   Each variable is named once, at its first added line. At most 10 are named, the rest counted.
5. The same moment writes one line to the transcript, so you see what the model was told. The line holds the variables alone, without the instruction:

       env-sync: env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4)

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. While the [sidebar](../sidebar) is open, those variables go there instead, one line per variable, as an entry in its stream, and the transcript stays clean. The entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript line is written as above.

7. A finding is never a remembered answer. Each measure, after every later commit and before a guarded git command, reads both sources again, so it closes two ways:

   - the reference file lists the variable;
   - the file whose added lines read it does not read it any more, because the code was changed or reverted. A file that is gone reads nothing either.

   A variable that settled leaves the finding at once, and the entry is cleared when nothing is left:

       env-sync: .env.example now lists the variables it lacked: STRIPE_KEY · REDIS_URL
       env-sync: the code no longer reads: STRIPE_KEY

   With the sidebar closed the same text is one transcript line. The model reads nothing of this: the finding closed by its own work, so a note would only repeat what it just did. A file that is there and cannot be read keeps its variable open, because an unread file proves nothing.

8. A finding the model did not close is measured again at the end of each main-loop turn, and what is left reaches the model as one note with its next prompt:

       env-sync: .env.example still lacks 1 env variable(s) the code reads: STRIPE_KEY (src/pay.ts). Add them to .env.example with a placeholder value, or take the reads out.

   One note per turn, not one per prompt. Without this the finding would be said once, at the commit, and then stand in the pane while the model forgot it. You read nothing new: the pane already carries the same finding.

9. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while a finding is open. Before it stops one it measures both sources again, so a commit that added the variables, and one that took the reads out, each open the gate themselves. A `git commit` answers for its own files alone: the mod reads the index (`git diff --cached --name-only`) and lets the commit run when it holds none of the files that read the missing variables, with one line to you naming how many still stand. A `push` and a `merge` hold no index to read, so every finding stands there. There is no bypass; only the person turns the gate off with `/env-sync mode note`. `note` mode is the default and stops nothing.

A git error is logged once, and the commit's result stays as it was.

In the live check the model added `process.env.STRIPE_KEY` to a file of a repository whose `.env.example` listed only `DB_URL`, committed it, and quoted the note word for word.

## Command

    /env-sync                 on or off, the mode, and the variables still missing
    /env-sync on | off        on by default
    /env-sync mode note       note only; the default
    /env-sync mode deny       a commit, a push and a merge also stop while a variable is missing

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install env-sync@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=env-sync}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via referenceFile, stillRead), $.fs.read (via commitNote, gate, recheckNow, stillRead), $.process.run (via git, scopeOf), $.session.cwd (via beforeCommit, recheckNow), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via denyFor, toPerson)

Reach L2, runs processes.

    1. Reads:    the Bash command text; the reference file at the repository root; each file an open finding came from, again, also at the turn's end; through git, the commit's added lines
    2. Runs:     git rev-parse, git show and git diff --cached --name-only, read-only, by argv, at most four times per commit, and git rev-parse at the turn's end while a finding stands
    3. Sends:    a note to the model after the commit's result, one more with the next prompt while a finding stands, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the mode
    5. Hostile input: the directory comes from the command text and reaches git only as the working directory, never through a shell; the note names variables, never a value from .env.example

## Limits

- A variable read through a config layer (Laravel `config('x')`, a settings class, `dotenv` schema files) is not seen, and neither is a name built at run time (`process.env[name]`).
- Only the reference file at the repository root is read. A monorepo package with its own `.env.example` is checked against the root file.
- A commit through a script or an alias that hides `git commit` is not seen. `cd ~/x` is not expanded.
- A merge commit's combined diff is not read.
- The `deny` mode has no bypass. When a finding cannot be fixed, the person turns the gate off with `/env-sync mode note`.
- The gate reads the command as text, so a commit through a script or an alias passes it.
- A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed to the index, because they commit files the index does not hold yet. Every open finding stands for those.
- A finding is measured against the file the commit read the variable in. A read moved to another file counts as gone there, and the commit that adds it elsewhere reports it again.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
