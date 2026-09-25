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
4. İki komutta mod çıktıyı küçülten bir flag ekler: ne bir sayı, ne bir aralık, ne de bir format verildiğinde `git log -10`, ve `pytest --tb=short -q`. Hiçbir aracı daha büyük bir formata (JSON) geçirmez. Başarısız bir komutun metni hook'a 10.000 karakterde kesilmiş gelir, ve bir JSON raporu bu sınırı düz metinden çok daha erken aşar. Model JSON'u kendisi istediğinde (`go test -json`, `jest --json`, `eslint -f json`, `rspec --format json`, `rubocop --format json`, `phpstan analyse --error-format=json`, `ruff check --output-format=json`), filtre o raporu okur. Flag yalnız permission kontrolü yeni komutu modelin yazdığı komutla aynı okuduğunda eklenir. Argümanlar zaten bir format seçtiğinde, bir pipeline'da, bir zincirde, `sudo`'dan sonra ya da bir redirect ile hiçbir zaman eklenmez.
5. Çıktının %5'inden ya da 40 karakterden az tasarruf eden filtrelenmiş bir sonuç atılır ve model çıktıyı olduğu gibi okur; bu sizin kurallarınız için de geçerlidir. Bir credential değeri maskelenmiş bir `env` ya da `printenv` listesi bunun istisnasıdır: çıktının yerini her zaman alır ve onun için tam çıktı dosyası tutulmaz, çünkü o dosya maskelenen değerleri taşırdı. `BASH_DIET_RAW=1 env` onları döndürür. Daha küçük bir tasarruf yalnız modelin okuduğunu değiştirir ve kimsenin kazanmadığı bir küçülmeyi sayar. Eklenmiş bir flag'den sonra filtrelenmiş sonuç her zaman kalır, çünkü ham çıktı o zaman modelin istemediği bir formattadır. Claude Code 30.000 karakteri geçen bir çıktıyı bir dosyaya yazar ve modele yalnız 2KB'lık bir önizleme ile dosyanın yolunu verir. Mod o dosyanın tamamını filtreler, ama filtrelenmiş sonuç yalnız o önizlemeden kısa olduğunda kalır. Tasarruf da bu önizlemeye göre sayılır.
6. Bir filtre satır bıraktığında ya da başarısız bir koşu 500 veya daha fazla karakter bastığında tam çıktı saklanır ve sonuç yoluyla biter:

       [full output: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]

   Engine sonucu zaten kestiyse dosya engine'in kendi kopyasıdır, değilse `$TMPDIR/bash-diet/` altında yeni bir dosyadır. O dizin en fazla 200 dosyayı 30 gün tutar. Başarısız bir komutun metni hook'a Claude Code tarafından 10.000 karakterde kesilmiş gelir ve ortası hiçbir yere yazılmaz. O durumda dosya yalnız gelen kısmı tutar ve satır bunu söyler:

       [output cut by Claude Code at 10000 characters; the middle is lost: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]
7. Başarısız bir komut exit kodu ile bir hata olarak kalır: model `Exit code 1` ve filtrelenmiş metni bir tool hatası olarak okur.
8. Session başında, `/clear`'dan sonra ve bir compaction'dan sonra model bir not okur: kısaltılmış bir sonuç eksiksizdir, tam çıktı adı verilen yoldadır ve `BASH_DIET_RAW=1 <komut>` birebir byte'ları döndürür.
9. [sidebar](../sidebar) açıkken session'ın tasarrufu orada "Bash output" başlığı altında durur. Sidebar yokken status line taşır.

## Filtreler

Modun kendi filtresi olan bütün komutlar. `*` ile işaretli komut 4. maddedeki flag'i alır.

