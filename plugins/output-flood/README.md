# output-flood

A Claude Code Mod that measures how much of your context each Bash command spent. When a command's output passes a size limit, the mod tells the model what it cost and which narrower command would have answered the same question.

## What it does

1. After each batch of tool calls resolves, and before the next model request, the mod measures every Bash result in characters, as the model reads it. The measure comes after every mod that rewrote a result, so a result another mod shrank (such as [bash-diet](../bash-diet)) counts at its shrunk size, whichever order the plugins load in. Subagent calls are measured the same way.
2. A result over the limit (20 KB by default, about 5000 tokens) is a finding. The model reads this note before its next request:

       output-flood: "pytest tests/ -v" returned 30 KB of output, over the 20 KB limit, and all of it is now in the context. Next time run the one test or file this turn needs, and let the runner report only failures (pytest -x -q, go test -run, cargo test <name>, jest -t).

   The advice follows the kind of command: a test runner, `git log`/`diff`/`show`, a filesystem walk (`find`, `ls`, `du`, `tree`), a package install, a file or JSON read, container logs. A command of no known kind is told to send its output to a file and read the range it needs.
3. No advice is ever a pipe into `tail` or `head`. A long run whose output is cut at the end hides the failure that scrolled past; every suggestion narrows what the command produces instead.
4. The same moment writes one line to the transcript, the finding alone, without the instruction the model reads:

       output-flood: 30 KB of output from "pytest tests/ -v", over 20 KB

5. While the [sidebar](../sidebar) is open, that finding goes there instead, the size on the first line (yellow under twice the limit, red at or above it, with `over N KB` faint) and the advice faint under it, as an entry in its stream, and the transcript stays clean. With the sidebar closed, or without that mod installed, the transcript line is written as above.
6. One command text is reported once per session. Its size still counts towards the total `/output-flood` prints.

## Command

    /output-flood            on or off, the limit, and what this session flooded
    /output-flood on | off   on by default
    /output-flood limit 50   a result over 50 KB is reported; 1 to 1000, 20 by default, stored across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install output-flood@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.282:

    ❯ ./register.ts hooks: session.start, command.run{command=output-flood}, classic.PostToolBatch
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setLimit), $.ui.log (via toPerson)

Reach L1, reads the session.

    1. Reads:    each Bash command's text, and the length of its result as the model reads it; it never parses the output itself
    2. Runs:     nothing
    3. Sends:    a note to the model before its next request, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the limit
    5. Hostile input: only the length of the output is measured; the command text reaches the note cut to 60 characters and is never run

## Limits

- The output is already in the context when the note is written. The mod cannot take it back; the note is for the next command.
- A failed command (a non-zero exit the engine reports as an error) is measured from its error text, because a failing test run is the largest output of all. The error text stays as it is. Claude Code cuts that text at 10,000 characters, so a failed command passes a limit of 20 KB only when you set a lower one.
- A backgrounded command is not measured: its result carries a task id, not the output.
- The advice is matched on the command text. A command hidden behind a script or a `make` target gets the general advice.
- The size is counted in characters, not tokens. A line of ASCII is about four characters per token, and other text more.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
