# bash-diet

Bir Bash komutunun ekrana bastıklarının çoğu model için gürültüdür: progress bar'lar, yüz tane geçen test satırı, iki kez tekrarlanan aynı uyarı, renk kodları. Bunların hepsi context'e girer ve sonraki her request'te yeniden ödenir. Bu mod her Bash sonucunu model okumadan önce budar. Bilinen komutlar (git, test runner'lar, linter'lar, compiler'lar, package manager'lar, container'lar, dosya listeleri ve aramalar) kendi filtrelerinden geçer, geri kalan her şey genel bir temizlikten geçer. Bir filtre bir şeyi dışarıda bıraktığında tam çıktı, modelin açabileceği bir dosyada bekler.

## Ne yapar

1. Bash tool'unu hook'lar, komutu çalıştırır ve çıktıyı modelden önce okur: başarılı bir çağrıda `stdout` ve `stderr`'i, exit başarısızsa hata metnini. Subagent çağrıları da aynı hook'tan geçer.
2. Komutu bir shell'in okuduğu gibi okur. Öndeki değişkenler ve wrapper'lar (`FOO=1`, `timeout 60`, `nice`, `env`, `sudo`) ayıklanır. `cd app && cargo test` gibi bir zincirde çıktı basan tek komut filtrelenir. Bir pipeline iki durumda filtrelenir: son aşaması `grep` ya da `rg` olduğunda, ya da çıktıyı üreten komuttan sonra yalnız `cat`, `head` ya da takip etmeyen bir `tail` geldiğinde.
3. Filtre, çıktıyı ne için okuyacaksan onu tutar, gerisini atar:
   - Geçen bir test koşusu sayı satırına iner. Başarısız olan koşu her hatayı mesajıyla ve senin kodundaki stack frame'leriyle tutar.
   - Build çıktısında her diagnostic bir kez kalır: önce hatalar, en sonda da sonuç.
   - Bir liste, arama ya da tablo satırlarını bir sınıra kadar tutar ve geri kalanın sayısını söyleyerek biter.
   - Progress bar'lar, indirme satırları, spinner'lar ve renk kodları her yerde atılır.
4. İki komuta çıktıyı küçülten bir flag ekler: sayı, aralık ya da format verilmemişse `git log -10`, bir de `pytest --tb=short -q`. Hiçbir aracı JSON gibi daha büyük bir formata geçirmez, çünkü başarısız bir komutun metni hook'a 10.000 karakterde kesilmiş gelir ve bir JSON raporu bu sınırı düz metinden çok önce aşar. Model JSON'u kendisi isterse (`go test -json`, `jest --json`, `eslint -f json`, `rspec --format json`, `rubocop --format json`, `phpstan analyse --error-format=json`, `ruff check --output-format=json`) filtre o raporu okur. Flag ancak permission kontrolü yeni komuta, modelin yazdığı komuta verdiği cevabın aynısını veriyorsa eklenir. Argümanlar zaten bir format seçmişse, komut bir pipeline'ın ya da zincirin içindeyse, `sudo`'dan sonra geliyorsa ya da bir redirect varsa hiç eklenmez.
5. Çıktının %5'inden ya da 40 karakterden az kazandıran filtre atılır, model çıktıyı olduğu gibi okur; senin kuralların da aynı eşiğe tabidir. Daha küçük bir kazanç, modelin okuduğu metni boşuna değiştirir ve işe yaramayan bir küçülmeyi kazanç diye sayar. İki durumda filtrelenmiş sonuç her zaman kalır:
   - Bir credential değeri maskelenmiş `env` ya da `printenv` listesi. Bunun için tam çıktı dosyası tutulmaz, çünkü o dosya maskelenen değerleri içerirdi; `BASH_DIET_RAW=1 env` onları geri verir.
   - Mod'un eklediği bir flag'den sonraki çıktı, çünkü ham çıktı o zaman modelin istemediği bir formattadır.

   Claude Code 30.000 karakteri geçen bir çıktıyı dosyaya yazar ve modele yalnız 2KB'lık bir önizlemeyle dosyanın yolunu verir. Mod o dosyanın tamamını filtreler, ama filtrelenmiş sonuç yalnız önizlemeden kısaysa kullanılır ve kazanç da önizlemeye göre hesaplanır.
