# bash-diet

Bir Bash komutunun bastığının çoğu model için gürültüdür: progress bar'lar, yüzlerce geçen test satırı, iki kez gelen aynı uyarı, renk kodları. Hepsi context'e düşer ve sonraki her istekte parası ödenir. Bu mod, her Bash sonucunu model okumadan önce kırpar. Bilinen komutlar (git, test runner'ları, linter'lar, derleyiciler, package manager'lar, container'lar, dosya listeleme ve arama) kendi filtresinden geçer; gerisi genel bir temizlik alır. Bir filtre bir şeyi bıraktığında tam çıktı, modelin açabileceği bir dosyada bekler.

## Ne yapar

1. Bash tool'unu izler; komut çalıştıktan sonra çıktıyı modelden önce okur: başarılı bir komutta `stdout` ve `stderr`, başarısız exit'te hata metni. Subagent çağrıları da aynı yerden geçer.
2. Komutu bir shell gibi okur. Önündeki değişkenleri ve wrapper'ları (`FOO=1`, `timeout 60`, `nice`, `env`, `sudo`) soyar. `cd app && cargo test` gibi bir zincirde filtre, çıktı basan tek komuta uygulanır. Bir pipeline, son halkası `grep` ya da `rg` ise veya çıktıyı üreten komuttan sonra yalnızca `cat`, `head` ya da `-f`'siz bir `tail` geliyorsa filtrelenir.
3. Filtre, çıktıda bakılmak istenen şeyi tutar; gerisini atar:
   - Geçen bir test koşusu tek bir sayı satırına iner. Kalan bir koşu her hatayı mesajıyla ve sizin kodunuzun stack frame'leriyle tutar.
   - Bir build, her diagnostic'i bir kez tutar: önce error'lar, en sonda sonuç.
   - Bir listeleme, arama ya da tablo satırlarını bir sınıra kadar tutar ve sonuna gerisinin sayısını yazar.
   - Progress bar'lar, indirme satırları, spinner'lar ve renk kodları her yerden gider.
4. İki komuta çıktıyı küçülten bir flag ekler: sayı, range ya da format verilmemişse `git log -10` ve `pytest --tb=short -q`. JSON gibi daha geniş bir biçime hiçbir aracı çevirmez; çünkü başarısız bir komutun metni hook'a 10.000 karakterde kesilmiş olarak ulaşır ve bir JSON raporu o sınırı düz metinden çok önce aşar. Model kendisi JSON istediğinde (`go test -json`, `jest --json`, `eslint -f json`, `rspec --format json`, `rubocop --format json`, `phpstan analyse --error-format=json`, `ruff check --output-format=json`) filtre o raporu okur. Flag yalnızca permission kontrolü, yeni komutu modelin yazdığıyla aynı şekilde okuduğunda eklenir. Argument'lar zaten bir biçim seçmişse, komut bir pipeline ya da zincirin içindeyse, `sudo`dan sonra geliyorsa ya da bir redirect varsa flag hiç eklenmez.
5. Filtrelenmiş sonuç, çıktının yüzde 5'inden ya da 40 karakterden azını kazandırıyorsa atılır ve model çıktıyı eski hâliyle okur; kendi kurallarınız da aynı eşiğe tabidir. Daha küçük bir tasarruf, modelin okuduğunu yalnız değiştirir ve kimsenin yararlanmadığı bir kısalığı sayardı. İki durumda filtrelenmiş sonuç her hâlükârda kalır:
   - Credential değeri maskelenmiş bir `env` ya da `printenv` listesi. Bunun için tam çıktı dosyası tutulmaz; çünkü o dosya maskelenmiş değerleri taşırdı. `BASH_DIET_RAW=1 env` değerleri geri verir.
   - Eklenmiş bir flag'ten sonraki çıktı; çünkü ham çıktı artık modelin istemediği bir biçimdedir.

   Claude Code 30.000 karakteri aşan bir çıktıyı bir dosyaya yazar ve modele yalnız 2KB'lik bir önizlemeyle dosyanın yolunu verir. Mod o dosyanın tamamını filtreler ama filtrelenmiş sonuç yalnızca önizlemeden kısaysa kazanır; tasarruf da önizlemeye göre sayılır.
