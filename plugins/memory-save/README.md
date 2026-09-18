# memory-save

A Claude Code Mod that keeps a per-project `MEMORY.md` up to date without blocking the stop, and loads it into the session. After every main-loop turn it asks a tool-less fork of the session what the project must remember, and writes the answer itself. The main conversation never sees a memory edit: no blocked stop, no Read or Edit of `MEMORY.md`, no extra turn.

## What it does

### Loads the memory

At startup, resume, `/clear` and compaction, the `classic.SessionStart` hook adds one context block:

    [PROJECT MEMORY: <project>]
    <the whole MEMORY.md>

    Topic files in ~/.cli-tweaks/memory/<project>: history.md

The topic line is present only when topic files exist. A project without `MEMORY.md` gets no block. The block holds no instruction to write the file, because the mod writes it. The memory is not repeated between these events, so it does not grow the context turn by turn.

### Saves the memory

After every main-loop turn that ended with an answer or an interruption:

1. It reads `~/.cli-tweaks/memory/<project>/MEMORY.md`, when the file exists.
2. It sends one message to `$.model.fork`. The fork sees the whole session transcript and shares its prompt cache, but it has no tools. The message carries the current file, the writing rules and the reply format.
3. The fork answers with JSON: bullets to add, remove or replace, and text to append to topic files such as `history.md`.
4. The mod applies the answer, checks the result and writes the files.

The save runs in the background. The next prompt is not held while the fork runs. One save runs at a time; a turn that ends during a save asks for one more save after it.

The project name is the primary repository name, also inside a git worktree, else the git top level, else the working directory. It is the same name `~/.claude/hooks/project.py` resolves, so the classic hooks read the same directory.

## What it shows

**A status line under the prompt** after every save:

    memory-save: +2 -1 · 14:32
    memory-save: +3 -1 ~3 topic: history · 14:32
    memory-save: no change · 14:32
    memory-save: error: reply has no JSON object · 14:32

**One line in the transcript** when a save changed a file. The line is not sent to the model:

    memory-save: MEMORY.md: 2 added, 1 removed; appended to history.md

## The file format

`MEMORY.md` has exactly these sections, in this order: `## CRITICAL RULES`, `## Architecture & Config Facts`, `## Active Warnings`, `## Topic Files`. A new file starts from this skeleton.

The template is never broken. At every load (startup, resume, `/clear`, compaction) and before every save, a file without exactly these four sections in this order is put into the template by the mod itself, without the fork: the sections go in order, a repeated section is merged into one, a missing section is added as `- None yet.`, and every other `## ` section moves to the end of `## Architecture & Config Facts` under a `### Unsorted: <heading>` line. No line is dropped. The next save tells the fork to move each unsorted bullet to the section it belongs in, or history to a topic file, and to remove the `### Unsorted:` line once it is empty. The old file is kept as `MEMORY.pre-migration.md` next to it (a later repair replaces that copy), and one line in the transcript says so:

    memory-save: MEMORY.md: put into the four sections (old copy: MEMORY.pre-migration.md)

A save whose result is not in the template is never written.

## What is checked before a write

- The reply is one JSON object of the documented shape. Any other reply is an error, never a guess.
- A removed or replaced line exists in the file exactly.
- A topic file name is lowercase, ends in `.md`, has no directory part and is not `memory.md`.
- The result has the four sections in order, fewer than 200 lines and fewer than 50000 characters.
- No new bullet is longer than 600 characters.
- `MEMORY.md` did not change while the fork ran.

A failed check writes nothing and shows the error on the status line.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install memory-save@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/memory-save

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.277:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, turn.complete
    ❯ ./register.ts calls: $.clock.now (via report), $.env.get (via locate), $.fs.exists (via readFile), $.fs.list (via memoryContext), $.fs.read (via readFile), $.fs.write (via save, templated, writeTopics), $.model.fork (via ask), $.process.run (via git), $.ui.log (via ask, git, save, templated), $.ui.status (via report)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: HOME

Reach L2, writes files, runs git and drives Claude.

    1. Reads:    HOME; MEMORY.md, its topic files and the directory listing under ~/.cli-tweaks/memory/<project>/; the session transcript, through the fork
    2. Runs:     git rev-parse, twice per session, to name the project; one tool-less $.model.fork per main-loop turn
    3. Sends:    MEMORY.md as session context at startup, resume, /clear and compaction; the fork message (the writing rules and the current MEMORY.md) to the session's own API client, on top of the session's transcript
    4. Persists: MEMORY.md, MEMORY.pre-migration.md and topic files under ~/.cli-tweaks/memory/<project>/
    5. Hostile input: the fork's reply is untrusted text; only the documented JSON shape is applied, topic file names are checked, and the result must pass every check before a write

## Limits

- The fork has no tools. It knows only the transcript and the current file.
- A mod loaded in the middle of a session (`/reload-plugins`, an enable) loads the memory at the next `/clear`, compaction or session.
- The test engine of `claude plugin test` cannot raise `classic.SessionStart`. The load is covered by unit tests of its text and by a live session check.
- Every main-loop turn costs one fork: the transcript as cache reads, the current file and the rules as input, and the answer as output.
- A save that fails is not retried. The next turn saves again.
- A fork can come back empty on a cold cache snapshot or an API error. The status line then shows the error.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
