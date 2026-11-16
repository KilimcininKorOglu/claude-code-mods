# probe-runner

Mod geliştirme aracıdır. Plugin'lerin canlı kontrolünü tmux içinde yeni bir Claude Code session'ında çalıştırır. Adımları tek tek yazar, pane'i ve transcript'i toplar. Ardından geçici dizini, bu dizinin transcript'lerini ve inline store dosyalarını siler.

> **Bu mod günlük kullanım için değil, geliştirme için yazıldı.** Amacı bu repository'nin modlarını geliştirirken canlı kontrol yapmaktır: model yalnız test edilen plugin'lerin yüklü olduğu gerçek bir Claude Code session'ı başlatır, içine prompt'lar ve slash command'lar yazar ve sonucu okur. Her probe sizin hesabınızla açılan gerçek bir session'dır. Bu yüzden token harcar ve yazdığı adımlar geçici bir repository'de tool çalıştırabilir. Modu yalnız mod geliştirdiğiniz kendi bilgisayarınıza yükleyin. Geliştirme yapmadığınız zamanlarda modu kapatın: `claude plugin disable probe-runner@kilimcininkoroglu-mods`.

## Ne yapar

Mod, canlı bir kontrolün elle yapılan bütün adımlarını tek bir çağrıda yapar: geçici bir git repository'si oluşturur, tmux'u başlatır, klasör güven sorusunu cevaplar, `--plugin-dir` ile plugin'leri yükler, adımları arka arkaya yazar, pane'i ve transcript'i toplar. Ardından dizini, transcript'leri ve inline store dosyalarını siler. Rapor şöyle görünür:

    # probe probe-runner-k_mj_kix · sonnet · 102s

    ## pane
    ❯ Public site hangi adreste yayınlanıyor? Dosyalara bakmadan cevap ver.
    ⏺ Public site şu adreste yayınlanıyor: https://cc-mods.keremgok.tr

    ## transcript
    user: Public site hangi adreste yayınlanıyor? ...
    hook context (prompt.submit): [sage-memory] memory related to this prompt ...
    assistant: Public site şu adreste yayınlanıyor: https://cc-mods.keremgok.tr

    ## deleted
    /private/tmp/probe-runner-k_mj_kix
    ~/.claude/projects/-private-tmp-probe-runner-k-mj-kix

## Nasıl çalışır

1. `scripts/probe.py`, `/private/tmp/probe-runner-<rastgele>` altında bir git repository'si oluşturur. `/private/tmp` olmayan sistemlerde sistemin geçici dizini kullanılır. Ardından bu dizinde bir tmux session'ında `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` ile `claude --setting-sources project --model <model> --plugin-dir <dizin> ...` komutunu başlatır. `--setting-sources project`, sizin kendi plugin'lerinizi ve hook'larınızı dışarıda tutar. Böylece yalnız test edilen plugin'ler yüklenir.
2. Script klasör güven sorusunu cevaplar, prompt kutusunu bekler ve her adımı yazar. Bir tamamlama menüsü slash command'ın ilk Enter'ını alabilir. Bu yüzden kutu boşalana kadar Enter'a en fazla dört kez yeniden basılır.
3. Pane `esc to interrupt` göstermiyorsa, prompt kutusunu gösteriyorsa ve 3 saniye arayla yapılan iki kontrolde değişmediyse adım bitmiş sayılır. Bir adım 5 dakika sonra probe'u durdurur. Bir probe da 10 dakikada durur, çünkü `$.process.run` en fazla bu kadar bekleyebilir.
4. Rapor şunları içerir: pane'in son metni (yana yerleştirilmiş sidebar kesilir), özetlenmiş transcript (prompt'lar, cevaplar, tool çağrıları ve sonuçları, komut çıktıları, mod log satırları ve hook'ların eklediği context) ve silinen dosyalar.
5. Silmeden önce script, probe'un claude process'inin çıkmasını bekler. Bunun nedeni, claude'un çıkarken transcript'ini yazması ve silinmiş bir dizini yeniden oluşturmasıdır. Script geçici dizini, `<config dizini>/projects/<kodlanmış geçici path>*` dizinlerini ve probe başladıktan sonra yazılan `*_inline-*.json` store dosyalarını siler. `<config dizini>`, tanımlıysa `CLAUDE_CONFIG_DIR`, değilse `~/.claude` dizinidir. Dışarıdan sonlandırılan bir probe (SIGTERM, SIGHUP) da temizliği yapar.