6. Bir filtre satırları dışarıda bıraktığında ya da başarısız bir koşu 500 karakter ya da üstünde bastığında tam çıktı saklanır ve sonuç yolunu ekler:

       [full output: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]

   Dosya, engine sonucu zaten kestiyse engine'in kendi kopyasıdır; değilse `$TMPDIR/bash-diet/` altında bir dosyadır. O dizin en fazla 200 dosyayı 30 gün tutar. Başarısız bir komutun metni, Claude Code'un 10.000 karakterdeki kesmesiyle hook'a ulaşır ve ortası hiçbir yere yazılmaz. O durumda dosya yalnız ulaşanı tutar ve satır bunu söyler:

       [output cut by Claude Code at 10000 characters; the middle is lost: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]
7. Başarısız bir komut, exit code'uyla birlikte error olarak kalır: model `Exit code 1`'i ve kırpılmış metni bir tool hatası olarak okur.
8. Session'ın başında, `/clear`'dan sonra ve bir compaction'dan sonra model tek bir not okur: kırpılmış bir sonuç eksiksizdir, tam çıktı adı verilen yoldadır ve `BASH_DIET_RAW=1 <command>` tam baytları geri verir.
9. Playwright MCP her browser çağrısının kodunu sonucunda, `### Ran Playwright code` altında tekrar eder: `browser_run_code_unsafe` ve `browser_evaluate` için modelin yazdığı kodu, her click ya da navigation'ın kodunu. Mod o bölümü her Playwright browser tool'unun sonucundan çıkarır; hep, hiçbir ayar olmadan. Sayfa, snapshot link'i, console event'leri ve varsa hata kalır. Bu makinenin 30 günlük transcript'lerinde o bölüm, bütün Playwright sonuç metninin yarısından fazlaydı: 1,8 milyon karakterin yaklaşık 950.000'i. Modun `PLAYWRIGHT_MCP_CODEGEN`'i ayarlaması hiçbir işe yaramaz; çünkü MCP server, session start daha çalışmadan başlar (2.1.283'te ölçüldü).
10. [sidebar](../sidebar) açıkken session'ın tasarrufu orada, "Bash output" altında durur. Kapalıysa onu status line gösterir.

## Filtreler

Modun kendi filtresi olan bütün komutlar buradadır. `*` işaretli komut, 4. maddedeki flag'i alır.

