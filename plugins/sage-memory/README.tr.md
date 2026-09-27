# sage-memory

Keeps project and global memories in SQLite through a shared local daemon, hands the model the entries that match its file tool calls, prompts and subagent tasks, and saves new ones with a haiku consolidator after each main-loop turn.

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install sage-memory@kilimcininkoroglu-mods
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
Threat model for sage-memory (reach LEVEL)
1. Okur:
2. Çalıştırır:
3. Gönderir:
4. Saklar:
5. Düşman girdi:
```
