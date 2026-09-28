# self-command

Mod geliştirme için: modelin kendi session'ında bir slash command çalıştırmasını sağlar, örneğin bir plugin update'inden sonra `/reload-plugins`, ve çıktıyı bir sonraki prompt olarak okur.

> **Günlük kullanım için değil, bir geliştirme aracıdır.** Bu deponun mod'larını geliştirmek ve test etmek için yazıldı: model bir mod'u günceller, `/reload-plugins`'i kendisi çalıştırır ve sonucu aynı turn zincirinde kontrol eder. Modele session'daki her slash command'ı (aşağıdaki yedisi hariç) sizin izinlerinizle verir. Bu yüzden modele ulaşan bir prompt injection, veri silen ya da gönderen bir komut çalıştırabilir. Yalnız mod geliştirdiğiniz kendi makinenize kurun ve geliştirme yapmadığınız zamanlarda kapatın (`claude plugin disable self-command@kilimcininkoroglu-mods`).

## Ne yapar

- Model `mcp__self-command__run` tool'unu `command` (slash'sız ad) ve `args` ile çağırır. Tool başlangıçta listelenir, ToolSearch'ün arkasında beklemez.
- Tipik çağrılar: `claude plugin update`'ten sonra `reload-plugins`, `sage-memory triage`, ya da modelin devam etmek için çıktısını okuması gereken bir mod'un kendi komutu.
- Model komutun çıktısını bir sonraki prompt olarak okur:

      The command /reload-plugins, which you ran with the self-command tool, ran. Its output:
      Reloaded: 58 plugins · 8 skills · 6 agents · 0 hooks · 1 plugin MCP server · 6 plugin LSP servers

- Hemen reddedilenler: session'ın listelemediği bir ad (alias'lar dahil), ve session'ı temizleyen, bitiren ya da değiştiren `/clear`, `/exit`, `/quit`, `/logout`, `/login`, `/resume` ve `/rewind`.

## Nasıl çalışır

1. Engine bir plugin'in komutunu yalnız session boştayken çalıştırır, turn'ün beklediği bir hook'tan geleni reddeder. Bu yüzden tool komutu kuyruğa alır ve hemen cevap verir: `queued: /reload-plugins runs once this turn ends ... do not report its outcome before that output arrives`. Tool metni modele bunu bir turn'ün son adımı olarak çağırmasını söyler.
2. Turn bitince bir `$.clock.after(0)` timer'ı komutu `$.command.run` ile çalıştırır.
3. Mod çıktıyı kendi markdown komutu `/self-command:send` ile geri verir. Bu komutun gövdesi yalnız argümanlarıdır, böylece model metni bir plugin mesajı çerçevesi içinde değil, bir prompt olarak okur. Reddedilen bir gönderim tek bir log satırıyla plugin prompt'u olarak gider. Rapor asla slash ile başlamaz, çünkü engine slash ile başlayan bir plugin prompt'unu reddeder.

Claude Code 2.1.283 (Sonnet 5) üzerinde ölçüldü: `/reload-plugins` turn'den sonra çalıştı, bu mod'un kendi dosyaları değişmediği için mod state'ini reload boyunca korudu, ve çıktı modele bir sonraki prompt olarak ulaştı. Bu mod'un kendi dosyalarını değiştiren bir reload bekleyen timer'ı düşürür ve rapor gelmez.

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install self-command@kilimcininkoroglu-mods
```

Function hook'lar early access. Claude Code'u `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` ile başlatın ya da flag'i `~/.claude/settings.json` içinde kalıcı yapın:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın ya da açık her session'da `/reload-plugins` çalıştırın.
2. Mod geliştirmediğiniz zamanlarda kapatın: `claude plugin disable self-command@kilimcininkoroglu-mods`.

## Nereye uzanır

Claude Code 2.1.283 üzerinde doğrulandı:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=/"^mcp__self-command__run$"/}, tool.call{tool=/"^mcp__self-command__run$"/}
    ❯ ./register.ts calls: $.clock.after (via runLater), $.command.list, $.command.run (via runLater, send), $.prompt.submit (via send), $.tool.register, $.ui.log (via send)

Reach L2, Claude'u sürer.

## Threat model

```
Threat model for self-command (reach L2)
1. Okur:         session'ın komut listesini.
2. Çalıştırır:   modelin adını verdiği her slash command'ı, session'ı temizleyen, bitiren ya da değiştiren yedisi hariç, sizin izinlerinizle.
3. Gönderir:     kendisi ağ üzerinden hiçbir şey; çalıştırdığı bir komut gönderebilir.
4. Saklar:       hiçbir şey.
5. Düşman girdi: modele ulaşan bir prompt injection, izin verilen herhangi bir komutu çalıştırabilir, örneğin veri silen ya da gönderen bir plugin komutunu. Bir geliştirme makinesinde tutun ve mod geliştirmediğiniz zamanlarda kapatın.
```

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10, üstünde build kırılır
    make typecheck   # .claude/types/ içindeki /plugin-types çıktısına ihtiyaç duyar
    make validate
    make test        # claude plugin test
