# desk-notify

You leave a session working in one window and switch to another. Meanwhile the model asks you a question, waits for your plan approval, or finishes its turn, and nothing tells you. This mod sends a desktop notification at those moments, so a session never waits unseen.

## What it does

1. When the model calls `AskUserQuestion`, it sends `Question awaiting your answer`, before the question starts waiting on you.
2. When the model calls `ExitPlanMode`, it sends `Plan awaiting your approval`, before the approval starts waiting on you.
3. When a main-loop turn ends (`Stop`), it sends `Turn finished`. A subagent's end is `SubagentStop` and sends nothing.
4. When an API error ends a turn (`StopFailure`), it sends `Turn failed` with the first line of the error, cut at 60 characters and without its markdown marks; if there is no error text, the turn's last words stand in.
5. Every notification carries the subtitle `Claude Code` and the project name: the primary repository (in a git worktree too), else the git root, else the session's directory. The name is read once at the session's start, so a shell `cd` does not rename it.

The notification command returns at once and is killed after 5 seconds, so a hung notification daemon holds up no tool call:

| Desktop | Command |
|---|---|
| macOS | `osascript -e 'display notification ...'` |
| Linux | `notify-send <title> <subtitle and body>` (it has no subtitle field) |
| Windows | a PowerShell toast, which never waits on a click |

The desktop is read once per session: `OS=Windows_NT` means Windows, otherwise `uname -s` names `Darwin` or `Linux`. On any other system the mod says so once and sends nothing. A notification command that fails or is missing is reported once as a transcript line, until a different failure replaces it.

In the live check on 2.1.282, a question the model asked with `AskUserQuestion` ran `osascript` with exit 0 before the question showed up.

## Command

    /desk-notify                  the desktop and each event's setting (also /desk-notify status)
    /desk-notify ask on | off     a question that waits for your answer
    /desk-notify plan on | off    a plan that waits for your approval
    /desk-notify stop on | off    a turn that ended or failed

Each event is on by default and its setting is kept across sessions. There is no bare `on` or `off`: you turn events on and off one at a time.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install desk-notify@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code.
2. On macOS, if no notification shows up, check System Settings > Notifications for the app that `osascript` notifications appear under. On Linux, install `notify-send` (`libnotify`).
3. Remove any hook of your own that already sends these notifications, or each event will notify twice.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.288:

    ❯ ./register.ts hooks: session.start, command.run{command=desk-notify}, tool.call{tool=/"^AskUserQuestion$"/}, tool.call{tool=/"^ExitPlanMode$"/}, classic.Stop, classic.StopFailure
    ❯ ./register.ts calls: $.clock.after (via notifyOn), $.command.register, $.env.get (via readPlatform), $.process.run (via gitOut, readPlatform, send), $.session.cwd (via readProject), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log
    ❯ ./register.ts env reads: OS

Reach L2: it runs processes.

    1. Reads:    the OS variable, the tool name of each call, and a failed turn's error text and last assistant message
    2. Runs:     uname -s and two git rev-parse calls once per session; one osascript, notify-send or powershell.exe per notification
    3. Sends:    a desktop notification with a fixed title, the project name and, for a failed turn, 60 characters of the error; nothing to the model and nothing off the machine
    4. Persists: in $.store, the on/off setting of each event
    5. Hostile input: the project name and the error text are escaped for the AppleScript and PowerShell string literals and pass to notify-send as one argv entry, so neither can run a command

## Limits

- The macOS notification has no icon of its own, because `display notification` takes no icon argument.
- Whether a turn you interrupt raises `Stop` has not been measured.
- The Linux and Windows commands have not been measured live.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
