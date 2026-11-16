# lockfile-sync

Model `package.json` dosyasına bir dependency ekler ve yalnız bu dosyayı commit eder. Lockfile ise eski hâlinde kalır. Sonraki `npm ci` CI'da başarısız olur ya da bir ekip arkadaşınız sizin denediğinizden farklı bir sürüm yükler. Bu mod, bir commit bir manifest'in dependency'lerini değiştirip lockfile'ını değiştirmediğinde bunu modele bildirir. Modelin çalıştırdığı her `git commit` komutundan sonra, commit'in lockfile'ını dışarıda bıraktığı manifest'ler commit'in sonucuna eklenir. Commit'in kendisi hiçbir zaman durdurulmaz.

## Ne yapar

1. Mod Bash tool'unu izler. `git commit` çalıştıran komutlar kontrol edilir. `git -C <dizin> commit` ve önünde git'in global flag'leri olan biçimler de kontrol edilir. `--dry-run`, `--help` ya da `-h` içeren komutlar kontrol edilmez.
2. Komut çalışmadan önce mod repository kökünü bulur. Bunun için session'ın dizinini, commit'ten önceki son `cd` komutunu ve commit'in `git -C` değerini kullanır. Ardından `HEAD` değerini kaydeder.
3. `HEAD` değerini ilerleten başarılı bir komuttan sonra mod, commit'in eklediği ve değiştirdiği dosyaları `git show --name-status HEAD` ile listeler. Ardından her manifest'i lockfile'ıyla eşleştirir:

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

   Lockfile, manifest'in dizininden repository köküne doğru diskte bulunan ilk lockfile'dır. Bu yüzden bir workspace package'ı kök dizindeki lockfile ile eşleşir. Diskte lockfile'ı olmayan bir manifest kontrol edilmez, çünkü proje bir lockfile kullanmaz.