| Aile | Komutlar |
|---|---|
| git | `git status`, `git diff`, `git show`, `git log`\*, `git push`, `git fetch`, `git pull`, `git commit`, `git branch`, `git stash`, `git checkout`, `git switch`, `git restore`, `git add`, `git worktree`, `git tag` (liste her uçtan on tag ile toplam sayıyı tutar), `git remote -v`; `yadm status`, `yadm diff`, `yadm log`\* |
| GitHub, GitLab | `gh pr`, `gh issue`, `gh run`, `gh release`; `glab mr`, `glab issue` |
| Rust | `cargo build`, `cargo check`, `cargo clippy`, `cargo doc`, `cargo run`, `cargo test`, `cargo nextest`, `cargo install`; `cargo fmt` ve `rustfmt` (check, her dosyayı ekleyeceği ve sileceği satırlarla gösterir) |
| Go | `go test`, `go build`, `go vet`, `go get`, `go mod`, `go install`; `golangci-lint`, `golangci-lint run`; `gofmt -l` ve `-d`, `go fmt` |
| Python | `pytest`\*; `ruff`, `ruff check`, `ruff format`; `mypy`; `flake8` ve `pylint` (kurala göre gruplanır); `black`; `pip` ve `pip3`: `list`, `install`, `uninstall`, `sync`, `download` ve diğer bütün subcommand'lar; `uv pip`, `uv sync`, `uv add`, `uv lock`; `poetry install`, `poetry add`, `poetry update` |
| JavaScript | `npm install`, `npm i`, `npm ci`, `npm ls`, `npm list`, `npm outdated`, `npm test`, `npm run`, `npm run-script`, `npm exec` ve diğer bütün `npm` subcommand'ları; `pnpm install`, `pnpm i`, `pnpm add`, `pnpm remove`, `pnpm rm`, `pnpm update`, `pnpm up`, `pnpm list`, `pnpm ls`, `pnpm outdated`, `pnpm why` ve diğer bütün `pnpm` subcommand'ları; `yarn install`, `yarn add`; `bun install`, `bun add`, `bun remove`, `bun test`; `deno test`, `deno lint`, `deno check`; `jest`, `vitest`, `mocha`, `cypress run`, `playwright`, `tsc`, `eslint`, `prettier`, `next build`, `prisma`; `webpack`, `webpack-cli`, `vite`, `rollup`, `esbuild` (üretilen dosyalar, sayıları ve en büyük üçüyle) |
| JVM | `mvn`, `mvnd`, `gradle`, `gradlew`, `sbt` |
| Ruby | `rake test`, `rails test`, `ruby` (bir minitest dosyası), `rspec`, `rubocop`, `bundle install`, `bundle update` |
| PHP | `php -l`, `phpunit`, `pest`, `paratest`, `artisan test`, `phpstan analyse`, `phpstan analyze` |
| .NET | `dotnet build`, `dotnet test`, `dotnet format`, `dotnet publish`, `dotnet pack`, `dotnet restore` |
| Apple | `swift build`, `swift test`, `xcodebuild` |
| Dosyalar ve sistem | `ls`; dizin başına bir satır olarak `ls -R`; `-v` ile `cp`, `mv`, `rm`, `ln` (her hata, ilk beş yol ve toplam sayı), `gcp`, `gmv`, `grm`, `gln` adlarıyla da; `find`, `grep`, `egrep`, `rg`, `ast-grep`, `tree`, `env` ve `printenv` (credential değerleri maskelenir), `ps` |
| Container'lar | `docker ps`, `docker images`, `docker image ls`, `docker logs`, `docker build`, `docker pull`, `docker inspect`, `docker compose` (`ps`, `logs` ve diğerleri); `kubectl get`, `kubectl logs`, `kubectl describe`; `oc get`, `oc logs`; `helm list` |
| Cloud ve ağ | `aws` (`aws s3 ls` sınırlı bir liste olarak, gerisi JSON olarak), `gcloud`; `terraform plan`, `terraform apply`, `tofu plan`, `tofu apply`; `pulumi`; `curl`, `wget` |
| make | `make`, `gmake`: make'in dizin satırları ve compiler kaynak alıntıları atılır; her runner'ın geçen test için yazdığı satır (`go test -v`, `cargo test`, `pytest -v`, `vitest --reporter=verbose`, `claude plugin test`) tek bir sayı olarak okunur; her hata, özet ve diğer satırlar kalır |
| Yerleşik kurallar | `gcc`, `g++`, `cc`, `c++`, `clang`, `clang++` (`gcc-14` gibi bir sürüm ekiyle de); `cmake`, `cmake --build`; `brew install`, `upgrade`, `reinstall`, `update`, `tap`, `bundle`; `rsync`; `df`; `du`; `ping`, `ping6`; `shellcheck` |

- Bir runner üzerinden başlatılan komut, başlattığı komutun adıyla sayılır: `npx`, `bunx`, `pnpx`, `pnpm exec` ve `dlx`, `npm exec` ve `x`, `uv run`, `poetry run`, `pipenv run`, `bundle exec`, `python -m`, `python3 -m`, `php artisan`. Tam yol (`/usr/bin/git`) temel adıyla, `git -C <dizin>` ise `git` ile sayılır.
- Kalan her komut genel temizliği alır: renk kodları, carriage-return ile yeniden çizilen satırlar ve tekrarlanan satırlar gider.
- Bir dosyanın `cat`, `head` ve `tail` çıktısı hiç filtrelenmez; çünkü model tam olarak o satırları istedi.

## Ölçülen tasarruf

Claude Code 2.1.282, Claude Opus 5.5 ve bash-diet 0.1.2 ile ölçüldü. Örnek repository Go, Rust, Node, Python, Gradle, .NET, Swift, Ruby, PHP ve C projeleri taşır; her birinde bir başarısız test ya da build hatası vardır. Headless bir session aynı 35 komutu sırayla çalıştırdı: git, build'ler, testler, linter'lar, package listeleri, dosya listeleme ve aramalar, `docker ps` ve `images`, `env`, `ps`, `df`, `du`. Üç kez modla, üç kez modsuz koştu; rakamlar üç koşunun medyanıdır.

| | Mod olmadan | Mod ile | Tasarruf |
|---|---|---|---|
| 35 Bash sonucunun karakteri | 79.555 | 33.366 | %58 |
| 35 sonucun context'e eklediği token | 38.277 | 20.653 | %46 |
| Session sonunda context | 107.946 | 90.557 | %16 |
| Bütün isteklerin input token'ı | 2.856.172 | 2.512.370 | %12 |
| Session maliyeti | $1,00 | $0,78 | %21 |

