# bughunt

Runs proof-driven bug hunt rounds with /bughunt: each round proves one bug with a failing command the mod runs itself, fixes it, and proves the fix, and the loop stops on a blocked or unverified round. /bughunt collab runs a read-only scanner, planner and critic in sequence. Needs function hooks (early access).

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install bughunt@kilimcininkoroglu-mods
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
Threat model for bughunt (reach LEVEL)
1. Okur:
2. Çalıştırır:
3. Gönderir:
4. Saklar:
5. Düşman girdi:
```
