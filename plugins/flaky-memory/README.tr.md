# flaky-memory

Bir test başarısız olur. Model, son değişikliğinin testi bozduğunu düşünür ve sorunsuz kodu "düzeltmeye" başlar. Oysa bazı testler kararsızdır: aynı kod üzerinde bir saat önce geçmiştir. Bu mod, hangi testin hangi kod üzerinde başarısız olduğunu hatırlar. Son 7 günde aynı kod üzerinde hem geçmiş hem de başarısız olmuş bir test yeniden başarısız olursa o Bash sonucuna bir not eklenir. Böylece model, kararsız bir test için kodu değiştirmek yerine testi yeniden çalıştırır.

## Ne yapar

Test çalıştıran bir Bash komutundan önce mod working tree'nin parmak izini alır. Parmak izi `git rev-parse HEAD`, `git diff HEAD` ve untracked dosyaların adlarından, 64 bit FNV-1a ile hesaplanır. Komuttan sonra mod, çıktının hangi testleri geçmiş ya da başarısız olarak gösterdiğini okur. Ardından her test için bu parmak iziyle bir çalıştırma kaydı saklar.

Bir parmak izi aynı testin hem geçişini hem başarısızlığını içeriyorsa test kararsızdır. Kod değiştikten sonra gelen bir başarısızlık kararsızlık sayılmaz, çünkü parmak izi farklıdır.

Başarısız bir çalıştırmanın Bash sonucundan sonra model şu notu okur:

    flaky-memory: go:TestFlip failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once. It may be flaky rather than broken by this change: run it again before you change code for it.

Aynı anda size tek bir satır gösterilir. Bu sayede modele ne söylendiğini görürsünüz. Satır talimat içermez, yalnız bulguyu içerir:

    flaky-memory: go:TestFlip failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once

[sidebar](../sidebar) açıksa bu satır transcript yerine sidebar'ın stream'ine yazılır ve transcript temiz kalır. Sidebar'da `failed 2 of 3` kırmızı, açıklama soluk renktedir. Zaman penceresi o testin aynı tree üzerindeki bir geçişini ve bir başarısızlığını artık içermiyorsa kayıt kaldırılır. Yerine bu durumu bildiren yeni bir kayıt yazılır ve `is no longer flaky` yeşil renktedir:

    flaky-memory: no longer flaky
    go:TestFlip is no longer flaky: nothing in the last 7 days has it passing and failing on the same code

`/flaky-memory reset` kaydı kapanış satırı olmadan kaldırır, çünkü bu işlemi siz istemişsinizdir. Sidebar yoksa satır yukarıdaki gibi transcript'e yazılır.

### Test komutları

Bir Bash komutu şunlardan birini içeriyorsa test komutu sayılır: `go test`, `pytest`, `python -m pytest` (`python3` de), `jest`, `vitest`, `bun test`, `cargo test`, `cargo nextest`, `phpunit` (`vendor/bin/phpunit` de), `npm test`, `pnpm test`, `yarn test` (`run` ile de), `bun run test`, `deno test`, `rspec`, `make test`, `mvn test`, `gradle test` (`./gradlew test` de), `dotnet test`. Diğer komutlara dokunulmaz ve bu komutlar için hiçbir git komutu çalıştırılmaz.

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

Geçen hiçbir testi listelemeyen bir çalıştırma 0 ile biterse, aynı komutun son başarısız çalıştırmasında başarısız olan testler geçmiş sayılır. Bu sayede `-v` olmadan `go test ./...`, PHPUnit, rspec, Maven ve Gradle de desteklenir: başarısızlıkları okunur ve 0 ile biten bir sonraki çalıştırma bu testleri geçmiş sayar.

Yalnız zaman penceresi içinde başarısız olmuş testler saklanır. Bu yüzden binlerce geçen testten oluşan bir test takımı için hiçbir şey saklanmaz. Her test için son 7 günden en fazla 50 çalıştırma tutulur.

## Komut

    /flaky-memory                   bu repository'nin kararsız testleri, en çok başarısız olan başta
    /flaky-memory reset             bu repository'nin çalıştırma kayıtlarını siler
    /flaky-memory reset <test id>   tek bir testin çalıştırma kayıtlarını siler, örneğin go:TestFlip
    /flaky-memory on | off          test çalıştırmalarını kaydeder ya da kaydetmez (varsayılan açık); kapalıyken saklanan kayıtlar korunur

Mod bir repository'yi git common dizininden tanır. Bu yüzden aynı repository'nin worktree'leri çalıştırma kayıtlarını ortak kullanır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install flaky-memory@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın. Mod bir key ya da ayar gerektirmez.
2. Mod, bir git repository'si içindeki ilk test çalıştırmasından itibaren kayıt tutmaya başlar.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=flaky-memory}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via learn, runCommand), $.command.register, $.process.run (via git), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.delete (via forget), $.store.get (via isEnabled, loadHistory), $.store.set (via forget, learn, runCommand), $.ui.log

Reach L2: git çalıştırır.

    1. Okur:         her Bash test komutunun çıktısını; git ile working tree'yi
    2. Çalıştırır:   her test komutundan önce argv ile salt okunur git rev-parse, git diff HEAD ve git ls-files --others
    3. Gönderir:     kararsız bir testin başarısız çalıştırmasından sonra modele bir not ve size bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       her repository için $.store içinde: başarısız her testin son 7 gündeki çalıştırmalarını (zaman, parmak izi, geçti mi) ve her komutun son çalıştırmasında başarısız olan testleri
    5. Düşman girdi: test çıktısı güvenilmeyen bir metindir; sabit satır desenleriyle karşılaştırılır; test adı yalnız saklanır ve geri yazılır, hiçbir zaman çalıştırılmaz

## Sınırlar

- Bir git repository'si dışında hiçbir şey kaydedilmez.
- 4 MiB'ı aşan bir diff için parmak izi alınmaz ve o çalıştırma kaydedilmez.
- Parmak izine untracked dosyaların yalnız adları girer, içerikleri girmez. Untracked bir dosyanın içindeki değişiklik parmak izini değiştirmez.
- Tree dışındaki durum (bir veritabanı, bir cache, `/tmp` altındaki bir dosya) parmak izine girmez. Bu duruma bağlı bir test kararsız görünebilir.
- Yarıda kesilen ya da arka plana gönderilen bir çalıştırma kaydedilmez, çünkü çıktısı eksiktir.
- Id'lerdeki runner ön ekleri (`go:`, `pytest:`, `js:`, `cargo:`, `phpunit:`, `deno:`, `dotnet:`, `rspec:`, `maven:`, `gradle:`) iki runner'ın test adlarını birbirinden ayırır. go id'si paket adını içermez. Bu yüzden aynı test adına sahip iki paket tek bir id'yi paylaşır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
