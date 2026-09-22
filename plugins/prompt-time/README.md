# prompt-time

A Claude Code Mod that draws a time in a dim line under each of your messages and under each text block of the model's replies in the transcript. A resumed session shows the times of its old messages too, when its transcript file is 4 MiB or smaller.

## What it shows

A message or reply block from today shows the time alone. An older one shows the date too, in the local time zone:

    ❯ Say one word, then run date, then say one more word.
    22:24
    ⏺ Start.
    22:24
    ⏺ Bash(date)
      ⎿  Fri Sep 18 22:24:28 +03 2026
    ⏺ Done.
    22:24

    ❯ Summarize the log.
    17.09.2026 21:58

The line is display only. The stored message does not change, and nothing reaches the model, so the mod costs no tokens and does not touch the prompt cache.

## How it knows the time

- **Your message.** `prompt.submit` records the clock and the text of the prompt. The next new `UserMessage` row with the same text takes that time.
- **A reply block.** A new `AssistantMessage` block first drawn while a turn runs (between `turn.start` and `turn.complete`) takes the time of that draw. In a live check the draw came within 0.1 seconds of the timestamp the transcript stores for the block.
- **A resumed session.** At startup, resume and fork, `classic.SessionStart` reads the session transcript and maps the `uuid` of every user and assistant row to its `timestamp`. The engine's `requestId` for these rows is the same `uuid` (measured on 2.1.277). The rows drawn before the read are drawn again with `$.ui.invalidate`. A transcript over 4 MiB is not read, because `$.fs.read` refuses a file over 4 MiB and has no ranged read; the mod checks the size with `$.fs.stat` first and writes one line to the debug log. The rows of that session keep no time, also when a turn redraws them (a resize redraws every row), and new messages get their time as usual. A block of that session first drawn during a turn, as a fullscreen scroll draws it, still takes the turn's time: no prop and no `$.session.messages()` row ties a block to its turn.

`/clear` forgets the known times, because the cleared messages leave the screen.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-time@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/prompt-time

To keep the flag on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

Restart Claude Code. The mod reads the transcript at session start, so a session open during the install shows no time under its earlier messages.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.tsx hooks: classic.SessionStart, prompt.submit, turn.start, turn.complete, ui.render{component=UserMessage}, ui.render{component=AssistantMessage}
    ❯ ./register.tsx calls: $.clock.now, $.fs.exists (via loadTranscript), $.fs.read (via loadTranscript), $.fs.stat (via loadTranscript), $.ui.invalidate (via loadTranscript), $.ui.log (via loadTranscript), $.ui.resolve (via stamped)

Reach L1, reads the transcript.

    1. Reads:    the size of the session's own transcript file, then the file once at startup, resume and fork when it is 4 MiB or smaller, and only the type, uuid and timestamp of its rows; the text of each submitted prompt and of each drawn user row, to match the two; the clock
    2. Runs:     nothing; no process, no fork, no timer
    3. Sends:    nothing; no network call and nothing to the model
    4. Persists: nothing; the times live in memory and end with the session
    5. Hostile input: a transcript line that is not JSON is counted and skipped, a row without a string uuid or a parseable timestamp is skipped; the drawn label is built from numbers only

## Limits

- A resumed session whose transcript is over 4 MiB shows no time under its earlier messages. A transcript row holds its timestamp, but `$.fs.read` refuses the whole file, and `$.session.messages()` answers no timestamp. Of the transcripts checked in `~/.claude/projects`, 78 were over 4 MiB.
- A mod loaded in the middle of a session shows no time under the messages that were already on the screen, because it reads the transcript only at session start.
- A user row takes the prompt's time by matching text. The engine draws a new prompt twice, first as `placeholder` and then under its stored id, so every new row with the prompt's text takes the time until the next prompt. A notification row with a different text does not.
- A reply block takes its time when it is first drawn during a turn. The engine can draw the last block of a turn for the first time a few milliseconds after `turn.complete` (seen on 2.1.277), so the first new block whose text equals the turn's final text takes the time the turn ended. Any other block first drawn after its turn has ended shows no time until the session is resumed.
- A thinking block shows no time. Claude Code 2.1.277 has no `ui.render` site for thinking, only for the text blocks of a reply (`AssistantMessage`).
- The time is the local time of the machine that runs Claude Code.
- The test engine of `claude plugin test` cannot raise `classic.SessionStart`. The transcript read is covered by unit tests of `indexTranscript` and by a live resume check.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
