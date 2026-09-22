# action-pin

A Claude Code Mod that tells the model when an edit adds a GitHub Actions step pinned to a moving tag, and names the commit SHA to write instead. By default nothing is stopped; in `deny` mode a commit, a push and a merge stop while a ref still moves.

## What it does

1. The mod hooks the Edit and Write tools. A call is checked when its path is `.github/workflows/<name>.yml` or `.github/actions/<name>/action.yml` (`.yaml` too).
2. Only the lines the edit adds are read. A `uses:` value whose ref is a 40 or 64 character hex commit is pinned and passes. A local action (`./.github/actions/setup`) and a container (`docker://alpine:3.20`) have no commit to pin and pass too. Every other ref, a tag (`@v4`) or a branch (`@main`), is reported, `actions/*` and `github/*` included.
3. For each reported action the mod asks `https://api.github.com/repos/<owner>/<repo>/commits/<ref>` with the `Accept: application/vnd.github.sha` header, which answers the commit as plain text. No token is sent, so the anonymous rate limit applies (60 requests an hour per address). Each action and ref is asked once per session.
4. The model reads this note after the tool's result:

       action-pin: this edit uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8. A tag or a branch can be moved to other code after a review, so a workflow with write access runs whatever it points at then. Write each as the SHA with the tag as a comment, for example: uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v4

   At most 10 actions are named and looked up, the rest counted. When GitHub does not answer, the action is named without a SHA, the note asks for the pin anyway, and the error is logged once.
5. The same moment writes one line to the transcript, so you see what the model was told. The line holds the workflow and its actions, without the instruction. The workflow is named because the model saw the edit and you did not:

       action-pin: .github/workflows/ci.yml uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8

   The note and the line are separate channels: the model never reads the line, and you never read the note. A workflow is written against the git repository the session started in, or against the session's directory outside a repository, and that path also keys its sidebar entry, so each workflow keeps an entry of its own. The root is read once at the session's start, because a Bash `cd` moves the session's own directory.
6. While the [sidebar](../sidebar) is open, those actions go there instead, the workflow first and then one line per action (the closing entry reads the same way), as an entry in its stream, and the transcript stays clean. The entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript line is written as above.

7. A finding stays open until the workflow pins those actions. After a later Edit or Write the mod reads each open workflow again, and one whose refs are all pinned closes. A workflow that is no longer there closes too, because it uses no action any more; one that is there and cannot be read keeps its finding, because an unread file proves nothing:

       action-pin: every action of .github/workflows/ci.yml is pinned to a commit now: actions/checkout@v4
       action-pin: .github/workflows/ci.yml is no longer there: actions/checkout@v4

   With the sidebar closed the same text is one transcript line. The model reads nothing of this: it wrote the SHA itself.

8. A finding the model did not close is measured again at the end of each main-loop turn, and what is left reaches the model as one note with its next prompt. The SHAs are already in memory, so this asks GitHub nothing:

       action-pin: 1 action(s) are still used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, or take the step out.

   One note per turn, not one per prompt. Without this the finding would be said once, at the edit, and then stand in the pane while the model forgot it. You read nothing new: the pane already carries the same finding.

9. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while a workflow still uses an action by a moving ref. Before it stops one it reads each open workflow again, so a file the model pinned opens the gate itself. A `git commit` answers for its own files alone: the mod reads the index (`git diff --cached --name-only`) and lets the commit run when it holds none of the open workflows, with one line to you naming how many still stand. A `push` and a `merge` hold no index to read, so every finding stands there. There is no bypass; only the person turns the gate off with `/action-pin mode note`. `note` mode is the default and stops nothing.

## Command

    /action-pin                 on or off, the mode, and the workflows that still move
    /action-pin on | off        on by default
    /action-pin mode note       note only; the default
    /action-pin mode deny       a commit, a push and a merge also stop while a ref moves

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install action-pin@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ ./register.ts hooks: session.start, command.run{command=action-pin}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isThere), $.fs.read (via stillMoving), $.http.fetch (via resolveSha), $.process.run (via shownRootOf, stagedPaths), $.session.cwd (via stagedPaths), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via gate, report, toPerson)

Reach L3, reaches the network.

    1. Reads:    the path and the new text of each Edit and Write; the Bash command text; each open workflow again while a finding stands, also at the turn's end
    2. Runs:     git rev-parse --show-toplevel once at the session's start, to show workflows against the repository root; git rev-parse --show-toplevel and git diff --cached --name-only, at a commit in deny mode, to read which files the commit holds
    3. Sends:    the public action name and its ref (for example actions/checkout and v4) to api.github.com, at most 10 per edit, once each per session; no token, no repository content, no file path
    4. Persists: in $.store, the on/off setting and the mode; the resolved SHAs live in memory for one session
    5. Hostile input: the answer is used only when it is 40 hex characters, and it is written into the note alone; the mod never edits a file

## Limits

- The check is lexical: a `uses:` line inside a block comment or a YAML string still counts.
- A workflow already in the repository is not checked; only the lines an edit adds are.
- An action the anonymous rate limit or a private repository hides gets the note without a SHA.
- A SHA resolved once is kept for the session, so a tag moved during the session keeps its first answer.
- A finding closes only when the workflow no longer uses those actions by a ref. A file that cannot be read keeps it open.
- The `deny` mode has no bypass. When a finding cannot be fixed, the person turns the gate off with `/action-pin mode note`.
- The gate reads the command text. A commit through a script or an alias that hides `git commit` is not stopped.
- A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed to the index, because they commit files the index does not hold yet. Every open finding stands for those.
- The index is read in the repository of the session's own directory. A finding of a workflow in another repository never matches it, so such a commit runs.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
