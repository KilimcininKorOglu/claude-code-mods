# error-poke

A Claude Code Mod that continues a turn an API error killed. When the engine ends a turn with `API Error: Connection lost mid-response` or another error that exhausted its retries, the session goes idle with the work half done. The mod submits one continue prompt so the model carries on, at most 99 times in a row, or as many as you set with `/error-poke limit <n>`.

## What it does

1. The mod hooks `turn.complete` of the main loop. A subagent's turn is left alone.
2. It acts on one end only: `reason: "error"`, the turn the engine reports as dead on an API error (retries exhausted, the context limit). A turn you interrupted is `aborted` and a model refusal is `refusal`; neither gets a prompt.
3. It submits this prompt, which runs once the session is idle:

       The previous turn was cut off by an API error, not by me. Continue where you stopped; do not start over. If you cannot tell how far you got, say so and stop.

   The interrupted turn's own work is still in the transcript, so the prompt asks the model to carry on rather than repeat it.
4. The prompt waits before it goes out, longer after each failure of the stretch: 5 s, 15 s, 45 s, 135 s, then 5 minutes each. An overloaded API recovers in seconds, and an error that fails the same way on every try (the context limit) does not spend the whole limit back to back. A prompt of yours during the wait, or `/error-poke off`, cancels the waiting prompt.

   The same moment writes one line to the transcript, so you see why the session will move by itself:

       error-poke: the turn died on an API error, continuing in 5 s (1/99)

5. At most 99 prompts go out for one stretch of failures, or as many as `/error-poke limit <n>` says. At the limit the mod says so once and stops:

       error-poke: stopped after 99 continue prompts; the API keeps failing. Send a prompt to reset the count.

6. Your own prompt (the composer, the bridge, the SDK) resets the count, so the next failure starts from 1 again.
7. While the [sidebar](../sidebar) is open, those lines go there instead, as entries in its stream, and the transcript stays clean. With the sidebar closed, or without that mod installed, the transcript line is written as above.
8. A prompt the engine refuses (the session is busy, a stop is pending) is reported too, and no count is lost.

The engine's own value for `reason` is what the mod reads, and `/error-poke` prints how the last turn ended. When a failure you saw did not get a prompt, that line tells you which value the engine reported.

## Command

    /error-poke            on or off, the count, and how the last turn ended
    /error-poke on | off   on by default
    /error-poke limit <n>  at most n continue prompts in a row; 1 to 999, 99 by default, kept across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install error-poke@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=error-poke}, prompt.submit, turn.complete
    ❯ ./register.ts calls: $.clock.after (via afterTurn), $.command.register, $.prompt.submit (via sendPoke), $.sidebar.set (via toPerson), $.store.get, $.store.set, $.ui.log (via toPerson)

Reach L2, drives Claude.

    1. Reads:    how each main-loop turn ended, and the origin of each prompt; no file, no command
    2. Runs:     nothing
    3. Sends:    one fixed continue prompt to your own session, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the limit; the count lives in memory for one stretch of failures
    5. Hostile input: the prompt text is a constant in the mod; no transcript or API text is copied into it

## Limits

- The mod reads the engine's `reason`. An error the engine reports as something other than `error` gets no prompt; `/error-poke` prints the value so you can tell.
- A turn that failed before any output is continued the same way. The model may answer that it cannot tell how far it got, which the prompt asks for.
- The count is per session and lives in memory. A restart starts at 0.
- Nothing is retried at the API level. The mod starts a new turn, so the failed turn's tokens are spent.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
