# storage-guard

A Claude Code Mod that tells the model when an edit stores browser data with `localStorage` or `sessionStorage` instead of a cookie. The note comes with the Edit's result and names each line, so the model moves the data to a cookie in the same turn. By default nothing is stopped; in `deny` mode a commit, a push and a merge stop while a file still uses the storage.

## What it does

1. The mod hooks the Edit and Write tools. After a successful call on a JavaScript, TypeScript or component file (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`, `.astro`, `.html`), it reads the lines the edit added: those of `new_string` that `old_string` does not have, or every line of a Write. Test files are read too.
2. A line counts when it uses `localStorage` or `sessionStorage` as code:

   | Counts | Does not count |
   |---|---|
   | `localStorage.setItem('token', token)` | `// localStorage.setItem(...)` and `<!-- ... -->` comment lines |
   | `window.sessionStorage.getItem(key)` | `save(token) // not localStorage`, a comment after the code |
   | `window['localStorage']` | `"we never use localStorage"`, the word inside a string |
   | `const { sessionStorage } = window` | `` `localStorage is off` ``, the word in a template literal's text |
   | `` `saved: ${localStorage.getItem(key)}` ``, the `${...}` part | `myLocalStorage`, `indexedDB`, `document.cookie` |

3. The model reads this note after the Edit's result:

       storage-guard: this edit stores data in the browser with localStorage or sessionStorage: src/auth.ts:12. Store it in a cookie instead (document.cookie, or the server's Set-Cookie).

   The line number comes from the file after the edit; a Write is numbered from its own content. At most 8 places are named, the rest counted. When the file cannot be read, the path stands without a line and the error is logged once. The path is written against the directory the session started in when the file is inside it. That directory is read once at the session's start, because a Bash `cd` moves the session's own directory.
4. The same moment writes one line to the transcript, so you see what the model was told. The line holds the places alone, without the instruction:

       storage-guard: browser storage instead of a cookie: src/auth.ts:12

   The note and the line are separate channels: the model never reads the line, and you never read the note.
5. While the [sidebar](../sidebar) is open, those places go there instead, one line each, as a red entry in its stream, and the transcript stays clean. The entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript line is written as above.

6. A finding is a claim about the file, never a remembered answer. After each later Edit or Write the mod reads each open file again, and every measure replaces the finding with what the file holds now: the reported lines that still use the storage, at their current line numbers. A line that is gone or commented out no longer counts. A partial fix keeps the finding open with the places left. A file whose lines are all gone closes, and so does a file that is no longer there; a file that is there and cannot be read keeps its finding, because an unread file proves nothing. The closing entry is green:

       storage-guard: the browser storage is gone from src/auth.ts: src/auth.ts:12

   With the sidebar closed the same text is one transcript line. The model reads nothing of this: it moved the data itself.

7. A finding the model did not close is measured again at the end of each main-loop turn, and what is left reaches the model as one note with its next prompt:

       storage-guard: 1 place(s) still store data in localStorage or sessionStorage: src/auth.ts:12. Move the data to a cookie, or take the lines out.

   One note per turn, not one per prompt. Without this the finding would be said once, at the edit, and then stand in the pane while the model forgot it. You read nothing new: the pane already carries the same finding.

8. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while a file still uses the storage. Before it stops one it reads each open file again, so a file the model fixed opens the gate itself. A `git commit` answers for its own files alone: the mod reads the index (`git diff --cached --name-only`) and lets the commit run when it holds none of the open files, with one line to you naming how many still stand. A `push` and a `merge` hold no index to read, so every finding stands there. There is no bypass; only the person turns the gate off with `/storage-guard mode note`. `note` mode is the default and stops nothing.

In the live check the model added `localStorage.setItem('token', token)` to a file with one Edit and quoted the note naming `app.ts:2` word for word. At the next prompt it quoted the turn-end note, rewrote the line with `document.cookie`, and the closing line `the browser storage is gone from app.ts: app.ts:2` followed that Edit.

## Command

    /storage-guard                 on or off, the mode, and the files still using the storage
    /storage-guard on | off        on by default
    /storage-guard mode note       note only; the default
    /storage-guard mode deny       a commit, a push and a merge also stop while a file uses the storage

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install storage-guard@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ ./register.ts hooks: session.start, command.run{command=storage-guard}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via fileText, gate, toPerson)

Reach L2, it runs git to read the index.

    1. Reads:    the text of each Edit and Write call; the Bash command text; the edited file after an Edit that adds the storage, for the line numbers, and each open file again while a finding stands
    2. Runs:     git rev-parse --show-toplevel and git diff --cached --name-only, at a commit in deny mode, to read which files the commit holds
    3. Sends:    a note to the model after an edit that adds the storage, one more with the next prompt while a finding stands, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the mode
    5. Hostile input: the edited text is only matched by regular expressions and printed as file:line, never run

## Limits

- The check is line by line with regular expressions, not a parser. A string or a comment that spans several lines is read line by line, so a use inside it can count.
- An HTML or component attribute in quotes (`onclick="localStorage.clear()"`) is read as a string and does not count.
- A storage reached through another name (`const s = window[name]`, a wrapper library, `indexedDB`) is not seen.
- An edit through Bash is not checked.
- A finding closes when the reported lines are gone from the file or commented out. A line moved to another file keeps it open.
- The `deny` mode has no bypass. When a finding cannot be fixed, the person turns the gate off with `/storage-guard mode note`.
- The gate reads the command text. A commit through a script or an alias that hides `git commit` is not stopped.
- A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed to the index, because they commit files the index does not hold yet. Every open finding stands for those.
- The index is read before the command runs. A commit whose files change between the read and the run is measured against what the index held at the read.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
