# bash-diet

Bir Bash komutunun yazdırdığı çıktının büyük kısmı model için gereksizdir: progress bar'lar, yüzlerce başarılı test satırı, iki kez gelen aynı uyarı, renk kodları. Bunların hepsi context'e girer ve sonraki her istekte maliyeti ödenir. Bu mod, her Bash sonucunu model okumadan önce kısaltır. Bilinen komutlar (git, test runner'ları, linter'lar, derleyiciler, package manager'lar, container'lar, dosya listeleme ve arama) kendi filtrelerinden geçer. Diğer bütün komutlar genel bir temizlikten geçer. Bir filtre bir kısmı dışarıda bıraktığında tam çıktı, modelin açabileceği bir dosyada saklanır.

## Ne yapar

1. Mod Bash tool'unu izler. Komut çalıştıktan sonra çıktıyı modelden önce okur: başarılı bir komutta `stdout` ve `stderr`, başarısız bir çıkışta hata metni. Subagent çağrıları da aynı hook'tan geçer.
2. Mod komutu bir shell gibi okur. Komutun önündeki değişkenleri ve wrapper'ları (`FOO=1`, `timeout 60`, `nice`, `env`, `sudo`) ayırır. `cd app && cargo test` gibi bir zincirde, çıktı yazdıran tek komut filtrelenir. Bir pipeline şu durumlarda filtrelenir: son aşaması `grep` ya da `rg` ise ya da çıktıyı üreten komuttan sonra yalnız `cat`, `head` ya da `-f` olmadan bir `tail` geliyorsa.
3. Filtre, çıktıda okumak istediğiniz kısmı tutar ve geri kalanını atar:
   - Başarılı bir test çalıştırması tek bir sayı satırına indirilir. Başarısız bir çalıştırma her hatayı, mesajıyla ve sizin kodunuzun stack frame'leriyle tutar.
   - Bir build her diagnostic'i bir kez tutar: önce error'lar, en sonda sonuç.
   - Bir listeleme, arama ya da tablo, satırları bir sınıra kadar tutar ve sonuna geri kalan satırların sayısını yazar.
   - Progress bar'lar, indirme satırları, spinner'lar ve renk kodları her çıktıdan kaldırılır.
4. Mod, iki komuta çıktıyı küçülten bir flag ekler: sayı, aralık ya da format verilmemişse `git log -10` ve `pytest --tb=short -q`. Hiçbir aracı JSON gibi daha büyük bir biçime çevirmez, çünkü başarısız bir komutun metni hook'a 10.000 karakterde kesilmiş olarak ulaşır ve bir JSON raporu bu sınırı düz metinden çok daha önce aşar. Model JSON'u kendisi istediğinde (`go test -json`, `jest --json`, `eslint -f json`, `rspec --format json`, `rubocop --format json`, `phpstan analyse --error-format=json`, `ruff check --output-format=json`) filtre bu raporu okur. Flag yalnız permission kontrolü yeni komutu modelin yazdığı komutla aynı şekilde okuduğunda eklenir. Şu durumlarda flag hiç eklenmez: argümanlar zaten bir biçim seçmişse, komut bir pipeline ya da zincirin içindeyse, `sudo` sonrasında geliyorsa ya da bir yönlendirme varsa.
5. Çıktının %5'inden ya da 40 karakterden az kazandıran filtrelenmiş bir sonuç atılır ve model çıktıyı olduğu gibi okur. Kendi kurallarınız da aynı eşiğe tabidir. Daha küçük bir kazanç, yalnız modelin okuduğu metni değiştirir ve kimseye yararı olmayan bir kısaltmayı sayardı. İki durumda filtrelenmiş sonuç her zaman kullanılır:
   - Credential değerleri maskelenmiş bir `env` ya da `printenv` listesi. Bunun için tam çıktı dosyası tutulmaz, çünkü bu dosya maskelenmiş değerleri içerirdi. `BASH_DIET_RAW=1 env` değerleri geri verir.
   - Bir flag eklendikten sonraki çıktı, çünkü ham çıktı artık modelin istemediği bir biçimdedir.

   Claude Code, 30.000 karakteri aşan bir çıktıyı bir dosyaya yazar ve modele yalnız 2KB'lık bir önizleme ile dosyanın path'ini verir. Mod bu dosyanın tamamını filtreler. Ancak filtrelenmiş sonuç yalnız önizlemeden kısaysa kullanılır. Kazanç da önizlemeye göre hesaplanır.
