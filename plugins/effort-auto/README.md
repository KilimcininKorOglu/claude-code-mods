# effort-auto

One effort setting never fits a whole session: `max` wastes minutes and tokens on "thanks", `low` rushes an architecture question. This mod has a small model rate how hard each of your prompts is, and runs that turn, with the subagents it starts, at the matching effort. You can limit the levels a rated turn runs at. The next turn starts again from the session's own effort, so nothing has to be set back.

## What it does

1. Each prompt you type while the session is idle goes to haiku first, at its lowest effort, with one question: how much reasoning does this request need? Haiku answers one word: `low`, `medium`, `high`, `xhigh` or `max`. It reads the first 4,000 characters of the prompt. Measured on 2.1.284: an answer in about 0.6 seconds.
2. A prompt that asks for a level by the level's own word gets that level instead of a rating, whatever language the rest of it is in: "bunu max ile çöz", "use high effort", "effort: low". Only the five level words name a level. A prompt that calls the work hard or easy, asks to think carefully, or says "yüksek effort" or "maximum effort" is rated. Haiku answers `named` and the level, and the mod keeps that answer only when the prompt holds the level's word, because haiku also answered `named` for prompts that only called the work hard. Measured on 2.1.284, three runs per prompt: eight prompts that name a level got it 24 of 24 times; eight that call the work hard or easy, or use a level word in another sense ("a medium sized image", "the max value of the counter"), were rated 24 of 24 times. Haiku answered `named` for "yüksek effort" and "maximum effort" 6 of 6 times, and the word check read those answers as ratings.
3. `/effort-auto levels low medium max` limits the levels a rated turn runs at. A rating outside them moves to the nearest allowed level, the higher of two equally near ones: with `low medium max`, a `high` rating runs at `medium` and an `xhigh` rating at `max`. A level the prompt names runs even when it is not allowed. Haiku still rates on the whole scale and is not told the allowed levels: told only `low` and `medium`, it answered `named max` for "the max value of the counter overflows at high load; find why" 3 of 3 times, while with the whole scale it rated the same prompt 6 of 6 times. `/effort-auto levels all` lifts the limit, which is the default.
4. Every model request of the main loop in that turn goes out at that level, whether it is below or above the session's own effort.
5. A subagent a rated turn starts runs at the turn's level for its whole run, also when it goes on in the background after the turn ended, and so does a subagent it starts. Measured on 2.1.284: when only the main loop's requests were changed, a subagent's requests still carried the session's effort. A subagent whose first request carries an effort other than the session's has an effort of its own in its definition, and keeps it.
6. Nothing is written to the session's settings. When the turn ends, the next one starts from the session's effort again, unless its own prompt gets rated.
7. A task notification, a plugin's prompt, or a prompt you type over a running turn is not rated, so its turn and its subagents run at the session's effort.
8. If haiku does not answer within 8 seconds, or answers something that is not a level, the turn runs at the session's effort and one line says so.
9. You see the level of each rated turn and the allowed levels. With the [sidebar](../sidebar) open, it is a standing section of two lines that stays for the whole session. A level is faint for `low`, green for `medium`, yellow for `high` and red for `xhigh` and `max`, the same colours session-watch gives the effort. While a turn runs, the first line shows that turn's effort beside the session's own; between turns, the effort of the last turn that ended. The second line shows the allowed levels:

       this turn high · session low
       allowed low · medium · high · xhigh · max

       last turn max (named) · session low
       allowed low · medium

   A level the prompt named has a faint `(named)` after it, and a turn that is not rated shows the session's effort with a faint `(session)` after it. `/effort-auto off` takes the section down. With the sidebar closed, a rated turn writes one transcript line at its start:

       effort-auto: this turn max (named) · session low

In the live check on Sonnet 5.5 with `levels low medium` and the session at `low`, a prompt that called the work hard and asked for an Explore subagent ran at `medium`, and so did the subagent's requests. "bunu max ile çöz" with a general-purpose subagent ran at `max`, and so did the subagent's requests.