6. Filtre bazı satırları dışarıda bıraktıysa ya da başarısız bir koşu 500 karakter veya daha fazlasını bastıysa tam çıktı saklanır ve sonuç dosyanın yoluyla biter:

       [full output: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]

   Engine sonucu zaten kestiyse dosya engine'in kendi kopyasıdır, kesmediyse `$TMPDIR/bash-diet/` altında yeni bir dosyadır. Bu dizin en fazla 200 dosyayı 30 gün tutar. Başarısız bir komutun metni hook'a Claude Code tarafından 10.000 karakterde kesilmiş olarak gelir ve ortası hiçbir yere yazılmaz. Bu durumda dosya yalnız gelen kısmı tutar ve satır da bunu söyler:

       [output cut by Claude Code at 10000 characters; the middle is lost: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]
7. Başarısız bir komut exit koduyla birlikte hata olarak kalır: model `Exit code 1` ve filtrelenmiş metni bir tool hatası olarak okur.
8. Session başında, `/clear`'dan ve compaction'dan sonra model tek bir not okur: kısaltılmış sonuç eksiksizdir, tam çıktı belirtilen yoldadır ve `BASH_DIET_RAW=1 <komut>` çıktının birebir byte'larını verir.
9. Playwright MCP her browser çağrısının kodunu sonucunda `### Ran Playwright code` başlığı altında tekrar eder: modelin `browser_run_code_unsafe` ve `browser_evaluate` için yazdığı kodu, bir de her tıklamanın ya da sayfa geçişinin kodunu. Mod bu bölümü her Playwright browser tool'unun sonucundan her zaman çıkarır, bunun bir ayarı yoktur. Sayfa, snapshot bağlantısı, console olayları ve varsa hata yerinde kalır. Bu makinenin son 30 günlük transcript'lerinde bu bölüm Playwright sonuç metninin yarısından fazlasıydı: 1,8 milyon karakterin yaklaşık 950.000'i. `PLAYWRIGHT_MCP_CODEGEN` değişkenini mod'dan ayarlamak işe yaramaz, çünkü MCP sunucusu session başlangıcı çalışmadan önce başlar (2.1.283 üzerinde ölçüldü).
10. [sidebar](../sidebar) açıksa session'ın kazancı orada "Bash output" başlığı altında durur. Sidebar yoksa status line'da görünür.

## Filtreler

Mod'un kendi filtresi olan komutların hepsi aşağıda. `*` ile işaretli komutlar 4. maddedeki flag'i alır.

