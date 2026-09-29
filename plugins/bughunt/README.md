# bughunt

A bug hunt prompt tells the model to prove a bug before it fixes it, and the model often writes the fix first and a test that passes after. This mod runs the hunt in rounds and holds each round to its proof. The model writes a proof command, the mod runs it itself, and production code stays unchanged until the proof exits non-zero with a `FAIL` line. The round counts as fixed only when the same command then exits 0 with a `PASS` line. The loop reads each round's outcome and stops at a blocked or unverified round instead of starting the next one.

`/bughunt collab <paths>` is a second, read-only mode: a scanner, a planner and a critic subagent review the paths in turn, and the report carries the findings, the plan and the critic's verdict.

## What it does

### Rounds

1. `/bughunt [--rounds N] [target]` starts a hunt of 1 to 25 rounds over the target, or over the whole project. `--rounds` may stand anywhere among the arguments. The hunt starts at any point of the session.
2. The mod sends each round as a prompt: the round number, the scope, the round's proof directory (`.temp_files/bughunt/<round>/`), the fingerprints of the earlier rounds and the protocol. The model first opens the `bughunt:hunt` skill, which holds the full rules; while a round runs, the mod appends the round's block to the skill's text.
3. While a round runs:
   - Edit, Write and NotebookEdit stop until the skill is open in the round.
   - An edit outside the proof directory stops until the mod recorded a `FAIL`.
   - With a target, an edit outside it stops after the `FAIL` too. A test file (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`) passes, so the regression test can go into the suite.
   - Every subagent spawn stops: a round runs in one conversation.
4. The model calls `mcp__bughunt__proof` with `phase: "before"` and the proof command's `argv`. The mod runs the command (5 minutes at most) and records `FAIL` only when it exits non-zero and prints a line that starts with `FAIL`. A setup or import error that prints no such line is rejected. After the fix, `phase: "after"` with the same `argv` records `PASS` only on exit 0 and a line that starts with `PASS`. The model reads the exit code, the last 20 lines of output and the reason.
5. When the round's turn ends, the mod reads the answer's outcome line: the first line that begins with an outcome label, so a sentence before it does not hide it:
   - `fixed-and-verified` goes on only when the mod recorded `FAIL` then `PASS` in the round; otherwise the hunt stops.
   - `no-proven-bug` goes on.
   - `blocked`, `fixed-verification-incomplete`, no outcome line, an interrupt or an API error stop the hunt.
   - After the last round the hunt ends.

   The `fingerprint:` line of each answer goes into the next rounds' prompts, so the same root cause is not counted twice.
6. A prompt you write yourself ends the hunt; `/bughunt` commands do not.

### Collab

1. `/bughunt collab <paths>`, or the model's `mcp__bughunt__collab` tool, starts three subagents in turn. They are the mod's own agent types (`bughunt:scanner`, `bughunt:planner`, `bughunt:critic`), hidden from the model's agent list, and each can only read: `Read`, `Grep`, `Glob`.
2. The scanner reports each finding at once with `mcp__bughunt__found` (file, line, severity, description, optional fix). The mod checks the fields and keeps the finding. Only the running scanner may call the tool.
3. The planner receives the findings and the scanner's report, and writes a fix plan. The critic receives the findings and the plan, and begins its answer with `verdict: approve`, `revise` or `reject`.
4. Each step has a time limit (scanner 10, planner 8, critic 6 minutes). A step that runs out is named in the report as `timed-out`, and the findings the scanner sent before that stay in the report.
5. When the critic gives no verdict line, the verdict is `no-verdict`, never `approve`.
6. The command and the tool return once the scanner started; the report arrives later as one message, and the model reads it as a read-only review. A step's hand-back message is taken by the mod and dropped, so it does not start a turn of its own.
7. A collab does not start while a round runs.

### What you see

The [sidebar](../sidebar) shows a standing `bughunt` section: the round, whether the skill is open, the proof state and each finished round's outcome and fingerprint. Stopped edits, proof results and the hunt's end go to the sidebar stream. Without the sidebar, each of them is one transcript line such as `bughunt: edit stopped (proof): src/a.ts`.

## Command

    /bughunt [--rounds N] [target]    start a hunt of N rounds (1 by default, 25 at most)
    /bughunt collab <paths>           a read-only scanner, planner and critic review
    /bughunt stop                     end the running hunt
    /bughunt status                   on or off, and the running round
    /bughunt on | off                 on by default; off starts nothing and holds no edit

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bughunt@kilimcininkoroglu-mods

Function hooks are early access, and nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Run `/bughunt` in a repository whose tests you can run from the command line. The proof command runs with your permissions, so read what the model proposes.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.284:

    ❯ ./register.ts hooks: session.start, command.run{command=bughunt}, agent.offer{agent=/"^bughunt:(scanner|planner|critic)$"/}, tool.describe{tool=/"^mcp__bughunt__(proof|found|collab)$"/}, tool.call{tool=/"^mcp__bughunt__proof$"/}, tool.call{tool=/"^mcp__bughunt__found$"/}, tool.call{tool=/"^mcp__bughunt__collab$"/}, prompt.submit, skill.prompt{skill=bughunt:hunt}, tool.call{tool=Skill}, tool.call{tool=Edit}, tool.call{tool=Write}, tool.call{tool=NotebookEdit}, agent.spawn, turn.complete
    ❯ ./register.ts calls: $.agent.register (via declare), $.agent.spawn (via runStep), $.clock.after (via answerOf, send), $.command.register (via declare), $.command.run (via send), $.process.run (via runProof), $.prompt.submit (via send), $.sidebar.clear (via show), $.sidebar.set (via show, toPerson), $.store.get (via readSettings), $.store.set (via setEnabled), $.tool.register (via declare), $.ui.log (via launchCollab, send, toPerson)

Reach L2, it runs the proof command the model names.

    1. Reads:    the path of each Edit, Write and NotebookEdit call; your prompts, only to see whether you wrote one; each round's final answer; the collab subagents' answers
    2. Runs:     the proof command the model passes to mcp__bughunt__proof, as argv without a shell, in the working directory or the cwd it names, for 5 minutes at most; three read-only subagents for a collab
    3. Sends:    each round's prompt and each collab report to the model as a message, a deny text for a stopped edit or spawn, the round's block after the skill's text, sidebar sections and lines or transcript lines to you; nothing leaves the machine
    4. Persists: in $.store, the on/off setting; the hunt itself lives in memory and ends with the session
    5. Hostile input: the proof command is the model's and runs with your permissions, as a Bash call would, but without a shell; a finding's fields are checked before they are kept

## Limits

- The gate reads Edit, Write and NotebookEdit. A file changed through Bash (`sed -i`, a redirect, a script) is not held.
- The mod measures the proof's exit code and its `FAIL` and `PASS` lines. It cannot tell whether the proof runs the real code path or asserts the right behaviour.
- The mod measures that the skill was delivered, not that the model read it.
- A collab step that runs out of time keeps running in the background until it ends; the mod no longer waits for it.
- The collab steps wait for a started subagent's answer, which the test engine cannot start; that path is checked live, not by the tests. Live on 2.1.284: a two-round hunt recorded FAIL then PASS, carried the fingerprint into round 2 and ended there; a collab kept the scanner's finding, read the critic's verdict, and its three hand-backs started no turn.
- There is no bypass of a round's gates. `/bughunt stop` ends the hunt, and `/bughunt off` turns the mod off.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
