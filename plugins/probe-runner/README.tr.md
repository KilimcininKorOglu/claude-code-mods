# probe-runner

Mod geliştirme için: plugin'lerin canlı kontrolünü tmux içinde yeni bir Claude Code session'ında çalıştırır, adımları tek tek yazar, pane'i ve transcript'i toplar, sonra geçici dizini, transcript'lerini ve inline store dosyalarını siler.

> **Günlük kullanım için değil, bir geliştirme aracıdır.** Bu repository'nin mod'larını geliştirirken canlı kontrol etmek için yazıldı: model yalnız test edilen plugin'lerle gerçek bir Claude Code session'ı başlatır, içine prompt'lar ve slash command'lar yazar ve ne olduğunu okur. Her probe senin hesabınla açılan gerçek bir session'dır; bu yüzden token harcar, yazdığı adımlar da geçici bir repository'de tool çalıştırabilir. Yalnız mod geliştirdiğin kendi makinene kur ve geliştirme yapmadığın zamanlarda kapat (`claude plugin disable probe-runner@kilimcininkoroglu-mods`).

## Ne yapar

Bir canlı kontrolün elle gerektirdiği her şeyi tek çağrıda yapar: geçici bir git repository'si, tmux, klasör güven sorusunun cevabı, `--plugin-dir`, art arda yazılan adımlar, toplanan pane ve transcript, ardından silinen dizin, transcript'ler ve inline store dosyaları. Rapor şöyle görünür:

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

1. `scripts/probe.py`, `/private/tmp/probe-runner-<rastgele>` altında bir git repository'si açar (`/private/tmp` olmayan sistemlerde sistemin geçici dizininde) ve orada bir tmux session'ında `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` ile `claude --setting-sources project --model <model> --plugin-dir <dizin> ...` başlatır. `--setting-sources project` senin kendi plugin'lerini ve hook'larını dışarıda tutar; yalnız test edilen plugin'ler yüklenir.
2. Klasör güven sorusunu cevaplar, prompt kutusunu bekler ve her adımı yazar. Bir tamamlama menüsü slash command'ın ilk Enter'ını yutabilir; bu yüzden kutu boşalana kadar Enter'a en fazla dört kez yeniden basılır.
3. Pane `esc to interrupt` göstermiyorsa, prompt kutusunu gösteriyorsa ve 3 saniye arayla iki bakışta değişmediyse adım bitmiş sayılır. Bir adım 5 dakikada probe'u durdurur; bir probe da 10 dakikada, yani `$.process.run`'ın en uzun bekleyebildiği sürede durur.
4. Rapor şunları içerir: pane'in son metni (yana yaslanmış sidebar kesilerek), özetlenmiş transcript (prompt'lar, cevaplar, tool çağrıları ve sonuçları, komut çıktıları, mod log satırları ve hook'ların eklediği context) ve silinenler.
5. Silmeden önce probe'un claude process'inin çıkmasını bekler, çünkü claude çıkarken transcript'ini yazar ve silinmiş bir dizini geri getirirdi. Geçici dizini, `<config dizini>/projects/<kodlanmış geçici yol>*` dizinlerini ve probe başladığından beri yazılan `*_inline-*.json` store dosyalarını siler (`<config dizini>`, ayarlıysa `CLAUDE_CONFIG_DIR`, değilse `~/.claude`'dur). Dışarıdan öldürülen bir probe (SIGTERM, SIGHUP) da temizliğini yapar.

Claude Code 2.1.283 üzerinde ölçüldü: iki slash command'lık bir probe bir tool çağrısı içinde 23 saniye sürdü; yani `$.process.run` beklemesi 10 saniyelik hook budget'ına bağlı değildir.

Bir probe'un test etmediği şey: kendi uzun yaşayan process'i olan bir mod (sage-memory'nin daemon'u), protokol aynıysa çalışan kurulu process'i yeniden kullanır. Bu yüzden probe checkout'taki hook'ları yükler ama daemon'daki bir değişikliği yüklemez.

## Kullanım

Model `mcp__probe-runner__probe` tool'unu çağırır (başta listelenir, ToolSearch'ün arkasında beklemez):

    { "plugins": ["pin-note"], "steps": ["/pin-note on", "/pin-note X", "/clear", "Sabitlenmiş not var mı?"], "model": "sonnet" }

Tool çağrısı probe'u bekler ve raporla cevap verir. Sen komutla çalıştırırsın:

    /probe-runner [--model <model>] <plugin>[,<plugin>...] <adım> ;; <adım> ;; ...

Komut hemen `started` der; rapor, probe bitince `/probe-runner:send` üzerinden modele kendi prompt'u olarak ulaşır. Engine bu komutu reddederse bir satır bunu söyler ve rapor plugin prompt'u olarak gider. Başarısız olan bir probe rapor yerine exit code'unu ve hata metnini döner.

Bir plugin, session'ın repository'sindeki `plugins/` dizini altında bir ad ya da bir path'tir (mutlak, `~/...` ya da session'ın dizinine göre). `.claude-plugin/plugin.json`'ı olmayan bir plugin hiçbir şey çalışmadan reddedilir. Model belirtilmezse `sonnet`'tir.

## Kurulum

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install probe-runner@kilimcininkoroglu-mods
```

Function hook'lar henüz early access aşamasında. Claude Code'u `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` ile başlat, ya da flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. `tmux` ve `python3` kur ve PATH'te tut.
2. Claude Code'u yeniden başlat ya da açık her session'da `/reload-plugins` çalıştır.
3. Mod geliştirmediğin zamanlarda kapat: `claude plugin disable probe-runner@kilimcininkoroglu-mods`.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=/"^mcp__probe-runner__probe$"/}, tool.call{tool=/"^mcp__probe-runner__probe$"/}, command.run{command=probe-runner}
    ❯ ./register.ts calls: $.clock.after (via runInBackground), $.command.register, $.command.run (via runInBackground), $.env.get (via pluginDirs), $.fs.exists (via pluginDirs), $.process.run (via runProbe), $.prompt.submit (via runInBackground), $.session.cwd (via pluginDirs), $.session.repo (via pluginDirs), $.tool.register, $.ui.log (via runInBackground)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: HOME

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
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
