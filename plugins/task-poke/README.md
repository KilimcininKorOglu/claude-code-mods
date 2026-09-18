# task-poke

A Claude Code Mod. When a main-loop turn ends and the task list still has pending or in-progress tasks, it submits a continue prompt. It stops after 5 consecutive pokes. A prompt you type resets the count.

It reads both task formats:

- `TodoWrite`: each call replaces the whole list.
- `TaskCreate` and `TaskUpdate` (default since Claude Code 2.1.142): `TaskCreate` adds a task, and the id comes from its tool result (`{ task: { id } }`). `TaskUpdate` patches a task by `taskId` (the raw `id` and `task_id` keys are also read). `status: "deleted"` removes a task.

A later `TodoWrite` replaces any state built from the Task tools.

## When it does not poke

- The turn was interrupted, refused, or ended on an API error (`reason` is not `answer`).
- The turn ran in a subagent.
- The last assistant message called `AskUserQuestion`.
- 5 pokes were sent since your last prompt. One log line reports the stop.
- `/task-poke off` is set.

## Commands

    /task-poke          status
    /task-poke on       enable (default), stored across sessions
    /task-poke off      disable, stored across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install task-poke@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/task-poke

To keep the flag on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.275:

    > ./register.ts hooks: session.start, command.run{command=task-poke}, prompt.submit, turn.complete
    > ./register.ts calls: $.command.register, $.prompt.submit, $.session.messages, $.store.get, $.store.set, $.ui.log

Reach L2, drives Claude. Reads the transcript.

    1. Reads:    the transcript through $.session.messages (tool names, inputs and results of TodoWrite, TaskCreate, TaskUpdate and AskUserQuestion); the origin kind of each prompt, never its text
    2. Runs:     one $.prompt.submit per main-loop turn that ends with unfinished tasks, at most 5 in a row
    3. Sends:    only the fixed poke prompt, as a normal turn
    4. Persists: one boolean (enabled) in $.store
    5. Hostile input: no text from the transcript reaches the poke prompt; an unknown task status or a TaskCreate result without task.id throws, and the engine skips the hook for that turn

## Limits

- `$.session.messages()` returns the newest 4096 messages. A task created before that window and never updated inside it is not counted.
- A task list read through `TaskList` or `TaskGet` results is not parsed. Only `TaskCreate` and `TaskUpdate` build the state.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
