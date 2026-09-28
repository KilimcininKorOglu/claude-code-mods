# probe-runner

Mod geliştirme için: plugin'lerin canlı kontrolünü tmux içinde yeni bir Claude Code session'ında çalıştırır, adımları tek tek yazar, pane'i ve transcript'i toplar, sonra geçici dizini, transcript'lerini ve inline store dosyalarını siler.

> **Günlük kullanım için değil, bir geliştirme aracıdır.** Bu deponun mod'larını geliştirilirken canlı kontrol etmek için yazıldı: model yalnız test edilen plugin'lerle gerçek bir Claude Code session'ı başlatır, içine prompt'lar ve slash command'lar yazar ve ne olduğunu okur. Her probe sizin hesabınızla açılan gerçek bir session'dır, bu yüzden token harcar, ve yazdığı adımlar geçici bir depoda tool çalıştırabilir. Yalnız mod geliştirdiğiniz kendi makinenize kurun ve geliştirme yapmadığınız zamanlarda kapatın (`claude plugin disable probe-runner@kilimcininkoroglu-mods`).

## Ne yapar

Bir canlı kontrolün elle gerektirdiği her şeyi tek çağrıda yapar: geçici bir git deposu, tmux, klasör güven sorusunun cevabı, `--plugin-dir`, art arda yazılan adımlar, toplanan pane ve transcript, sonra silinen dizin, transcript'ler ve inline store dosyaları. Rapor şöyle görünür:

    # probe probe-runner-k_mj_kix · sonnet · 102s

    ## pane
    ❯ Public site hangi adreste yayınlanıyor? Dosyalara bakmadan cevap ver.
    ⏺ Public site şu adreste yayınlanıyor: https://cc-mods.keremgok.tr

    ## transcript
    user: Public site hangi adreste yayınlanıyor? ...
    hook context (prompt.submit): [sage-memory] project memory related to this prompt ...
    assistant: Public site şu adreste yayınlanıyor: https://cc-mods.keremgok.tr

    ## deleted
    /private/tmp/probe-runner-k_mj_kix
    ~/.claude/projects/-private-tmp-probe-runner-k-mj-kix

## Nasıl çalışır

1. `scripts/probe.py`, `/private/tmp/probe-runner-<rastgele>` altında bir git deposu açar (`/private/tmp` olmayan sistemlerde sistemin geçici dizininde) ve orada bir tmux session'ında `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` ile `claude --setting-sources project --model <model> --plugin-dir <dizin> ...` başlatır. `--setting-sources project` sizin kendi plugin'lerinizi ve hook'larınızı dışarıda tutar, yani yalnız test edilen plugin'ler yüklenir.
2. Klasör güven sorusunu cevaplar, prompt kutusunu bekler ve her adımı yazar. Bir tamamlama menüsü bir slash command'ın ilk Enter'ını alabilir, bu yüzden kutu boşalana kadar Enter'a en fazla dört kez yeniden basılır.
3. Pane `esc to interrupt` göstermediğinde, prompt kutusunu gösterdiğinde ve 3 saniye arayla iki bakış arasında değişmediğinde bir adım bitmiş sayılır. Bir adım 5 dakikada probe'u durdurur; bir probe 10 dakikada, yani `$.process.run`'ın en uzun beklediği sürede durur.
4. Rapor pane'in son metnini (yandaki sidebar kesilmiş olarak), özetlenmiş transcript'i (prompt'lar, cevaplar, tool çağrıları ve sonuçları, komut çıktıları, mod log satırları ve hook'ların eklediği context) ve silinenleri içerir.
5. Silmeden önce probe'un claude sürecinin çıkmasını bekler, çünkü claude çıkarken transcript'ini yazar ve silinmiş bir dizini geri getirirdi. Geçici dizini, `<config dizini>/projects/<kodlanmış geçici yol>*` dizinlerini ve probe başladığından beri yazılan `*_inline-*.json` store dosyalarını siler (`<config dizini>` ayarlıysa `CLAUDE_CONFIG_DIR`, değilse `~/.claude`). Dışarıdan öldürülen bir probe (SIGTERM, SIGHUP) da temizlik yapar.

