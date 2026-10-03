# action-pin

A GitHub Actions step written as `actions/checkout@v4` runs whatever code that tag points at on the day the workflow runs, and a tag or a branch can be moved after you reviewed it. This mod watches the workflows the model edits: when an edit adds a step pinned to a moving ref, it tells the model the commit SHA to write instead. By default it stops nothing; in `deny` mode a commit, a push and a merge wait until every ref is pinned.

## What it does

1. It watches the Edit and Write tools. A call is checked when its path is `.github/workflows/<name>.yml` or `.github/actions/<name>/action.yml` (`.yaml` too).
2. Only the lines the edit adds are read. A `uses:` value whose ref is a 40 or 64 character hex commit is already pinned and passes. A local action (`./.github/actions/setup`) and a container (`docker://alpine:3.20`) have no commit to pin, so they pass too. Every other ref, a tag (`@v4`) or a branch (`@main`), is reported, `actions/*` and `github/*` included.
3. For each reported action it asks `https://api.github.com/repos/<owner>/<repo>/commits/<ref>` with the `Accept: application/vnd.github.sha` header, and GitHub answers the commit as plain text. No token is sent, so the anonymous rate limit applies (60 requests an hour per address). Each action and ref is asked once per session.
4. Right after the tool's result, the model reads this note:

       action-pin: this edit uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8. A tag or a branch can be moved to other code after a review, so a workflow with write access runs whatever it points at then. Write each as the SHA with the tag as a comment, for example: uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v4

   At most 10 actions are named and looked up; the rest are counted. When GitHub does not answer, the action is named without a SHA, the note still asks for the pin, and the error is logged once until a different one comes.
5. At the same moment you get one line in the transcript, so you see what the model was told. It holds the workflow and its actions, without the instruction. The workflow is named because the model saw the edit and you did not:

       action-pin: .github/workflows/ci.yml uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8

   The note and the line are separate channels: the model never reads the line, and you never read the note. The workflow is shown relative to the git repository the session started in, or to the session's directory outside a repository. That path also keys its sidebar entry, so each workflow keeps an entry of its own. The root is read once at the session's start, because a Bash `cd` moves the session's own directory.
6. With the [sidebar](../sidebar) open, the finding goes into its stream instead and the transcript stays clean. The workflow comes first in red, then one line per action: the action in the default colour, the moving ref red, the commit it points at faint. Without the sidebar, the line lands in the transcript as above.
7. A finding stays open until the workflow pins those actions. After each later Edit or Write the mod reads every open workflow again, and one whose refs are all pinned closes. A workflow that is no longer there closes too, because it uses no action any more. One that is there but cannot be read keeps its finding, because an unread file proves nothing:

       action-pin: every action of .github/workflows/ci.yml is pinned to a commit now: actions/checkout@v4
       action-pin: .github/workflows/ci.yml is no longer there: actions/checkout@v4

   In the sidebar the red entry is removed and a green one takes its place; with the sidebar closed the same text is one transcript line. The model reads none of this, because it wrote the SHA itself.
8. A finding the model did not close is measured again at the end of each main-loop turn, and what is left reaches the model as one note with your next prompt. The SHAs are already in memory, so this asks GitHub nothing:

       action-pin: 1 action(s) are still used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, or take the step out.

   One note per turn, not one per prompt. Without it the finding would be said once, at the edit, and then stand in the pane while the model forgot it. You read nothing new, because the pane already shows the same finding.
9. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while a workflow still uses an action by a moving ref. Before it stops one it reads each open workflow again, so a file the model pinned opens the gate by itself. A `git commit` answers for its own files alone: the mod reads the index (`git diff --cached --name-only -z`) and lets the commit run when it holds none of the open workflows, with one line to you saying how many still stand. A `push` and a `merge` have no index to read, so every finding stands there. There is no bypass; only you turn the gate off, with `/action-pin mode note`. `note` mode is the default and stops nothing.

## Command

    /action-pin                 on or off, the mode, and the workflows that still move
    /action-pin on | off        on by default
    /action-pin mode note       note only; the default
    /action-pin mode deny       a commit, a push and a merge also stop while a ref moves

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install action-pin@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=action-pin}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isThere), $.fs.read (via stillMoving), $.http.fetch (via resolveSha), $.process.run (via shownRootOf, stagedPaths), $.session.cwd (via stagedPaths), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via gate, report, toPerson)

Reach L3: it reaches the network.

    1. Reads:    the path and the new text of each Edit and Write; the Bash command text; each open workflow again while a finding stands, also at the turn's end
    2. Runs:     git rev-parse --show-toplevel once at the session's start, to show workflows against the repository root; git rev-parse --show-toplevel and git diff --cached --name-only -z, at a commit in deny mode, to read which files the commit holds
    3. Sends:    the public action name and its ref (for example actions/checkout and v4) to api.github.com, at most 10 per edit, once each per session; no token, no repository content, no file path
    4. Persists: in $.store, the on/off setting and the mode; the resolved SHAs live in memory for one session
    5. Hostile input: the answer is used only when it is 40 hex characters, and it is written into the note alone; the mod never edits a file

## Limits

- The check is lexical: a `uses:` line inside a block comment or a YAML string still counts.
- A workflow already in the repository is not checked; only the lines an edit adds are.
- An action that the anonymous rate limit or a private repository hides gets the note without a SHA.
- A SHA resolved once is kept for the session, so a tag moved during the session keeps its first answer.
- A finding closes only when the workflow no longer uses those actions by a ref. A file that cannot be read keeps it open.
- The `deny` mode has no bypass. When a finding cannot be fixed, you turn the gate off with `/action-pin mode note`.
- The gate reads the command text. A commit through a script or an alias that hides `git commit` is not stopped.
- A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed to the index, because they commit files the index does not hold yet. Every open finding stands for those.
- The index is read in the repository of the session's own directory. A finding of a workflow in another repository never matches it, so such a commit runs.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
