# bg-tasks

The model starts a dev server or a file watcher in the background, moves on, and forgets about it. An hour later it is still running and you have no idea where it came from. This mod keeps every background shell task of the session in sight until it ends, and lets you stop any of them with one press.

## What it does

1. It watches the Bash tool. Any call that returns a `backgroundTaskId` goes on the list: one the model started with `run_in_background`, or one you sent to the background with Ctrl+B.
2. A task leaves the list when:
   - its notification arrives (`<task-notification>` with a `<task-id>` and a status other than `running`). The main loop reads it as a prompt. A subagent that is still running reads it as a queued message inside its own loop. A subagent that had already answered is resumed with it, and the mod then reads that agent's messages at the end of its turn;
   - a subagent that ran in the foreground answers. The engine ends that agent's background tasks along with its answer and sends no notification, so the mod closes them as `killed`;
   - the model stops it with the TaskStop tool;
   - you stop it in the pane.
3. The status line shows how many are running, the age of the oldest one and its command, redrawn every 30 seconds:

       bg-tasks: 2 running · oldest 12m (npm run dev)

   With nothing running there is no line.
4. `/bg-tasks` opens a pane with one row per task, oldest first:

          age  who    command
       [ stop ]    12m  model  npm run dev
       [ stop ]     3m  you    tail -f logs/app.log

   Enter on a row stops that task through the engine's TaskStop tool, with your press as the consent. The pane then says `stopped: npm run dev`, or `not stopped: ...` with the reason, in which case the task stays listed.
5. With the [sidebar](../sidebar) open, the list goes there instead and the status line stays empty. It is one section titled with the count (`2 running`), holding the same rows and a `[ stop ... ]` button per task. In a row the age and who started it are faint and the command is in the default colour; an age of an hour or more turns yellow, so a runaway task stands out. A button runs `/bg-tasks stop <id>`, which stops the task the same way. Without the sidebar, everything works as above.
6. A task that ends by itself also leaves one entry in the sidebar's stream. That way the pane keeps a record of what ended, while the section above holds only what still runs. The entry says how the task ended, and only that word is coloured: `finished` green for `completed`, `killed` yellow, `failed` (or any other status the engine reports) red:

       bg-tasks: task finished
       sleep 600 · finished after 12m

       bg-tasks: task failed
       npm test · failed after 3m

   A task you or the model stopped writes no such entry; the pane already says `stopped: <task>`. With the sidebar closed nothing is written, because the engine's own task notification already reports the end.

In the live check on 2.1.282 all three subagent paths closed their task: a foreground subagent's `sleep 5` that it waited out, a foreground subagent's `sleep 120` that it left running when it answered, and a background subagent's `sleep 15` that ended after the agent did.

In an earlier live check the model started `sleep 900` in the background. The status line showed `1 running · oldest <1m (sleep 900)`. A press on its row in the pane stopped the process, and both the status line and the engine's `1 shell` footer went away.

## Command

    /bg-tasks            opens or closes the pane
    /bg-tasks list       the tasks as text, with their ids
    /bg-tasks stop <id>  stops that task; this is what a sidebar button runs
    /bg-tasks on | off   on by default; off clears the list

The command is not `/bg`, because the engine keeps `/bg` for its built-in `/background`.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bg-tasks@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.tsx hooks: session.start, command.run{command=bg-tasks}, tool.call{tool=Bash}, tool.call{tool=TaskStop}, prompt.submit{origin has {kind=task-notification}}, prompt.attachment{type=queued_command}, turn.complete, ui.render{component=Pane}
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.session.messages (via afterAgentTurn), $.sidebar.clear (via offSidebar), $.sidebar.set (via toFinished, toSidebar), $.store.get (via readSettings), $.store.set (via runCommand), $.tool.call (via stopTask), $.ui.close (via togglePane), $.ui.invalidate (via changed), $.ui.open (via togglePane), $.ui.panes (via togglePane), $.ui.resolve, $.ui.status (via showStatus)

Reach L2: it calls a tool.

    1. Reads:    the command and the result of each Bash call; the text of task notifications; the task id of each TaskStop call; at the end of a subagent's turn, the messages of a subagent that started a listed task
    2. Runs:     the engine's TaskStop tool, only on your press in the pane or on the sidebar's button
    3. Sends:    nothing to the model; the status line and the pane are drawn for you only
    4. Persists: in $.store, the on/off setting; the task list lives in memory for the session
    5. Hostile input: a task id reaches TaskStop only from the list the engine's own Bash results built; notification text is only matched for ids

## Limits

- Only tasks started while the mod is loaded are listed. After a resume, a `/reload-plugins` or an update, tasks started earlier are unknown to it.
- Only background shells are listed; subagents, workflows and monitors are not.
- A task that ends while its notification is still queued (the session was busy) stays listed until the notification arrives.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
