# subagent-ledger

A Claude Code Mod that shows what each subagent of the session spent: its turns, its wall-clock time and its tokens, one row per agent, the costliest first.

## What it does

1. The mod hooks `agent.spawn`, which names what the subagent is: its agent type (`Explore`, `general-purpose`, a plugin's agent, `fork`) and the one-line description of its task. It keeps that against the agent id the spawn answers with.
2. It hooks `turn.complete` of every subagent loop. Each of those turns adds one turn, its `durationMs`, and its tokens: the input, the output, the cache reads and the cache writes the engine reports for that turn. The turn also names the model that answered it, drawn without the vendor prefix and without the date of a full id, so `claude-haiku-4-5-20251001` reads as `haiku-4-5`. A main-loop turn is not counted.
3. While the [sidebar](../sidebar) is open, the ledger is one `subagents` section that stays for the session and is rewritten at each subagent turn:

       subagents
       Explore: find the parser · haiku-4-5 · 3 turn · 42s · 81k
       general-purpose: port t… · opus-5 · 7 turn · 4m 10s · 260k
       2 more · 150k

   A row is green while its subagent is under the limit and red once it passed it (200k tokens by default). The rows past the fifth are one faint line with their tokens added up, so a fan-out of twenty agents still holds six rows.
4. With the sidebar closed, or without that mod installed, the totals go to the status line instead:

       subagent-ledger: 4 subagent · 12 turn · 3m 10s · 210k

5. `/subagent-ledger` prints the totals and every subagent of the session, the costliest first, whatever the sidebar shows.

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

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=subagent-ledger}, agent.spawn, turn.complete
    ❯ ./register.ts calls: $.command.register, $.sidebar.clear (via clearShown), $.sidebar.set (via show), $.store.get, $.store.set (via setEnabled, setLimit), $.ui.status (via clearShown, show)

Reach L0, draws and remembers.

    1. Reads:    each spawn's agent type, description and resolved model, and each subagent turn's id, duration, model and token counts. It reads no prompt, no answer, no file and no tool result.
    2. Runs:     nothing
    3. Sends:    nothing to the model; the rows and the status line are for the person only
    4. Persists: in $.store, the on/off setting and the limit; the ledger itself lives in memory and ends with the session
    5. Hostile input: the only text drawn is the agent type, the spawn's own description, cut to 28 characters, and the model id the engine reports

## Limits

- The ledger counts turns as they end. A subagent still running is in the rows with what it has spent so far.
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