- Bir sonucun token'ı, komutu çalıştıran istekten bir sonrakine kadar context'in ne kadar büyüdüğüdür; o isteğin kendi output token'ları düşülür. Bu sayı, hiçbir filtrenin kısaltamayacağı çağrının kendisi için yaklaşık 100 token taşır.
- Session'ın kendi prompt'u, tool'ları ve talimatları iki koşuda da aynıdır; bu yüzden bütün session üzerindeki tasarruf, sonuçlardaki tasarruftan küçüktür.

35 sonucun context token'ları, aileye göre. Her rakam, o ailenin komut medyanlarının toplamıdır.

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

- En küçük tasarruflar `env`'de (filtre yalnız credential değerlerini maskeler), `php -l`'de, `make`'te ve `go vet`'tedir: onların çıktısı hâlihazırda birkaç satırdır ve sayılarının çoğu çağrının kendi 100 token'ıdır.

O session'dan sonra eklenen filtreler, bir scratch projesinde her biri tek koşuyla, sonucun karakter sayısı olarak ölçüldü:

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

Hiçbir filtrenin tanımadığı bir komut, sizin bir kuralınızı alabilir. Kurallar iki dosyada yaşar:

- `~/.claude/bash-diet/filters.json`, bütün projeler için. Olduğu gibi çalışır.
- `<repository>/.bash-diet/filters.json`, tek bir proje için. Yalnız `/bash-diet trust`'tan sonra çalışır ve içeriği değişince yeniden durur; çünkü clone'lanmış bir repository ile gelen bir dosya, modelden çıktı saklayabilir.

Sizin kuralınız, aynı komut için modun kendi filtresinden önce gelir. Adımlar bu sırayla çalışır ve her biri isteğe bağlıdır:

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

- `match_command`, değişkenler ve wrapper'lar soyulduktan sonra komutun kelimeleri üzerinde bir JavaScript regex'idir. Baştaki `(?i)` büyük küçük harf farkını yok sayar.
- `strip_lines_matching` eşleştiği satırları atar; `keep_lines_matching` yalnız eşleşenleri tutar. Bir kural ikisinden birini alır.
- `match_output`, çıktının tamamı `pattern`'a uyup `unless`'a uymadığında yalnız `message` ile cevap verir.
- `head_lines` ve `tail_lines` iki ucu tutar, aralarında bir sayı yazar. `max_lines` sonra satırları sınırlar.

Hatası olan bir dosya, iyi kurallarını yine de çalıştırır ve tek bir transcript satırı her hatayı adlandırır. `/bash-diet filters` iki dosyayı, kurallarını ve yerleşik kuralları listeler.

## Komut

    /bash-diet                               açık mı kapalı mı, exclude'lar ve bu session'ın tasarrufu
    /bash-diet on | off                      varsayılan açık
    /bash-diet exclude <prefix | ^regex>     o komut filtresiz çalışır; excludes listeler, include birini geri alır
    /bash-diet filters                       kural dosyaları, kuralları ve yerleşik kurallar
    /bash-diet trust | untrust               bu repository'nin .bash-diet/filters.json'unu çalıştırır ya da durdurur
    /bash-diet gain                          son 90 günün tasarrufu ve en çok kazandıran aileler
    /bash-diet gain project | daily | graph | history
    /bash-diet cost                          bu session'ın harcaması ve dışarıda tutulan token'ların bedeli
    /bash-diet discover [days] [all]         modelin önceki session'larda okuduğu çıktı, filtreye göre; hiçbir filtrenin okumadığı komutlar
    /bash-diet learn [days] [write]          bir CLI hatasıyla başarısız olan komutlar ve arkasından işe yarayan biçimleri

