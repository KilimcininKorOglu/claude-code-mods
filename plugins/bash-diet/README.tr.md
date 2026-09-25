# bash-diet

Her Bash sonucunu model okumadan önce küçülten bir Claude Code Mod'u. Bilinen komutlar (git, test runner'lar, linter'lar, compiler'lar, package manager'lar, container'lar, dosya listeleri ve aramalar) kendi filtrelerinden geçer; diğer her komut genel bir cleanup alır. Bir filtre bir şeyi dışarıda bıraktığında tam çıktı, modelin açabileceği bir dosyada kalır.

## Ne yapar

1. Mod Bash tool'unu hook'lar, komutu çalıştırır ve çıktısını modelden önce okur: başarılı bir çağrının `stdout` ve `stderr`'i, başarısız bir exit'in hata metni. Subagent çağrıları da aynı hook'tan geçer.
2. Komutu bir shell'in okuduğu gibi okur. Öndeki değişkenler ve wrapper'lar (`FOO=1`, `timeout 60`, `nice`, `env`, `sudo`) soyulur. `cd app && cargo test` gibi bir zincirde, çıktı basan tek komut filtrelenir. Bir pipeline, son aşaması `grep` ya da `rg` olduğunda, ya da producer'dan sonra yalnız `cat`, `head` ya da takip etmeyen bir `tail` geldiğinde filtrelenir.
3. Bir filtre, bir kişinin çıktıyı okuma sebebi olan kısmı tutar, gerisini atar:
   - Geçen bir test koşusu sayı satırından ibarettir. Başarısız olan, her hatayı mesajıyla ve sizin kodunuzun frame'leriyle tutar.
   - Bir build diagnostic'lerini her birini bir kez, önce hataları, ve sonucu tutar.
   - Bir liste, bir arama ya da bir tablo satırlarını bir sınıra kadar tutar ve geri kalanın sayısıyla biter.
   - Progress bar'lar, download satırları, spinner'lar ve renk kodları her yerde gider.
4. Bazı filtreler yapılandırılmış bir formatı metinden daha iyi okur. Onlar için mod komuta bir flag ekler: `go test -json`, ne bir sayı, ne bir aralık, ne de bir format verildiğinde `git log -10`, `pytest --tb=short -q`, `ruff check --output-format=json`, `jest --json`, `vitest --reporter=json`, `eslint -f json`, `rspec --format json`, `rubocop --format json`, `phpstan analyse --error-format=json --no-progress`. Flag yalnız permission kontrolü yeni komutu modelin yazdığı komutla aynı okuduğunda eklenir. Argümanlar zaten bir format seçtiğinde, bir pipeline'da, bir zincirde, `sudo`'dan sonra ya da bir redirect ile hiçbir zaman eklenmez.
5. Çıktıdan kısa olmayan filtrelenmiş bir sonuç atılır ve model çıktıyı olduğu gibi okur. Eklenmiş bir flag'den sonra filtrelenmiş sonuç her zaman kalır, çünkü ham çıktı o zaman modelin istemediği bir formattadır.
6. Bir filtre satır bıraktığında ya da başarısız bir koşu 500 veya daha fazla karakter bastığında tam çıktı saklanır ve sonuç yoluyla biter:

       [full output: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]

   Engine sonucu zaten kestiyse dosya engine'in kendi kopyasıdır, değilse `$TMPDIR/bash-diet/` altında yeni bir dosyadır. O dizin en fazla 200 dosyayı 30 gün tutar.
7. Başarısız bir komut exit kodu ile bir hata olarak kalır: model `Exit code 1` ve filtrelenmiş metni bir tool hatası olarak okur.
8. Session başında, `/clear`'dan sonra ve bir compaction'dan sonra model bir not okur: kısaltılmış bir sonuç eksiksizdir, tam çıktı adı verilen yoldadır ve `BASH_DIET_RAW=1 <komut>` birebir byte'ları döndürür.
9. [sidebar](../sidebar) açıkken session'ın tasarrufu orada "Bash output" başlığı altında durur. Sidebar yokken status line taşır.

## Filtreler

