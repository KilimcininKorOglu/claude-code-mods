# effort-auto

A Claude Code Mod that has a small model rate how hard each of your prompts is, and runs that turn at the matching effort. The next turn starts again from the session's own effort, so nothing needs to be set back.

## What it does

1. Each prompt you type while the session is idle goes to haiku first, at its lowest effort, with one question: how much reasoning does this request need? Haiku answers one word: `low`, `medium`, `high`, `xhigh` or `max`. It reads the first 4,000 characters of the prompt. Measured: an answer in about 0.6 seconds.
2. Every model request of the main loop in that turn goes out at that level, below or above the session's own effort. A subagent keeps its own effort.
3. Nothing is written to the session's settings. When the turn ends, the next one starts from the session's effort again, unless its own prompt is rated.
4. A task notification, a plugin's prompt, or a prompt you type over a running turn is not rated, so its turn runs at the session's effort.
5. When haiku does not answer, or answers something that is not a level, the turn runs at the session's effort, and one line says so.
6. You see the level of each rated turn. With the [sidebar](../sidebar) open, it is a standing section: the level faint for `low`, green for `medium`, plain for `high`, yellow for `xhigh`, red for `max`. Otherwise it is a transcript line:

       effort-auto: this turn max · session low

## Only where the prompt cache survives

An effort change can rewrite the whole prompt cache, and a rewrite of a long conversation costs more than the turn gains. The mod changes the effort only on the models that keep the cache across an effort change: Opus 5.5 and Fable 5.1. On every other model it changes nothing, and after the first request of the session names the model, no prompt is rated.

Measured on Claude Code 2.1.283, with the same conversation and an effort change from one turn to the next:

    Opus 5.5   high → low, low → max    cache read 58,408 each time, as at the same effort
    Sonnet 5   high → low, low → max    cache read 0, the whole conversation of about 73,700 tokens written again

In the live check, a greeting was rated `low` and a design question `max`. The `max` turn read the cache the `low` turn had written (74,079 tokens), and the next turn, back at `low`, read 91,755.

## Command

    /effort-auto            on or off
    /effort-auto on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install effort-auto@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=effort-auto}, prompt.submit, turn.step, turn.complete
    ❯ ./register.ts calls: $.command.register, $.model.complete (via rate), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via rate, toPerson)

Reach L3, one model request per prompt.

    1. Reads:    the text of each prompt you type, and the model and effort of each main-loop request
    2. Runs:     nothing
    3. Sends:    the first 4,000 characters of each prompt you type to haiku, through Claude Code's own API connection
    4. Persists: in $.store, the on/off setting; the turn's level lives in memory until the turn ends
    5. Hostile input: the prompt reaches haiku inside a <request> block; only one of the five level words is taken from the answer, so a reply that says anything else changes nothing

## Limits

- The rating costs one haiku request per prompt and delays the turn by about 0.6 seconds.
- Haiku judges from the prompt alone, not from the conversation, so a short follow-up such as "go on" is rated `low` even in the middle of hard work.
- A `max` turn thinks much longer and costs more. In the live check a five-point design summary took 7 minutes and 42,683 output tokens.
- The cache check follows the model name alone. On Amazon Bedrock, Google Cloud, a Claude apps gateway, or with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, the Claude Code docs say an effort change still rewrites the cache on every model.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