| Aile | Komutlar |
|---|---|
| git | `git status`, `git diff`, `git show`, `git log`\*, `git push`, `git fetch`, `git pull`, `git commit`, `git branch`, `git stash`, `git checkout`, `git switch`, `git restore`, `git add`, `git worktree`, `git tag` (liste her uçtan on tag ve toplam sayıyı tutar), `git remote -v`; `yadm status`, `yadm diff`, `yadm log`\* |
| GitHub, GitLab | `gh pr`, `gh issue`, `gh run`, `gh release`; `glab mr`, `glab issue` |
| Rust | `cargo build`, `cargo check`, `cargo clippy`, `cargo doc`, `cargo run`, `cargo test`, `cargo nextest`, `cargo install`; `cargo fmt` ve `rustfmt` (bir check, her dosyayı ekleyeceği ve sileceği satır sayısıyla verir) |
| Go | `go test`, `go build`, `go vet`, `go get`, `go mod`, `go install`; `golangci-lint`, `golangci-lint run`; `gofmt -l` ve `-d`, `go fmt` |
| Python | `pytest`\*; `ruff`, `ruff check`, `ruff format`; `mypy`; `flake8` ve `pylint` (kurala göre gruplanır); `black`; `pip` ve `pip3`: `list`, `install`, `uninstall`, `sync`, `download` ve diğer bütün subcommand'lar; `uv pip`, `uv sync`, `uv add`, `uv lock`; `poetry install`, `poetry add`, `poetry update` |
| JavaScript | `npm install`, `npm i`, `npm ci`, `npm ls`, `npm list`, `npm outdated`, `npm test`, `npm run`, `npm run-script`, `npm exec` ve diğer bütün `npm` subcommand'ları; `pnpm install`, `pnpm i`, `pnpm add`, `pnpm remove`, `pnpm rm`, `pnpm update`, `pnpm up`, `pnpm list`, `pnpm ls`, `pnpm outdated`, `pnpm why` ve diğer bütün `pnpm` subcommand'ları; `yarn install`, `yarn add`; `bun install`, `bun add`, `bun remove`, `bun test`; `deno test`, `deno lint`, `deno check`; `jest`, `vitest`, `mocha`, `cypress run`, `playwright`, `tsc`, `eslint`, `prettier`, `next build`, `prisma`; `webpack`, `vite`, `rollup`, `esbuild` (üretilen dosyalar sayıları ve en büyük üçü olarak) |
| JVM | `mvn`, `mvnd`, `gradle`, `gradlew`, `sbt` |
| Ruby | `rake test`, `rails test`, `ruby` (bir minitest dosyası), `rspec`, `rubocop`, `bundle install`, `bundle update` |
| PHP | `php -l`, `phpunit`, `pest`, `paratest`, `artisan test`, `phpstan analyse`, `phpstan analyze` |
| .NET | `dotnet build`, `dotnet test`, `dotnet format`, `dotnet publish`, `dotnet pack`, `dotnet restore` |
| Apple | `swift build`, `swift test`, `xcodebuild` |
| Dosyalar ve sistem | `ls`, ve dizin başına bir satır olarak `ls -R`; `-v` ile `cp`, `mv`, `rm`, `ln` (her hata, ilk beş yol ve toplam sayı), `gcp`, `gmv`, `grm`, `gln` adlarıyla da; `find`, `grep`, `egrep`, `rg`, `ast-grep`, `tree`, `env` ve `printenv` (credential değerleri maskelenir), `ps` |
| Container'lar | `docker ps`, `docker images`, `docker image ls`, `docker logs`, `docker build`, `docker pull`, `docker inspect`, `docker compose` (`ps`, `logs` ve diğerleri); `kubectl get`, `kubectl logs`, `kubectl describe`; `oc get`, `oc logs`; `helm list` |
| Cloud'lar ve ağ | `aws` (`aws s3 ls` sınırlı bir liste olarak, diğerleri JSON olarak), `gcloud`; `terraform plan`, `terraform apply`, `tofu plan`, `tofu apply`; `pulumi`; `curl`, `wget` |
| make | `make`, `gmake`: make'in dizin satırları ve derleyici kaynak alıntıları atılır, her runner'ın geçen bir test için yazdığı satır (`go test -v`, `cargo test`, `pytest -v`, `vitest --reporter=verbose`, `claude plugin test`) tek bir sayıya iner; her hata, özet ve diğer satırlar kalır |
| Built-in kurallar | `gcc`, `g++`, `cc`, `c++`, `clang`, `clang++` (`gcc-14` gibi bir sürüm ekiyle de); `cmake`, `cmake --build`; `brew install`, `upgrade`, `reinstall`, `update`, `tap`, `bundle`; `rsync`; `df`; `du`; `ping`, `ping6`; `shellcheck` |

