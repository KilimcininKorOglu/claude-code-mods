# env-sync

Bir commit, `.env.example` dosyasında olmayan env variable'ları okuduğunda bunu modele söyleyen bir Claude Code Mod'u. Modelin çalıştırdığı her `git commit` sonrasında mod, commit'in eklediği satırları okur ve referans dosyanın listelemediği variable'ları commit'in sonucuna ekler. Commit hiç durdurulmaz.

## Ne yapar

1. Mod Bash tool'unu hook'lar. `git commit` çalıştıran bir komut kontrol edilir (`git -C <dir> commit` de, `--dry-run` ve `--help` değil).
2. Komut çalışmadan önce repository root'unu bulur: session'ın dizini, commit'ten önceki son `cd` ve commit'in kendi `git -C` değeri. Sonra `HEAD`'i kaydeder.
3. `HEAD`'i ilerleten başarılı bir komuttan sonra root'taki ilk referans dosyayı okur: `.env.example`, yoksa `.env.sample`, yoksa `.env.dist`. Bunlardan hiçbiri olmayan bir repository hiçbir şey almaz.
4. Eklenen satırları `git show --format= --unified=0 HEAD` ile okur ve şu env okumalarını bulur:

   | Dil | Okuma |
   |---|---|
   | JavaScript, TypeScript | `process.env.X`, `process.env['X']`, `import.meta.env.X` |
   | Python | `os.getenv('X')`, `os.environ['X']`, `os.environ.get('X')`, `getenv('X')` |
   | Go | `os.Getenv("X")`, `os.LookupEnv("X")` |
   | PHP, Laravel | `env('X')`, `getenv('X')`, `$_ENV['X']`, `$_SERVER['X']` |
   | Rust | `std::env::var("X")`, `env::var("X")`, `env::var_os("X")` |
   | Ruby | `ENV['X']`, `ENV.fetch('X')` |
   | Java, Kotlin | `System.getenv("X")` |

   Ad büyük harftir (`[A-Z][A-Z0-9_]*`). `NODE_ENV`, `HOME`, `PATH`, `USER`, `PWD`, `SHELL`, `TMPDIR`, `TERM`, `LANG` ve `CI` atlanır; web sunucusunun `$_SERVER` içine yazdığı request değerleri de (`HTTP_*`, `REQUEST_*`, `SERVER_*` ve benzerleri, ve önek taşımayan `HTTPS`, `AUTH_TYPE` ve `UNIQUE_ID`). Düz metin dosyalarının satırları (`.md`, `.txt`, `.rst` ve benzerleri) okunmaz.
5. Bir variable, referans dosyada `X=`, `export X=` ya da comment'lenmiş `# X=` satırı varsa listelenmiş sayılır. Model, commit'in sonucundan sonra şu notu okur:

       env-sync: this commit reads env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4). Add them to .env.example with a placeholder value, never a real secret.

   Her variable bir kere, ilk eklendiği satırda adlandırılır. En fazla 10 tanesi adlandırılır, gerisi sayılır.
6. Aynı anda transcript'e bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır talimat cümlesi olmadan yalnız variable'ları taşır:

       env-sync: env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4)

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
7. [sidebar](../sidebar) açıkken bu variable'lar oraya gider, variable başına bir satır, stream'in içinde bir kayıt olarak; transcript temiz kalır. Kayıt, yenileri onu pane'in dışına itene kadar durur. Sidebar kapalıyken ya da o mod kurulu değilken yukarıdaki transcript satırı yazılır.

8. Bulgu asla hatırlanan bir cevap değildir. Her ölçüm, sonraki her commit'ten sonra ve guarded bir git komutundan önce, iki kaynağı da tekrar okur, yani iki yoldan kapanır:

   - referans dosya variable'ı listeler;
   - eklenen satırları onu okuyan dosya artık okumuyordur, çünkü kod değişti ya da geri alındı. Artık var olmayan bir dosya da hiçbir şey okumaz.

   Çözülen bir variable bulgudan hemen çıkar ve geriye bir şey kalmadığında kayıt temizlenir:

       env-sync: .env.example now lists the variables it lacked: STRIPE_KEY · REDIS_URL
       env-sync: the code no longer reads: STRIPE_KEY

   Sidebar kapalıyken aynı metin tek bir transcript satırıdır. Model bunların hiçbirini okumaz: bulgu kendi işiyle kapanmıştır, yani bir not yalnız az önce yaptığını tekrarlardı. Duran ama okunamayan bir dosya variable'ını açık tutar, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz.

