# session-watch

A Claude Code Mod that shows this session's state in the [sidebar](../sidebar): context fill, token totals, cost, model and thinking level, the Claude Code version, and the git branch and status.

## What it shows

**A section at the top of the sidebar** (`order: 5`), measured on Claude Code 2.1.282:

    session-watch: session
    context 8% · 81k / 1.0M
    tokens T 81k · I 2 · O 8 · CR 74k · CW 7k
    cost $0.07
    model opus-5-5[1m] · thinking medium
    Claude Code 2.1.282
    main · 1 untracked · no upstream

- `context`: the input tokens of the last reply over the model's context window, and their share. Green under 50%, yellow from 50% to 80%, red above 80%. The engine reports all three (`$.session.usage().context`); the mod computes none of them. Before the first reply the line reads `context: no reply yet`.
- `tokens`: the session's totals: `T` all, `I` input, `O` output, `CR` cache reads, `CW` cache writes. A session with no totals kept reads them once from its transcripts (the main loop's and each subagent's), counting each model response once, and every turn after that adds its own, a subagent's too. A request no transcript records counts as it returns: a plugin's own model call (`$.model.fork`, `$.model.complete`, such as the fork memory-save runs at each turn's end) and a compaction's summary. Measured on 2.1.282: a fork of 16 input tokens and a completion of 14 raised `I` from 2 to 32, and a fork fires no `turn.complete`, so it counts once. The totals are kept in `$.store` per session, so a reloaded module goes on from them. While the transcripts are read the line reads `tokens: reading the transcripts`. Measured on 2.1.282 in a resumed session: the totals equalled the `/cost` row of the session's model, `6 input, 19 output, 222.3k cache read, 21.5k cache write`.
- `cost`: the session's cost in US dollars, as `/cost` totals it.
- `model`: the main loop's model, and the thinking setting (`effort`) of the main loop's last model request: `low` to `max`, a budget, `no thinking setting` for a model without one, or `thinking: not read yet` before the first request. The model's name is coloured by family, the dearest the warmest: opus red, fable yellow, sonnet green, haiku faint. The thinking level is coloured by how hard it asks: `low` faint, `medium` green, `high` yellow, `xhigh` and `max` red. Colouring one word needs sidebar 0.11.0 or later; an older sidebar draws the line in one colour.
- `Claude Code`: the engine's version.
- The git line: the branch (or `detached at <sha>`), the staged, modified, untracked and conflicted files, and the commits ahead of and behind the upstream (`↑1 ↓0`, or `no upstream`). Yellow while the tree has changes, green when it is clean. Outside a repository it reads `git: not a repository`.

**A status line** in place of the section while the sidebar is closed or not installed:

    session-watch: ctx 8% · $0.07 · main*

A `*` after the branch marks a tree with changes. The status line is cleared while the sidebar holds the section.

## When it reads

- At session start.
- At the end of each main-loop turn.
- After each Bash command that names `git`, so a commit, checkout or pull shows at once.
- Every 10 seconds in an interactive session, so a change made outside the session (a checkout in another terminal) shows too. Measured with the earlier 30-second timer: a file staged from outside turned `1 untracked` into `1 staged` within one tick.
- After a plugin's own model call (`$.model.fork`, `$.model.complete`) or a compaction, so memory-save's fork at a turn's end shows at once. The redraw runs from a timer, so the call's caller does not wait for its git run.
- At `/session-watch`, which also prints the section's lines.

Each reading runs `git status --porcelain=v2 --branch` once in the directory the session started in. A reading that fails is logged once as `cannot read the session: <error>`.

## Command

    /session-watch    the section's lines, read now

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install session-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Install the [sidebar](../sidebar) mod and open it with `/sidebar`. Without it the mod writes the short status line.
3. Install `git`. Without it the git line reads the error.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.282:

    ❯ ./register.ts hooks: session.start, turn.step, turn.complete, model.fork, model.complete, session.compact, tool.call{tool=Bash}, command.run{command=session-watch}
    ❯ ./register.ts calls: $.clock.after (via countCall, startTotals), $.clock.every, $.command.register, $.env.get (via configDirOf), $.fs.exists (via transcriptsOf), $.fs.list (via transcriptsOf), $.fs.stat (via transcriptsOf), $.process.run (via readGit), $.process.spawn (via readTotals), $.session.id, $.session.model (via readNow), $.session.root, $.session.usage (via readNow), $.session.version, $.sidebar.set (via show), $.store.delete (via startTotals), $.store.get (via keepTotals, startTotals), $.store.set (via keepTotals), $.ui.log (via refresh, seedTotals, startTotals), $.ui.status (via show)

Reach L2, it runs git and head.

    1. Reads:    the session's usage figures (context, cost), model, id, start directory and engine version; each turn's token counts, the usage of each plugin model call and compaction, and each request's thinking setting; the text of each Bash command, to see whether it names git; once per session with no totals kept, the session's transcripts under <config dir>/projects/, only their model responses' usage
    2. Runs:     git status --porcelain=v2 --branch in the session's start directory, at each reading; head -c <size> on each transcript, once; one 10 second timer in an interactive session
    3. Sends:    nothing leaves the machine
    4. Persists: the token totals of the last 20 sessions in $.store
    5. Hostile input: git's output is parsed by line shape and only counted; a transcript row is parsed as JSON and only its four token counts are added, a count of another type adding nothing; a stored value of another shape reads as none

## Limits

- The engine's own side calls (part of the `haiku` row in `/cost`) reach no hook and are not counted; measured on 2.1.282, 888 of 902 haiku input tokens in a probe session. `$.model.classify` reports no usage and is not counted either. `cost` counts every request.
- A plugin's model call or a compaction made before the module loaded left no record, so a session open before the install misses them for good.
- A turn that ran across the moment the transcripts' sizes were read can be counted twice: its responses written before that moment are read from the transcript, and its `turn.complete` adds the whole turn.
- The thinking setting is the main loop's last request; a subagent's own setting is not shown.
- `git status` reads the directory the session started in; a Bash `cd` into another repository does not move it.
- A Bash command that runs git through a script without naming `git` refreshes the git line only at the turn's end or the timer.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