- Bir runner ile başlatılan komut, başlattığı komut olarak okunur: `npx`, `bunx`, `pnpx`, `pnpm exec` ve `dlx`, `npm exec` ve `x`, `uv run`, `poetry run`, `pipenv run`, `bundle exec`, `python -m`, `python3 -m`, `php artisan`. Mutlak bir yol (`/usr/bin/git`) base name'i olarak, `git -C <dizin>` ise `git` olarak okunur.
- Diğer her komut genel temizliği alır: renk kodları, carriage-return ile yeniden çizimler ve tekrarlanan satırlar gider.
- Bir dosyanın `cat`, `head` ve `tail`'i hiçbir zaman filtrelenmez: model tam o satırları istedi.

## Ölçülen tasarruf

Ölçüm Claude Code 2.1.282, Claude Opus 5.5 ve bash-diet 0.1.2 ile yapıldı. Örnek repository Go, Rust, Node, Python, Gradle, .NET, Swift, Ruby, PHP ve C projeleri tutar. Her projede bir başarısız test ya da build hatası vardır. Headless bir session aynı 35 komutu sırayla çalıştırdı: git, build'ler, testler, linter'lar, paket listeleri, dosya listeleri ve aramaları, `docker ps` ve `images`, `env`, `ps`, `df`, `du`. Session üç kez mod ile, üç kez mod olmadan koştu. Sayılar üç koşunun medyanıdır.

| | Mod olmadan | Mod ile | Tasarruf |
|---|---|---|---|
| 35 Bash sonucunun karakteri | 79.555 | 33.366 | %58 |
| 35 sonucun bağlama eklediği token | 38.277 | 20.653 | %46 |
| Session sonunda bağlam | 107.946 | 90.557 | %16 |
| Bütün request'lerin input token'ı | 2.856.172 | 2.512.370 | %12 |
| Session maliyeti | $1,00 | $0,78 | %21 |

- Bir sonucun token'ı, komutu çalıştıran request'ten sonrakine bağlamın büyümesidir, o request'in output token'ı çıkarılarak. Bu sayı çağrının kendisi için yaklaşık 100 token içerir, ve hiçbir filtre onu küçültmez.
- Session'ın kendi prompt'u, tool'ları ve talimatları iki koşuda da aynıdır. Bu yüzden bütün session'daki tasarruf sonuçlardaki tasarruftan küçüktür.

35 sonucun bağlam token'ı, aileye göre. Her sayı, ailedeki komutların medyanlarının toplamıdır.

| Aile | Çalışan komutlar | Mod olmadan | Mod ile | Tasarruf |
|---|---|---|---|---|
| git | `git status`, `git diff`, `git log`, `git branch -a`, `git show --stat` | 1.598 | 890 | %44 |
| Go | `go build`, `go vet`, `go test` | 308 | 226 | %27 |
| Rust | `cargo build`, `cargo clippy`, `cargo test` | 1.682 | 923 | %45 |
| Node | `npm install`, `npx tsc`, `npx vitest run`, `npm ls` | 1.191 | 1.012 | %15 |
| Python | `pytest`, `python3 -m pip list` | 1.635 | 1.287 | %21 |
| Gradle | `gradle build`, `gradle test` | 757 | 540 | %29 |
| .NET | `dotnet build`, `dotnet test` | 1.221 | 697 | %43 |
| Swift | `swift build`, `swift test` | 1.443 | 915 | %37 |
| Ruby | `rake test` | 1.092 | 206 | %81 |
| PHP | `php -l` | 112 | 103 | %8 |
| C | `make` | 281 | 273 | %3 |
| Dosyalar | `ls -la`, `find -name`, `grep -rn` | 6.974 | 2.384 | %66 |
| Container'lar | `docker ps -a`, `docker images` | 10.423 | 2.270 | %78 |
| Sistem | `env`, `ps aux`, `df -h`, `du -sh` | 9.560 | 8.927 | %7 |
| Toplam | 35 komut | 38.277 | 20.653 | %46 |

