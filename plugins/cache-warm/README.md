# cache-warm

A Claude Code Mod that keeps the 1-hour prompt cache of a session warm for a window you set, and shows what a cold cache would cost. A message sent after the cache has lapsed re-writes the whole context at the cache-write rate; on Claude Fable 5.1 that is $4.00 for 200k tokens, against $0.05 to read the same tokens from a warm cache.

The behavior follows the cache-tax mod by Karan Bansal (karanb192/claude-code-mods), without its send guard. The code is new.

## What it does

**Keeps the cache warm.** `/cache-warm` arms a six-hour window. Inside the window, 50 minutes after the last model request of the main loop, the mod sends one tool-less `$.model.fork` over the session's own transcript. The server answers it from the cache, which refreshes the hour. Every new request moves the ping later, so an active session sends no ping at all. The first request of a session, and the first after `/clear` or a compaction, sets the ping too, so one tool call that runs past the hour inside the first turn still gets its ping in the middle of the turn (measured on 2.1.281: the ping went out while `sleep 110` ran, and the turn ended normally).

**Runs with no end under `always`.** `/cache-warm always` is not a window: the ping goes out every 50 minutes for as long as the session lives, and `/cache-warm off` is the only thing that ends it. The switch is one global key in the mod's own `$.store`, so every later session of every project starts the same loop at its start and after `/clear`. A module loaded into a running conversation (`/reload-plugins`, an update) reads the last request's time from the last write of the session's transcript (`~/.claude/projects/<directory>/<session id>.jsonl`, under `CLAUDE_CONFIG_DIR` when it is set) and pings on time; when that write is over an hour old, the cache is gone and the loop waits for the next turn instead of paying a cold ping. A ping that finds the cache gone does not end this loop: the write that ping paid for is the new cache, the mod says so in one transcript line, counts the write in the session's tally and keeps going. A warm ping reads the context at the read rate, about $0.05 for 200k tokens, so an idle day of pings costs about $1.40.

**Stops when the cache is gone.** This holds for a window with an end, not for `always`. A warm ping reads the context and writes only its own few tokens. When a ping reads nothing, or writes a tenth of what it read or more, the cache was already gone and the ping itself paid the write. The mod then stops and shows why. It also stops when the engine has nothing to fork yet, when the API answers the fork with an error (the line names its status and kind), and when the fork is cut before its reply. A reply that carries no text still read the cache, so it counts as a ping. Under `always` such a failure stops the loop for that turn alone: the next turn starts it again, so the session never holds the switch while running nothing.

**Arms itself after a paid cold write.** When a turn re-writes at least half of a context larger than 20k tokens, the mod counts that cold write and arms a six-hour window, unless a longer window is already armed. Under `always` no six-hour window is armed at all, because the endless loop already keeps that cache.

**Shows the state.** `/cache-status` prints the model, warm or cold, the context size, the cold price, the window, the break-even and this session's cold writes.

A message sent to a cold cache is not stopped or delayed. A resumed session whose cache has lapsed gets one line with the price of its first message.

## Commands

    /cache-warm               keep warm for six hours
    /cache-warm 90m           keep warm for a window of your own (also 2h30m)
    /cache-warm always        keep the cache warm with no end, in every session of every project
    /cache-warm 6h every 2m   ping every two minutes; a test setting, floor 1m, forgotten after this window
    /cache-warm status        the status line text
    /cache-warm off           stop, forget the window, and turn always off
    /cache-status             the card

## What it shows

**A status line under the prompt** while a window is armed or after a stop:

    cache-warm: 5h 10m left · ping in 37m · last ping read 200k $0.05 (05:42)
    cache-warm: stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone

The time in brackets is when the last ping's answer came, in local time; a ping of an earlier day carries its day and month, as `(22 Sep 23:10)`.

While the [sidebar](../sidebar) is open, that line goes there instead, as a `cache window` section that stays for the session and is rewritten at each change, and the status line stays clear. There the line is coloured: a stopped window red, a window whose end is nearer than one ping period yellow, a window that holds green, and the wait for the first turn faint. With the sidebar closed, or without that mod installed, the status line is drawn as above.

A stop reason stands for one turn. At the next turn the section carries the idle line instead, faint, so the pane holds a measurement of now and not one sentence of the window that ended. The reason stays in the transcript, and the status line is empty while no window runs:

    cache window
    off · 2 cold writes paid $6.30 · context 315k tokens

A window that runs out of time is armed again by your next message, as long as the one that ended and with the same ping period, and the idle line says so while it waits:

    cache window
    off · 6h again at your next message · 1 cold write paid $4.01 · context 201k tokens

    cache-warm: the 6h window ran out; this message arms another one. /cache-warm off stops it.

Only a window that ran out of time comes back. A window a ping stopped does not: the cache is already gone there, and the cold write of your next message arms its own 6h window. `/cache-warm off` forgets a window waiting to come back.

