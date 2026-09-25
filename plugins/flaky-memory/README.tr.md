# flaky-memory

Hangi testin hangi kod üzerinde başarısız olduğunu hatırlayan bir Claude Code Mod'u. Son 7 günde aynı kod üzerinde hem geçmiş hem de kalmış bir test başarısız olduğunda mod o Bash sonucuna bir not ekler, böylece model flaky bir test için kod değiştirmek yerine testi tekrar çalıştırır.

## Ne yapar

Test çalıştıran bir Bash komutundan önce mod working tree'nin bir parmak izini alır: `git rev-parse HEAD`, `git diff HEAD` ve untracked dosyaların adları, 64 bit FNV-1a ile hash'lenir. Komuttan sonra çıktının geçti ya da kaldı diye adlandırdığı testleri okur ve test başına bir koşuyu o parmak iziyle saklar.

Bir parmak izinde hem bir geçiş hem de bir kalma varsa o test flaky'dir. Kod değişikliğinden sonraki bir kalma flaky değildir, çünkü parmak izi farklıdır.

Model, başarısız bir koşunun Bash sonucundan sonra şu notu okur:

    flaky-memory: go:TestFlip failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once. It may be flaky rather than broken by this change: run it again before you change code for it.

Aynı anda sizin için bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır talimat cümlesi olmadan yalnız bulguyu taşır:

    flaky-memory: go:TestFlip failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once

[sidebar](../sidebar) açıkken bu satır oraya gider, stream'in içinde bir kayıt olarak: `failed 2 of 3` kırmızı, açıklama soluk çizilir; transcript temiz kalır. Pencere artık o testin tek bir tree üzerinde hem geçişini hem kalmasını tutmadığında kayıt düşer ve yeni bir kayıt bunu söyler, `is no longer flaky` yeşil çizilir:

    flaky-memory: no longer flaky
    go:TestFlip is no longer flaky: nothing in the last 7 days has it passing and failing on the same code

`/flaky-memory reset` kaydı kapanış satırı olmadan kaldırır, çünkü onu siz istediniz. Sidebar kapalıyken ya da o mod kurulu değilken yukarıdaki transcript satırı yazılır.

### Test komutları

Bir Bash komutu, şunlardan birini içeriyorsa test komutudur: `go test`, `pytest`, `python -m pytest`, `jest`, `vitest`, `bun test`, `cargo test`, `cargo nextest`, `phpunit` (`vendor/bin/phpunit` de), `npm test`, `pnpm test`, `yarn test` (`run` ile de), `bun run test`, `deno test`, `rspec`, `make test`, `mvn test`, `gradle test` (`./gradlew test` de), `dotnet test`. Diğer komutlara dokunulmaz ve onlar için hiçbir git komutu çalışmaz.

### Çıktının göstermesi gerekenler

| Runner | Kaldı | Geçti |
|---|---|---|
| go test | `--- FAIL: TestX` | `--- PASS: TestX` (`-v` ile) |
| pytest | `FAILED path::test`, `ERROR path::test` | `path::test PASSED` (`-v`), `PASSED path::test` (`-rA`) |
| jest, vitest, bun | `✕`, `×`, `✗`, `(fail)` satırları | `✓`, `√`, `(pass)` satırları |
| cargo test | `test x ... FAILED` | `test x ... ok` |
| PHPUnit | `1) Class::method` | yok |
| deno test | `name ... FAILED` | `name ... ok` |
| dotnet test | `Failed Name [12 ms]` | `Passed Name [1 ms]` |
| rspec | `rspec path:line # name` yeniden koşma listesi | yok |
| Maven surefire | `name(Class)  Time elapsed … <<< FAILURE!` | yok |
| Gradle | `Class > test FAILED` | yok |

Hiçbir geçen testi adlandırmayan bir koşu, 0 ile çıktığında, aynı komutun son başarısız koşusunda kalan testler için yine de geçiş sayılır. Yani `-v` olmadan `go test ./...`, PHPUnit, rspec, Maven ve Gradle de çalışır: kalmaları okunur ve 0 ile çıkan sonraki koşuları o testleri geçmiş sayar.

Yalnız pencere içinde kalan testler saklanır. Binlerce geçen testi olan bir suite hiçbir şey saklamaz. Her test son 7 günün en fazla 50 koşusunu tutar.

## Komut

    /flaky-memory                   bu repository'nin flaky testleri, en çok kalan üstte
    /flaky-memory reset             bu repository'nin koşularını unut
    /flaky-memory reset <test id>   tek bir testin koşularını unut, örneğin go:TestFlip
    /flaky-memory on | off          test koşularını kaydet ya da kaydetme (varsayılan on); off saklanan koşuları korur

Repository, git common directory'dir; yani bir repository'nin worktree'leri koşularını paylaşır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install flaky-memory@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

Claude Code'u yeniden başlatın. Mod'un key'e ve ayara ihtiyacı yoktur. Bir git repository'sindeki ilk test koşusundan itibaren kaydeder.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=flaky-memory}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via learn, runCommand), $.command.register, $.process.run (via git), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.delete (via forget), $.store.get (via isEnabled, loadHistory), $.store.set (via forget, learn, runCommand), $.ui.log

Reach L2, git çalıştırır.

    1. Okur:     her Bash test komutunun çıktısını; git üzerinden working tree'yi
    2. Çalıştırır: git rev-parse, git diff HEAD ve git ls-files --others, salt okuma, argv ile, her test komutundan önce
    3. Gönderir: flaky bir testin başarısız koşusundan sonra modele bir not ve size bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   repository başına, $.store içinde: kalan her testin son 7 gündeki koşularını (zaman, parmak izi, geçti mi) ve her komutun en son kalan testlerini
    5. Düşman girdi: test çıktısı güvenilmez metindir; sabit satır kalıplarına karşı eşleştirilir ve bir test adı yalnız saklanır ve geri yazılır, hiç çalıştırılmaz

## Sınırlar

- git repository'si dışında hiçbir şey kaydedilmez.
- 4 MiB'ı aşan bir diff parmak izi almaz ve o koşu kaydedilmez.
- Parmak izine untracked dosyaların yalnız adları girer, içerikleri değil. Untracked bir dosyanın içindeki değişiklik parmak izini değiştirmez.
- Tree dışındaki durum (bir veritabanı, bir cache, `/tmp` altındaki bir dosya) parmak izinde değildir. Ona bağlı bir test flaky görünebilir.
- Kesilen bir koşu ve arka plana alınan bir koşu kaydedilmez, çünkü çıktıları eksiktir.
- Runner id ön ekleri (`go:`, `pytest:`, `js:`, `cargo:`, `phpunit:`, `deno:`, `dotnet:`, `rspec:`, `maven:`, `gradle:`) iki runner'ın adlarını ayırır. go id'si paket adı taşımaz, yani aynı test adına sahip iki paket tek id paylaşır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
