# lockfile-sync

Bir commit'in bir manifest'in dependency'lerini değiştirip lockfile'ını değiştirmediğini modele söyleyen bir Claude Code Mod'u. Modelin çalıştırdığı her `git commit` sonrasında mod, commit'in lockfile'ını dışarıda bıraktığı manifest'leri commit'in sonucuna ekler. Commit hiçbir zaman durdurulmaz.

## Ne yapar

1. Mod Bash tool'unu hook'lar. `git commit` çalıştıran bir komut (`git -C <dir> commit` de dahil, `--dry-run` ya da `--help` değil) kontrol edilir.
2. Komut çalışmadan önce repository kökünü session'ın dizininden, commit'ten önceki son `cd`'den ve commit'in `git -C` değerinden bulur ve `HEAD`'i kaydeder.
3. `HEAD`'i ilerleten başarılı bir komuttan sonra commit'in eklenen ve değiştirilen dosyalarını `git show --name-status HEAD` ile listeler ve her manifest'i lockfile'ı ile eşleştirir:

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

   Lockfile, manifest'in dizininden repository köküne doğru diskte bulunan ilkidir, yani bir workspace package'i kökteki lockfile ile eşleşir. Diskte lockfile'ı olmayan bir manifest'e dokunulmaz: proje bir tane tutmuyordur.