6. Bir filtre satırları dışarıda bıraktığında ya da başarısız bir çalıştırma 500 karakter veya daha fazla yazdırdığında tam çıktı saklanır ve sonucun sonuna dosyanın path'i eklenir:

       [full output: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]

   Engine sonucu zaten kestiyse dosya engine'in kendi kopyasıdır. Kesmediyse `$TMPDIR/bash-diet/` altındaki bir dosyadır. Bu dizin en fazla 200 dosyayı 30 gün boyunca tutar. Başarısız bir komutun metni hook'a, Claude Code tarafından 10.000 karakterde kesilmiş olarak ulaşır ve metnin ortası hiçbir yere yazılmaz. Bu durumda dosya yalnız hook'a ulaşan kısmı içerir ve satır bunu bildirir:

       [output cut by Claude Code at 10000 characters; the middle is lost: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]
7. Başarısız bir komut, exit code'uyla birlikte hata olarak kalır: model `Exit code 1` değerini ve filtrelenmiş metni bir tool hatası olarak okur.
8. Session başında, `/clear` sonrasında ve bir compaction'dan sonra model tek bir not okur: kısaltılmış bir sonuç eksiksizdir, tam çıktı belirtilen path'tedir ve `BASH_DIET_RAW=1 <komut>` tam byte'ları geri verir.
9. Playwright MCP, her browser çağrısının kodunu sonucunda `### Ran Playwright code` başlığı altında tekrarlar: `browser_run_code_unsafe` ve `browser_evaluate` için modelin yazdığı kodu ve her click ya da navigation'ın kodunu. Mod bu bölümü her Playwright browser tool'unun sonucundan her zaman, hiçbir ayar gerektirmeden kaldırır. Sayfa, snapshot bağlantısı, console olayları ve varsa hata korunur. Bu bilgisayarın 30 günlük transcript'lerinde bu bölüm, bütün Playwright sonuç metninin yarısından fazlasıydı: 1,8 milyon karakterin yaklaşık 950.000'i. Modun `PLAYWRIGHT_MCP_CODEGEN` değerini ayarlaması işe yaramaz, çünkü MCP server, session başlangıcı çalışmadan önce başlar (2.1.283 üzerinde ölçüldü).
10. [sidebar](../sidebar) açıkken session'ın kazancı orada "Bash output" başlığı altında gösterilir. Sidebar kapalıysa kazancı status line gösterir.

## Filtreler

Modun kendi filtresinin olduğu bütün komutlar aşağıdadır. `*` ile işaretli bir komut, 4. maddedeki flag'i alır.

