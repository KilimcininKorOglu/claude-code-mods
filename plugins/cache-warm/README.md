# cache-warm

Claude Code keeps your conversation in a prompt cache for one hour. Step away for longer, and the next message re-writes the whole context at the cache-write rate: on Claude Fable 5.1 that is $4.00 for 200k tokens, against $0.05 to read the same tokens from a warm cache. This mod keeps the cache warm for a window you choose, and shows you what a cold cache would cost.

It follows the behaviour of the cache-tax mod by Karan Bansal (karanb192/claude-code-mods), without its send guard. The code is new.

## What it does

**Keeps the cache warm.** `/cache-warm` arms a six-hour window. Inside it, 50 minutes after the main loop's last model request, the mod sends one tool-less `$.model.fork` over the session's own transcript. The server answers it from the cache, and that refreshes the hour. Every new request pushes the ping later, so a session you are actively using sends no ping at all. The first request of a session, and the first after `/clear` or a compaction, sets the ping as well, so even a tool call that runs past the hour inside the first turn gets its ping in the middle of the turn (measured on 2.1.281: the ping went out while `sleep 110` ran, and the turn ended normally).

**Runs with no end under `always`.** `/cache-warm always` is not a window: the ping goes out every 50 minutes for as long as the session lives, and only `/cache-warm off` ends it. The switch is one global key in the mod's own `$.store`, so every later session of every project starts the same loop at its start and after `/clear`.

- Each turn's end keeps the last request's time in `$.store` under the session's id, and each ping keeps its own read there too. A module loaded into a running conversation (`/reload-plugins`, an update) therefore pings on time from the later of the two; a session kept warm by pings alone has a last turn older than its cache. When both are more than an hour old, the cache is gone, and the loop waits for the next turn instead of paying for a cold ping.
- The session's transcript is not used for this, because `/reload-plugins` writes a line of its own there and the file's last write would then look like a request (measured: a reload 90 seconds after the last turn would have set the ping 90 seconds late). Only a session with no time kept yet, one that ran an older version, reads the last write of its transcript (`~/.claude/projects/<directory>/<session id>.jsonl`, under `CLAUDE_CONFIG_DIR` when it is set) once. The transcript is looked up under the directory the session started in, never the one a shell `cd` moved to, and one it cannot find is named in a transcript line.
- A ping that finds the cache gone does not end this loop. The write that ping paid for is the new cache: the mod says so in a transcript line, counts the write in the session's tally and keeps going. A warm ping reads the context at the read rate, about $0.05 for 200k tokens, so an idle day of pings costs about $1.40.

**Stops when the cache is gone.** This applies to a window with an end, not to `always`. A warm ping reads the context and writes only its own few tokens. When a ping reads nothing, or writes a tenth of what it read or more, the cache was already gone and the ping itself paid for the write, so the mod stops and shows why. It also stops when the API answers the fork with an error (the line names its status and kind), and when the fork is cut before it replies. When the engine has nothing to fork, as in a resumed process before its first reply, the window does not stop: it waits for the next reply, whose turn arms the ping again, and the line says until when the cache holds. A reply without text still read the cache, so it counts as a ping. Under `always` such a failure stops the loop for that turn only: the next turn starts it again, so the session never holds the switch while nothing runs.

**Arms itself after a paid cold write.** When a turn re-writes at least half of a context larger than 20k tokens, the mod counts that cold write and arms a six-hour window, unless a longer one is already armed. Under `always` no six-hour window is armed, because the endless loop already keeps that cache.

**Shows the state.** `/cache-status` prints the model, warm or cold, the context size, the cold price, the window, the break-even and this session's cold writes.

A message you send to a cold cache is never stopped or delayed. A resumed session whose cache has lapsed gets one line with the price of its first message. Claude Code dates the cache from the transcript's last reply, which a ping never writes, so that line is left out while the last ping the mod kept for the session read the cache within the hour.

**Sends a keep-warm message after a resume.** A resumed process cannot fork before its own first reply: `$.model.fork` answers `nothing-to-fork` (measured with a headless `claude --resume`). So no ping can go out, and a session you closed and opened again 30 minutes later would lose its cache at the hour unless you wrote something. When an interactive session is resumed while a window or `always` runs, its context is 50k tokens or more and its cache still holds, the mod therefore sends one message three seconds after the resume, through its own `/cache-warm:send` command:

    /cache-warm:send This message was sent by the cache-warm plugin, not by the person. The session was resumed, and a resumed session can keep its prompt cache warm only after a reply. Do not run a tool or continue a task. Reply with the single word: warm

This is a real turn: it reads the cache, the model answers one word, the pair stays in the conversation, and its end arms the ping again. Nothing is sent when the cache is already gone (your next message pays the same write anyway), in a `-p` run, or when you sent a message within those three seconds. Other mods see it like any other turn: `task-poke` may send its continue prompt after it while tasks are open, and `desk-notify` shows its turn-end notification. Measured on 2.1.283 in a resumed interactive session of 116k tokens: the message went out at the resume, the model answered `warm`, and the next ping forked and read 117k tokens. A resume can break part of the prefix on its own (that session re-wrote 42k of the 116k; another, resumed 40 minutes after its last ping, 4k); the keep-warm turn pays that write at the resume instead of your first message.