| Aile | Komutlar |
|---|---|
| git | `git status`, `git diff`, `git show`, `git log`\*, `git push`, `git fetch`, `git pull`, `git commit`, `git branch`, `git stash`, `git checkout`, `git switch`, `git restore`, `git add`, `git worktree`, `git tag` (liste her uçtan on tag ile toplam sayıyı tutar), `git remote -v`; `yadm status`, `yadm diff`, `yadm log`\* |
| GitHub, GitLab | `gh pr`, `gh issue`, `gh run`, `gh release`; `glab mr`, `glab issue` |
| Rust | `cargo build`, `cargo check`, `cargo clippy`, `cargo doc`, `cargo run`, `cargo test`, `cargo nextest`, `cargo install`; `cargo fmt` ve `rustfmt` (check çıktısı her dosyayı ekleyeceği ve sileceği satırlarla gösterir) |
| Go | `go test`, `go build`, `go vet`, `go get`, `go mod`, `go install`; `golangci-lint`, `golangci-lint run`; `gofmt -l` ve `-d`, `go fmt` |
| Python | `pytest`\*; `ruff`, `ruff check`, `ruff format`; `mypy`; `flake8` ve `pylint` (kurala göre gruplanır); `black`; `pip` ve `pip3`: `list`, `install`, `uninstall`, `sync`, `download` ve diğer bütün subcommand'lar; `uv pip`, `uv sync`, `uv add`, `uv lock`; `poetry install`, `poetry add`, `poetry update` |
| JavaScript | `npm install`, `npm i`, `npm ci`, `npm ls`, `npm list`, `npm outdated`, `npm test`, `npm run`, `npm run-script`, `npm exec` ve diğer bütün `npm` subcommand'ları; `pnpm install`, `pnpm i`, `pnpm add`, `pnpm remove`, `pnpm rm`, `pnpm update`, `pnpm up`, `pnpm list`, `pnpm ls`, `pnpm outdated`, `pnpm why` ve diğer bütün `pnpm` subcommand'ları; `yarn install`, `yarn add`; `bun install`, `bun add`, `bun remove`, `bun test`; `deno test`, `deno lint`, `deno check`; `jest`, `vitest`, `mocha`, `cypress run`, `playwright`, `tsc`, `eslint`, `prettier`, `next build`, `prisma`; `webpack`, `webpack-cli`, `vite`, `rollup`, `esbuild` (üretilen dosyalar sayıları ve en büyük üçüyle) |
| JVM | `mvn`, `mvnd`, `gradle`, `gradlew`, `sbt` |
| Ruby | `rake test`, `rails test`, `ruby` (bir minitest dosyası), `rspec`, `rubocop`, `bundle install`, `bundle update` |
| PHP | `php -l`, `phpunit`, `pest`, `paratest`, `artisan test`, `phpstan analyse`, `phpstan analyze` |
| .NET | `dotnet build`, `dotnet test`, `dotnet format`, `dotnet publish`, `dotnet pack`, `dotnet restore` |
| Apple | `swift build`, `swift test`, `xcodebuild` |
| Dosyalar ve sistem | `ls`, dizin başına bir satır olarak `ls -R`; `-v` ile `cp`, `mv`, `rm`, `ln` (her hata, ilk beş yol ve toplam sayı), `gcp`, `gmv`, `grm`, `gln` adlarıyla da; `find`, `grep`, `egrep`, `rg`, `ast-grep`, `tree`, `env` ve `printenv` (credential değerleri maskelenir), `ps` |
| Container'lar | `docker ps`, `docker images`, `docker image ls`, `docker logs`, `docker build`, `docker pull`, `docker inspect`, `docker compose` (`ps`, `logs` ve diğerleri); `kubectl get`, `kubectl logs`, `kubectl describe`; `oc get`, `oc logs`; `helm list` |
| Cloud ve ağ | `aws` (`aws s3 ls` sınırlı bir liste olarak, geri kalanı JSON olarak), `gcloud`; `terraform plan`, `terraform apply`, `tofu plan`, `tofu apply`; `pulumi`; `curl`, `wget` |
| make | `make`, `gmake`: make'in dizin satırları ve compiler'ın kaynak alıntıları atılır; her runner'ın geçen test için yazdığı satır (`go test -v`, `cargo test`, `pytest -v`, `vitest --reporter=verbose`, `claude plugin test`) tek bir sayıya iner; her hata, özet ve geri kalan satırlar kalır |
| Yerleşik kurallar | `gcc`, `g++`, `cc`, `c++`, `clang`, `clang++` (`gcc-14` gibi sürüm ekiyle de); `cmake`, `cmake --build`; `brew install`, `upgrade`, `reinstall`, `update`, `tap`, `bundle`; `rsync`; `df`; `du`; `ping`, `ping6`; `shellcheck` |

