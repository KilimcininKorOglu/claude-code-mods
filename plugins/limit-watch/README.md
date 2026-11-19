# limit-watch

A Claude subscription has a 5-hour limit, a 7-day limit and per-model weekly limits such as Fable's, and a Claude gateway can add a spend limit. Claude Code shows them only in a notice when a limit is almost full, so you learn where you stand when it is already late. This mod keeps them on screen for the whole session, counts down to each reset, forecasts when the current pace fills a limit, gives the model a tool that reads them, and logs a warning when a limit passes 80% and 95%. `/limit-watch off` stops all of it until `/limit-watch on` starts it again.

## What it shows

**A status line under the prompt**, updated after every turn and every 60 seconds:

    limit-watch: 5h 9%, reset in 2h 36m · 7d 15%, reset in 5d 10h · measuring the pace

The last part is one of these:

- `5h hits 100% in ~1h 40m`: at the current pace this limit fills before its reset. When more than one limit fills, the first one is named.
- `no limit fills before its reset`: every limit resets before the current pace fills it, or its pace is flat.
- `measuring the pace`: no limit has a long enough span yet.
- `5h limit reached`: a limit is at 100%.

A per-model weekly limit comes after the 7-day limit, named after its model: `7d Fable 25%, reset in 6d 9h`. It is paced like the 7-day limit.

An API key session reports no limits. The status line then reads `no usage limits reported yet`. A new session also shows this until Claude answers once.