9. Modelin kapatmadığı bir bulgu her main-loop turn sonunda tekrar ölçülür ve geriye kalan, bir sonraki prompt ile modele tek not olarak ulaşır:

       env-sync: .env.example still lacks 1 env variable(s) the code reads: STRIPE_KEY (src/pay.ts). Add them to .env.example with a placeholder value, or take the reads out.

   Turn başına bir not, prompt başına değil. Bu olmasa bulgu bir kere, commit anında söylenir ve model onu unutmuşken pane'de dururdu. Siz yeni bir şey okumazsınız: pane zaten aynı bulguyu taşır.

10. `deny` modunda mod ayrıca, bir bulgu açıkken `git commit`, `git push` ve `git merge` komutlarını durdurur. Bir komutu durdurmadan önce iki kaynağı da tekrar ölçer, yani variable'ları ekleyen bir commit de, okumaları kaldıran bir commit de gate'i kendisi açar. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only`) ve commit eksik variable'ları okuyan dosyalardan hiçbirini tutmuyorsa çalışmasına izin verir, kaç bulgunun durduğunu söyleyen bir satırla. `push` ve `merge` hiçbir index okumaz, bu yüzden orada her bulgu durur. Kaçış yolu yoktur; gate'i yalnız kişi `/env-sync mode note` ile kapatır. `note` varsayılandır ve hiçbir şeyi durdurmaz.

Bir git hatası bir kere log'lanır ve commit'in sonucu olduğu gibi kalır.

Canlı testte model, `.env.example` dosyası yalnız `DB_URL` listeleyen bir repository'nin bir dosyasına `process.env.STRIPE_KEY` ekledi, commit etti ve notu kelimesi kelimesine aktardı.

## Komut

    /env-sync                 on ya da off, mod ve hâlâ eksik variable'lar
    /env-sync on | off        varsayılan on
    /env-sync mode note       sadece not; varsayılan
    /env-sync mode deny       bir variable eksikken commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install env-sync@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=env-sync}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via referenceFile, stillRead), $.fs.read (via commitNote, gate, recheckNow, stillRead), $.process.run (via git, scopeOf), $.session.cwd (via beforeCommit, recheckNow), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via denyFor, toPerson)

Reach L2, process çalıştırır.

    1. Okur:     Bash komut metnini; repository root'undaki referans dosyayı; açık bir bulgunun geldiği her dosyayı tekrar, turn sonunda da; git üzerinden commit'in eklediği satırları
    2. Çalıştırır: git rev-parse, git show ve git diff --cached --name-only, salt okuma, argv ile, commit başına en fazla dört kere; bulgu dururken turn sonunda git rev-parse
    3. Gönderir: commit'in sonucundan sonra modele bir not, bulgu dururken bir sonraki prompt ile bir not daha, ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: dizin komut metninden gelir ve git'e yalnız working directory olarak ulaşır, hiçbir zaman shell üzerinden geçmez; not variable adlarını adlandırır, .env.example içindeki bir değeri asla

## Sınırlar

- Bir config katmanı üzerinden okunan variable (Laravel `config('x')`, bir settings sınıfı, `dotenv` şema dosyaları) görülmez; çalışma zamanında kurulan bir ad da görülmez (`process.env[name]`).
- Yalnız repository root'undaki referans dosya okunur. Kendi `.env.example` dosyası olan bir monorepo paketi, root'taki dosyaya göre kontrol edilir.
- `git commit` komutunu gizleyen bir script ya da alias üzerinden atılan commit görülmez. `cd ~/x` genişletilmez.
- Bir merge commit'inin birleşik diff'i okunmaz.
- `deny` modunun kaçış yolu yoktur. Bulgu düzeltilemiyorsa kişi gate'i `/env-sync mode note` ile kapatır.
- Gate komutu metin olarak okur, yani bir script ya da alias üzerinden atılan commit gate'ten geçer.
- `git commit -a`, `-am` ve `--` sonrası pathspec taşıyan bir commit index'e göre daraltılmaz, çünkü bunlar index'in henüz tutmadığı dosyaları commit eder. Onlar için her açık bulgu durur.
- Bulgu, commit'in variable'ı okuduğu dosyaya göre ölçülür. Başka bir dosyaya taşınan bir okuma orada gitmiş sayılır ve onu başka yere ekleyen commit bulguyu tekrar raporlar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
