# edit-loop

When a fix does not work, the model tends to edit the same file again, and again, each time with a slightly different guess. Five edits of one file in one turn usually mean it is guessing instead of understanding. This mod notices that moment and tells the model to stop, re-read the code and name the root cause before the next edit. It stops nothing.

## What it does

1. It watches the Edit, Write and NotebookEdit tools. Each successful call counts as one edit of its file; a denied or failed call does not count.
2. Counts are kept per loop and file: the main loop and each subagent count separately. A new turn starts every count at zero.
3. The third edit of one file in a turn warns you alone:

       edit-loop: 3rd edit of hooks/a.ts in this turn

   The model reads nothing at this count.
4. The fifth edit of one file in a turn gets this note right after its result:

       edit-loop: this turn edited hooks/a.ts 5 times. Stop editing it, re-read the code path and state the root cause before the next edit.

   The path is relative to the git repository the session started in when the file is inside it, so a session opened in `plugins/a` shows a file of `plugins/b` as `plugins/b/x.ts`. Outside a git repository the path is relative to the directory the session started in. That root is read once at the session's start, because a Bash `cd` moves the session's own directory. The note comes once per file and turn; the sixth and later edits get none.
5. At the same moment you get one line in the transcript, so you see what the model was told. It holds the finding alone, without the instruction:

       edit-loop: 5th edit of hooks/a.ts in this turn

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. With the [sidebar](../sidebar) open, both lines go into its stream instead, and the transcript stays clean. There the ordinal (`3rd`, `5th`) carries the colour, yellow at the third edit and red at the fifth, the path stays in the default colour, and `in this turn` is faint. An entry stays until newer ones push it off the pane. Without the sidebar, the lines land in the transcript as above.

In the live check the model edited one file six times in one turn. It read the note after the fifth edit, re-read the file, explained why the edits were intended, and quoted the note word for word. The other five edits got no note.

## Command

    /edit-loop            on or off
    /edit-loop on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install edit-loop@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=edit-loop}, turn.start, tool.call{tool=Edit}, tool.call{tool=Write}, tool.call{tool=NotebookEdit}
    ❯ ./register.ts calls: $.command.register, $.process.run (via shownRootOf), $.session.cwd (via afterEdit, shownRootOf), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2: it runs a process.

    1. Reads:    the file path of each Edit, Write and NotebookEdit call; the session's directory and its git repository root
    2. Runs:     `git rev-parse --show-toplevel` once at the session's start, to show paths against the repository root
    3. Sends:    a note to the model after the fifth edit of one file in a turn, and one line to the transcript at the third and the fifth; nothing leaves the machine
    4. Persists: in $.store, the on/off setting; the counts live in memory for one turn
    5. Hostile input: the path is only compared and printed in the note, never opened

## Limits

- An edit through Bash (`sed -i`, a heredoc, a script) is not counted.
- Five edits of one file can be intended, for example a long file written in parts. The note asks for a reason; it stops nothing.
- The count follows the path as the tool call names it, so one file under two spellings (a link, `..`) counts twice.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
