# self-command

Mod geliştirme aracıdır. Model kendi session'ında bir slash command çalıştırır ve komutun çıktısını bir sonraki prompt olarak okur. Örnek: bir plugin güncellemesinden sonra `/reload-plugins`.

> **Bu mod günlük kullanım için değil, geliştirme için yazıldı.** Amacı bu repository'nin modlarını geliştirmek ve test etmektir: model bir modu günceller, `/reload-plugins` komutunu kendisi çalıştırır ve sonucu aynı turn zincirinde kontrol eder. Mod, modele session'daki her slash command'ı (aşağıda listelenen yedi komut hariç) sizin izinlerinizle verir. Bu yüzden modele ulaşan bir prompt injection, veri silen ya da dışarı veri gönderen bir komutu çalıştırabilir. Modu yalnız mod geliştirdiğiniz kendi bilgisayarınıza yükleyin. Geliştirme yapmadığınız zamanlarda modu kapatın: `claude plugin disable self-command@kilimcininkoroglu-mods`.

## Ne yapar

- Model `mcp__self-command__run` tool'unu `command` (slash olmadan komut adı) ve `args` ile çağırır. Baştaki slash atılır. `args` verilmezse, argümanlarıyla birlikte yazılmış bir ad (`sage-memory triage`) ilk boşluktan bölünür. Tool tool listesinin başında yer alır, ToolSearch ile yüklenmesi gerekmez.
- Tipik çağrılar: `claude plugin update` sonrasında `reload-plugins`, `sage-memory triage` ya da modelin işe devam etmek için çıktısını okuması gereken bir modun kendi komutu.
- Model komutun çıktısını bir sonraki prompt olarak okur:

      The command /reload-plugins, which you ran with the self-command tool, ran. Its output:
      Reloaded: 58 plugins · 8 skills · 6 agents · 0 hooks · 1 plugin MCP server · 6 plugin LSP servers

  Başarısız olan bir komutta bu metnin yerine `did not run:` ve engine'in hata mesajı gelir.
- Şu komutlar hemen reddedilir: session'ın komut listesinde olmayan bir ad (alias'lar dahil) ve session'ı temizleyen, bitiren ya da değiştiren `/clear`, `/exit`, `/quit`, `/logout`, `/login`, `/resume` ve `/rewind`.

## Nasıl çalışır

1. Engine bir plugin'in komutunu yalnız session boştayken çalıştırır. Turn'ün beklediği bir hook'tan gelen komut reddedilir. Bu yüzden tool komutu sıraya alır ve hemen cevap verir: `queued: /reload-plugins runs once this turn ends ... do not report its outcome before that output arrives`. Tool açıklaması, modelden tool'u bir turn'ün son adımı olarak çağırmasını ister.
2. Turn bitince bir `$.clock.after(0)` timer'ı komutu `$.command.run` ile çalıştırır.
3. Mod çıktıyı kendi markdown komutu `/self-command:send` ile geri verir. Bu komutun gövdesi yalnız argümanlarından oluşur. Bu sayede model metni bir plugin mesajı çerçevesinde değil, normal bir prompt olarak okur. Bu gönderim reddedilirse çıktı, tek bir log satırıyla birlikte plugin prompt'u olarak gönderilir. Rapor hiçbir zaman slash ile başlamaz, çünkü engine slash ile başlayan bir plugin prompt'unu reddeder.

Claude Code 2.1.283 (Sonnet 5) üzerinde ölçüldü. `/reload-plugins` turn bittikten sonra çalıştı. Modun kendi dosyaları değişmediği için mod, reload sırasında state'ini korudu. Çıktı modele bir sonraki prompt olarak ulaştı. Modun kendi dosyalarını değiştiren bir reload ise bekleyen timer'ı iptal eder ve rapor gelmez.

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install self-command@kilimcininkoroglu-mods
```

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın ya da açık her session'da `/reload-plugins` komutunu çalıştırın.
2. Mod geliştirmediğiniz zamanlarda modu kapatın: `claude plugin disable self-command@kilimcininkoroglu-mods`.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=/"^mcp__self-command__run$"/}, tool.call{tool=/"^mcp__self-command__run$"/}
    ❯ ./register.ts calls: $.clock.after (via runLater), $.command.list, $.command.run (via runLater, send), $.prompt.submit (via send), $.tool.register, $.ui.log (via send)

Reach L2: Claude'u yönlendirir.

## Threat model

```
Threat model for self-command (reach L2)
1. Okur:         session'ın komut listesini.
2. Çalıştırır:   modelin adını verdiği her slash command'ı sizin izinlerinizle; session'ı temizleyen, bitiren ya da değiştiren yedi komut hariç.
3. Gönderir:     kendisi network üzerinden hiçbir şey göndermez; çalıştırdığı bir komut gönderebilir.
4. Saklar:       hiçbir şey.
5. Düşman girdi: modele ulaşan bir prompt injection, izin verilen herhangi bir komutu çalıştırabilir, örneğin veri silen ya da dışarı veri gönderen bir plugin komutunu. Modu bir geliştirme bilgisayarında tutun ve mod geliştirmediğiniz zamanlarda kapatın.
```

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