## Commands

    /cache-warm               keep warm for six hours
    /cache-warm 90m           keep warm for a window of your own (also 2h30m)
    /cache-warm always        keep the cache warm with no end, in every session of every project
    /cache-warm 6h every 2m   ping every two minutes; a test setting, floor 1m, forgotten after this window
    /cache-warm status        the status line text
    /cache-warm off           stop, forget the window, and turn always off
    /cache-status             the card
    /cache-warm:send <text>   the keep-warm message the mod sends after a resume; its body is the text alone

## What it shows

**A status line under the prompt** while a window is armed or after a stop:

    cache-warm: 5h 10m left · ping in 37m · last ping read 200k $0.05 (05:42)
    cache-warm: stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone

The `last` part names the last request that read the cache, a ping or a main-loop turn, whichever came later: `last ping read 200k $0.05` or `last turn read 250k $0.07`, never both. A turn's figures cover the whole turn, every request summed. The time in brackets is when that answer came, in local time; one from an earlier day carries its day and month, as `(22 Sep 23:10)`. The record is kept in `$.store` under the session's id, so `/reload-plugins` or an update shows it again at once.

While a window runs, an interactive session redraws the line every minute, so the time left and the time to the next ping count down between turns and pings, and the `last` part stays on the line. The last minute before a ping reads `ping now`, because minutes are rounded and the line is drawn once a minute; while the ping's fork is out it reads `pinging…`. When the engine has nothing to fork, the line says so instead of counting down:

    cache-warm: always · no ping before the next reply · cache holds until 19:16

**One stream entry per ping attempt** while the sidebar is open. It is also kept in the sidebar's log file (`~/.claude/sidebar/<project>-<date>.log`), so you can read back later whether a ping went out and what it did; with the sidebar closed the same text is a transcript line:

    ping sent · read 901k · wrote 0 · $0.45
    ping found the cache gone · read 0 · wrote 180k · $3.60
    ping not sent: the conversation has no reply to fork yet; the ping waits for the next reply, and the cache holds until 19:16
    ping failed: the ping failed, the API answered 529 (overloaded)
    keep-warm message sent: the session was resumed and its cache holds until 19:16; a resumed session pings only after a reply

With the [sidebar](../sidebar) open, the status line moves there as a `cache window` section that stays for the session and is rewritten at every change, and the status line stays clear. Only the time left (or `always`) is coloured: yellow when the window ends sooner than one ping period, green while it holds, faint while it waits for the first turn. The ping details after it are faint, and a stopped window shows its `stopped:` front in red with the reason in the default colour. Without the sidebar, the status line is drawn as above.

A stop reason stays for one turn. At the next turn the section shows the idle line instead: faint, except for a paid `N cold writes paid $X`, which is yellow. That way the pane shows a measurement of now, not the last sentence of a window that ended. The reason stays in the transcript, and the status line is empty while no window runs:

    cache window
    off · 2 cold writes paid $6.30 · context 315k tokens

A window that runs out of time is armed again by your next message, as long as the one that ended and with the same ping period, and the idle line says so while it waits:

    cache window
    off · 6h again at your next message · 1 cold write paid $4.01 · context 201k tokens

    cache-warm: the 6h window ran out; this message arms another one. /cache-warm off stops it.

Only a window that ran out of time comes back. One that a ping stopped does not: the cache is already gone there, and the cold write of your next message arms its own 6h window. `/cache-warm off` forgets a window waiting to come back.

Under the window the section holds a second, faint line: the last transcript line, shortened, with the cost of a cold write in yellow. The window line says how long the cache is kept; the second line says what the mod did last:

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

**One transcript line**, not sent to the model, when a cold write arms the window or a resume starts cold.

## Prices

The table in `hooks/pricing.ts` holds the cache-read, 1-hour cache-write and output rates of every model on the Anthropic pricing page, read in September 2026. A model id takes the first family it contains, so `claude-opus-4-1` is priced as Opus 4.1 ($1.50 / $30 / $75) and `claude-opus-4-8` as Opus 4.8 ($0.50 / $10 / $25). `claude-opus-5-5` also contains `opus-5`, so its own row comes first: Opus 5.5 is $0.20 / $8 / $20, cheaper than Opus 5. A ping is priced in full: the cache read, its cache write, its uncached input at the base rate (half the 1-hour write rate) and its output. An unknown model shows `n/a`.