Claude Code 2.1.283 üzerinde ölçüldü: iki slash command'lık bir probe, bir tool çağrısı içinde 23 saniye sürdü. Bu yüzden `$.process.run` beklemesi, hook'ların 10 saniyelik süre sınırına bağlı değildir.

Bir probe'un test etmediği durum: kendi uzun ömürlü process'i olan bir mod (sage-memory'nin daemon'u), protocol aynıysa çalışan yüklü process'i yeniden kullanır. Bu yüzden probe checkout'taki hook'ları yükler, ancak daemon'daki bir değişikliği yüklemez.

## Kullanım

Model `mcp__probe-runner__probe` tool'unu çağırır. Tool, tool listesinin başında yer alır ve ToolSearch ile yüklenmesi gerekmez:

    { "plugins": ["pin-note"], "steps": ["/pin-note on", "/pin-note X", "/clear", "Sabitlenmiş not var mı?"], "model": "sonnet" }

Tool çağrısı probe'un bitmesini bekler ve raporu döndürür. Siz probe'u şu komutla çalıştırırsınız:

    /probe-runner [--model <model>] <plugin>[,<plugin>...] <adım> ;; <adım> ;; ...

Komut hemen `started` cevabını verir. Probe bittiğinde rapor `/probe-runner:send` ile modele kendi prompt'u olarak gönderilir. Engine bu komutu reddederse bu durum bir satırla bildirilir ve rapor plugin prompt'u olarak gönderilir. Başarısız olan bir probe rapor yerine exit kodunu ve hata metnini döndürür.

Bir plugin, session'ın repository'sindeki `plugins/` dizini altındaki bir ad ya da bir path'tir (mutlak, `~/...` ya da session'ın dizinine göre göreli). `.claude-plugin/plugin.json` dosyası olmayan bir plugin, hiçbir şey çalıştırılmadan reddedilir. Model belirtilmezse `sonnet` kullanılır.

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install probe-runner@kilimcininkoroglu-mods
```

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. `tmux` ve `python3` paketlerini yükleyin ve PATH'te olduklarından emin olun.
2. Claude Code'u yeniden başlatın ya da açık her session'da `/reload-plugins` komutunu çalıştırın.
3. Mod geliştirmediğiniz zamanlarda modu kapatın: `claude plugin disable probe-runner@kilimcininkoroglu-mods`.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=/"^mcp__probe-runner__probe$"/}, tool.call{tool=/"^mcp__probe-runner__probe$"/}, command.run{command=probe-runner}
    ❯ ./register.ts calls: $.clock.after (via runInBackground), $.command.register, $.command.run (via runInBackground), $.env.get (via pluginDirs), $.fs.exists (via pluginDirs), $.process.run (via runProbe), $.prompt.submit (via runInBackground), $.session.cwd (via pluginDirs), $.session.repo (via pluginDirs), $.tool.register, $.ui.log (via runInBackground)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: HOME

Reach L3: probe session'ı Claude API ile iletişim kurar.

## Threat model

```
Threat model for probe-runner (reach L3)
1. Okur:         session'ın dizinini ve repository kökünü, HOME'u, her plugin'in manifest'ini; probe'un pane'ini ve transcript'ini.
2. Çalıştırır:   git, tmux ve claude çalıştıran python3 scripts/probe.py'yi.
3. Gönderir:     adımları, ayrı bir Claude Code session'ına, sizin hesabınızla.
4. Saklar:       hiçbir şey; probe'un dizini, transcript'leri ve inline store dosyaları silinir.
5. Düşman girdi: adımlar ve plugin path'leri sizden ya da modelden gelir; claude'a ve tmux'a hiçbir zaman bir shell üzerinden değil, argv olarak verilir; bir adım, probe session'ının kendi geçici repository'sinde tool çalıştırmasına neden olabilir.
```

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
