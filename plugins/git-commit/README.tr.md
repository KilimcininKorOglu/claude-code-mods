# git-commit

Ships a commit skill and holds every Bash git commit to it: a commit the skill did not open, a blanket git add, a signature trailer, a secret, an ignored path, or a push or branch change nobody asked for is stopped before git runs.

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install git-commit@kilimcininkoroglu-mods
```

Function hook'lar henüz early access aşamasında. Claude Code'u `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` ile başlat ya da flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

Claude Code'u yeniden başlat. Kullanıcının elle yapması gereken her adımı buraya yaz: bir key, bir login, bir ayar, kapatılacak başka bir plugin.

## Nereye uzanır

Claude Code VERSION üzerinde doğrulandı:

    ❯ ./register.ts hooks: EVENTS
    ❯ ./register.ts calls: CALLS

## Threat model

```
Threat model for git-commit (reach LEVEL)
1. Okur:
2. Çalıştırır:
3. Gönderir:
4. Saklar:
5. Düşman girdi:
```