- `gain`, `~/.claude/bash-diet/gain/` içindeki kayıtları okur; session ve gün başına bir dosya, 90 gün tutulur. Her rapor, karakterleri önce ve sonra olarak ölçer. Token rakamı, token başına dört karakterle yapılan bir tahmindir; `history` ve `graph` yalnız karakter verir.
- `cost`, context'ten tutulan token'ları Eylül 2026 model liste fiyatlarıyla fiyatlar: bir kez cache write oranıyla, sonraki her istek için bir kez cache read oranıyla.
- `discover` ve `learn`, varsayılan olarak bu projenin son 30 günün transcript'lerini okur. `discover all` her projeninkini okur; tek seferde cevap verir ve raporu arkasından bir transcript satırı olarak gelir.
- `learn` yalnız şunu sayar: bilinmeyen bir flag, bulunamayan bir komut, eksik bir argument ya da syntax hatası yüzünden başarısız olan tek bir komut ve onu üç çağrı içinde izleyen, işe yarayan benzer bir komut. `learn write` çiftleri repository'deki `.claude/rules/cli-corrections.md`'ye yazar; model sonraki session'larda o dosyayı okur. Credential taşıyabilecek bir komut hiç yazılmaz.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bash-diet@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Aynı amaçla Bash komutlarını yeniden yazan başka bir tool kullanıyorsanız onu kapatın; böylece her çıktı bir kez filtrelenir.
3. Bir projenin kendi kurallarını yürürlükte tutmak için `.bash-diet/filters.json` yazın ve o projede `/bash-diet trust` çalıştırın.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=bash-diet}, tool.call{tool=Bash}, tool.call{tool=?}
    ❯ ./register.ts calls: $.clock.now (via gainCommand, pruneGain, pruneRecall, recordGain, transcriptsOf), $.command.register, $.env.get (via locate, recallDir), $.fs.exists (via gainFiles, refreshFile, transcriptDirs), $.fs.list (via gainFiles, pruneRecall, transcriptDirs, transcriptsOf), $.fs.read (via gainCommand, refreshFile, seedGain, wholeText), $.fs.stat (via pruneRecall, refreshFile, transcriptsOf), $.fs.write (via keepFull, recordGain, writeLearned), $.process.run (via locate, pruneGain, pruneRecall, recallDir, recordGain, writeLearned), $.process.spawn (via callsIn), $.session.id, $.session.model (via costCommand), $.session.root (via locate), $.session.usage (via costCommand), $.sidebar.set (via showGain), $.store.get (via readSettings), $.store.set (via setEnabled, setExcludes, setTrusted), $.tool.check (via withPlanFlags), $.ui.log (via activeRules, discoverAll, refreshFile, report), $.ui.status (via showGain)

Reach L2: dosya yazar ve process çalıştırır.

    1. Okur:     her Bash komutunu ve çıktısını; her Playwright MCP browser tool'unun sonucunu; iki filters.json dosyasını; bu session'ın modelini, harcamasını ve id'sini; discover ve learn için ~/.claude/projects altındaki transcript'leri
    2. Çalıştırır: modelin kendi Bash komutunu, permission kontrolü izin verdiğinde çıktısını kısaltan bir flag eklenmiş olarak; git rev-parse, mkdir, rm (yalnız kendi dosyaları) ve cat (transcript'ler)
    3. Gönderir: çıktının yerine kırpılmış sonucu ve kod yankısı çıkarılmış her Playwright sonucunu modele; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:   tam çıktıları $TMPDIR/bash-diet altında (200 dosya, 30 gün); tasarruf kayıtlarını ~/.claude/bash-diet/gain altında (90 gün); learn write ile .claude/rules/cli-corrections.md'yi; $.store içinde açık/kapalıyı, exclude'ları ve güvenilen kural dosyalarının hash'lerini
    5. Düşman girdi: bir komutun çıktısı yalnız regex'lerden ve JSON.parse'dan geçer, asla çalıştırılmaz; bir proje kural dosyası yalnız /bash-diet trust'tan sonra ve SHA-256'sı eşleştiği sürece çalışır; credential benzeri addaki env değerleri maskelenir

## Sınırlar

- Bir filtre, çıktının bilinen biçimini okur. Çıktı biçimini değiştiren bir tool, filtrenin gerekenden azını tutmasına yol açabilir; o durumda tam çıktı dosyası ve `BASH_DIET_RAW=1` işinize yarar.
- 10.000 karakteri aşan başarısız bir komutun ortasını Claude Code, mod hiç görmeden atar. Mod onu geri getiremez; yalnız kesildiğini söyler.
- Arka plana atılmış bir komut (`run_in_background`) filtrelenmez; çünkü onun sonucu bir task id'dir.
- `$(...)`, bir heredoc ya da process substitution içindeki bir komut ve çıktısı bir dosyaya yönlendirilmiş bir komut filtrelenmez.
- Birkaç çıktı basan komuttan kurulu bir zincir yalnız genel temizliği alır: renk kodları, carriage-return ile yeniden çizilen satırlar, tekrarlanan satırlar.
- `output-flood` 0.3.0 ve üstü, iki mod hangi sırada yüklenirse yüklensin, filtrelenmiş sonucu ölçer. bash-diet'ten sonra yüklenen eski bir `output-flood` çıktıyı filtreden önce ölçer ve notu, modelin hiç okumadığı bir boyut adlandırır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
