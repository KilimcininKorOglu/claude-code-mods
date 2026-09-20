# bg-tasks

A Claude Code Mod that shows the background shell tasks of the session on the status line, and stops one from the `/bg-tasks` pane. A dev server or a watcher the model left running stays in sight until it ends.

## What it does

1. The mod hooks the Bash tool. A call that returns a `backgroundTaskId` is listed: one the model started with `run_in_background`, or one you moved to the background with Ctrl+B.
2. A task leaves the list when:
   - its notification arrives (`<task-notification>` with a `<task-id>` and a status other than `running`),
   - the model stops it with the TaskStop tool,
   - you stop it in the pane.
3. The status line shows the count, the age of the oldest task and its command, redrawn every 30 seconds:

       bg-tasks: 2 running · oldest 12m (npm run dev)

   With no task running there is no line.
4. `/bg-tasks` opens a pane with one row per task, the oldest first:

          age  who    command
       [ stop ]    12m  model  npm run dev
       [ stop ]     3m  you    tail -f logs/app.log

   Enter on a row stops that task through the engine's TaskStop tool, with your press as the consent. The pane says `stopped: npm run dev`, or `not stopped: ...` with the reason, and the task stays listed then.

5. While the [sidebar](../sidebar) is open, the list goes there instead: one section with the same rows and a `[ stop ... ]` button per task, and the status line stays empty. A press runs `/bg-tasks stop <id>`, which stops that task the same way. With the sidebar closed, or without that mod installed, everything is as above.

6. A task that ends by itself also writes one green entry into the sidebar's stream, so the pane keeps what finished while the list above it holds only what still runs:

       bg-tasks: task finished
       sleep 600 · finished after 12m

   A task you stopped writes no such entry; the pane already says `stopped: <task>`. With the sidebar closed nothing is written, because the engine's own task notification already reports the end.

In the live check the model started `sleep 900` in the background. The status line showed `1 running · oldest <1m (sleep 900)`. A press on its row in the pane stopped the process, and the status line and the engine's `1 shell` footer went away.

## Command

    /bg-tasks            opens or closes the pane
    /bg-tasks list       the tasks as text, with their ids
    /bg-tasks stop <id>  stops that task; what a sidebar button runs
    /bg-tasks on | off   on by default; off clears the list

The name is not `/bg`, because the engine keeps `/bg` for its built-in `/background`.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bg-tasks@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.tsx hooks: session.start, command.run{command=bg-tasks}, tool.call{tool=Bash}, tool.call{tool=TaskStop}, prompt.submit{origin has {kind=task-notification}}, ui.render{component=Pane}
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.sidebar.clear (via offSidebar), $.sidebar.set (via toFinished, toSidebar), $.store.get, $.store.set (via runCommand), $.tool.call (via stopTask), $.ui.close (via togglePane), $.ui.invalidate (via changed), $.ui.open (via togglePane), $.ui.panes (via togglePane), $.ui.resolve, $.ui.status (via showStatus)

Reach L2, calls a tool.

    1. Reads:    the command and the result of each Bash call; the text of task notifications; the task id of each TaskStop call
    2. Runs:     the engine's TaskStop tool, only on your press in the pane or on the sidebar's button
    3. Sends:    nothing to the model; the status line and the pane are drawn for you only
    4. Persists: in $.store, the on/off setting; the task list lives in memory for the session
    5. Hostile input: a task id reaches TaskStop only from the list the engine's own Bash results built; notification text is only matched for ids

## Limits

- Only tasks that start while the mod is loaded are listed. After a resume, a `/reload-plugins` or an update, tasks started earlier are not known.
- Subagents, workflows and monitors are not listed, only background shells.
- A task that ends without a notification (the session was busy and the notification is still queued) stays listed until the notification arrives.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
