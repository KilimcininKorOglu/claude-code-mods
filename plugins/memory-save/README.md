# memory-save

A Claude Code Mod that keeps a per-project `MEMORY.md` up to date without blocking the stop, and loads it into the session. After every main-loop turn it asks a tool-less fork of the session what the project must remember, and writes the answer itself. The main conversation never sees a memory edit: no blocked stop, no Read or Edit of `MEMORY.md`, no extra turn.

## What it does

### Loads the memory

At startup, resume, `/clear` and compaction, the `classic.SessionStart` hook adds one context block:

    [PROJECT MEMORY: <project>]
    Answer in the language of the user's own messages, in every reply and every progress line, also at the end of a long turn whose context (tool output, docs, this memory) is in another language. Keep technical terms and identifiers as they are.

    <the whole MEMORY.md>

    Topic files in ~/.cli-tweaks/memory/<project>: history.md

The language line is there because long turns whose context was mostly English ended with English replies to prompts in another language (measured). The topic line is present only when topic files exist. A project without `MEMORY.md` gets no block. The block holds no instruction to write the file, because the mod writes it. The memory is not repeated between these events, so it does not grow the context turn by turn.

### Saves the memory

After every main-loop turn that ended with an answer or an interruption:

1. It reads `~/.cli-tweaks/memory/<project>/MEMORY.md`, when the file exists.
2. It sends one message to `$.model.fork`. The fork sees the whole session transcript and shares its prompt cache, but it has no tools. The message carries the current file, the writing rules and the reply format. The writing rules, the template and the MIGRATION, OFFLOAD and BULLET SPLIT notes are the texts of the classic memory-save Stop hook, word for word; only the parts about stopping are left out, because the fork does not stop.
3. The fork answers with JSON: bullets to add, remove or replace, and text to append to topic files such as `history.md`.
4. The mod applies the answer, checks the result and writes the files.

The save runs in the background. The next prompt is not held while the fork runs. One save runs at a time; a turn that ends during a save asks for one more save after it.

The project name is the primary repository name, also inside a git worktree, else the git top level, else the working directory.

## What it shows

**A status line under the prompt** while a save runs, and after it:

    memory-save: saving… · 14:31
    memory-save: +2 -1 · 14:32
    memory-save: +3 -1 ~3 topic: history · 14:32
    memory-save: no change · 14:32
    memory-save: +2 1 refused · 14:32
    memory-save: error: reply has no JSON object · 14:32

While the [sidebar](../sidebar) is open, that state goes there instead, as a `MEMORY.md` section that stays for the session and is rewritten at each save, and the status line stays clear. There the line is coloured: a written save green, a save that skipped or refused a part yellow, an error red, and `saving…` or `no change` faint. With the sidebar closed, or without that mod installed, the status line is drawn as above, in the engine's own colour.

The section holds a second, faint line under the state: the last transcript line, without the `MEMORY.md:` front. The state says where the save stands, the second line says what it did:

    MEMORY.md
    topic: history · 14:32
    topic files only; appended to history.md

**One line in the transcript** when a save changed a file. The line is not sent to the model:

    memory-save: MEMORY.md: 2 added, 1 removed; appended to history.md

## The file format

`MEMORY.md` has exactly these sections, in this order: `## CRITICAL RULES`, `## Architecture & Config Facts`, `## Active Warnings`, `## Topic Files`. A new file starts from this skeleton.

The template is never broken. At every load (startup, resume, `/clear`, compaction) and before every save, a file without exactly these four sections in this order is put into the template by the mod itself, without the fork: the sections go in order, a repeated section is merged into one, a missing section is added as `- None yet.`, and every other `## ` section moves to the end of `## Architecture & Config Facts` under a `### Unsorted: <heading>` line. No line is dropped. The next save tells the fork to move each unsorted bullet to the section it belongs in, or history to a topic file, and to remove the `### Unsorted:` line once it is empty. The old file is kept as `MEMORY.pre-migration.md` next to it (a later repair replaces that copy), and one line in the transcript says so:

    memory-save: MEMORY.md: put into the four sections (old copy: MEMORY.pre-migration.md)

A save whose result is not in the template is never written.

## What is checked before a write