Claude Code 2.1.283 üzerinde ölçüldü: iki slash command'lık bir probe bir tool çağrısı içinde 23 saniye sürdü, yani `$.process.run` beklemesi 10 saniyelik hook bütçesine bağlı değildir.

Bir probe'un test etmediği şey: kendi uzun yaşayan süreci olan bir mod (sage-memory'nin daemon'u) protokol aynıysa çalışan kurulu süreci yeniden kullanır. Bu yüzden probe checkout'taki hook'ları yükler ama bir daemon değişikliğini yüklemez.

## Kullanım

Model `mcp__probe-runner__probe` tool'unu çağırır (başlangıçta listelenir, ToolSearch'ün arkasında beklemez):

    { "plugins": ["pin-note"], "steps": ["/pin-note on", "/pin-note X", "/clear", "Sabitlenmiş not var mı?"], "model": "sonnet" }

Tool çağrısı probe'u bekler ve raporla cevap verir. Siz komutla çalıştırırsınız:

    /probe-runner [--model <model>] <plugin>[,<plugin>...] <adım> ;; <adım> ;; ...

Komut hemen `started` der; rapor probe bitince `/probe-runner:send` ile modele kendi prompt'u olarak ulaşır.

Bir plugin, session'ın deposundaki `plugins/` dizini altındaki bir ad ya da bir yoldur (mutlak, `~/...` ya da session'ın dizinine göre). `.claude-plugin/plugin.json` dosyası olmayan bir plugin hiçbir şey çalışmadan reddedilir. Model belirtilmezse `sonnet`'tir.

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install probe-runner@kilimcininkoroglu-mods
```

Function hook'lar early access. Claude Code'u `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` ile başlatın ya da flag'i `~/.claude/settings.json` içinde kalıcı yapın:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. `tmux` ve `python3` kurun ve PATH'te tutun.
2. Claude Code'u yeniden başlatın ya da açık her session'da `/reload-plugins` çalıştırın.
3. Mod geliştirmediğiniz zamanlarda kapatın: `claude plugin disable probe-runner@kilimcininkoroglu-mods`.

## Nereye uzanır

Claude Code 2.1.283 üzerinde doğrulandı:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=/"^mcp__probe-runner__probe$"/}, tool.call{tool=/"^mcp__probe-runner__probe$"/}, command.run{command=probe-runner}
    ❯ ./register.ts calls: $.clock.after (via runInBackground), $.command.register, $.command.run (via runInBackground), $.env.get (via pluginDirs), $.fs.exists (via pluginDirs), $.process.run (via runProbe), $.prompt.submit (via runInBackground), $.session.cwd (via pluginDirs), $.session.repo (via pluginDirs), $.tool.register, $.ui.log (via runInBackground)

Reach L3: probe session'ı Claude API ile konuşur.

## Threat model

```
Threat model for probe-runner (reach L3)
1. Okur:         session'ın dizinini ve depo kökünü, HOME'u, her plugin'in manifest'ini; probe'un pane'ini ve transcript'ini.
2. Çalıştırır:   git, tmux ve claude çalıştıran python3 scripts/probe.py'yi.
3. Gönderir:     adımları, kendi Claude Code session'larına, sizin hesabınızla.
4. Saklar:       hiçbir şey; probe'un dizini, transcript'leri ve inline store dosyaları silinir.
5. Düşman girdi: adımlar ve plugin yolları sizden ya da modelden gelir ve claude ile tmux'a asla bir shell üzerinden değil, argv olarak gider; bir adım probe session'ına kendi geçici deposunda tool çalıştırtabilir.
```

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10, üstünde build kırılır
    make typecheck   # .claude/types/ içindeki /plugin-types çıktısına ihtiyaç duyar
    make validate
    make test        # claude plugin test
