# lockfile-sync

Model `package.json`'a bir dependency ekler, yalnız o dosyayı commit'ler ve lockfile geride kalır. Sonraki `npm ci` CI'da düşer, ya da bir takım arkadaşın senin denediğinden farklı bir sürüm kurar. Bu mod, bir commit bir manifest'in dependency'lerini değiştirip lockfile'ını değiştirmediğinde bunu modele söyler. Modelin çalıştırdığı her `git commit`'ten sonra, commit'in lockfile'ını dışarıda bıraktığı manifest'leri commit'in sonucuna ekler. Commit'in kendisi hiçbir zaman durdurulmaz.

## Ne yapar

1. Mod Bash tool'unu izler. `git commit` çalıştıran bir komut kontrol edilir; `git -C <dizin> commit` ya da önünde git'in global flag'leri olan biçimleri de. `--dry-run`, `--help` ya da `-h` taşıyanlar kontrol edilmez.
2. Komut çalışmadan önce repository kökünü session'ın dizininden, commit'ten önceki son `cd`'den ve commit'in `git -C`'sinden bulur ve `HEAD`'i kaydeder.
3. `HEAD`'i ilerleten başarılı bir komuttan sonra commit'in eklediği ve değiştirdiği dosyaları `git show --name-status HEAD` ile listeler ve her manifest'i lockfile'ıyla eşleştirir:

   | Manifest | Lockfile |
   |---|---|
   | `package.json` | `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb` |
   | `composer.json` | `composer.lock` |
   | `Cargo.toml` | `Cargo.lock` |
   | `go.mod` | `go.sum` |
   | `pyproject.toml` | `poetry.lock`, `uv.lock`, `pdm.lock` |
   | `Pipfile` | `Pipfile.lock` |
   | `Gemfile` | `Gemfile.lock` |
   | `pubspec.yaml` | `pubspec.lock` |
   | `mix.exs` | `mix.lock` |

   Lockfile, manifest'in dizininden repository köküne doğru diskte bulunan ilk lockfile'dır; yani bir workspace package'i kökteki lockfile ile eşleşir. Diskte lockfile'ı olmayan bir manifest'e dokunulmaz: proje bir tane tutmuyordur.
