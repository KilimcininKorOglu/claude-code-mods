# MOD_NAME

MOD_DESCRIPTION

## Install

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install MOD_NAME@kilimcininkoroglu-mods
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
Threat model for MOD_NAME (reach LEVEL)
1. Reads:
2. Runs:
3. Sends:
4. Persists:
5. Hostile input:
```