Fast mode bills Opus 5.5, Opus 5 and Opus 4.8 at their own base rates ($8 and $10 input), with the cache multipliers applied on top. The mod prices Opus 5.5 at $0.40 / $16 / $40 and Opus 5 and 4.8 at $1 / $20 / $50 while the `fastMode` setting, which `/fast` writes, is on. It reads the settings at the session's start and at the end of each main-loop turn, so a `/fast` counts from the next turn. With `fastModePerSessionOptIn` set to `true`, every session starts with fast mode off, so the standard rates apply. Any other model keeps its standard rates, and the card mentions fast mode only when the rates changed:

    claude-opus-5-5 · fast mode rates (the fastMode setting)

On a subscription the dollars are a yardstick, not your bill. How a cache read counts against the 5-hour and weekly limits is not documented.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install cache-warm@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

To load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/cache-warm

To keep the flag on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Disable every other keep-warm mod, for example `claude plugin disable cache-tax@claude-code-mods`. Two keep-warm mods in one session send two pings per idle stretch.
3. Check once that a ping reads your cache, as "Prove it on your own session" below describes.
4. To keep the cache warm with no end, run `/cache-warm always` once. The switch is global: every later session of every project starts the loop by itself, and `/cache-warm off` ends it for good. Without it, a window is armed only by `/cache-warm` or after a paid cold write.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, prompt.submit, command.run{command=cache-warm}, command.run{command=cache-status}, turn.step, turn.complete, session.compact
    ❯ ./register.ts calls: $.clock.after, $.clock.every, $.clock.now, $.command.register (via registerCommands), $.command.run (via keepWarmAfterResume), $.env.get (via seedFromTranscript), $.fs.exists (via seedFromTranscript), $.fs.stat (via seedFromTranscript), $.model.fork (via forkPing), $.prompt.submit (via keepWarmAfterResume), $.session.id, $.session.model, $.session.root (via seedFromTranscript), $.session.usage, $.settings.read (via readFast), $.sidebar.set (via toSidebar, toStream), $.store.delete (via prune, pruneRequests, startEndless, startWindow, stop), $.store.get, $.store.keys (via prune, pruneRequests), $.store.set (via afterTurn, keepLastRead, startWindow, warmCommand), $.ui.log (via logEvent, seedFromTranscript, toStream), $.ui.status (via showStatusAt)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2: it drives Claude.

    1. Reads:    the time of each main-loop model request; the token counts and model id of each turn and of each ping; the live context size; the origin of each message, to arm a window again; the resume fields Claude Code computes for settings hooks; the session id and model; the last write time of the session's own transcript file, once when the module loads into a running conversation; the fastMode and fastModePerSessionOptIn settings, at the session's start and at each turn's end; its own $.store. It never reads a prompt's text, a file's content or a tool result.
    2. Runs:     one $.model.fork per idle stretch while a window or the always loop runs, 50 minutes after the last request unless the test setting is used (floor 1 minute); never while off; a ping that found the cache gone ends a window with an end, and under always the loop carries on; after a resume of an interactive session whose cache still holds, one keep-warm message through /cache-warm:send (a plugin prompt when the engine refuses the command), which is a real turn
    3. Sends:    the fork, an API request over the session's own transcript with a fixed one-line prompt, and after a resume the fixed keep-warm message as a turn of the conversation
    4. Persists: in $.store, the window end, the ping period and the last main-loop request's time and the last ping or turn read (tokens, cost, time) under this session's id, and the global always switch, which the endless loop needs no window key beside; this session's ended window is deleted at stop and at its next start, another session's window one week after it ended, another session's request time and last read once they are an hour old; the cold-write tally lives in memory and ends with the session
    5. Hostile input: the only text it parses is the argument of /cache-warm, matched against a duration pattern and three words; the fork's prompt is a constant, so nothing crafted can reach it

## Prove it on your own session

The mock-clock tests prove the timer and the scoring, not that a fork reads the main cache. One ping proves that. In a warm session:

    > Reply with one word: ready
    > /cache-warm 1h every 1m

After a minute the status line should read `last ping read <close to your context> $...`. A `stopped: the ping read ...` line means the fork did not share the cache, and the mod has already stopped. `/cache-warm off` ends the test.

## Limits

- The 50-minute ping assumes the 1-hour cache tier, which the main conversation uses.
- A warm ping only proves the cache was warm at that moment. A model or effort switch, an edited CLAUDE.md or a changed tool list breaks the prefix no matter the time, and your next message pays.
- A ping's output cannot be capped; a model at high effort may think before it answers. The status line prices what the ping really billed.
- The resume logic is covered by hook tests that raise `classic.SessionStart` with the resume fields, and by a live check of a resumed interactive session in tmux. Whether a resume keeps the whole prefix is out of the mod's hands: it re-wrote 42k of 116k tokens in one measured session and 4k in another.
- The cold-write tally is per session and lives in memory. `/clear` empties it.
- Fast mode is read from the `fastMode` setting, the saved preference, not from the request. The mod does not see Claude Code fall back to standard speed within a session (a fast mode rate-limit cooldown, usage credits that ran out, an organization that turned fast mode off). Those turns bill standard rates while the mod prices them as fast.
- Whether a ping, a `$.model.fork`, runs at fast speed while the session does has not been measured; the mod prices it at the session's rates.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
