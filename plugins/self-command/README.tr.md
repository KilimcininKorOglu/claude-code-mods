# self-command

Mod geliştirme için: model kendi session'ında bir slash command çalıştırır (örneğin bir plugin update'inden sonra `/reload-plugins`) ve çıktıyı bir sonraki prompt olarak okur.

> **Günlük kullanım için değil, bir geliştirme aracıdır.** Bu repository'nin mod'larını geliştirmek ve test etmek için yazıldı: model bir mod'u günceller, `/reload-plugins`'i kendisi çalıştırır ve sonucu aynı turn zincirinde kontrol eder. Modele session'daki her slash command'ı (aşağıdaki yedisi hariç) senin izinlerinle verir; bu yüzden modele ulaşan bir prompt injection, veri silen ya da gönderen bir komutu çalıştırabilir. Yalnız mod geliştirdiğin kendi makinene kur ve geliştirme yapmadığın zamanlarda kapat (`claude plugin disable self-command@kilimcininkoroglu-mods`).

## Ne yapar

- Model `mcp__self-command__run` tool'unu `command` (slash'sız ad) ve `args` ile çağırır. Baştaki bir slash atılır; `args` verilmezse argümanlarıyla birlikte yazılmış bir ad (`sage-memory triage`) ilk boşlukta bölünür. Tool başta listelenir, ToolSearch'ün arkasında beklemez.
- Tipik çağrılar: `claude plugin update`'ten sonra `reload-plugins`, `sage-memory triage`, ya da modelin devam etmek için çıktısını okuması gereken bir mod'un kendi komutu.
- Model komutun çıktısını bir sonraki prompt olarak okur:

      The command /reload-plugins, which you ran with the self-command tool, ran. Its output:
      Reloaded: 58 plugins · 8 skills · 6 agents · 0 hooks · 1 plugin MCP server · 6 plugin LSP servers

  Başarısız olan bir komut bunun yerine engine'in hatasıyla birlikte `did not run:` bildirir.
- Hemen reddedilenler: session'ın listelemediği bir ad (alias'lar dahil) ve session'ı temizleyen, bitiren ya da değiştiren `/clear`, `/exit`, `/quit`, `/logout`, `/login`, `/resume` ve `/rewind`.

## Nasıl çalışır

1. Engine bir plugin'in komutunu yalnız session boştayken çalıştırır, turn'ün beklediği bir hook'tan geleni reddeder. Bu yüzden tool komutu kuyruğa alır ve hemen cevap verir: `queued: /reload-plugins runs once this turn ends ... do not report its outcome before that output arrives`. Tool metni modele onu bir turn'ün son adımı olarak çağırmasını söyler.
2. Turn bitince bir `$.clock.after(0)` timer'ı komutu `$.command.run` ile çalıştırır.
3. Mod çıktıyı kendi markdown komutu `/self-command:send` ile geri verir. Bu komutun gövdesi yalnız argümanlarıdır; böylece model metni bir plugin mesajı çerçevesi içinde değil, bir prompt olarak okur. Reddedilen bir gönderim tek bir log satırıyla plugin prompt'u olarak gider. Rapor hiçbir zaman slash ile başlamaz, çünkü engine slash ile başlayan bir plugin prompt'unu reddeder.

Claude Code 2.1.283 (Sonnet 5) üzerinde ölçüldü: `/reload-plugins` turn'den sonra çalıştı, bu mod kendi dosyaları değişmediği için state'ini reload boyunca korudu ve çıktı modele bir sonraki prompt olarak ulaştı. Bu mod'un kendi dosyalarını değiştiren bir reload bekleyen timer'ı düşürür ve rapor gelmez.

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install self-command@kilimcininkoroglu-mods
```

Function hook'lar henüz early access aşamasında. Claude Code'u `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` ile başlat, ya da flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat ya da açık her session'da `/reload-plugins` çalıştır.
2. Mod geliştirmediğin zamanlarda kapat: `claude plugin disable self-command@kilimcininkoroglu-mods`.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=/"^mcp__self-command__run$"/}, tool.call{tool=/"^mcp__self-command__run$"/}
    ❯ ./register.ts calls: $.clock.after (via runLater), $.command.list, $.command.run (via runLater, send), $.prompt.submit (via send), $.tool.register, $.ui.log (via send)

Reach L2: Claude'u yönlendirir.

## Threat model

```
Threat model for self-command (reach L2)
1. Okur:         session'ın komut listesini.
2. Çalıştırır:   modelin adını verdiği her slash command'ı, session'ı temizleyen, bitiren ya da değiştiren yedisi hariç, senin izinlerinle.
3. Gönderir:     kendisi network üzerinden hiçbir şey; çalıştırdığı bir komut gönderebilir.
4. Saklar:       hiçbir şey.
5. Düşman girdi: modele ulaşan bir prompt injection, izin verilen herhangi bir komutu çalıştırabilir, örneğin veri silen ya da gönderen bir plugin komutunu. Mod'u bir geliştirme makinesinde tut ve mod geliştirmediğin zamanlarda kapat.
```

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
