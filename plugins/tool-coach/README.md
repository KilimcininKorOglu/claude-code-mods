# tool-coach

A Claude Code Mod that stops the model from repeating a tool call that just failed with the same input. The call is not run again until a file or a command has changed something, and the model reads the error it already got instead.

## What it does

1. The mod hooks every tool call: the built-in tools, MCP tools and the calls of subagents. Bash is left out, because a failed command often runs again for good reasons, such as a test after a fix.
2. A call whose result is an error is kept with its error. This covers errors the tool itself reports (`File does not exist`, `String to replace not found`, an MCP error) and input the engine refuses (`InputValidationError`).
3. The same call again, with the same tool and the same input, is not run. The model reads this instead of a result:

       this exact Read call failed a moment ago, and no file or command has changed anything since, so it would fail the same way. Its error was:
       File does not exist. Note: your current working directory is /w.
       Read the error, change the input, and call again.

   Two calls are the same when their input holds the same values, whatever the order of the keys. A `description` field only labels a call, so it is not compared. The main loop and each subagent keep their own failed calls.
4. A call with any other input runs as usual.
5. A successful Edit, Write, NotebookEdit or Bash call drops every kept call, because it may have changed what the failed call needed: a file now exists, a command started a server. So does each new turn, because you may have changed something by hand.
6. The same moment writes one line, so you see which call was refused. With the [sidebar](../sidebar) open, the line is an entry in its stream, the tool name red and the rest faint; else it goes to the transcript:

       tool-coach: Read call repeated after it failed, not run

In the live check the model read a missing file, then asked for the same Read again. The second call did not run, and the model reported the error it had already got. After a Write created the file, the same Read ran and returned the text. A failed Bash command ran again as asked.

## Command

    /tool-coach            on or off
    /tool-coach on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install tool-coach@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=tool-coach}, turn.start, tool.call
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L0, draws and remembers.

    1. Reads:    the tool name, the input and the result of each tool call
    2. Runs:     nothing
    3. Sends:    a deny text to the model when a failed call is repeated unchanged, and one line to the sidebar or the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting; the failed calls live in memory until a change or the next turn
    5. Hostile input: a call's input and error are only compared and quoted back to the model, never run or opened

## Limits

- The mod cannot read a tool's input schema, so it does not check an input before the first call. The engine checks the schema itself and answers `InputValidationError`; the mod stops the repeat.
- A change the mod does not see, such as a file another program writes, does not drop the kept calls. The next turn does.
- A failed call can succeed later with the same input for a reason that is not a file or a command, such as an MCP server that reconnected. The model then needs another input, or the next turn.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