## Only where the prompt cache survives

An effort change can rewrite the whole prompt cache, and rewriting a long conversation costs more than the turn gains. So the mod changes the effort only on the models that keep the cache across an effort change: Opus 5.5, Sonnet 5.5 and Fable 5.1. On every other model it changes nothing, and once the session's first request names such a model, no prompt is rated at all. A subagent's request is checked by its own model the same way. In a live check on Sonnet 5, every request went out at the session's effort, a subagent's too.

Measured on Claude Code 2.1.283, with the same conversation and an effort change from one turn to the next:

    Opus 5.5   high → low, low → max    cache read 58,408 each time, as at the same effort
    Sonnet 5   high → low, low → max    cache read 0, the whole conversation of about 73,700 tokens written again

Measured on Claude Code 2.1.284 the same way, a medium turn first as the control:

    Sonnet 5.5  medium → high, high → low   cache read 58,417 each time and about 5,500 written, as at the same effort
    Sonnet 5    medium → high               cache read 0, about 73,700 tokens written again

In the live check a greeting was rated `low` and a design question `max`. The `max` turn read the cache the `low` turn had written (74,079 tokens), and the next turn, back at `low`, read 91,755.

## Command

    /effort-auto                      on or off, and the allowed levels
    /effort-auto on | off             on by default
    /effort-auto levels               the allowed levels
    /effort-auto levels <level ...>   allow only these, in any order: levels low medium max
    /effort-auto levels all           allow every level, the default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install effort-auto@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.284:

    ❯ ./register.ts hooks: session.start, command.run{command=effort-auto}, prompt.submit, turn.step, agent.spawn, turn.complete
    ❯ ./register.ts calls: $.command.register, $.model.complete (via rate), $.sidebar.clear (via dropLine), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via setLevels, switchTo), $.ui.log (via rate, toPerson)

Reach L3: one model request per prompt.

    1. Reads:    the text of each prompt you type, and the model and effort of each model request, a subagent's too
    2. Runs:     nothing
    3. Sends:    the first 4,000 characters of each prompt you type to haiku, through Claude Code's own API connection
    4. Persists: in $.store, the on/off setting and the allowed levels; the turn's level and each subagent's live in memory until the turn or the subagent ends
    5. Hostile input: the prompt reaches haiku inside a <request> block; only one of the five level words is taken from the answer, and a "named" answer only when the prompt holds that word, so a reply that says anything else changes nothing

## Limits

- The rating costs one haiku request per prompt and delays the turn by about 0.6 seconds. Measured on 2.1.284 through the mod's own call, nine calls: 0.59 to 0.92 seconds; a short prompt took 378 input tokens and 4 output tokens, and a 6,000-character prompt of one-letter words, cut at 4,000 characters, 2,382 input tokens; no cache was read or written. At Haiku 4.5's $1 per million input tokens and $5 per million output tokens, that is about $0.0004 for a short prompt, so about $0.40 for 1,000 short prompts, and about $0.0024 for that cut prompt. On a Claude subscription the request counts toward your usage limits instead.
- Haiku judges from the prompt alone, not from the conversation, so a short follow-up such as "go on" is rated `low` even in the middle of hard work.
- A level named by another word ("yüksek", "maximum", "extra high") is rated like any other prompt, and a rating outside the allowed levels moves into them.
- The word check cannot tell a level word used in another sense from a named level; haiku makes that call. With the whole scale it rated two such prompts 6 of 6 times.
- A subagent whose own effort equals the session's cannot be told apart from one without an effort of its own, so it runs at the turn's level.
- A `max` turn thinks much longer and costs more. In the live check a five-point design summary took 7 minutes and 42,683 output tokens.
- The cache check goes by the model name alone. On Amazon Bedrock, Google Cloud, a Claude apps gateway, or with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, the Claude Code docs say an effort change still rewrites the cache on every model.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
