# bash-diet

Shrinks each Bash result before the model reads it: per-command filters for git, test runners, linters, package managers, containers and file tools, the full output kept in a file. Needs function hooks (early access).

## Install

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install bash-diet@kilimcininkoroglu-mods
```

Function hooks are early access. Start Claude Code with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, or keep it on in `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

Restart Claude Code. List here every step a user must take by hand: a key, a login, a setting, another plugin to disable.

## What it can reach

Validated on Claude Code VERSION:

    ❯ ./register.ts hooks: EVENTS
    ❯ ./register.ts calls: CALLS

## Threat model

```
Threat model for bash-diet (reach LEVEL)
1. Reads:
2. Runs:
3. Sends:
4. Persists:
5. Hostile input:
```
