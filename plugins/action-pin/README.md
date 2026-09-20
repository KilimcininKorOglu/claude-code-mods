# action-pin

A Claude Code Mod that tells the model when an edit adds a GitHub Actions step pinned to a moving tag, and names the commit SHA to write instead. Nothing is stopped.

## What it does

1. The mod hooks the Edit and Write tools. A call is checked when its path is `.github/workflows/<name>.yml` or `.github/actions/<name>/action.yml` (`.yaml` too).
2. Only the lines the edit adds are read. A `uses:` value whose ref is a 40 or 64 character hex commit is pinned and passes. A local action (`./.github/actions/setup`) and a container (`docker://alpine:3.20`) have no commit to pin and pass too. Every other ref, a tag (`@v4`) or a branch (`@main`), is reported, `actions/*` and `github/*` included.
3. For each reported action the mod asks `https://api.github.com/repos/<owner>/<repo>/commits/<ref>` with the `Accept: application/vnd.github.sha` header, which answers the commit as plain text. No token is sent, so the anonymous rate limit applies (60 requests an hour per address). Each action and ref is asked once per session.
4. The model reads this note after the tool's result:

       action-pin: this edit uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8. A tag or a branch can be moved to other code after a review, so a workflow with write access runs whatever it points at then. Write each as the SHA with the tag as a comment, for example: uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v4

   At most 10 actions are named and looked up, the rest counted. When GitHub does not answer, the action is named without a SHA, the note asks for the pin anyway, and the error is logged once.
5. The same moment writes one line to the transcript, so you see what the model was told. The line holds the actions alone, without the instruction:

       action-pin: actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. While the [sidebar](../sidebar) is open, those actions go there instead, one line per action in a section per edited file, and the transcript stays clean. The section goes when the turn ends. With the sidebar closed, or without that mod installed, the transcript line is written as above.

## Command

    /action-pin            on or off
    /action-pin on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install action-pin@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=action-pin}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.http.fetch (via resolveSha), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via report, toPerson)

Reach L3, reaches the network.

    1. Reads:    the path and the new text of each Edit and Write; no file is opened
    2. Runs:     nothing
    3. Sends:    the public action name and its ref (for example actions/checkout and v4) to api.github.com, at most 10 per edit, once each per session; no token, no repository content, no file path
    4. Persists: in $.store, the on/off setting; the resolved SHAs live in memory for one session
    5. Hostile input: the answer is used only when it is 40 hex characters, and it is written into the note alone; the mod never edits a file

## Limits

- The check is lexical: a `uses:` line inside a block comment or a YAML string still counts.
- A workflow already in the repository is not checked; only the lines an edit adds are.
- An action the anonymous rate limit or a private repository hides gets the note without a SHA.
- A SHA resolved once is kept for the session, so a tag moved during the session keeps its first answer.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