| Aile | Komutlar |
|---|---|
| git | `git status`, `diff`, `show`, `log`, `push`, `fetch`, `pull`, `commit`, `branch`, `stash`, `checkout`, `switch`, `restore`, `add`, `worktree`; `yadm`; `gh pr`, `issue`, `run`, `release`; `glab mr`, `issue` |
| Rust, Go, Python | `cargo build`, `check`, `clippy`, `doc`, `test`, `nextest`, `install`, `run`; `go test`, `build`, `vet`, `get`, `mod`, `install`; `golangci-lint`; `pytest`, `ruff`, `mypy`, `pip`, `uv`, `poetry` |
| JavaScript | `npm`, `pnpm`, `yarn`, `bun` install'ları ve testleri, `jest`, `vitest`, `playwright`, `tsc`, `eslint`, `prettier`, `next build`, `prisma`, `deno` |
| JVM, Ruby, PHP, .NET | `mvn`, `mvnd`, `gradle`, `gradlew`, `sbt`; `rake test`, `rails test`, `rspec`, `rubocop`, `bundle install`; `php -l`, `phpunit`, `pest`, `paratest`, `artisan test`, `phpstan analyse`; `dotnet build`, `test`, `format`, `publish`, `pack`, `restore` |
| Apple | `swift build`, `swift test`, `xcodebuild` |
| Dosyalar ve sistem | `ls`, `find`, `grep`, `rg`, `tree`, `env` (credential değerleri maskelenir), `ps` |
| Container'lar ve cloud'lar | `docker ps`, `images`, `logs`, `build`, `pull`, `inspect`, `compose`; `kubectl` ve `oc` get ve logs; `helm list`; `aws`, `gcloud`; `terraform` ve `tofu` plan ve apply; `pulumi`; `curl`, `wget` |
| Built-in kurallar | `gcc`, `clang` ve `cc`, `make`, `cmake`, `brew`, `rsync`, `df`, `du`, `ping`, `shellcheck` |

Bir dosyanın `cat`, `head` ve `tail`'i hiçbir zaman filtrelenmez: model tam o satırları istedi.

## Kendi kurallarınız

Hiçbir filtrenin tanımadığı bir komut bir kural alabilir. Kurallar iki dosyada durur:

- `~/.claude/bash-diet/filters.json`, her proje için. Olduğu gibi çalışır.
- `<repository>/.bash-diet/filters.json`, tek bir proje için. Yalnız `/bash-diet trust`'tan sonra çalışır ve içeriği değiştiğinde yeniden durur, çünkü clone'lanmış bir repository ile gelen bir dosya modelden çıktı gizleyebilir.

Sizin bir kuralınız, aynı komut için modun kendi filtresinden önce gelir. Adımlar bu sırayla çalışır, her biri isteğe bağlıdır:

```json
{
  "filters": {
    "deploy": {
      "description": "the deploy script: only the steps and the result",
      "match_command": "^\\./scripts/deploy\\.sh( |$)",
      "strip_ansi": true,
      "replace": [{ "pattern": "\\d+ms", "replacement": "Nms" }],
      "match_output": [{ "pattern": "nothing to deploy", "message": "deploy: nothing to do", "unless": "(?i)error" }],
      "keep_lines_matching": ["^(step|error|done)"],
      "truncate_lines_at": 200,
      "head_lines": 20,
      "tail_lines": 10,
      "max_lines": 40,
      "on_empty": "deploy: done"
    }
  }
}
```

- `match_command`, değişkenlerden ve wrapper'lardan sonraki komut kelimeleri üzerinde bir JavaScript regex'idir. Baştaki `(?i)` büyük-küçük harfi yok sayar.
- `strip_lines_matching` eşleştiği satırları atar. `keep_lines_matching` yalnız onları tutar. Bir kural ikisinden birini alır.
- `match_output`, tüm çıktı `pattern` ile eşleştiğinde ve `unless` ile eşleşmediğinde yalnız `message` ile cevap verir.
- `head_lines` ve `tail_lines` iki ucu arada bir sayı ile tutar. `max_lines` sonra satırları sınırlar.

Hatalı bir dosya iyi kurallarını tutar ve bir transcript satırı her hatayı adıyla söyler. `/bash-diet filters` iki dosyayı, kurallarını ve built-in kuralları listeler.

## Komut

    /bash-diet                               on ya da off, exclude'lar ve bu session'ın tasarrufu
    /bash-diet on | off                      varsayılan on
    /bash-diet exclude <prefix | ^regex>     o komut filtresiz çalışır; excludes listeler, include birini geri alır
    /bash-diet filters                       kural dosyaları, kuralları, built-in kurallar
    /bash-diet trust | untrust               bu repository'nin .bash-diet/filters.json dosyasını çalıştırır ya da durdurur
    /bash-diet gain                          son 90 günün tasarrufu, en çok kazandıran aileler
    /bash-diet gain project | daily | graph | history
    /bash-diet cost                          bu session'ın harcaması ve dışarıda tutulan token'ların maliyeti ne olurdu
    /bash-diet discover [days] [all]         modelin önceki session'larda okuduğu çıktı, filtreye göre, ve hiçbir filtrenin okumadığı komutlar
    /bash-diet learn [days] [write]          bir CLI hatası ile başarısız olan komutlar ve onlardan sonra çalışan biçim

