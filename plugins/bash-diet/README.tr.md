# bash-diet

Shrinks each Bash result before the model reads it: per-command filters for git, test runners, linters, package managers, containers and file tools, the full output kept in a file. Needs function hooks (early access).

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install bash-diet@kilimcininkoroglu-mods
```

Function hook'lar early access. Claude Code'u `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` ile başlatın ya da flag'i `~/.claude/settings.json` içinde kalıcı yapın:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

Claude Code'u yeniden başlatın. Kullanıcının elle atması gereken her adımı buraya yazın: bir key, bir login, bir ayar, devre dışı bırakılacak başka bir plugin.

## Nereye uzanır

Claude Code VERSION üzerinde doğrulandı:

    ❯ ./register.ts hooks: EVENTS
    ❯ ./register.ts calls: CALLS

## Threat model

```
Threat model for bash-diet (reach LEVEL)
1. Okur:
2. Çalıştırır:
3. Gönderir:
4. Saklar:
5. Düşman girdi:
```
