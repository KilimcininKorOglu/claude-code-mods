# limit-watch

A Claude Code Mod that keeps the subscription usage limits on screen. A Claude subscription has a 5-hour limit and a 7-day limit, and a Claude gateway can add a spend limit. Claude Code shows them only in a notice when a limit is almost full. limit-watch shows them for the whole session, counts down to each reset, forecasts when the current pace fills a limit, and logs a warning when a limit passes 80% and 95%.

## What it shows

**A status line under the prompt**, updated after every turn and every 60 seconds:

    limit-watch: 5h 9%, reset in 2h 36m · 7d 15%, reset in 5d 10h · measuring the pace

The last part is one of these:

- `5h hits 100% in ~1h 40m`: at the current pace this limit fills before its reset. When more than one limit fills, the first one is named.
- `no limit fills before its reset`: every limit resets before the current pace fills it.
- `measuring the pace`: no limit has samples over a long enough span yet.
- `5h limit reached`: a limit is at 100%.

An API key session reports no limits. The status line then reads `no usage limits reported yet`. A new session also shows this until Claude answers once.

**A section in the [sidebar](../sidebar)** instead of that status line while the sidebar is open: the same parts, one line per limit (green under 80%, yellow from 80%, red from 95%, the same steps as the pane's bar) and the pace line under them, itself red when a limit is already reached, yellow when one fills before its reset, green when none does and faint while the pace is still measured. The status line is cleared then. With the sidebar closed, or without that mod installed, the status line stays as above.

**A pane, opened and closed with `/limit-watch`**, with one block per limit:

    5-hour limit · 9% used
    ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    resets 22:40, in 2h 36m
    pace +4.2%/h over the last 38m

The bar fills the width of the pane. It is green below 80%, yellow from 80% and red from 95%. While the pace is measured, the pace line says how much more sampling it needs.

**A warning in the transcript** when a limit passes 80% and again when it passes 95%:

    limit-watch: 5-hour limit passed 80% (now 82%), resets 22:40 (in 1h 5m)

Each warning comes once per limit cycle. A new session in the same cycle does not repeat it, and neither does a second session open at the same time: each sample reads the warned levels from the store again before it warns. Two sessions that sample in the same instant can still both warn. After the limit resets, the warnings come again.

## How the numbers are made

- `$.session.usage()` gives each limit as `{ kind, percentUsed, resetsAt }`, read from the last API response. limit-watch reads it at session start, after every main-loop turn, every 60 seconds in an interactive session, and when `/limit-watch` opens the pane. A read that fails at session start or on the timer is logged once as `cannot read the usage limits: <error>`, and the 60 second timer keeps running.
- Every reading is one sample `{ at, percent }`, kept in `$.store` so that a restart keeps the pace.
- The 5-hour and spend limits read the pace from their samples: the change in percent between the first and the last sample of a recent span, per hour. The span is the last hour for the 5-hour limit and the last 24 hours for the spend limit, so the pace follows how you work now. A pace is shown only when its samples span at least 10 minutes (5-hour limit) or 2 hours (spend limit). A shorter span gives a pace that one step of the percentage can double.
- The 7-day limit reads the pace as the average of its whole cycle so far: the percentage divided by the time since the cycle began, `resetsAt` minus 7 days. Nights and idle hours are part of that time, and so is the time no session ran, so the pace needs no samples. It is shown from the cycle's second day on. Measured before this rule: 4% after 2.4 busy hours read as `7d hits 100% in ~2d 8h`, because the pace of those hours was stretched over two days without a break; the cycle average of the same reading fills the limit in about 6 days.
- The status line tail uses `(100 - percent) / pace` as the time to 100%. A limit that resets before that time does not count as filling.
- A new cycle starts when `resetsAt` moves by more than 5 minutes, or, for a limit without `resetsAt`, when the percentage falls by more than half a point. A new cycle clears the samples and the warnings of that limit.
- A stored value of an unknown shape is reported with one log line, and the samples start over.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install limit-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/limit-watch

To keep the flag on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Sign in with a Claude subscription (`/login`). A session on an API key reports no limits, and the status line stays at `no usage limits reported yet`.
3. Send one prompt. The limits come from the last API response, so the status line fills after the first answer. Open the pane with `/limit-watch`.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.281:

    ❯ ./register.tsx hooks: session.start, turn.complete, command.run{command=limit-watch}, ui.render{component=Pane}
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.session.usage (via sample), $.sidebar.set (via toSidebar), $.store.get, $.store.set (via sample), $.ui.close, $.ui.invalidate (via sample), $.ui.log, $.ui.open, $.ui.panes, $.ui.resolve, $.ui.status (via sample)

Reach L0, draws and remembers.

    1. Reads:    the rate-limit windows of $.session.usage (kind, percent used, reset time); the event payloads of its four hooks
    2. Runs:     nothing; one 60 second timer in an interactive session
    3. Sends:    nothing leaves the machine
    4. Persists: the samples and the warned levels of each limit in $.store, at most 1500 samples per limit
    5. Hostile input: the only outside input is the usage figures; a stored value of an unknown shape is reported and replaced, never trusted

## Limits

- A new session has no reading until Claude answers once, because the figures come from the last API response.
- The 7-day limit shows no pace in the first 24 hours of its cycle.
- The 7-day pace assumes the cycle began exactly 7 days before `resetsAt`.
- A spend limit can pass 100%. The bar stops at full; the percentage does not.
- `/limit-watch` toggles one pane. The second run closes it.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