4. Commit bu lockfile'ı dışarıda bıraktıysa mod önce lockfile'ın kendi package manager'ına, lockfile'ın manifest'e hâlâ uyup uymadığını sorar. Kontrol argv ile, lockfile'ın dizininde ve 60 saniyelik bir sınırla çalıştırılır:

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

   Her kontrolün repository'ye hiçbir şey yazmadığı ölçüldü. Başarılı bir kontrol, lockfile'ın manifest'e uyduğunu gösterir ve bulgu açılmaz. Örneğin `Cargo.toml` içinde yeni bir crate eklemeyen bir `features` değişikliği bulgu açmaz. `serde_derive` ekleyen bir `features = ["derive"]` değişikliği bulgu açar. Lockfile'ın geride olduğunu bildiren bir hata bulguyu açar. Diğer her cevap hiçbir şeyi kanıtlamaz: araç yüklü değildir, süre sınırını aşmıştır, başka bir nedenle başarısız olmuştur, lockfile bir Yarn 2+ `yarn.lock` dosyasıdır ya da manifest veya lockfile working tree'de `HEAD`'den farklıdır. Kontrol working tree'yi okur, bulgu ise commit ile ilgilidir. Bu yüzden yazılmış ancak commit'e eklenmemiş bir lockfile uyumlu okunurdu. Başlatılamayan bir araç log'a bir kez yazılır:

       lockfile-sync: cargo did not run: <reason>; the manifest's diff decides

   Ardından mod manifest'in diff'ini okur (`git show --unified=20 HEAD -- <manifest>`) ve değişen satırların hangi bölümde olduğuna bakar. Yalnız lockfile'ı değiştirebilecek bir değişiklik sayılır:

   | Manifest | Sayılır | Sayılmaz |
   |---|---|---|
   | `package.json`, `composer.json` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions`, `require`, `require-dev` ve benzerleri | `scripts`, `version`, diğer key'ler |
   | `Cargo.toml`, `pyproject.toml`, `Pipfile` | `[dependencies]`, `[dev-dependencies]`, `[target.*.dependencies]`, `[project]`, `[tool.poetry.dependencies]`, `[packages]` ve benzerleri | `[package]`, `[tool.ruff]`, diğer table'lar |
   | `go.mod` | `require`, `replace`, `exclude` satırları ve blokları | `go 1.22`, `module` |
   | `Gemfile` | `gem`, `source`, `gemspec`, `group` satırları | yorumlar |
   | `pubspec.yaml` | `dependencies`, `dev_dependencies`, `dependency_overrides` | diğer key'ler |
   | `mix.exs` | her değişiklik | |

   Değişen bir satırın bölümü, diff'in kendi 20 satırlık context'inden değil, manifest'in tamamından (`git show HEAD:<manifest>`) okunur. Bunun nedeni şudur: bir `package.json` dosyasının 40. satırındaki bir değişikliğin hunk'ı kök `{` satırına hiç ulaşmaz ve kök seviyesindeki her key dependency olarak okunurdu. Manifest'te bir bölüme ait olmayan bir key ya da table sayılır. Bu yüzden okunamayan bir dosya için de not gönderilir.
5. Model, commit'in sonucundan sonra şu notu okur:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum. Run the package manager's install so the lockfile matches, and commit it.

6. Aynı anda transcript'e tek bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır talimat içermez, yalnız dosya çiftlerini içerir:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz.
7. [sidebar](../sidebar) açıksa bu çiftler transcript yerine sidebar'ın stream'ine bir kayıt olarak yazılır. Her çift bir satırdadır: lockfile kırmızı, `but not` soluk renktedir. Transcript temiz kalır. Kayıt, yeni kayıtlar onu pane'den çıkarana kadar görünür. Sidebar kapalıysa ya da yüklü değilse satır yukarıdaki gibi transcript'e yazılır.

8. Bir lockfile'ı dışarıda bırakan her commit, kendi bulgusunu açar. Bu bulgunun, manifest'lerine göre key'lenen kendi sidebar kaydı vardır. Sonraki bir commit kendi bulgusunu açık bulguların yanına ekler ve hiçbirinin üzerine yazmaz. Açık bir bulgunun zaten içerdiği bir çift ikinci kez açılmaz. Her bulgu kendi ölçümüyle kapanır.

   Mod bulguyu bellekteki eski bir cevaba göre tutmaz. Her ölçüm git'e ve package manager'a yeniden sorar. Ölçüm sonraki her commit'ten sonra, her ana loop turn'ünün sonunda ve `deny` modunda korunan bir git komutundan önce yapılır. Bulgu üç yoldan kapanır:

   - Lockfile yazılmıştır: sonraki bir commit lockfile'ı değiştirmiştir ya da `git status --porcelain` lockfile'ı working tree'de değişmiş olarak gösterir.
   - Package manager lockfile'ı manifest ile uyumlu okur (4. adımdaki kontrol).
   - Kontrol hiçbir şeyi kanıtlamaz ve manifest artık bir lockfile değişikliği gerektirmez: `git log -1 -- <lockfile>`, lockfile'ı en son yazan commit'i bulur ve manifest'in bu commit'e göre diff'i hiçbir dependency'yi değiştirmez. Geri alınan bir değişiklik bu şekilde okunur. Package manager'ın geride okuduğu bir lockfile, diff ne gösterirse göstersin açık kalır.

   Kayıt silinir ve yeşil yeni bir kayıt bu üç yoldan hangisinin gerçekleştiğini bildirir:

       lockfile-sync: a later change brought the lockfiles along: package-lock.json
       lockfile-sync: cargo reads Cargo.lock as in step with Cargo.toml
       lockfile-sync: the dependencies match the lockfile again: package.json

   Sidebar kapalıysa aynı metin transcript'e tek bir satır olarak yazılır. Model bunların hiçbirini okumaz, çünkü bulgu modelin kendi yaptığı işle kapanmıştır. Bir not, modelin az önce yaptığı işi yalnız tekrarlardı.

9. Modelin kapatmadığı bir bulgu, her ana loop turn'ünün sonunda yeniden ölçülür. Hâlâ açık olan bulgular, bir sonraki prompt'unuzla birlikte modele tek bir not olarak gönderilir:

       lockfile-sync: 1 lockfile(s) are still behind their manifest: package-lock.json behind package.json. Run the package manager's install so the lockfile is written, or take the dependency change back.

   Bu not her turn için bir kez gönderilir, her prompt için değil. Bu not olmasaydı model bulguyu yalnız commit anında bir kez duyar ve ardından unuturdu. Bulgu da pane'de kalırdı. Size yeni bir satır gösterilmez, çünkü pane aynı bulguyu zaten gösterir.

10. `deny` modunda bir lockfile geride kaldığı sürece mod `git commit`, `git push` ve `git merge` komutlarını da durdurur. Mod bir komutu durdurmadan önce iki ölçümü de çalıştırır. Böylece package manager'ın az önce yazdığı bir lockfile ya da geri alınmış bir dependency değişikliği gate'i kendiliğinden açar. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`). Commit açık manifest'lerin hiçbirini içermiyorsa çalışır ve kaç bulgunun hâlâ açık olduğu size tek bir satırla bildirilir. `push` ve `merge` için okunacak bir index yoktur. Bu yüzden bu komutlarda bütün çiftler geçerlidir. Gate'i atlamanın bir yolu yoktur. Gate'i yalnız siz `/lockfile-sync mode note` ile kapatabilirsiniz. Varsayılan mod `note` modudur ve hiçbir işlemi durdurmaz.

