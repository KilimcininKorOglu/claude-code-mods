# flaky-memory

Bir test başarısız olur, model son değişikliğinin onu bozduğunu sanır ve aslında sağlam olan kodu "düzeltmeye" girişir. Oysa bazen test sadece kararsızdır: aynı kodda bir saat önce geçmiştir. Bu mod hangi testin hangi kodda başarısız olduğunu hatırlar. Son 7 günde aynı kod üzerinde hem geçmiş hem de başarısız olmuş bir test yeniden başarısız olursa o Bash sonucuna bir not ekler; böylece model kararsız bir test için kodu değiştirmek yerine testi yeniden çalıştırır.

## Ne yapar

Test çalıştıran bir Bash komutundan önce mod working tree'nin parmak izini alır: `git rev-parse HEAD`, `git diff HEAD` ve untracked dosyaların adları, 64 bit FNV-1a ile hash'lenir. Komuttan sonra çıktının hangi testleri geçmiş ya da başarısız diye andığını okur ve her test için o parmak iziyle bir çalıştırma kaydeder.

Bir parmak izi aynı testin hem geçişini hem başarısızlığını taşıyorsa test kararsızdır. Kod değiştikten sonra gelen bir başarısızlık kararsızlık sayılmaz, çünkü parmak izi farklıdır.

Başarısız bir çalıştırmanın Bash sonucundan sonra model şu notu okur:

    flaky-memory: go:TestFlip failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once. It may be flaky rather than broken by this change: run it again before you change code for it.

Aynı anda sana tek bir satır düşer, böylece modele ne söylendiğini görürsün. Satırda talimat yoktur, yalnız bulgu vardır:

    flaky-memory: go:TestFlip failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once

[sidebar](../sidebar) açıksa bu satır transcript yerine onun stream'ine gider; `failed 2 of 3` kırmızı, açıklama soluktur; transcript temiz kalır. Zaman penceresi o testin tek bir tree üzerindeki geçişini ve başarısızlığını artık tutmuyorsa kayıt kalkar, yerine bunu söyleyen yeni bir kayıt gelir; `is no longer flaky` yeşildir:

    flaky-memory: no longer flaky
    go:TestFlip is no longer flaky: nothing in the last 7 days has it passing and failing on the same code

`/flaky-memory reset` kaydı kapanış satırı olmadan kaldırır, çünkü bunu sen istedin. Sidebar yoksa satır yukarıdaki gibi transcript'e düşer.

### Test komutları

Bir Bash komutu şunlardan birini içeriyorsa test komutu sayılır: `go test`, `pytest`, `python -m pytest` (`python3` de), `jest`, `vitest`, `bun test`, `cargo test`, `cargo nextest`, `phpunit` (`vendor/bin/phpunit` de), `npm test`, `pnpm test`, `yarn test` (`run` ile de), `bun run test`, `deno test`, `rspec`, `make test`, `mvn test`, `gradle test` (`./gradlew test` de), `dotnet test`. Diğer komutlar dokunulmadan geçer ve onlar için hiçbir git komutu çalışmaz.

### Çıktının göstermesi gerekenler

| Runner | Başarısız | Geçen |
|---|---|---|
| go test | `--- FAIL: TestX` | `--- PASS: TestX` (`-v` ile) |
| pytest | `FAILED path::test`, `ERROR path::test` | `path::test PASSED` (`-v`), `PASSED path::test` (`-rA`) |
| jest, vitest, bun | `✕`, `×`, `✗`, `(fail)` satırları | `✓`, `√`, `(pass)` satırları |
| cargo test | `test x ... FAILED` | `test x ... ok` |
| PHPUnit | `1) Class::method` | yok |
| deno test | `name ... FAILED` | `name ... ok` |
| dotnet test | `Failed Name [12 ms]` | `Passed Name [1 ms]` |
| rspec | `rspec path:line # name` yeniden çalıştırma listesi | yok |
| Maven surefire | `name(Class)  Time elapsed … <<< FAILURE!` | yok |
| Gradle | `Class > test FAILED` | yok |

Geçen hiçbir testi anmayan bir çalıştırma 0 ile çıkarsa, aynı komutun son başarısız çalıştırmasında düşen testler için geçiş sayılır. Böylece `-v` olmadan `go test ./...`, PHPUnit, rspec, Maven ve Gradle de çalışır: başarısızlıkları okunur, 0 ile çıkan bir sonraki çalıştırmaları da o testleri geçmiş sayar.

Yalnız pencere içinde başarısız olmuş testler saklanır; binlerce geçen testten oluşan bir test takımı hiçbir şey saklamaz. Her test son 7 günden en fazla 50 çalıştırma tutar.

## Komut

    /flaky-memory                   bu repository'nin kararsız testleri, en çok başarısız olan önce
    /flaky-memory reset             bu repository'nin çalıştırmalarını unutur
    /flaky-memory reset <test id>   tek bir testin çalıştırmalarını unutur, örneğin go:TestFlip
    /flaky-memory on | off          test çalıştırmalarını kaydeder ya da kaydetmez (varsayılan açık); off saklanan çalıştırmaları korur

Mod bir repository'yi git common dizininden tanır; yani aynı repository'nin worktree'leri çalıştırmalarını paylaşır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install flaky-memory@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat. Mod'un bir key'e ya da ayara ihtiyacı yoktur.
2. Bir git repository'si içindeki ilk test çalıştırmasından itibaren kaydetmeye başlar.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=flaky-memory}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via learn, runCommand), $.command.register, $.process.run (via git), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.delete (via forget), $.store.get (via isEnabled, loadHistory), $.store.set (via forget, learn, runCommand), $.ui.log

Reach L2: git çalıştırır.

    1. Okur:     her Bash test komutunun çıktısını; git üzerinden working tree'yi
    2. Çalıştırır: her test komutundan önce salt okunur git rev-parse, git diff HEAD ve git ls-files --others; argv ile
    3. Gönderir: kararsız bir testin başarısız çalıştırmasından sonra modele bir not ve sana bir satır; makineden dışarı bir şey çıkmaz
    4. Saklar:   repository başına $.store içinde: başarısız her testin son 7 gündeki çalıştırmalarını (zaman, parmak izi, geçti mi) ve her komutun en son düşürdüğü testleri
    5. Düşman girdi: test çıktısı güvenilmeyen metindir; sabit satır desenleriyle karşılaştırılır, test adı yalnız saklanır ve geri yazılır, hiçbir zaman çalıştırılmaz

## Sınırlar

- Git repository'si dışında hiçbir şey kaydedilmez.
- 4 MiB'ı aşan bir diff parmak izi almaz ve o çalıştırma kaydedilmez.
- Parmak izine untracked dosyaların yalnız adları girer, içerikleri değil. Untracked bir dosyanın içindeki değişiklik parmak izini değiştirmez.
- Tree dışındaki durum (bir veritabanı, bir cache, `/tmp` altındaki bir dosya) parmak izinde yoktur. Ona bağlı bir test kararsız görünebilir.
- Yarıda kesilen ya da arka plana gönderilen bir çalıştırma kaydedilmez, çünkü çıktısı eksiktir.
- Id'lerdeki runner ön ekleri (`go:`, `pytest:`, `js:`, `cargo:`, `phpunit:`, `deno:`, `dotnet:`, `rspec:`, `maven:`, `gradle:`) iki runner'ın test adlarını birbirinden ayırır. go id'si paket adı taşımaz, yani aynı test adına sahip iki paket tek bir id'yi paylaşır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