| Aile | Komutlar |
|---|---|
| git | `git status`, `git diff`, `git show`, `git log`\*, `git push`, `git fetch`, `git pull`, `git commit`, `git branch`, `git stash`, `git checkout`, `git switch`, `git restore`, `git add`, `git worktree`, `git tag` (bir liste her uçtan on tag'i ve toplam sayıyı tutar), `git remote -v`; `yadm status`, `yadm diff`, `yadm log`\* |
| GitHub, GitLab | `gh pr`, `gh issue`, `gh run`, `gh release`; `glab mr`, `glab issue` |
| Rust | `cargo build`, `cargo check`, `cargo clippy`, `cargo doc`, `cargo run`, `cargo test`, `cargo nextest`, `cargo install`; `cargo fmt` ve `rustfmt` (bir kontrol, her dosyayı ekleyeceği ve sileceği satırlarla gösterir) |
| Go | `go test`, `go build`, `go vet`, `go get`, `go mod`, `go install`; `golangci-lint`, `golangci-lint run`; `gofmt -l` ve `-d`, `go fmt` |
| Python | `pytest`\*; `ruff`, `ruff check`, `ruff format`; `mypy`; `flake8` ve `pylint` (kurala göre gruplanır); `black`; `pip` ve `pip3`: `list`, `install`, `uninstall`, `sync`, `download` ve diğer bütün subcommand'lar; `uv pip`, `uv sync`, `uv add`, `uv lock`; `poetry install`, `poetry add`, `poetry update` |
| JavaScript | `npm install`, `npm i`, `npm ci`, `npm ls`, `npm list`, `npm outdated`, `npm test`, `npm run`, `npm run-script`, `npm exec` ve diğer bütün `npm` subcommand'ları; `pnpm install`, `pnpm i`, `pnpm add`, `pnpm remove`, `pnpm rm`, `pnpm update`, `pnpm up`, `pnpm list`, `pnpm ls`, `pnpm outdated`, `pnpm why` ve diğer bütün `pnpm` subcommand'ları; `yarn install`, `yarn add`; `bun install`, `bun add`, `bun remove`, `bun test`; `deno test`, `deno lint`, `deno check`; `jest`, `vitest`, `mocha`, `cypress run`, `playwright`, `tsc`, `eslint`, `prettier`, `next build`, `prisma`; `webpack`, `webpack-cli`, `vite`, `rollup`, `esbuild` (üretilen dosyalar, sayıları ve en büyük üçü olarak) |
| JVM | `mvn`, `mvnd`, `gradle`, `gradlew`, `sbt` |
| Ruby | `rake test`, `rails test`, `ruby` (bir minitest dosyası), `rspec`, `rubocop`, `bundle install`, `bundle update` |
| PHP | `php -l`, `phpunit`, `pest`, `paratest`, `artisan test`, `phpstan analyse`, `phpstan analyze` |
| .NET | `dotnet build`, `dotnet test`, `dotnet format`, `dotnet publish`, `dotnet pack`, `dotnet restore` |
| Apple | `swift build`, `swift test`, `xcodebuild` |
| Dosyalar ve sistem | `ls` ve her dizin için bir satır olarak `ls -R`; `-v` ile `cp`, `mv`, `rm`, `ln` (her hata, ilk beş path ve toplam sayı), `gcp`, `gmv`, `grm`, `gln` adlarıyla da; `find`, `grep`, `egrep`, `rg`, `ast-grep`, `tree`, `env` ve `printenv` (credential değerleri maskelenir), `ps` |
| Container'lar | `docker ps`, `docker images`, `docker image ls`, `docker logs`, `docker build`, `docker pull`, `docker inspect`, `docker compose` (`ps`, `logs` ve diğerleri); `kubectl get`, `kubectl logs`, `kubectl describe`; `oc get`, `oc logs`; `helm list` |
| Cloud ve network | `aws` (`aws s3 ls` sınırlı bir liste olarak, geri kalanı JSON olarak), `gcloud`; `terraform plan`, `terraform apply`, `tofu plan`, `tofu apply`; `pulumi`; `curl`, `wget` |
| make | `make`, `gmake`: make'in dizin satırları ve derleyicinin kaynak kod alıntıları kaldırılır; her runner'ın başarılı bir test için yazdığı satır (`go test -v`, `cargo test`, `pytest -v`, `vitest --reporter=verbose`, `claude plugin test`) tek bir sayı olarak okunur; her hata, özet ve diğer satırlar korunur |
| Yerleşik kurallar | `gcc`, `g++`, `cc`, `c++`, `clang`, `clang++` (`gcc-14` gibi bir sürüm ekiyle de); `cmake`, `cmake --build`; `brew install`, `upgrade`, `reinstall`, `update`, `tap`, `bundle`; `rsync`; `df`; `du`; `ping`, `ping6`; `shellcheck` |

- Bir runner ile başlatılan bir komut, başlattığı komut olarak sayılır: `npx`, `bunx`, `pnpx`, `pnpm exec` ve `dlx`, `npm exec` ve `x`, `uv run`, `poetry run`, `pipenv run`, `bundle exec`, `python -m`, `python3 -m`, `php artisan`. Tam bir path (`/usr/bin/git`) temel adıyla, `git -C <dizin>` ise `git` olarak sayılır.
- Diğer bütün komutlar genel temizlikten geçer: renk kodları, carriage return ile yeniden çizilen satırlar ve tekrarlanan satırlar kaldırılır.
- Bir dosyanın `cat`, `head` ve `tail` çıktısı hiçbir zaman filtrelenmez, çünkü model tam olarak bu satırları istedi.

## Ölçülen kazanç

Claude Code 2.1.282, Claude Opus 5.5 ve bash-diet 0.1.2 ile ölçüldü. Örnek repository Go, Rust, Node, Python, Gradle, .NET, Swift, Ruby, PHP ve C projeleri içerir. Her projede bir başarısız test ya da build hatası vardır. Headless bir session aynı 35 komutu sırayla çalıştırdı: git, build'ler, testler, linter'lar, paket listeleri, dosya listeleme ve aramalar, `docker ps` ve `images`, `env`, `ps`, `df`, `du`. Session üç kez modla, üç kez modsuz çalıştırıldı. Değerler üç çalıştırmanın medyanıdır.

| | Mod olmadan | Mod ile | Kazanç |
|---|---|---|---|
| 35 Bash sonucunun karakter sayısı | 79.555 | 33.366 | %58 |
| 35 sonucun context'e eklediği token | 38.277 | 20.653 | %46 |
| Session sonunda context | 107.946 | 90.557 | %16 |
| Bütün isteklerin input token'ı | 2.856.172 | 2.512.370 | %12 |
| Session maliyeti | $1,00 | $0,78 | %21 |

- Bir sonucun token sayısı, komutu çalıştıran istekten bir sonraki isteğe kadar context'in ne kadar büyüdüğüdür. Bu sayıdan o isteğin kendi output token'ları çıkarılır. Bu sayı, çağrının kendisi için yaklaşık 100 token içerir ve hiçbir filtre bunu kısaltamaz.
- Session'ın kendi prompt'u, tool'ları ve talimatları iki çalıştırmada da aynıdır. Bu yüzden bütün session üzerindeki kazanç, sonuçlardaki kazançtan daha küçüktür.

35 sonucun context token'ları, aileye göre. Her değer, o ailenin komut medyanlarının toplamıdır.

| Aile | Çalıştırılan komutlar | Mod olmadan | Mod ile | Kazanç |
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

- En küçük kazançlar `env` (filtre yalnız credential değerlerini maskeler), `php -l`, `make` ve `go vet` komutlarındadır: bu komutların çıktısı zaten birkaç satırdır ve sayılarının büyük kısmı çağrının kendi 100 token'ıdır.

Bu session'dan sonra eklenen filtreler, bir deneme projesinde her biri tek bir çalıştırmayla, sonucun karakter sayısı olarak ölçüldü:

| Komut | Mod olmadan | Mod ile | Kazanç |
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
| Bu modun `make check` komutu (lint, typecheck, validate, 129 test) | 15.131 | 1.684 | %89 |
| `go test -v` çalıştıran `make test` | 563 | 307 | %45 |
| `pytest -v` çalıştıran `make test` | 1.382 | 928 | %33 |

## Kendi kurallarınız

Hiçbir filtrenin tanımadığı bir komut için kendi kuralınızı yazabilirsiniz. Kurallar iki dosyada tutulur:

- `~/.claude/bash-diet/filters.json`, bütün projeler için. Bu dosya olduğu gibi çalışır.
- `<repository>/.bash-diet/filters.json`, tek bir proje için. Bu dosya yalnız `/bash-diet trust` komutundan sonra çalışır. İçeriği değiştiğinde yeniden durur, çünkü clone'lanmış bir repository ile gelen bir dosya modelden çıktı gizleyebilir.

Sizin kuralınız, aynı komut için modun kendi filtresinden önce çalışır. Adımlar bu sırayla çalışır ve her biri isteğe bağlıdır:

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

- `match_command`, değişkenler ve wrapper'lar ayrıldıktan sonra komutun kelimelerine uygulanan bir JavaScript regex'idir. Baştaki `(?i)` büyük/küçük harf farkını yok sayar.
- `strip_lines_matching` eşleşen satırları atar, `keep_lines_matching` yalnız eşleşen satırları tutar. Bir kural bu ikisinden yalnız birini kullanır.
- `match_output`, çıktının tamamı `pattern` ile eşleşiyorsa ve `unless` ile eşleşmiyorsa yalnız `message` ile cevap verir.
- `head_lines` ve `tail_lines` çıktının iki ucunu tutar ve aralarına bir sayı yazar. Ardından `max_lines` satır sayısını sınırlar.

Hatalı bir dosyanın doğru kuralları yine çalışır ve tek bir transcript satırı her hatayı belirtir. `/bash-diet filters` iki dosyayı, kurallarını ve yerleşik kuralları listeler.

## Komut

    /bash-diet                               açık mı kapalı mı, exclude'lar ve bu session'ın kazancı
    /bash-diet on | off                      varsayılan açık
    /bash-diet exclude <prefix | ^regex>     bu komut filtrelenmeden çalışır; excludes listeler, include birini geri alır
    /bash-diet filters                       kural dosyaları, kuralları ve yerleşik kurallar
    /bash-diet trust | untrust               bu repository'nin .bash-diet/filters.json dosyasını çalıştırır ya da durdurur
    /bash-diet gain                          son 90 günün kazancı ve en çok kazandıran aileler
    /bash-diet gain project | daily | graph | history
    /bash-diet cost                          bu session'ın harcaması ve context'e girmeyen token'ların maliyeti
    /bash-diet discover [days] [all]         modelin önceki session'larda okuduğu çıktı, filtreye göre; hiçbir filtrenin okumadığı komutlar
    /bash-diet learn [days] [write]          bir CLI hatası yüzünden başarısız olan komutlar ve ardından çalışan biçimleri

- `gain`, `~/.claude/bash-diet/gain/` içindeki kayıtları okur: her session ve gün için bir dosya, 90 gün boyunca saklanır. Her rapor, ölçülen karakter sayısını öncesi ve sonrası olarak verir. Token değeri, token başına dört karakter kabul edilerek yapılan bir tahmindir. `history` ve `graph` yalnız karakter sayısını verir.
- `cost`, context'e girmeyen token'ları Kasım 2026 model liste fiyatlarıyla hesaplar: bir kez cache write fiyatıyla ve sonraki her istek için bir kez cache read fiyatıyla. Haiku 5.5, 100.000 token'ı aşan bir prompt'u daha yüksek fiyatla faturalandırır. Mod her isteğin boyutunu bilmez. Bu yüzden bu model için iki tutarı da yazar.
- `discover` ve `learn`, varsayılan olarak bu projenin son 30 günlük transcript'lerini okur. `discover all` her projenin transcript'lerini okur. Komut hemen cevap verir ve rapor ardından bir transcript satırı olarak gelir.
- `learn` yalnız şunları sayar: bilinmeyen bir flag, bulunamayan bir komut, eksik bir argüman ya da bir syntax hatası yüzünden başarısız olan tek bir komut ve bunu üç çağrı içinde izleyen, başarılı çalışan benzer bir komut. `learn write` bu çiftleri repository'deki `.claude/rules/cli-corrections.md` dosyasına yazar. Model bu dosyayı sonraki session'larda okur. Credential içerebilecek bir komut hiçbir zaman yazılmaz.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bash-diet@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Aynı amaçla Bash komutlarını yeniden yazan başka bir araç kullanıyorsanız onu kapatın. Böylece her çıktı yalnız bir kez filtrelenir.
3. Bir projenin kendi kurallarını kullanmak için `.bash-diet/filters.json` dosyasını yazın ve o projede `/bash-diet trust` komutunu çalıştırın.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=bash-diet}, tool.call{tool=Bash}, tool.call{tool=?}
    ❯ ./register.ts calls: $.clock.now (via gainCommand, pruneGain, pruneRecall, recordGain, transcriptsOf), $.command.register, $.env.get (via locate, recallDir), $.fs.exists (via gainFiles, refreshFile, transcriptDirs), $.fs.list (via gainFiles, pruneRecall, transcriptDirs, transcriptsOf), $.fs.read (via gainCommand, refreshFile, seedGain, wholeText), $.fs.stat (via pruneRecall, refreshFile, transcriptsOf), $.fs.write (via keepFull, recordGain, writeLearned), $.process.run (via locate, pruneGain, pruneRecall, recallDir, recordGain, writeLearned), $.process.spawn (via callsIn), $.session.id, $.session.model (via costCommand), $.session.root (via locate), $.session.usage (via costCommand)
    ❯ ./register.ts calls: $.sidebar.set (via showGain), $.store.get (via readSettings), $.store.set (via setEnabled, setExcludes, setTrusted), $.tool.check (via withPlanFlags), $.ui.log (via activeRules, discoverAll, refreshFile, report), $.ui.status (via showGain)

