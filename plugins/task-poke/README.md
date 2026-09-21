# task-poke

A Claude Code Mod. When a main-loop turn ends and the task list still has pending or in-progress tasks, it submits a continue prompt. It stops after 99 consecutive pokes, or after the limit you set with `/task-poke limit <n>`. A prompt you type resets the count.

It reads both task formats:

- `TodoWrite`: each call replaces the whole list.
- `TaskCreate` and `TaskUpdate` (default since Claude Code 2.1.142): `TaskCreate` adds a task, and the id comes from its tool result (`{ task: { id } }`). `TaskUpdate` patches a task by `taskId` (the raw `id` and `task_id` keys are also read). `status: "deleted"` removes a task.

A later `TodoWrite` replaces any state built from the Task tools.

## Task tools on every model

Claude Code offers the task-tracking tools only on Claude 3.x, Opus 4.0 to 4.7, Sonnet 4.0 to 4.6 and Haiku 4.5. On every other model the mod has nothing to count. So at `session.start` the mod sets `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` for the Claude Code process, and Claude Code then offers the task tools on every model.

- The mod does not change a value you set yourself. `CLAUDE_CODE_ENABLE_TODO_TOOLS=0` keeps the task tools off.
- The mod does not set the variable while `/task-poke off` is stored. `/task-poke off` takes effect on the task tools from the next session.
- The variable also reaches every Bash command and MCP server the session starts.
- `CLAUDE_CODE_ENABLE_TASKS=false` replaces the Task tools with `TodoWrite`. The mod reads both formats.

## What it shows

While the [sidebar](../sidebar) is open, the count stands there as a `task list` section for the session, rewritten at each turn:

    task-poke: task list
    3 unfinished tasks, poke 2/99

The line is green below the last poke, yellow at it, and red once the pokes stopped. The section goes down when nothing is unfinished. Three findings go into the stream instead, in red, so the next count does not take them off the pane: the stop after 5 pokes, a poke the engine dropped, and a task list the parser cannot read.

With the sidebar closed, or without that mod installed, only a turn that sent a poke writes its line to the transcript, and the three findings are transcript lines, as before.

## When it does not poke

- The turn was interrupted, refused, or ended on an API error (`reason` is not `answer`).
- The turn ran in a subagent.
- The last assistant message called `AskUserQuestion`.
- The limit of pokes was sent since your last prompt. One red entry reports the stop.
- `/task-poke off` is set.

## Commands

    /task-poke          status
    /task-poke on       enable (default), stored across sessions
    /task-poke off      disable, stored across sessions
    /task-poke limit 20 at most 20 pokes in a row; 1 to 999, 99 by default, stored across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install task-poke@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/task-poke

To keep the flag on, add this to `~/.claude/settings.json` (measured on 2.1.278):

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

Restart Claude Code. The mod turns the task tools on at session start, so on a model outside the list above the task tools come from the next session.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=task-poke}, prompt.submit, turn.complete
    ❯ ./register.ts calls: $.command.register, $.env.get, $.env.set, $.prompt.submit (via sendPoke), $.session.messages (via afterTurn), $.sidebar.clear (via clearCount), $.sidebar.set (via toCount, toStream), $.store.get, $.store.set, $.ui.log (via toCount, toStream)
    ❯ ./register.ts env writes: CLAUDE_CODE_ENABLE_TODO_TOOLS
    ❯ ./register.ts env reads: CLAUDE_CODE_ENABLE_TODO_TOOLS

Reach L2, drives Claude. Reads the transcript. Writes one environment variable.

    1. Reads:    the transcript through $.session.messages (tool names, inputs and results of TodoWrite, TaskCreate, TaskUpdate and AskUserQuestion); the origin kind of each prompt, never its text; CLAUDE_CODE_ENABLE_TODO_TOOLS
    2. Runs:     one $.prompt.submit per main-loop turn that ends with unfinished tasks, at most 99 in a row, or the limit you set; sets CLAUDE_CODE_ENABLE_TODO_TOOLS=1 once per session when it is unset
    3. Sends:    only the fixed poke prompt, as a normal turn
    4. Persists: one boolean (enabled) and the poke limit in $.store; the environment variable lasts for the process only
    5. Hostile input: no text from the transcript reaches the poke prompt; an unknown task status or a TaskCreate result without task.id stops the pokes, and one line names the error until the error changes

## Limits

- `$.session.messages()` returns the newest 4096 messages. A task created before that window and never updated inside it is not counted.
- A task list read through `TaskList` or `TaskGet` results is not parsed. Only `TaskCreate` and `TaskUpdate` build the state.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
