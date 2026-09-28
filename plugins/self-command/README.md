# self-command

For mod development: lets the model run a slash command in its own session, such as `/reload-plugins` after a plugin update, and read the output as the next prompt.

> **A development tool, not an everyday mod.** It was written to build and test the mods of this repository: the model updates a mod, runs `/reload-plugins` itself and checks the result in the same turn chain. It gives the model every slash command of the session (except the seven below), with your permissions, so a prompt injection that reaches the model can run a command that deletes or sends data. Install it on your own development machine while you work on mods, and disable it (`claude plugin disable self-command@kilimcininkoroglu-mods`) when you do not.

## What it does

- The model calls `mcp__self-command__run` with `command` (the name without its slash) and `args`. A leading slash is dropped, and a name written with its arguments (`sage-memory triage`) is split at the first space when `args` is left out. The tool is listed at the start, not behind ToolSearch.
- Typical calls: `reload-plugins` after `claude plugin update`, `sage-memory triage`, or a mod's own command whose output the model must read to go on.
- The model reads the command's output as the next prompt:

      The command /reload-plugins, which you ran with the self-command tool, ran. Its output:
      Reloaded: 58 plugins · 8 skills · 6 agents · 0 hooks · 1 plugin MCP server · 6 plugin LSP servers

  A command that fails reports `did not run:` with the engine's error instead.
- Refused at once: a name the session does not list (an alias too), and `/clear`, `/exit`, `/quit`, `/logout`, `/login`, `/resume` and `/rewind`, which clear, end or swap the session.

## How it works

1. The engine runs a plugin's command only once the session is idle, and refuses one from a hook the turn waits on. So the tool queues the command and answers at once: `queued: /reload-plugins runs once this turn ends ... do not report its outcome before that output arrives`. The tool text tells the model to call it as the last step of a turn.
2. After the turn ends, a `$.clock.after(0)` timer runs the command with `$.command.run`.
3. The mod hands the output back through its own markdown command `/self-command:send`, whose body is its arguments alone, so the model reads the text as a prompt and not inside a plugin-message frame. A refused send goes out as a plugin prompt with one log line. The report never starts with a slash, because the engine refuses a plugin prompt that does.

Measured on Claude Code 2.1.283 (Sonnet 5): `/reload-plugins` ran after the turn, this mod kept its state through the reload because its own files had not changed, and the output reached the model as the next prompt. A reload that changes this mod's own files drops the pending timer, and no report follows.

## Install

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install self-command@kilimcininkoroglu-mods
```

Function hooks are early access. Start Claude Code with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, or keep it on in `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code, or run `/reload-plugins` in each open session.
2. Disable it when you are not developing mods: `claude plugin disable self-command@kilimcininkoroglu-mods`.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=/"^mcp__self-command__run$"/}, tool.call{tool=/"^mcp__self-command__run$"/}
    ❯ ./register.ts calls: $.clock.after (via runLater), $.command.list, $.command.run (via runLater, send), $.prompt.submit (via send), $.tool.register, $.ui.log (via send)

Reach L2, drives Claude.

## Threat model

```
Threat model for self-command (reach L2)
1. Reads:         the session's command list.
2. Runs:          any slash command the model names, except the seven that clear, end or swap the session, with your permissions.
3. Sends:         nothing over the network itself; a command it runs may.
4. Persists:      nothing.
5. Hostile input: a prompt injection that reaches the model can run any allowed command, such as a plugin's own command that deletes or sends data. Keep it on a development machine, and off when you do not develop mods.
```

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