Reach L2: dosya yazar ve process çalıştırır.

    1. Okur:         her Bash komutunu ve çıktısını; her Playwright MCP browser tool'unun sonucunu; iki filters.json dosyasını; bu session'ın modelini, harcamasını ve id'sini; discover ve learn için ~/.claude/projects altındaki transcript'leri
    2. Çalıştırır:   modelin kendi Bash komutunu, permission kontrolü izin verdiğinde çıktısını kısaltan bir flag ekleyerek; git rev-parse, mkdir, rm (yalnız kendi dosyalarını) ve cat (transcript'leri okumak için)
    3. Gönderir:     çıktının yerine filtrelenmiş sonucu ve kod tekrarı kaldırılmış her Playwright sonucunu modele; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       tam çıktıları $TMPDIR/bash-diet altında (200 dosya, 30 gün); kazanç kayıtlarını ~/.claude/bash-diet/gain altında (90 gün); learn write ile .claude/rules/cli-corrections.md dosyasını; $.store içinde açık/kapalı ayarını, exclude'ları ve güvenilen kural dosyalarının hash'lerini
    5. Düşman girdi: bir komutun çıktısı yalnız regex'lerden ve JSON.parse'tan geçer, hiçbir zaman çalıştırılmaz; bir proje kural dosyası yalnız /bash-diet trust komutundan sonra ve SHA-256 değeri eşleştiği sürece çalışır; credential'a benzer adlara sahip env değerleri maskelenir

## Sınırlar

- Bir filtre, çıktının bilinen biçimini okur. Çıktı biçimini değiştiren bir araç, filtrenin gerekenden az satır tutmasına neden olabilir. Bu durumda tam çıktı dosyasını ve `BASH_DIET_RAW=1` kullanabilirsiniz.
- 10.000 karakteri aşan başarısız bir komut çıktısının ortası, mod onu görmeden önce Claude Code tarafından atılır. Mod bu kısmı geri getiremez. Yalnız çıktının kesildiğini bildirir.
- Arka planda çalıştırılan bir komut (`run_in_background`) filtrelenmez, çünkü onun sonucu bir task id'sidir.
- `$(...)`, bir heredoc ya da process substitution içindeki bir komut ve çıktısı bir dosyaya yönlendirilen bir komut filtrelenmez.
- Çıktı yazdıran birden çok komuttan oluşan bir zincir yalnız genel temizlikten geçer (renk kodları, carriage return ile yeniden çizilen satırlar, tekrarlanan satırlar).
- `output-flood` 0.3.0 ve sonrası, iki mod hangi sırayla yüklenirse yüklensin, filtrelenmiş sonucu ölçer. bash-diet'ten sonra yüklenen eski bir `output-flood` sürümü çıktıyı filtreden önce ölçer ve notunda modelin hiç okumadığı bir boyutu yazar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
