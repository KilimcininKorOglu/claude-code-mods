# subagent-ledger

A Claude Code Mod that shows what each subagent of the session spent: its turns, its wall-clock time and its tokens, one row per agent, the costliest first.

## What it does

1. The mod hooks `agent.spawn`, which names what the subagent is: its agent type (`Explore`, `general-purpose`, a plugin's agent, `fork`) and the one-line description of its task. It keeps that against the agent id the spawn answers with, and draws the row as running at once.
2. It hooks `turn.complete` of every subagent loop. That turn is the subagent's answer, so it ends the run: `done` when the turn ended with an answer, `stopped` when it was interrupted, refused or ended on an API error. Each of those turns adds one turn, its `durationMs`, and its tokens: the input, the output, the cache reads and the cache writes the engine reports for that turn. The turn also names the model that answered it, drawn without the vendor prefix and without the date of a full id, so `claude-haiku-4-5-20251001` reads as `haiku-4-5`. A main-loop turn is not counted.
3. It hooks `turn.step`, one model request, to draw a subagent as running again when its loop runs after it answered, as it does when SendMessage resumes it. A main-loop step is not read.
4. While the [sidebar](../sidebar) is open, the ledger is one `subagents` section that stays for the session and is rewritten at each spawn, at each subagent turn and when a subagent runs again:

       subagents
       find the parser · haiku-4-5 · 3 turn · 42s · T 81k · I 2k · O 1k · CR 70k · CW 8k · done
       port the config loader to the new schem… · opus-5 · 7 turn · 4m 10s · T 260k · I 5k · O 9k · CR 210k · CW 36k · running
       read the tests · haiku-4-5 · 1 turn · 9s · T 30k · I 1k · O 500 · CR 24k · CW 5k · stopped
       2 more · 150k

   A row's name is the description of its task, cut at 40 characters; a spawn that named no description shows its agent type there instead. Its tokens read as `T` the total, `I` the input the cache did not serve, `O` the output, `CR` the cache reads and `CW` the cache writes; the last four add up to `T`. A row ends with its status word: `running` yellow while its subagent runs, `done` green once it answered, and `stopped` faint when its run ended without an answer. The model is coloured by family (opus red, fable yellow, sonnet green, haiku faint). The `T` total is yellow from 80% of the limit (200k tokens by default) and red once the subagent reached it, in every status. The label, the turns, the time and the tokens by kind stay in the default colour. The rows past the fifth are one faint line with their tokens added up, so a fan-out of twenty agents still holds six rows.
5. With the sidebar closed, or without that mod installed, the totals go to the status line instead:

       subagent-ledger: 4 subagent · 12 turn · 3m 10s · 210k

6. `/subagent-ledger` prints the totals and every subagent of the session, the costliest first, whatever the sidebar shows.

## Command

    /subagent-ledger             on or off, the limit, the totals and every subagent
    /subagent-ledger on | off    on by default
    /subagent-ledger limit 500   a subagent over 500k tokens is drawn red; 1 to 10000, 200 by default, stored across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install subagent-ledger@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Install the [sidebar](../sidebar) mod for the per-agent rows. Without it the mod shows the totals on the status line.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ ./register.ts hooks: session.start, command.run{command=subagent-ledger}, agent.spawn, turn.step, turn.complete
    ❯ ./register.ts calls: $.command.register, $.sidebar.clear (via clearShown), $.sidebar.set (via show), $.store.get, $.store.set (via setEnabled, setLimit), $.ui.status (via clearShown, show)

Reach L0, draws and remembers.

    1. Reads:    each spawn's agent type, description and resolved model, each subagent turn's id, duration, end reason, model and token counts, and the agent id of each model request. It reads no prompt, no answer, no file and no tool result.
    2. Runs:     nothing
    3. Sends:    nothing to the model; the rows and the status line are for the person only
    4. Persists: in $.store, the on/off setting and the limit; the ledger itself lives in memory and ends with the session
    5. Hostile input: the only text drawn is the agent type, the spawn's own description, cut to 28 characters, and the model id the engine reports

## Limits

- The ledger counts turns as they end. A subagent still running is in the rows, yellow, with what it has spent so far.
- A run ends in the ledger only at the subagent's `turn.complete`. A subagent whose run ends without one stays yellow. Whether every kind of end (a `TaskStop`, a killed background agent) raises that event is not measured.
- A subagent whose spawn this mod did not see (one started before it loaded) is counted under the label `agent`, because only the spawn names the type. Its model is empty until one of its turns names one, and a row without a model draws without that field.
- The tokens are the engine's own per-turn counts. A turn that got no response carries none and adds zero.
- Tokens are not dollars. What a cache read costs against a subscription's limits is not documented.
- The ledger is per session. A restart starts empty, and the counts are not written to disk.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
