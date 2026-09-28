# error-poke

You leave the model working, and when you come back the session sits idle with `API Error: Connection lost mid-response` and the work half done. The engine gave up after its retries and nobody told the model to go on. This mod does: when an API error kills a turn, it sends one continue prompt so the model carries on, at most 99 times in a row, or as many as you set with `/error-poke limit <n>`.

## What it does

1. It watches `turn.complete` of the main loop. A subagent's turn is left alone.
2. It acts on one kind of end only: `reason: "error"`, a turn the engine reports as dead on an API error (retries exhausted, the context limit). A turn you interrupted is `aborted` and a model refusal is `refusal`; neither gets a prompt.
3. It sends this prompt, which runs once the session is idle:

       The previous turn was cut off by an API error, not by me. Continue where you stopped; do not start over. If you cannot tell how far you got, say so and stop.

   The interrupted turn's work is still in the transcript, so the prompt asks the model to carry on rather than repeat it.
4. The prompt waits before it goes out, longer after each failure in a row: 5 s, 15 s, 45 s, 135 s, then 5 minutes each. An overloaded API usually recovers in seconds, and an error that fails the same way on every try (the context limit) does not burn the whole limit back to back. A prompt of yours during the wait, or `/error-poke off`, cancels the waiting prompt.

   A turn that a usage limit stopped waits for the limit instead. When a limit reads 100% or more, or the last assistant text is Claude Code's own `You've hit your ... limit`, the one continue prompt goes out a minute after that limit resets (the latest reset, when several limits are full), because every prompt before that would fail the same way:

       error-poke: the turn hit the 5h usage limit, continuing at 14:01 (in 2 h 1 min) (1/99)

   Every prompt also writes one line to the transcript, so you know why the session will move by itself:

       error-poke: the turn died on an API error, continuing in 5 s (1/99)

5. At most 99 prompts go out for one stretch of failures, or as many as `/error-poke limit <n>` says. At the limit the mod says so once and stops:

       error-poke: stopped after 99 continue prompts; the API keeps failing. Send a prompt to reset the count.

6. A prompt of your own (from the composer, the bridge or the SDK) resets the count, so the next failure starts from 1 again.
7. With the [sidebar](../sidebar) open, these lines go into its stream instead, and the transcript stays clean. There `API error` and the usage limit's name are red, the count is faint (yellow once it is within 10% of the limit), and the stop line is red. Without the sidebar, the lines land in the transcript as above.
8. The prompt runs the mod's own markdown command `/error-poke:send <prompt>`, whose body is its arguments alone. The transcript shows that command line, and the model reads the prompt exactly as written, as it reads a typed slash command; a `$.prompt.submit` text would reach it inside a `The error-poke plugin sent a message:` frame. When the engine refuses the command, one line says so and the prompt goes out as a plugin prompt, with that frame.
9. A plugin prompt the engine refuses (the session is busy, a stop is pending) is reported as well, and no count is lost.

What the mod reads is the engine's own `reason` value, and `/error-poke` prints how the last turn ended. If a failure you saw got no prompt, that line tells you which value the engine reported.

## Command

    /error-poke            on or off, the count, and how the last turn ended
    /error-poke on | off   on by default
    /error-poke limit <n>  at most n continue prompts in a row; 1 to 999, 99 by default, kept across sessions
    /error-poke:send <prompt>  the command a continue prompt runs; typed, it sends the prompt as written

`/error-poke:send` is the mod's second command, the one exception to one command per mod, because only a markdown command hands the model a prompt without the plugin frame.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install error-poke@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=error-poke}, prompt.submit, turn.complete
    ❯ ./register.ts calls: $.clock.after (via afterTurn), $.clock.now (via afterTurn), $.command.register, $.command.run (via sendPoke), $.prompt.submit (via submitPoke), $.session.messages (via readLimitWait), $.session.usage (via readLimitWait), $.sidebar.set (via toPerson), $.store.get (via readLimit, readSettings), $.store.set, $.ui.log (via toPerson)

Reach L2: it drives Claude.

    1. Reads:    how each main-loop turn ended, and the origin of each prompt; after a turn an API error ended, the session's usage limits and the last assistant text; no file, no command
    2. Runs:     nothing
    3. Sends:    one fixed continue prompt to your own session, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the limit; the count lives in memory for one stretch of failures
    5. Hostile input: the prompt text is a constant in the mod; no transcript or API text is copied into it

## Limits

- The mod goes by the engine's `reason`. An error the engine reports as something other than `error` gets no prompt; `/error-poke` prints the value so you can tell.
- A turn that failed before any output is continued the same way. The model may answer that it cannot tell how far it got, which is what the prompt asks for.
- The count is per session and lives in memory, so a restart starts at 0.
- Nothing is retried at the API level. The mod starts a new turn, so the failed turn's tokens stay spent.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
