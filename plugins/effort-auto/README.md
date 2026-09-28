# effort-auto

One effort setting never fits a whole session: `max` wastes minutes and tokens on "thanks", `low` rushes an architecture question. This mod has a small model rate how hard each of your prompts is, and runs that turn at the matching effort. The next turn starts again from the session's own effort, so nothing has to be set back.

## What it does

1. Each prompt you type while the session is idle goes to haiku first, at its lowest effort, with one question: how much reasoning does this request need? Haiku answers one word: `low`, `medium`, `high`, `xhigh` or `max`. It reads the first 4,000 characters of the prompt. Measured: an answer in about 0.6 seconds. A prompt that names its own level, in any language ("solve this at medium effort", "mit niedrigem Aufwand (low effort)", "推論レベルは medium"), gets that level, because haiku is told to answer with it instead of rating the request. Measured on 2.1.283: four such prompts in Turkish, German, Japanese and English got the named level in 12 of 12 runs; a prompt that used the word `medium` for something else ("a medium sized image") was also read as `medium`.
2. Every model request of the main loop in that turn goes out at that level, whether it is below or above the session's own effort. A subagent keeps its own effort.
3. Nothing is written to the session's settings. When the turn ends, the next one starts from the session's effort again, unless its own prompt gets rated.
4. A task notification, a plugin's prompt, or a prompt you type over a running turn is not rated, so its turn runs at the session's effort.
5. If haiku does not answer within 8 seconds, or answers something that is not a level, the turn runs at the session's effort and one line says so.
6. You see the level of each rated turn. With the [sidebar](../sidebar) open, it is a standing section that stays for the whole session. The level is faint for `low`, green for `medium`, yellow for `high` and red for `xhigh` and `max`, the same colours session-watch gives the effort. While a turn runs, the section shows that turn's effort beside the session's own; between turns, the effort of the last turn that ended:

       this turn high · session low
       last turn high · session low

   A turn that is not rated shows the session's effort with a faint `(session)` after it. `/effort-auto off` takes the section down. With the sidebar closed, a rated turn writes one transcript line at its start:

       effort-auto: this turn max · session low

## Only where the prompt cache survives

An effort change can rewrite the whole prompt cache, and rewriting a long conversation costs more than the turn gains. So the mod changes the effort only on the models that keep the cache across an effort change: Opus 5.5 and Fable 5.1. On every other model it changes nothing, and once the session's first request names such a model, no prompt is rated at all.

Measured on Claude Code 2.1.283, with the same conversation and an effort change from one turn to the next:

    Opus 5.5   high → low, low → max    cache read 58,408 each time, as at the same effort
    Sonnet 5   high → low, low → max    cache read 0, the whole conversation of about 73,700 tokens written again

In the live check a greeting was rated `low` and a design question `max`. The `max` turn read the cache the `low` turn had written (74,079 tokens), and the next turn, back at `low`, read 91,755.

## Command

    /effort-auto            on or off
    /effort-auto on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install effort-auto@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=effort-auto}, prompt.submit, turn.step, turn.complete
    ❯ ./register.ts calls: $.command.register, $.model.complete (via rate), $.sidebar.clear (via dropLine), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via rate, toPerson)

Reach L3: one model request per prompt.

    1. Reads:    the text of each prompt you type, and the model and effort of each main-loop request
    2. Runs:     nothing
    3. Sends:    the first 4,000 characters of each prompt you type to haiku, through Claude Code's own API connection
    4. Persists: in $.store, the on/off setting; the turn's level lives in memory until the turn ends
    5. Hostile input: the prompt reaches haiku inside a <request> block; only one of the five level words is taken from the answer, so a reply that says anything else changes nothing

## Limits

- The rating costs one haiku request per prompt and delays the turn by about 0.6 seconds. Measured on 2.1.283 through the mod's own call: a short prompt took 168 to 236 input tokens and 4 output tokens, a prompt cut at 4,000 characters 667 input tokens; no cache was read or written. At Haiku 4.5's $1 per million input tokens and $5 per million output tokens, that is about $0.0002 for a short prompt and $0.0007 at the most, so about $0.20 for 1,000 short prompts. On a Claude subscription the request counts toward your usage limits instead.
- Haiku judges from the prompt alone, not from the conversation, so a short follow-up such as "go on" is rated `low` even in the middle of hard work.
- A `max` turn thinks much longer and costs more. In the live check a five-point design summary took 7 minutes and 42,683 output tokens.
- The cache check goes by the model name alone. On Amazon Bedrock, Google Cloud, a Claude apps gateway, or with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, the Claude Code docs say an effort change still rewrites the cache on every model.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