4. Commit o lockfile'ı dışarıda bıraktığında mod manifest'in diff'ini okur (`git show --unified=20 HEAD -- <manifest>`) ve değişen satırların nerede olduğunu kontrol eder. Yalnız lockfile'ı değiştirebilecek bir değişiklik sayılır:

   | Manifest | Sayılır | Sayılmaz |
   |---|---|---|
   | `package.json`, `composer.json` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions`, `require`, `require-dev` ve benzerleri | `scripts`, `version`, diğer key'ler |
   | `Cargo.toml`, `pyproject.toml`, `Pipfile` | `[dependencies]`, `[dev-dependencies]`, `[target.*.dependencies]`, `[project]`, `[tool.poetry.dependencies]`, `[packages]` ve benzerleri | `[package]`, `[tool.ruff]`, diğer table'lar |
   | `go.mod` | `require`, `replace`, `exclude` satırları ve blokları | `go 1.22`, `module` |
   | `Gemfile` | `gem`, `source`, `gemspec`, `group` satırları | yorumlar |
   | `pubspec.yaml` | `dependencies`, `dev_dependencies`, `dependency_overrides` | diğer key'ler |
   | `mix.exs` | her değişiklik | |

   Değişen bir satırın section'ı manifest'in tamamından okunur (`git show HEAD:<manifest>`), diff'in kendi 20 satırlık context'inden değil: bir `package.json` içinde 40 satır derindeki bir değişiklik hunk içinde kök `{` işaretine hiç ulaşmaz ve her kök seviyesindeki key dependency olarak okunurdu. Manifest'in kendisinin yerleştirmediği bir key ya da table sayılır, yani okunamayan bir dosya yine de notu alır.
5. Model bu notu commit'in sonucundan sonra okur:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum. Run the package manager's install so the lockfile matches, and commit it.

6. Aynı anda transcript'e bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır yalnız çiftleri taşır, talimat cümlesi olmadan:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
6. [sidebar](../sidebar) açıkken bu çiftler oraya gider, çift başına bir satır olarak, stream'inde bir entry halinde, ve transcript temiz kalır. Entry, yenileri pane'den itene kadar durur. Sidebar kapalıyken ya da o mod kurulu değilken transcript satırı yukarıdaki gibi yazılır.

7. Bir lockfile'ı dışarıda bırakan her commit, manifest'lerine göre key'lenmiş kendi sidebar entry'siyle kendi bulgusunu açar. Sonraki bir commit bulgusunu açık olanların yanına ekler ve hiçbirinin üstüne yazmaz; açık bir bulgunun zaten adlandırdığı bir çift ikinci kez açılmaz. Her bulgu kendi ölçümüyle kapanır.

   Bir bulgu hiçbir zaman hatırlanmış bir cevap değildir. Her ölçüm, sonraki her commit'ten sonra ve guarded bir git komutundan önce git'e yeniden sorar, yani iki yoldan kapanır:

   - lockfile yazıldı: sonraki bir commit onu değiştirdi ya da `git status --porcelain` working tree'de değiştiğini gösteriyor;
   - manifest artık bir lockfile değişikliği istemiyor: `git log -1 -- <lockfile>` lockfile'ı en son yazan commit'i adlandırır ve manifest'in o commit'e karşı diff'i hiçbir dependency'ye dokunmaz. Geri alınmış bir değişiklik böyle okunur.

   Entry temizlenir ve yeni bir satır hangisi olduğunu söyler:

       lockfile-sync: a later change brought the lockfiles along: package-lock.json
       lockfile-sync: the dependencies match the lockfile again: package.json

   Sidebar kapalıyken aynı metin tek bir transcript satırıdır. Model bunun hiçbirini okumaz: bulgu kendi işiyle kapandı, bir not yalnız az önce yaptığını tekrar ederdi.

8. Modelin kapatmadığı bir bulgu her ana döngü turunun sonunda yeniden ölçülür ve kalan, bir sonraki prompt'la modele tek bir not olarak ulaşır:

       lockfile-sync: 1 lockfile(s) are still behind their manifest: package-lock.json behind package.json. Run the package manager's install so the lockfile is written, or take the dependency change back.

   Tur başına bir not, prompt başına değil. Bu olmasa bulgu bir kere, commit anında söylenir ve sonra model onu unutmuşken pane'de dururdu. Siz yeni bir şey okumazsınız: pane zaten aynı bulguyu taşıyor.

9. `deny` modunda mod ayrıca, bir lockfile geride kaldığı sürece `git commit`, `git push` ve `git merge` komutlarını durdurur. Bir komutu durdurmadan önce iki ölçümü de çalıştırır, yani package manager'ın az önce yazdığı bir lockfile ve geri alınmış bir dependency değişikliği gate'i kendileri açar. Bir `git commit` yalnız kendi dosyaları için cevap verir: mod index'i okur (`git diff --cached --name-only`) ve index açık manifest'lerin hiçbirini tutmuyorsa commit'in çalışmasına izin verir, size kaçının hâlâ durduğunu söyleyen bir satırla. Bir `push` ve bir `merge` okunacak index tutmaz, yani orada her çift durur. Kaçış yolu yok; gate'i yalnız kişi `/lockfile-sync mode note` ile kapatır. `note` modu varsayılandır ve hiçbir şeyi durdurmaz.

Bir git hatası bir kere log'lanır ve commit'in sonucu olduğu gibi kalır.

Canlı kontrolde model bir `package.json` dependency'sini yükseltti, yalnız o dosyayı commit etti ve notu kelimesi kelimesine alıntıladı.

## Komut

    /lockfile-sync                 on ya da off, mod ve hâlâ geride olan lockfile'lar
    /lockfile-sync on | off        varsayılan on
    /lockfile-sync mode note       yalnız not; varsayılan
    /lockfile-sync mode deny       bir lockfile geride kalmışken commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install lockfile-sync@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=lockfile-sync}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via lockOnDisk), $.fs.read (via manifestText), $.process.run (via git), $.session.cwd (via beforeCommit), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via denyFor, report, toPerson)

Reach L2, process çalıştırır.

    1. Okur:     Bash komut metnini; repository'de lockfile'ların var olup olmadığını; her açık bulgunun manifest'ini working tree'de; git üzerinden commit'in dosya listesini, manifest diff'lerini ve her manifest'in HEAD'deki hâlini
    2. Çalıştırır: git rev-parse, git show, git status, git log, git diff ve git diff --cached --name-only komutlarını salt okuma olarak argv ile: commit başına dört, lockfile'ı olmayan manifest başına iki, ve her ölçümde açık çift başına iki, turun sonunda da
    3. Gönderir: commit'in sonucundan sonra modele bir not, bulgu dururken sonraki prompt'la bir tane daha ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: dizin komut metninden gelir ve git'e yalnız working directory olarak ulaşır, hiçbir zaman bir shell üzerinden geçmez; manifest path'leri git'e `--` sonrası tek bir argv girdisi olarak ulaşır

## Sınırlar

- Mod dosya adlarını ve diff section'larını karşılaştırır. Lockfile'ın içeriğinin manifest ile eşleştiğini kontrol etmez.
- Hiçbir commit'in yazmadığı bir lockfile, manifest'i karşılaştıracak bir şey tutmaz, yani bulgusunu yalnız ilk ölçüm kapatabilir.
- Bir dizinde bir manager'ın iki lockfile'ı (bir `package-lock.json` yanındaki bir `yarn.lock`) tablodaki ilkiyle eşleşir.
- `git commit`'i gizleyen bir script ya da alias üzerinden atılan commit görülmez. `cd ~/x` genişletilmez.
- Bir merge commit'inin birleşik diff'i okunmaz.
- `deny` modunun kaçış yolu yoktur. Bir bulgu düzeltilemediğinde kişi gate'i `/lockfile-sync mode note` ile kapatır.
- Gate, working tree'deki lockfile'a yapılan her değişikliği düzeltme olarak okur; o değişikliğin ne taşıdığını kontrol etmez.
- Bir `git commit -a`, bir `-am` ve `--` sonrası pathspec taşıyan bir commit index'e göre daraltılmaz, çünkü bunlar index'in henüz tutmadığı dosyaları commit eder. Onlar için her açık çift durur.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