- The reply is one JSON object. A reply the parser cannot read is left to the next turn: nothing is written, the reply is kept as evidence, and one transcript line says so without a status line. An op or a topic of another shape is refused alone, the rest of the reply is written, the status line counts it (`+2 1 refused`), the transcript line names it, and the next save tells the fork what it refused. One bad op no longer loses the whole save.
- An `add` names a heading the file already has: one of the four sections, or a `### ` subheading of it, whatever its case. A bullet goes at the end of that heading's own block, so an add to a section lands before its first subheading. An add whose heading the file lacks is refused alone.
- A removed or replaced line exists in the file exactly, or it differs only by a leading list marker from exactly one line. The fork writes every entry as a bullet, also one that stands in the file as a plain paragraph line. A remove or replace whose line the file does not have is skipped, and the other ops are written: the status line counts it (`+1 1 skipped`), the transcript line names it, and the next save tells the fork to copy such a line exactly, with its markup. A misquoted line (the fork added `**` around one, for example) used to stop the whole save.
- A topic file name is lowercase, ends in `.md`, has no directory part and is not `memory.md`.
- The result has the four sections in order, fewer than 200 lines and fewer than 50000 characters. A file that is already at or over a cap (one written before these checks, for example) is the exception: a save that makes it smaller in both measures is written, so the file comes back under the caps in steps instead of every save failing. A result over a cap is not lost either: the adds and the topic appends are dropped, the removes alone are written, and the dropped part is counted as refused. A remove or replace that would take the title or one of the four `## ` section lines is refused alone, so the template cannot break; a `### ` subheading may still go.
- From 160 lines or 42000 characters the fork is told how many lines and characters this save must remove. Over a cap the note becomes a shrink-only save: add no new bullet, only move entries to a topic file.
- No new bullet is longer than 600 characters. An `add` or `replace` whose bullet is longer is refused alone: the other ops are written, the status line counts it (`+1 1 refused`), the transcript line names it, and the next save tells the fork to split such a bullet or move its detail to a topic file.
- `MEMORY.md` did not change while the fork ran.

Two cases are left that write nothing and show an error on the status line: the fork gave no text to read (nothing to fork yet, an API error with its status and kind, a reply with no text, or a cut call), and `MEMORY.md` changed while the fork ran.

The reply's JSON object is read from the last `}` back to the first `{` that opens an object of named fields and parses. A reply that writes a sentence before the JSON is still read, also one whose sentence holds braces of its own, for example a `{ tool: 'Edit' }` matcher.

A reply that is not a JSON object of that shape is written to `memory-save.failed-reply.txt` in the memory directory, and one transcript line names its cause and its output tokens:

    memory-save: MEMORY.md: this turn's reply was not read (reply is not valid JSON (JSON Parse error: Expected '}')); 1840 output tokens, kept in memory-save.failed-reply.txt

Each such reply replaces the file, so it holds the last one. Read it to see whether the reply was cut short or held broken JSON. The fork reply's stop reason is not available to a mod, so the mod cannot tell the two apart itself.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install memory-save@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/memory-save

To keep the flag on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Remove every other hook, `CLAUDE.md` line or skill that tells the model to edit `MEMORY.md`. The mod writes the file, and a model edit while the fork runs makes that save stop with an error.
2. To keep a memory file you already have, copy it to `~/.cli-tweaks/memory/<project>/MEMORY.md`. At the next load the mod puts it into the four sections and keeps the old copy as `MEMORY.pre-migration.md`. A project without the file gets one after its first save; the mod creates the directory.
3. Restart Claude Code. The memory loads at startup, resume, `/clear` and compaction.

The mod has no command. To stop the saves, disable it: `claude plugin disable memory-save@kilimcininkoroglu-mods`.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, turn.complete
    ❯ ./register.ts calls: $.clock.now (via report), $.env.get (via locate), $.fs.exists (via readFile), $.fs.list (via memoryContext), $.fs.read (via readFile), $.fs.write (via ask, save, templated, writeTopics), $.model.fork (via ask), $.process.run (via git), $.sidebar.clear (via clearReport), $.sidebar.set (via report), $.ui.log (via ask, git, logEvent), $.ui.status (via clearReport, report)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: HOME

Reach L2, writes files, runs git and drives Claude.

    1. Reads:    HOME; MEMORY.md, its topic files and the directory listing under ~/.cli-tweaks/memory/<project>/; the session transcript, through the fork
    2. Runs:     git rev-parse, twice per session, to name the project; one tool-less $.model.fork per main-loop turn
    3. Sends:    MEMORY.md as session context at startup, resume, /clear and compaction; the fork message (the writing rules and the current MEMORY.md) to the session's own API client, on top of the session's transcript
    4. Persists: MEMORY.md, MEMORY.pre-migration.md, topic files and the last unreadable fork reply (memory-save.failed-reply.txt) under ~/.cli-tweaks/memory/<project>/
    5. Hostile input: the fork's reply is untrusted text; only the documented JSON shape is applied, topic file names are checked, and the result must pass every check before a write

## Limits

- The fork has no tools. It knows only the transcript and the current file.
- A mod loaded in the middle of a session (`/reload-plugins`, an enable) loads the memory at the next `/clear`, compaction or session.
- The test engine of `claude plugin test` cannot raise `classic.SessionStart`. The load is covered by unit tests of its text and by a live session check.
- Every main-loop turn costs one fork: the transcript as cache reads, the current file and the rules as input, and the answer as output.
- A save that fails is not retried. The next turn saves again.
- A fork can come back without text: before the conversation's first reply, on an API error, or cut by an abort. The status line then names the reason.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