- Bir runner üzerinden başlatılan komut, başlattığı komutun adıyla sayılır: `npx`, `bunx`, `pnpx`, `pnpm exec` ve `dlx`, `npm exec` ve `x`, `uv run`, `poetry run`, `pipenv run`, `bundle exec`, `python -m`, `python3 -m`, `php artisan`. Mutlak yol (`/usr/bin/git`) dosya adı olarak, `git -C <dizin>` ise `git` olarak okunur.
- Geri kalan her komut genel temizlikten geçer: renk kodları, carriage-return ile yeniden çizilen satırlar ve tekrarlanan satırlar atılır.
- Bir dosyanın `cat`, `head` ve `tail` çıktısı hiçbir zaman filtrelenmez, çünkü model tam olarak o satırları istemiştir.

## Ölçülen kazanç

Ölçüm Claude Code 2.1.282, Claude Opus 5.5 ve bash-diet 0.1.2 ile yapıldı. Örnek repository'de Go, Rust, Node, Python, Gradle, .NET, Swift, Ruby, PHP ve C projeleri var; her birinde bir başarısız test ya da build hatası bulunuyor. Headless bir session aynı 35 komutu sırayla çalıştırdı: git, build'ler, testler, linter'lar, paket listeleri, dosya listeleri ve aramalar, `docker ps` ve `images`, `env`, `ps`, `df`, `du`. Session üç kez mod'la, üç kez mod'suz koştu; sayılar üç koşunun medyanıdır.

| | Mod olmadan | Mod ile | Kazanç |
|---|---|---|---|
| 35 Bash sonucunun karakteri | 79.555 | 33.366 | %58 |
| 35 sonucun context'e eklediği token | 38.277 | 20.653 | %46 |
| Session sonunda context | 107.946 | 90.557 | %16 |
| Bütün request'lerin input token'ı | 2.856.172 | 2.512.370 | %12 |
| Session maliyeti | $1,00 | $0,78 | %21 |

- Bir sonucun token'ı, komutu çalıştıran request'ten bir sonrakine context'in ne kadar büyüdüğüdür; o request'in output token'ları bundan düşülür. Bu sayının içinde çağrının kendisi için yaklaşık 100 token var ve hiçbir filtre onu küçültemez.
- Session'ın kendi prompt'u, tool'ları ve talimatları iki koşuda da aynıdır. Bu yüzden bütün session'daki kazanç, sonuçlardaki kazançtan küçük kalır.

35 sonucun context token'ları, aileye göre. Her sayı, ailedeki komutların medyanlarının toplamıdır.

| Aile | Çalışan komutlar | Mod olmadan | Mod ile | Kazanç |
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

- En az kazanç `env` (filtre yalnız credential değerlerini maskeler), `php -l`, `make` ve `go vet` komutlarında. Bunların çıktısı zaten birkaç satır; sayılarının çoğu da çağrının kendi 100 token'ı.

O session'dan sonra eklenen filtreler bir deneme projesinde birer kez çalıştırıldı ve kazanç, sonucun karakter sayısıyla ölçüldü:

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
| Bu mod'un `make check`'i (lint, typecheck, validate, 129 test) | 15.131 | 1.684 | %89 |
| `go test -v` çalıştıran `make test` | 563 | 307 | %45 |
| `pytest -v` çalıştıran `make test` | 1.382 | 928 | %33 |

## Kendi kuralların

Hiçbir filtrenin tanımadığı bir komut için kendi kuralını yazabilirsin. Kurallar iki dosyada durur:

- `~/.claude/bash-diet/filters.json`: bütün projeler için, olduğu gibi çalışır.
- `<repository>/.bash-diet/filters.json`: tek bir proje için. Yalnız `/bash-diet trust`'tan sonra çalışır ve içeriği değişince bir daha çalışmaz, çünkü clone'ladığın bir repository'yle gelen dosya çıktının bir kısmını modelden saklayabilir.