The section holds a second, faint line under the window: the last transcript line, shortened. The window line says how long the cache is kept, the second line says what the mod last did:

    cache window
    6h left · ping in 50m
    cold write 201k tokens paid ($4.01)

**The card** of `/cache-status`:

    claude-fable-5-1
    state       warm, 42m left
    context     200,502 tokens
    cold cost   $4.01 to re-write it (warm turn $0.05)
    keep warm   on, 5h 10m left · ping in 37m · last ping read 200k $0.05 (05:42)
    break-even  up to 80 pings at the read rate cost one cold write, about 2d 18h of idle at one ping per 50m
    session     1 cold write paid, $4.01

**One line in the transcript**, not sent to the model, when a cold write arms the window or a resume starts cold.

## Prices

The table in `hooks/pricing.ts` holds the cache-read, 1-hour cache-write and output rates of every model on the Anthropic pricing page, read in September 2026. A model id takes the first family it contains, so `claude-opus-4-1` is priced as Opus 4.1 ($1.50 / $30 / $75) and `claude-opus-4-8` as Opus 4.8 ($0.50 / $10 / $25). `claude-opus-5-5` also contains `opus-5`, so its own row comes first: Opus 5.5 is $0.20 / $8 / $20, below Opus 5. A ping is priced in full: the cache read, its cache write, its uncached input at the base rate (half the 1-hour write rate) and its output. An unknown model shows `n/a`.

Fast mode bills Opus 5.5, Opus 5 and Opus 4.8 at their own base rates ($8 and $10 input), and the cache multipliers apply on top of them. The mod prices Opus 5.5 at $0.40 / $16 / $40 and Opus 5 and 4.8 at $1 / $20 / $50 while the `fastMode` setting is on, which `/fast` writes. It reads the settings at the session's start and at the end of each main-loop turn, so a `/fast` counts from the next turn. A `fastModePerSessionOptIn` of `true` starts every session with fast mode off, so the standard rates stay then. Any other model keeps its standard rates, and the card names fast mode only when the rates changed:

    claude-opus-5-5 · fast mode rates (the fastMode setting)

On a subscription the dollars are a yardstick, not the bill. How a cache read counts against the 5-hour and weekly limits is not documented.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install cache-warm@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/cache-warm

To keep the flag on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Disable every other keep-warm mod, for example `claude plugin disable cache-tax@claude-code-mods`. Two keep-warm mods in one session send two pings per idle stretch.
3. Check once that a ping reads your cache, as "Prove it on your own session" below says.
4. To keep the cache warm with no end, run `/cache-warm always` once. The switch is global: every later session of every project starts the loop by itself, and `/cache-warm off` ends it for good. Without it, a window is armed only by `/cache-warm` or after a paid cold write.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.281:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, prompt.submit, command.run{command=cache-warm}, command.run{command=cache-status}, turn.step, turn.complete, session.compact
    ❯ ./register.ts calls: $.clock.after (via arm), $.clock.now, $.command.register (via registerCommands), $.env.get (via seedFromTranscript), $.fs.exists (via seedFromTranscript), $.fs.stat (via seedFromTranscript), $.model.fork (via ping), $.session.id, $.session.model, $.session.usage, $.settings.read (via readFast), $.sidebar.set (via toSidebar), $.store.delete (via prune, startEndless, startWindow, stop), $.store.get (via prune, restore), $.store.keys (via prune), $.store.set (via startWindow, warmCommand), $.ui.log (via logEvent, seedFromTranscript), $.ui.status (via showStatusAt)
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2, drives Claude.

    1. Reads:    the time of each main-loop model request; the token counts and model id of each turn and of each ping; the live context size; the origin of each message, to arm a window again; the resume fields Claude Code computes for settings hooks; the session id and model; the last write time of the session's own transcript file, once when the module loads into a running conversation; the fastMode and fastModePerSessionOptIn settings, at the session's start and at each turn's end; its own $.store. It never reads a prompt's text, a file's content or a tool result.
    2. Runs:     one $.model.fork per idle stretch while a window or the always loop runs, 50 minutes after the last request unless the test setting is used (floor 1 minute); never while off; a ping that found the cache gone ends a window with an end, and under always the loop carries on
    3. Sends:    only the fork, an API request over the session's own transcript with a fixed one-line prompt
    4. Persists: in $.store, the window end and the ping period under this session's id, and the global always switch, which the endless loop needs no window key beside; this session's ended window is deleted at stop and at its next start, another session's window one week after it ended; the cold-write tally lives in memory and ends with the session
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
- Fast mode is read from the `fastMode` setting, the saved preference, not from the request. The mod does not see Claude Code fall back to standard speed within a session: a fast mode rate-limit cooldown, usage credits that ran out, or an organization that turned fast mode off. Those turns bill standard rates while the mod prices them fast.
- Whether a ping, a `$.model.fork`, runs at fast speed while the session does is not measured; the mod prices it at the session's rates.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
