# cache-warm

A Claude Code Mod that keeps the 1-hour prompt cache of a session warm for a window you set, and shows what a cold cache would cost. A message sent after the cache has lapsed re-writes the whole context at the cache-write rate; on Claude Fable 5.1 that is $4.00 for 200k tokens, against $0.05 to read the same tokens from a warm cache.

The behavior follows the cache-tax mod by Karan Bansal (karanb192/claude-code-mods), without its send guard. The code is new.

## What it does

**Keeps the cache warm.** `/cache-warm` arms a six-hour window. Inside the window, 50 minutes after the last model request of the main loop, the mod sends one tool-less `$.model.fork` over the session's own transcript. The server answers it from the cache, which refreshes the hour. Every new request moves the ping later, so an active session sends no ping at all.

**Stops when the cache is gone.** A warm ping reads the context and writes only its own few tokens. When a ping reads nothing, or writes a tenth of what it read or more, the cache was already gone and the ping itself paid the write. The mod then stops and shows why. It also stops when the engine sends no ping or the fork fails.

**Arms itself after a paid cold write.** When a turn re-writes at least half of a context larger than 20k tokens, the mod counts that cold write and arms a three-hour window, unless a longer window is already armed.

**Shows the state.** `/cache-status` prints the model, warm or cold, the context size, the cold price, the window, the break-even and this session's cold writes.

A message sent to a cold cache is not stopped or delayed. A resumed session whose cache has lapsed gets one line with the price of its first message.

## Commands

    /cache-warm               keep warm for six hours
    /cache-warm 90m           keep warm for a window of your own (also 2h30m)
    /cache-warm always        arm a six-hour window at every session start and /clear, remembered across sessions
    /cache-warm 6h every 2m   ping every two minutes; a test setting, floor 1m, forgotten after this window
    /cache-warm status        the status line text
    /cache-warm off           stop, forget the window, and turn always off
    /cache-status             the card

## What it shows

**A status line under the prompt** while a window is armed or after a stop:

    cache-warm: 5h10m left · ping in 37m · last ping read 200k $0.05
    cache-warm: stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone

**The card** of `/cache-status`:

    claude-fable-5-1
    state       warm, 42m left
    context     200,502 tokens
    cold cost   $4.01 to re-write it (warm turn $0.05)
    keep warm   on, 5h10m left · ping in 37m · last ping read 200k $0.05
    break-even  up to 80 pings at the read rate cost one cold write, about 2d 18h of idle at one ping per 50m
    session     1 cold write paid, $4.01

**One line in the transcript**, not sent to the model, when a cold write arms the window or a resume starts cold.

## Prices

The table in `hooks/pricing.ts` holds the cache-read, 1-hour cache-write and output rates of every model on the Anthropic pricing page, read in September 2026. A model id takes the first family it contains, so `claude-opus-4-1` is priced as Opus 4.1 ($1.50 / $30 / $75) and `claude-opus-4-8` as Opus 4.8 ($0.50 / $10 / $25). A ping is priced in full: the cache read, its cache write, its uncached input at the base rate (half the 1-hour write rate) and its output. An unknown model shows `n/a`.

On a subscription the dollars are a yardstick, not the bill. How a cache read counts against the 5-hour and weekly limits is not documented.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install cache-warm@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/cache-warm

Two keep-warm mods in one session send two pings per idle stretch. Keep one of them enabled.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.277:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=cache-warm}, command.run{command=cache-status}, turn.step, turn.complete, session.compact
    ❯ ./register.ts calls: $.clock.after (via arm), $.clock.now, $.command.register (via registerCommands), $.model.fork (via ping), $.session.id, $.session.model, $.session.usage, $.store.delete (via prune, startWindow, stop), $.store.get (via prune, restore), $.store.keys (via prune), $.store.set (via startWindow, warmCommand), $.ui.log, $.ui.status (via arm, showStatus)

Reach L2, drives Claude.

    1. Reads:    the time of each main-loop model request; the token counts and model id of each turn and of each ping; the live context size; the resume fields Claude Code computes for settings hooks; the session id and model; its own $.store. It never reads a prompt, a file or a tool result.
    2. Runs:     one $.model.fork per idle stretch inside an armed window, 50 minutes after the last request unless the test setting is used (floor 1 minute); never outside a window, never after a ping that found the cache gone
    3. Sends:    only the fork, an API request over the session's own transcript with a fixed one-line prompt
    4. Persists: in $.store, the window end and the ping period under this session's id, and the global always switch; this session's ended window is deleted at stop and at its next start, another session's window one week after it ended; the cold-write tally lives in memory and ends with the session
    5. Hostile input: the only text it parses is the argument of /cache-warm, matched against a duration pattern and three words; the fork's prompt is a constant, so nothing crafted can reach it

## Prove it on your own session

The mock-clock tests prove the timer and the scoring, not that a fork reads the main cache. One ping proves that. In a warm session:

    > Reply with one word: ready
    > /cache-warm 1h every 1m

After a minute the status line should read `last ping read <close to your context> $...`. A `stopped: the ping read ...` line means the fork did not share the cache, and the mod has already stopped. `/cache-warm off` ends the test.

## Limits

- The 50-minute ping assumes the 1-hour cache tier, which the main conversation uses.
- A warm ping proves the cache was warm then. A model or effort switch, an edited CLAUDE.md or a changed tool list breaks the prefix regardless of time, and the next message pays.
- A ping's output cannot be capped; a model at high effort may think before it answers. The status line prices what the ping really billed.
- The test engine of `claude plugin test` cannot raise `classic.SessionStart`. The resume and `/clear` logic is covered by unit tests of the pure functions and by a live session check.
- The cold-write tally is per session and in memory. `/clear` empties it.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