- `gain`, `~/.claude/bash-diet/gain/` içindeki kayıtları okur: session ve gün başına bir dosya, 90 gün tutulur. Bir token dört karakter olarak tahmin edilir.
- `cost`, context dışında tutulan token'ları modelin Eylül 2026 liste fiyatlarıyla fiyatlar: bir kez cache write fiyatıyla, ve sonraki her request için yeniden cache read fiyatıyla.
- `discover` ve `learn` varsayılan olarak bu projenin son 30 günlük transcript'lerini okur. `discover all` her projenin transcript'lerini okur; hemen cevap verir ve raporu bir transcript satırı olarak arkadan gelir.
- `learn` yalnız bilinmeyen bir flag, bulunmayan bir komut, eksik bir argüman ya da bir syntax hatası ile başarısız olan ve üç çağrı içinde çalışan benzer bir komutun takip ettiği tek bir komutu sayar. `learn write` çiftleri repository'deki `.claude/rules/cli-corrections.md` dosyasına yazar; model onu sonraki session'larda okur. Credential taşıyabilecek bir komut hiçbir zaman yazılmaz.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bash-diet@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Aynı amaçla Bash komutlarını yeniden yazan başka bir araç kullanıyorsanız onu kapatın, böylece her çıktı bir kez filtrelenir.
3. Bir projenin kendi kurallarını tutmak için `.bash-diet/filters.json` dosyasını yazın ve o projede `/bash-diet trust` çalıştırın.

## Nereye uzanır

Claude Code 2.1.282 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=bash-diet}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via gainCommand, pruneGain, pruneRecall, recordGain, transcriptsOf), $.command.register, $.env.get (via locate, recallDir), $.fs.exists (via gainFiles, refreshFile, transcriptDirs), $.fs.list (via gainFiles, pruneRecall, transcriptDirs, transcriptsOf), $.fs.read (via gainCommand, refreshFile, seedGain, wholeText), $.fs.stat (via pruneRecall, refreshFile, transcriptsOf), $.fs.write (via keepFull, recordGain, writeLearned), $.process.run (via locate, pruneGain, pruneRecall, recallDir, recordGain, writeLearned), $.process.spawn (via callsIn), $.session.id, $.session.model (via costCommand), $.session.root (via locate), $.session.usage (via costCommand), $.sidebar.set (via showGain), $.store.get, $.store.set (via setEnabled, setExcludes, setTrusted), $.tool.check (via withPlanFlags), $.ui.log (via activeRules, discoverAll, refreshFile, report), $.ui.status (via showGain)

Reach L2, dosya yazar ve process çalıştırır.

    1. Okur:     her Bash komutunu ve çıktısını; iki filters.json dosyasını; bu session'ın modelini, harcamasını ve id'sini; discover ve learn için ~/.claude/projects altındaki transcript'leri
    2. Çalıştırır: modelin kendi Bash komutunu, permission kontrolü izin verdiğinde eklenmiş bir format flag'i ile; git rev-parse, mkdir, rm (yalnız kendi dosyalarını) ve cat (transcript'leri)
    3. Gönderir: çıktının yerine filtrelenmiş sonucu modele; makineden hiçbir şey çıkmaz
    4. Saklar:   $TMPDIR/bash-diet içinde tam çıktıları (200 dosya, 30 gün); ~/.claude/bash-diet/gain içinde tasarruf kayıtlarını (90 gün); learn write ile .claude/rules/cli-corrections.md; $.store içinde on/off, exclude'lar ve trust edilen kural dosyalarının hash'leri
    5. Düşman girdi: bir komutun çıktısı yalnız regex'lerden ve JSON.parse'tan geçer ve hiçbir zaman çalıştırılmaz; bir proje kural dosyası yalnız /bash-diet trust'tan sonra ve SHA-256'sı tuttuğu sürece çalışır; credential benzeri adların env değerleri maskelenir

## Sınırlar

- Bir filtre çıktının bilinen şeklini okur. Çıktı formatını değiştiren bir araç, bir filtrenin olması gerekenden azını tutmasına yol açabilir; tam çıktı dosyası ve `BASH_DIET_RAW=1` geri dönüş yollarıdır.
- Arka plana alınmış bir komut (`run_in_background`) filtrelenmez: sonucu bir task id'dir.
- `$(...)` içindeki, bir heredoc'taki, bir process substitution'daki ya da çıktısı bir dosyaya redirect edilen bir komut filtrelenmez.
- Çıktı basan birden çok komuttan oluşan bir zincir yalnız genel cleanup'ı alır (renk kodları, carriage-return yeniden çizimleri, tekrarlanan satırlar).
- `output-flood` gördüğü sonucu ölçer. Bunun filtrelenmiş sonuç olup olmadığı, engine'in iki modun hook'larını çalıştırdığı sıraya bağlıdır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