Bir git hatası sarı bir kayıt olarak yazılır (sidebar kapalıysa transcript'e). Kayıt, farklı bir hata gelene kadar yalnız bir kez yazılır ve commit'in sonucu değiştirilmez.

Canlı denemede model bir `package.json` dependency'sinin sürümünü yükseltti, yalnız bu dosyayı commit etti ve notu kelimesi kelimesine aktardı.

## Komut

    /lockfile-sync                 açık mı kapalı mı, mod ve hâlâ geride olan lockfile'lar
    /lockfile-sync on | off        varsayılan açık
    /lockfile-sync mode note       yalnız not verir; varsayılan
    /lockfile-sync mode deny       bir lockfile geride kaldığı sürece commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install lockfile-sync@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=lockfile-sync}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.env.get (via tmpDir), $.fs.exists (via lockOnDisk), $.fs.read (via treeText), $.process.run (via git, lockVerdict), $.session.cwd (via beforeCommit), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via denyFor, toPerson, toolFailed)

Reach L3: network'e erişen process'ler çalıştırır.

    1. Okur:         Bash komutunun metnini; repository'de lockfile'ların olup olmadığını; açık her bulgunun manifest'ini ve lockfile'ını working tree'de; git ile commit'in dosya listesini, manifest diff'lerini ve HEAD'deki her manifest'i; TMPDIR'i
    2. Çalıştırır:   argv ile salt okunur git rev-parse, git show, git status, git log ve git diff; 4. adımdaki package manager kontrolünü, commit sırasında lockfile'ı dışarıda kalan her manifest için bir kez ve her ölçümde, turn sonunda da, açık her çift için bir kez
    3. Gönderir:     commit'in sonucundan sonra modele bir not; bulgu açık kaldığı sürece bir sonraki prompt'la bir not daha; transcript'e bir satır; package manager, çözümlediği paketlerin metadata'sı için kendi registry'sine istek gönderebilir
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde; package manager'lar kendi cache'lerini tutar ve mix $TMPDIR/lockfile-sync/mix-deps altına indirir
    5. Düşman girdi: dizin komutun metninden gelir ve git'e ve package manager'a hiçbir zaman bir shell üzerinden değil, yalnız çalışma dizini olarak verilir; manifest path'leri tek bir argv öğesi olarak verilir. Kontrol, projenin içerdiği kodu çalıştırır: Gemfile Ruby, mix.exs Elixir kodudur ve ikisi de çalıştırılır. npm, pnpm ve bun --ignore-scripts ile, pnpm ayrıca --ignore-pnpmfile ile, composer --no-plugins ile çalışır; böylece projenin script'leri ve plugin'leri çalışmaz

## Sınırlar

- Package manager kontrolünün hiçbir şeyi kanıtlamadığı durumda mod yalnız dosya adlarını ve diff bölümlerini karşılaştırır. Lockfile'ın içeriğinin manifest'e uyup uymadığını kontrol etmez.
- Kararı package manager'ın kendisi verir: `npm ci` kök paketin `version` değerini karşılaştırmaz. `yarn check` de kaldırılmış bir dependency'yi hâlâ listeleyen bir lockfile'ı uyumlu okur.
- Yarn 2+ `yarn.lock` için burada bir kontrol yoktur: `yarn install --immutable` `node_modules` dizinini projeye bağlar ve `--mode=update-lockfile`, `--immutable` ile birlikte kullanılamaz.
- Bir bulgu açık kaldığı sürece kontrolü her ana loop turn'ünün sonunda, her çift için en fazla 60 saniye olmak üzere yeniden çalışır.
- Hiçbir commit'in yazmadığı bir lockfile için manifest'in karşılaştırılacağı bir commit yoktur. Bu yüzden bu bulguyu yalnız ilk ölçüm kapatabilir.
- Aynı dizinde aynı package manager ekosistemine ait iki lockfile (bir `package-lock.json` yanında bir `yarn.lock`), tablodaki ilk lockfile ile eşleşir.
- `git commit` komutunu gizleyen bir script ya da alias ile yapılan bir commit fark edilmez.
- Dizinini shell'in genişlettiği bir `cd` ya da `git -C` (`cd $D`, `cd ~/x`, bir backquote) moda gerçek dizini vermez. Bu commit kontrol edilmez ve sarı satır bu kelimeyi gösterir, örneğin `the commit's directory is not known: cd $D`. Tek tırnak içindeki bir kelime olduğu gibi okunur.
- Bir merge commit'inin birleşik diff'i okunmaz.
- `deny` modunu atlamanın bir yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/lockfile-sync mode note` ile siz kapatırsınız.
- Gate, lockfile'daki herhangi bir working tree değişikliğini düzeltme sayar. Değişikliğin içeriğini kontrol etmez.
- `git commit -a`, `-am` ve `--` işaretinden sonra pathspec verilen commit'ler index'e göre daraltılmaz, çünkü bu komutlar index'te henüz olmayan dosyaları da commit eder. Bu commit'lerde açık çiftlerin hepsi geçerlidir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