- En az tasarruf `env` (filtre yalnız credential değerlerini maskeler), `php -l`, `make` ve `go vet` komutlarındadır. Bunların çıktısı zaten birkaç satırdır ve sayılarının çoğu çağrının kendi 100 token'ıdır.

O session'dan sonra eklenen filtreler, bir deneme projesinde her biri bir kez çalıştırılarak, sonucun karakter sayısıyla ölçüldü:

| Komut | Mod olmadan | Mod ile | Tasarruf |
|---|---|---|---|
| `flake8` | 2.091 | 775 | %63 |
| `pylint` | 2.898 | 1.049 | %64 |
| `gofmt -d` | 328 | 56 | %83 |
| `black --check --diff` | 1.104 | 286 | %74 |
| `webpack` | 779 | 117 | %85 |
| `vite build` (bir parse hatası) | 1.562 | 291 | %81 |
| `esbuild` (bir parse hatası) | 1.044 | 109 | %90 |
| `rollup` (bir parse hatası) | 1.554 | 178 | %89 |
| `mocha` | 897 | 455 | %49 |
| `cypress run` | 5.517 | 327 | %94 |
| Bu modun `make check`'i (lint, typecheck, validate, 129 test) | 15.131 | 1.684 | %89 |
| `go test -v` çalıştıran `make test` | 563 | 307 | %45 |
| `pytest -v` çalıştıran `make test` | 1.382 | 928 | %33 |

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

- `gain`, `~/.claude/bash-diet/gain/` içindeki kayıtları okur: session ve gün başına bir dosya, 90 gün tutulur. Her rapor önce ve sonraki ölçülen karakter sayısını verir. Token sayısı, token başına dört karakterle yapılan bir tahmindir. `history` ve `graph` yalnız karakter verir.
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
    2. Çalıştırır: modelin kendi Bash komutunu, permission kontrolü izin verdiğinde eklenmiş, çıktıyı kısaltan bir flag ile; git rev-parse, mkdir, rm (yalnız kendi dosyalarını) ve cat (transcript'leri)
    3. Gönderir: çıktının yerine filtrelenmiş sonucu modele; makineden hiçbir şey çıkmaz
    4. Saklar:   $TMPDIR/bash-diet içinde tam çıktıları (200 dosya, 30 gün); ~/.claude/bash-diet/gain içinde tasarruf kayıtlarını (90 gün); learn write ile .claude/rules/cli-corrections.md; $.store içinde on/off, exclude'lar ve trust edilen kural dosyalarının hash'leri
    5. Düşman girdi: bir komutun çıktısı yalnız regex'lerden ve JSON.parse'tan geçer ve hiçbir zaman çalıştırılmaz; bir proje kural dosyası yalnız /bash-diet trust'tan sonra ve SHA-256'sı tuttuğu sürece çalışır; credential benzeri adların env değerleri maskelenir

## Sınırlar

- Bir filtre çıktının bilinen şeklini okur. Çıktı formatını değiştiren bir araç, bir filtrenin olması gerekenden azını tutmasına yol açabilir; tam çıktı dosyası ve `BASH_DIET_RAW=1` geri dönüş yollarıdır.
- Başarısız bir komutun 10.000 karakteri aşan çıktısının ortası, mod'dan önce Claude Code tarafından atılır. Mod o kısmı geri getiremez. Yalnız kesildiğini söyler.
- Arka plana alınmış bir komut (`run_in_background`) filtrelenmez: sonucu bir task id'dir.
- `$(...)` içindeki, bir heredoc'taki, bir process substitution'daki ya da çıktısı bir dosyaya redirect edilen bir komut filtrelenmez.
- Çıktı basan birden çok komuttan oluşan bir zincir yalnız genel cleanup'ı alır (renk kodları, carriage-return yeniden çizimleri, tekrarlanan satırlar).
- `output-flood` 0.3.0 ve sonrası, iki mod hangi sırada yüklenirse yüklensin filtrelenmiş sonucu ölçer. bash-diet'ten sonra yüklenen daha eski bir `output-flood` çıktıyı filtreden önce ölçer, ve notu modelin hiç okumadığı bir boyutu söyler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