Senin kuralın, aynı komut için mod'un kendi filtresinden önce çalışır. Adımlar bu sırayla işler ve hepsi isteğe bağlıdır:

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

- `match_command`, değişkenler ve wrapper'lar ayıklandıktan sonraki komut kelimeleri üzerinde çalışan bir JavaScript regex'idir. Başa konan `(?i)` büyük-küçük harf ayrımını kaldırır.
- `strip_lines_matching` eşleşen satırları atar, `keep_lines_matching` yalnız onları tutar. Bir kural bu ikisinden birini kullanır.
- `match_output`, çıktının tamamı `pattern` ile eşleşiyor ve `unless` ile eşleşmiyorsa yalnız `message` ile cevap verir.
- `head_lines` ve `tail_lines` iki ucu tutar, aradakinin sayısını yazar. Ardından `max_lines` satır sayısını sınırlar.

Dosya hatalı olsa bile doğru kurallar yine çalışır; tek bir transcript satırı bütün hataları sayar. `/bash-diet filters` iki dosyayı, içlerindeki kuralları ve yerleşik kuralları listeler.

## Komut

    /bash-diet                               açık mı kapalı mı, exclude'lar ve bu session'ın kazancı
    /bash-diet on | off                      açar ya da kapatır; kurulumdan sonra açıktır
    /bash-diet exclude <prefix | ^regex>     o komut filtresiz çalışır; exclude'ları listeler, bir include birini geri alır
    /bash-diet filters                       kural dosyaları, içlerindeki kurallar ve yerleşik kurallar
    /bash-diet trust | untrust               bu repository'nin .bash-diet/filters.json dosyasını çalıştırır ya da durdurur
    /bash-diet gain                          son 90 günün kazancı ve en çok kazandıran aileler
    /bash-diet gain project | daily | graph | history
    /bash-diet cost                          bu session'ın harcaması ve dışarıda tutulan token'ların ne tutacağı
    /bash-diet discover [days] [all]         modelin önceki session'larda okuduğu çıktı (filtreye göre) ve hiçbir filtrenin okumadığı komutlar
    /bash-diet learn [days] [write]          bir CLI hatasıyla başarısız olan komutlar ve arkasından çalışan doğru biçimleri

- `gain`, `~/.claude/bash-diet/gain/` altındaki kayıtları okur: session ve gün başına bir dosya, 90 gün saklanır. Her rapor önceki ve sonraki karakter sayılarını ölçer. Token sayısı, token başına dört karakter kabul edilerek yapılan bir tahmindir; `history` ve `graph` yalnız karakter gösterir.
- `cost`, context dışında tutulan token'ları modelin Eylül 2026 liste fiyatlarıyla hesaplar: bir kez cache write fiyatıyla, ardından sonraki her request için cache read fiyatıyla.
- `discover` ve `learn` varsayılan olarak bu projenin son 30 günlük transcript'lerini okur. `discover all` bütün projelerinkini okur; hemen cevap verir, raporu ise arkasından bir transcript satırı olarak gelir.
- `learn` yalnız şu durumu sayar: tek bir komut bilinmeyen bir flag, bulunamayan bir komut, eksik bir argüman ya da syntax hatası yüzünden başarısız olmuş ve üç çağrı içinde çalışan benzer bir komut gelmiş. `learn write` bu çiftleri repository'deki `.claude/rules/cli-corrections.md` dosyasına yazar; model onu sonraki session'larda okur. Credential taşıyabilecek bir komut asla yazılmaz.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bash-diet@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Bash komutlarını aynı amaçla yeniden yazan başka bir araç kullanıyorsan onu kapat; böylece her çıktı yalnız bir kez filtrelenir.
3. Bir projeye özel kurallar için `.bash-diet/filters.json` dosyasını yaz ve o projede `/bash-diet trust` çalıştır.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=bash-diet}, tool.call{tool=Bash}, tool.call{tool=?}
    ❯ ./register.ts calls: $.clock.now (via gainCommand, pruneGain, pruneRecall, recordGain, transcriptsOf), $.command.register, $.env.get (via locate, recallDir), $.fs.exists (via gainFiles, refreshFile, transcriptDirs), $.fs.list (via gainFiles, pruneRecall, transcriptDirs, transcriptsOf), $.fs.read (via gainCommand, refreshFile, seedGain, wholeText), $.fs.stat (via pruneRecall, refreshFile, transcriptsOf), $.fs.write (via keepFull, recordGain, writeLearned), $.process.run (via locate, pruneGain, pruneRecall, recallDir, recordGain, writeLearned), $.process.spawn (via callsIn), $.session.id, $.session.model (via costCommand), $.session.root (via locate), $.session.usage (via costCommand), $.sidebar.set (via showGain), $.store.get (via readSettings), $.store.set (via setEnabled, setExcludes, setTrusted), $.tool.check (via withPlanFlags), $.ui.log (via activeRules, discoverAll, refreshFile, report), $.ui.status (via showGain)