4. Commit o lockfile'ı dışarıda bıraktıysa mod önce lockfile'ın kendi package manager'ına, lockfile'ın manifest'e hâlâ uyup uymadığını sorar. Kontrolü argv ile, lockfile'ın dizininde, 60 sn sınırla çalıştırır:

   | Lockfile | Kontrol | Geride sayıldığı durum |
   |---|---|---|
   | `Cargo.lock` | `cargo metadata --locked --format-version 1 --manifest-path <manifest>` | `cannot update the lock file` |
   | `package-lock.json` | `npm ci --dry-run --ignore-scripts` | hata metninde `are in sync` |
   | `pnpm-lock.yaml` | `pnpm install --frozen-lockfile --lockfile-only --ignore-pnpmfile --ignore-scripts` | `don't match specifiers` |
   | `bun.lock`, `bun.lockb` | `bun install --frozen-lockfile --dry-run --ignore-scripts` | `lockfile had changes` |
   | `yarn.lock` (v1) | `yarn check` | `Lockfile does not contain pattern` |
   | `composer.lock` | `composer validate --no-check-all --no-check-publish --check-lock --no-plugins` | `lock file is not up to date` |
   | `go.sum` | `go mod tidy -diff` | diff'te bir `go.sum` hunk'ı var |
   | `uv.lock` | `uv lock --check` | `needs to be updated` |
   | `poetry.lock` | `poetry check --lock` | `changed significantly` |
   | `pdm.lock` | `pdm lock --check` | `satisfy the project requirements` |
   | `Pipfile.lock` | `pipenv verify` | `out-of-date` |
   | `Gemfile.lock` | `bundle lock --print` | yazdırılan lockfile, platformlar ve Bundler sürümü dışında farklı |
   | `pubspec.lock` | `dart pub get --enforce-lockfile --dry-run` | `Unable to satisfy` |
   | `mix.lock` | `mix deps.get --check-locked`, `MIX_DEPS_PATH` `$TMPDIR/lockfile-sync` altında | `mix.lock is out of date` |

   Her kontrolün repository'ye hiçbir şey yazmadığı ölçüldü. Geçen bir kontrol lockfile'ın uyduğunu söyler ve bulgu açılmaz: `Cargo.toml`'da yeni bir crate getirmeyen bir `features` değişikliği bir şey açmaz, `serde_derive`'ı getiren bir `features = ["derive"]` açar. Lockfile'ın geride olduğunu söyleyen bir hata bulguyu açar. Diğer her cevap hiçbir şey kanıtlamaz: araç kurulu değildir, sınırı aşmıştır, başka bir nedenle başarısız olmuştur, lockfile bir Yarn 2+ `yarn.lock`'udur, ya da manifest veya lockfile working tree'de `HEAD`'den farklıdır. Kontrol working tree'yi okur, bulgu ise commit'ten söz eder; yazılmış ama commit'e girmemiş bir lockfile uyumlu okunurdu. Başlayamayan bir araç bir kez yazılır:

       lockfile-sync: cargo did not run: <reason>; the manifest's diff decides

   Ardından mod manifest'in diff'ini okur (`git show --unified=20 HEAD -- <manifest>`) ve değişen satırların nerede durduğuna bakar. Yalnız lockfile'ı değiştirebilecek bir değişiklik sayılır:

   | Manifest | Sayılır | Sayılmaz |
   |---|---|---|
   | `package.json`, `composer.json` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions`, `require`, `require-dev` ve benzerleri | `scripts`, `version`, diğer key'ler |
   | `Cargo.toml`, `pyproject.toml`, `Pipfile` | `[dependencies]`, `[dev-dependencies]`, `[target.*.dependencies]`, `[project]`, `[tool.poetry.dependencies]`, `[packages]` ve benzerleri | `[package]`, `[tool.ruff]`, diğer table'lar |
   | `go.mod` | `require`, `replace`, `exclude` satırları ve blokları | `go 1.22`, `module` |
   | `Gemfile` | `gem`, `source`, `gemspec`, `group` satırları | yorumlar |
   | `pubspec.yaml` | `dependencies`, `dev_dependencies`, `dependency_overrides` | diğer key'ler |
   | `mix.exs` | her değişiklik | |

   Değişen bir satırın section'ı diff'in kendi 20 satırlık context'inden değil, manifest'in tamamından (`git show HEAD:<manifest>`) okunur: bir `package.json`'ın 40. satırındaki bir değişiklik hunk içinde kök `{`'a hiç ulaşmaz ve kök seviyesindeki her key dependency gibi okunurdu. Manifest'in kendisinin bir yere koymadığı bir key ya da table sayılır; yani okunamayan bir dosya da notu alır.
5. Model commit'in sonucundan sonra şu notu okur:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum. Run the package manager's install so the lockfile matches, and commit it.

6. Aynı anda transcript'e tek bir satır düşer, böylece modele ne söylendiğini görürsün. Satırda talimat yoktur, yalnız çiftler vardır:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum

   Not ile satır ayrı kanallardır: model satırı, sen de notu hiç okumazsın.
7. [sidebar](../sidebar) açıksa bu çiftler transcript yerine onun stream'ine bir kayıt olarak gider, her çift bir satırda (lockfile kırmızı, `but not` soluk); transcript temiz kalır. Kayıt, yenileri onu pane'den itene kadar durur. Sidebar kapalıysa ya da kurulu değilse satır yukarıdaki gibi transcript'e düşer.

8. Bir lockfile'ı dışarıda bırakan her commit, manifest'lerine göre key'lenmiş kendi sidebar kaydıyla kendi bulgusunu açar. Sonraki bir commit bulgusunu açık olanların yanına ekler ve hiçbirinin üstüne yazmaz; açık bir bulgunun zaten saydığı bir çift ikinci kez açılmaz. Her bulgu kendi ölçümüyle kapanır.

   Bulgu hiçbir zaman hatırlanmış bir cevap değildir. Her ölçüm, sonraki her commit'ten sonra, her ana loop turn'ünün sonunda ve `deny` modunda korunan bir git komutundan önce git'e ve package manager'a yeniden sorar; bu yüzden bulgu üç yoldan kapanır:

   - lockfile yazılmıştır: sonraki bir commit onu değiştirmiştir, ya da `git status --porcelain` onu working tree'de değişmiş gösterir;
   - package manager lockfile'ı manifest'le uyumlu okur (4. adımdaki kontrol);
   - kontrol hiçbir şey kanıtlamaz ve manifest artık lockfile değişikliği istemez: `git log -1 -- <lockfile>` lockfile'ı en son yazan commit'i bulur, manifest'in o commit'e göre diff'i hiçbir dependency'ye dokunmaz. Geri alınan bir değişiklik böyle okunur. Package manager'ın geride okuduğu bir lockfile, diff ne derse desin açık kalır.

   Kayıt silinir ve yeşil yeni bir kayıt bunlardan hangisi olduğunu söyler:

       lockfile-sync: a later change brought the lockfiles along: package-lock.json
       lockfile-sync: cargo reads Cargo.lock as in step with Cargo.toml
       lockfile-sync: the dependencies match the lockfile again: package.json

   Sidebar kapalıysa aynı metin tek bir transcript satırıdır. Model bunların hiçbirini okumaz: bulgu kendi yaptığı işle kapandı, bir not ancak az önce yaptığını tekrarlardı.

9. Modelin kapatmadığı bir bulgu her ana loop turn'ünün sonunda yeniden ölçülür; geriye kalan, bir sonraki prompt'unla birlikte modele tek bir not olarak gider:

       lockfile-sync: 1 lockfile(s) are still behind their manifest: package-lock.json behind package.json. Run the package manager's install so the lockfile is written, or take the dependency change back.

   Not her prompt'ta değil, her turn'de bir kez gelir. Bu olmasa bulgu yalnız commit anında bir kez söylenir, model onu unuturken pane'de öylece dururdu. Sen yeni bir şey okumazsın, çünkü pane aynı bulguyu zaten gösteriyor.

10. `deny` modunda bir lockfile geride kaldıkça mod `git commit`, `git push` ve `git merge`'ü de durdurur. Durdurmadan önce iki ölçümü de çalıştırır; böylece package manager'ın az önce yazdığı bir lockfile da, geri alınmış bir dependency değişikliği de gate'i kendiliğinden açar. `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`), commit açık manifest'lerin hiçbirini içermiyorsa geçmesine izin verir ve kaç tanesinin hâlâ durduğunu tek satırla söyler. `push` ve `merge` için okunacak bir index yoktur, orada bütün çiftler geçerlidir. Gate'i aşmanın yolu yoktur; kapatmak yalnız sana kalır, `/lockfile-sync mode note` ile. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz.

Bir git hatası sarı bir kayıt olarak yazılır (sidebar kapalıysa transcript'e), farklı bir hata gelene kadar bir kez; commit'in sonucu da olduğu gibi kalır.

Canlı denemede model bir `package.json` dependency'sini yükseltti, yalnız o dosyayı commit'ledi ve notu kelimesi kelimesine aktardı.

## Komut

    /lockfile-sync                 açık mı kapalı mı, mod ve hâlâ geride olan lockfile'lar
    /lockfile-sync on | off        varsayılan açık
    /lockfile-sync mode note       yalnız not verir; varsayılan budur
    /lockfile-sync mode deny       bir lockfile geride kaldıkça commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install lockfile-sync@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=lockfile-sync}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.env.get (via tmpDir), $.fs.exists (via lockOnDisk), $.fs.read (via treeText), $.process.run (via git, lockVerdict), $.session.cwd (via beforeCommit), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via denyFor, toPerson, toolFailed)

Reach L3: network'e çıkan process'ler çalıştırır.

    1. Okur:     Bash komut metnini; repository'de lockfile'ların olup olmadığını; açık her bulgunun manifest'ini ve lockfile'ını working tree'de; git üzerinden commit'in dosya listesini, manifest diff'lerini ve HEAD'deki her manifest'i; TMPDIR'i
    2. Çalıştırır: salt okunur git rev-parse, git show, git status, git log ve git diff; argv ile; ve 4. adımdaki lockfile package manager kontrolünü, commit anında lockfile'ı olmayan her manifest için bir kez ve her ölçümde açık her çift için bir kez, turn sonunda da
    3. Gönderir: commit'in sonucundan sonra modele bir not, bulgu durdukça sonraki prompt'la bir not daha ve transcript'e bir satır; package manager çözümlediği paket metadata'sı için registry'sine sorabilir
    4. Saklar:   $.store içinde açık/kapalı ayarını ve modu; package manager'lar kendi cache'lerini tutar, mix de $TMPDIR/lockfile-sync/mix-deps altına indirir
    5. Düşman girdi: dizin komut metninden gelir ve git'e ve package manager'a yalnız çalışma dizini olarak ulaşır, hiçbir zaman shell üzerinden değil; manifest path'leri onlara tek bir argv girdisi olarak ulaşır. Kontrol projenin tuttuğu kodu çalıştırır: Gemfile Ruby'dir, mix.exs Elixir'dir ve ikisi de değerlendirilir. npm, pnpm ve bun --ignore-scripts ile, pnpm --ignore-pnpmfile ile, composer --no-plugins ile çalışır; böylece projenin script'leri ve plugin'leri çalışmaz

## Sınırlar

- Package manager kontrolünün hiçbir şey kanıtlamadığı yerde mod yalnız dosya adlarını ve diff section'larını karşılaştırır; lockfile'ın içeriğinin manifest'e uyduğunu kontrol etmez.
- Karar package manager'ın kendisinindir: `npm ci` kök paketin `version`'ını karşılaştırmaz, `yarn check` de kaldırılmış bir dependency'yi hâlâ listeleyen bir lockfile'ı uyumlu okur.
- Yarn 2+ `yarn.lock`'un burada kontrolü yoktur: `yarn install --immutable` `node_modules`'ı projeye bağlar, `--mode=update-lockfile` de `--immutable` ile birlikte kullanılamaz.
- Bir bulgu durdukça kontrolü her ana loop turn'ünün sonunda yeniden çalışır, çift başına 60 sn'ye kadar.
- Hiçbir commit'in yazmadığı bir lockfile'da manifest'i karşılaştıracak bir şey yoktur; bulgusunu yalnız ilk ölçüm kapatabilir.
- Aynı dizinde aynı manager'a ait iki lockfile (bir `package-lock.json`'ın yanında bir `yarn.lock`) tablodaki ilkiyle eşleşir.
- `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit görülmez.
- Dizinini shell'in önce genişlettiği bir `cd` ya da `git -C` (`cd $D`, `cd ~/x`, bir backquote), mod'un bilebileceği bir dizin söylemez. O commit kontrol edilmez; sarı satır da kelimeyi söyler, örneğin `the commit's directory is not known: cd $D`. Tek tırnak içindeki bir kelime olduğu gibi kalır.
- Bir merge commit'inin birleşik diff'i okunmaz.
- `deny` modunu aşmanın yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/lockfile-sync mode note` ile sen kapatırsın.
- Gate, lockfile'daki working tree değişikliğini düzeltme sayar; değişikliğin içeriğine bakmaz.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit index'e göre daraltılmaz, çünkü index'te henüz olmayan dosyaları da commit'ler. Bunlarda açık çiftlerin hepsi geçerlidir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