**A section in the [sidebar](../sidebar)** instead of that status line while the sidebar is open: the same parts, one line per limit, with only the percentage coloured (green under 80%, yellow from 80%, red from 95%, the same steps as the pane's bar) and the reset countdown faint, and the pace line under them: `limit reached` red, the `~<time>` of `hits 100% in` yellow, the whole line green when no limit fills and faint while the pace is still measured. The status line is cleared then. With the sidebar closed, or without that mod installed, the status line stays as above.

**A pane, opened and closed with `/limit-watch`**, with one block per limit:

    5-hour limit · 9% used
    ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    resets 22:40, in 2h 36m
    pace +4.2%/h over the last 38m

The bar fills the width of the pane. It is green below 80%, yellow from 80% and red from 95%. While the pace is measured, the pace line says how much more sampling it needs.

**`/limit-watch on` and `/limit-watch off`** stop and start the whole watcher. While it is off nothing is sampled: no status line, no sidebar section, no pane and no warnings, and an open pane and the standing section are dropped. The setting lives in the store every window shares, so an `off` in one window also stops the others at their next hook that acts on it, and it survives a restart. While the watcher is off, a bare `/limit-watch` answers `off.` instead of opening the pane.

**A tool the model reads, `mcp__limit-watch__limits`**, listed from the session's start without ToolSearch and run without an approval prompt, because it only reads. Each call samples the limits again, so the model gets them as they stand at that moment, and answers one line per limit:

    Usage limits at 20:04 local time:
    - 5-hour limit: 41% used, resets 22:40 (in 2h 36m), pace +4.2%/h over the last 38m, reaches 100% at 10:05 (in ~14h) at this pace

Its description tells the model to call it before long or costly work, or when you ask about the limits. While the watcher is off, the tool reads nothing and says so.

**A warning in the transcript** when a limit passes 80% and again when it passes 95%:

    limit-watch: 5-hour limit passed 80% (now 82%), resets 22:40 (in 1h 5m)

Each warning comes once per limit cycle. A new session in the same cycle does not repeat it, and neither does a second session open at the same time: each sample reads the warned levels from the store again before it warns. Two sessions that sample in the same instant can still both warn. After the limit resets, the warnings come again.

**A note to the model** when a limit passes 80%, 90% and 95%, so the model learns about it in the middle of its work:

    limit-watch: the account's 5-hour limit passed 90% (now 91%), resets 22:40 (in 1h 5m). Tell the user, and read the limits with mcp__limit-watch__limits before you start new long or costly work.

The note comes with the next tool result of the main loop, or with the next prompt when no tool runs first. A jump past more than one level tells only the highest one. Each level is told once per limit cycle in each session, because each session's model needs its own note; the warning another session stored does not hold it back. A subagent's tool result does not take the note. The note informs the model and stops nothing.

## How the numbers are made

- `$.session.usage()` gives each limit as `{ kind, percentUsed, resetsAt }`, read from the last API response. limit-watch reads it at session start, after every main-loop turn, every 60 seconds in an interactive session, and when `/limit-watch` opens the pane. A read that fails at session start or on the timer is logged once as `cannot read the usage limits: <error>`, and the 60 second timer keeps running.
- `$.session.usage()` does not report the per-model weekly limits. limit-watch reads them from the account's usage endpoint, `GET https://api.anthropic.com/api/oauth/usage`: each `limits[]` entry of kind `weekly_scoped` with a model name. The mod asks `$.session.authorize()` for a handle and passes it to `$.http.fetch`; the engine sets the credential header itself, so the mod never sees the token. The account reads the endpoint at most every 5 minutes over all its sessions: the time and the result of the last read live in `$.store`, so a second session, a reload and a tool call within those 5 minutes show the stored reading and send nothing. A read goes at session start, after a main-loop turn, when `/limit-watch` opens the pane, and on a tool call. The 60 second timer never reads it, so an idle session sends nothing. A session with no first-party sign-in (an API key, a gateway, a third-party provider) sends no request. An HTTP 429 keeps the last reading and stores the wait the endpoint asks for in `Retry-After` (15 minutes when it names none, at least 1 minute and at most 6 hours); no session reads again before it ends. It is logged once as `cannot read the per-model limits: HTTP 429; the reading of 21:10 stays, and the next read is at 21:40`, and the tool's answer names the time of the kept reading. Any other failed read is logged once as `cannot read the per-model limits: <error>` and drops the per-model limits, so an old reading is not shown as the current one; the other limits stay.
- Every reading is one sample `{ at, percent }`, kept in `$.store` so that a restart keeps the pace.
- The 5-hour and spend limits read the pace from their samples: the slope of a least-squares line through every sample of a recent span, in percent per hour. Every sample weighs in, so one step of the whole-number percentage at either end does not set the pace alone. The span is the last hour for the 5-hour limit and the last 24 hours for the spend limit, so the pace follows how you work now. A pace is shown only when its samples span at least 10 minutes (5-hour limit) or 2 hours (spend limit). A shorter span gives a pace that one step of the percentage can double.
- The 7-day limit and each per-model weekly limit read the pace as the average of its whole cycle so far: the percentage divided by the time since the cycle began, `resetsAt` minus 7 days. Nights and idle hours are part of that time, and so is the time no session ran, so the pace needs no samples. It is shown from the cycle's second day on. Measured before this rule: 4% after 2.4 busy hours read as `7d hits 100% in ~2d 8h`, because the pace of those hours was stretched over two days without a break; the cycle average of the same reading fills the limit in about 6 days.
- The status line tail uses `(100 - percent) / pace` as the time to 100%. A limit that resets before that time does not count as filling.
- A new cycle starts when `resetsAt` moves by more than 5 minutes, or, for a limit without `resetsAt`, when the percentage falls by more than half a point. A new cycle clears the samples and the warnings of that limit.
- A stored value of an unknown shape is reported with one log line, and the samples start over.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install limit-watch@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

Load it from a local checkout for one session:

    claude --plugin-dir plugins/limit-watch

## After installing

1. Restart Claude Code.
2. Sign in with a Claude subscription (`/login`). A session on an API key reports no limits, and the status line stays at `no usage limits reported yet`.
3. Send one prompt. The limits come from the last API response, so the status line fills after the first answer. Open the pane with `/limit-watch`.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.325:

    ❯ ./register.tsx hooks: session.start, turn.complete, tool.describe{tool=/"^mcp__limit-watch__limits$"/}, tool.check{tool=/"^mcp__limit-watch__limits$"/}, tool.call{tool=/"^mcp__limit-watch__limits$"/}, tool.call, prompt.submit, command.run{command=limit-watch}, ui.render{component=Pane} (default matcher key: plugin)
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.http.fetch (via fetchScoped), $.session.authorize (via fetchScoped), $.session.usage (via sample), $.sidebar.clear (via clearDrawings), $.sidebar.set (via toSidebar), $.store.get, $.store.set (via runCommand, sample), $.tool.register, $.ui.close (via clearDrawings, runCommand), $.ui.invalidate (via sample), $.ui.log, $.ui.open (via runCommand), $.ui.panes (via clearDrawings, runCommand), $.ui.resolve, $.ui.status (via clearDrawings, sample)

Reach L3, network.

    1. Reads:    the rate-limit windows of $.session.usage (kind, percent used, reset time); the per-model weekly limits of the account's usage endpoint; the event payloads of its nine hooks
    2. Runs:     nothing; one 60 second timer in an interactive session
    3. Sends:    one GET to https://api.anthropic.com/api/oauth/usage at most every 5 minutes over all the account's sessions while one works, none during a 429 wait; the engine adds the session's credential, which the mod never sees; the reading goes into the model's context when the model calls mcp__limit-watch__limits, and a note naming the passed level goes into it with the next tool result or prompt of the main loop
    4. Persists: the samples and the warned levels of each limit in $.store, at most 1500 samples per limit, the last read of the usage endpoint with its time and any 429 wait, and the stored on/off setting
    5. Hostile input: the usage figures and the endpoint's JSON; an answer of an unknown shape and a stored value of an unknown shape are reported, never trusted

## Limits

- A new session has no reading until Claude answers once, because the figures come from the last API response.
- The 7-day limit shows no pace in the first 24 hours of its cycle.
- The 7-day pace assumes the cycle began exactly 7 days before `resetsAt`.
- The usage endpoint is not a documented API. When its answer changes shape, the per-model limits disappear with one log line, and the other limits stay.
- An idle session shows the per-model limit of its last read until it works again.
- A spend limit can pass 100%. The bar stops at full; the percentage does not.
- `/limit-watch` toggles one pane. The second run closes it. While the watcher is off, the bare command opens nothing; `/limit-watch on` starts the sampling again.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make validate
    make test        # claude plugin test