Reach L2: dosya yazar ve process çalıştırır.

    1. Okur:     her Bash komutunu ve çıktısını; her Playwright MCP browser tool'unun sonucunu; iki filters.json dosyasını; bu session'ın modelini, harcamasını ve id'sini; discover ve learn için ~/.claude/projects altındaki transcript'leri
    2. Çalıştırır: modelin kendi Bash komutunu, permission kontrolü izin verirse çıktıyı kısaltan bir flag ekleyerek; git rev-parse, mkdir, rm (yalnız kendi dosyaları için) ve cat (transcript'ler için)
    3. Gönderir: çıktının yerine filtrelenmiş sonucu ve kod tekrarı çıkarılmış her Playwright sonucunu modele; makineden dışarı bir şey çıkmaz
    4. Saklar:   $TMPDIR/bash-diet içinde tam çıktıları (200 dosya, 30 gün); ~/.claude/bash-diet/gain içinde kazanç kayıtlarını (90 gün); learn write ile .claude/rules/cli-corrections.md dosyasını; $.store içinde açık/kapalı ayarını, exclude'ları ve trust edilen kural dosyalarının hash'lerini
    5. Düşman girdi: komut çıktısı yalnız regex'lerden ve JSON.parse'tan geçer, hiçbir zaman çalıştırılmaz; proje kural dosyası yalnız /bash-diet trust'tan sonra ve SHA-256'sı tuttuğu sürece çalışır; credential'a benzeyen adların env değerleri maskelenir

## Sınırlar

- Filtre çıktının bilinen biçimini okur. Çıktı formatını değiştiren bir araç, filtrenin gerekenden azını tutmasına yol açabilir; o durumda tam çıktı dosyası ve `BASH_DIET_RAW=1` imdadına yetişir.
- Başarısız bir komutun 10.000 karakteri aşan çıktısının ortasını Claude Code, mod daha görmeden atar. Mod bunu geri getiremez; yalnız kesildiğini söyler.
- Arka plana alınan bir komut (`run_in_background`) filtrelenmez, çünkü sonucu bir task id'dir.
- `$(...)` içindeki, heredoc'taki ya da process substitution'daki komutlar ve çıktısı bir dosyaya redirect edilen komutlar filtrelenmez.
- Çıktı basan birkaç komuttan oluşan bir zincir yalnız genel temizlikten geçer (renk kodları, carriage-return ile yeniden çizilen satırlar, tekrarlanan satırlar).
- `output-flood` 0.3.0 ve sonrası, iki mod hangi sırayla yüklenirse yüklensin filtrelenmiş sonucu ölçer. bash-diet'ten sonra yüklenen daha eski bir `output-flood` ise çıktıyı filtreden önce ölçer ve notunda modelin hiç okumadığı bir boyuttan söz eder.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
