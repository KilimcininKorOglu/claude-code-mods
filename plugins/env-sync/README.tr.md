# env-sync

Model koda `process.env.STRIPE_KEY` ekler, commit'ler ve `.env.example` hâlâ ondan söz etmez. Repository'yi clone'layan bir sonraki kişi uygulamayı başlatır ve ödemelerin neden çalışmadığını merak eder. Bu mod her commit'i kontrol eder: modelin çalıştırdığı her `git commit`'ten sonra commit'in eklediği satırları okur ve referans dosyasının listelemediği env değişkenlerini commit'in sonucuna ekler. Commit'in kendisi hiçbir zaman durdurulmaz.

## Ne yapar

1. Bash tool'unu izler. `git commit` çalıştıran komutlar kontrol edilir; `git -C <dizin> commit` ya da önünde git'in global flag'leri olan biçimleri de. `--dry-run`, `--help` ya da `-h` taşıyanlar kontrol edilmez.
2. Komut çalışmadan önce repository kökünü session'ın dizininden, commit'ten önceki son `cd`'den ve commit'in `git -C`'sinden bulur ve `HEAD`'i kaydeder.
3. `HEAD`'i ilerleten başarılı bir komuttan sonra kökteki ilk referans dosyasını okur: `.env.example`, yoksa `.env.sample`, o da yoksa `.env.dist`. Böyle bir dosyası olmayan repository'de hiçbir şey olmaz.
4. Eklenen satırları `git show --format= --unified=0 HEAD` ile okur ve şu env okumalarını arar:

   | Dil | Okumalar |
   |---|---|
   | JavaScript, TypeScript | `process.env.X`, `process.env['X']`, `import.meta.env.X` |
   | Python | `os.getenv('X')`, `os.environ['X']`, `os.environ.get('X')`, `getenv('X')` |
   | Go | `os.Getenv("X")`, `os.LookupEnv("X")` |
   | PHP, Laravel | `env('X')`, `getenv('X')`, `$_ENV['X']`, `$_SERVER['X']` |
   | Rust | `std::env::var("X")`, `env::var("X")`, `env::var_os("X")` |
   | Ruby | `ENV['X']`, `ENV.fetch('X')` |
   | Java, Kotlin | `System.getenv("X")` |

   Ad büyük harflidir (`[A-Z][A-Z0-9_]*`). `NODE_ENV`, `HOME`, `PATH`, `USER`, `PWD`, `SHELL`, `TMPDIR`, `TERM`, `LANG` ve `CI` atlanır; web sunucusunun `$_SERVER`'a koyduğu request değerleri de (`HTTP_*`, `REQUEST_*`, `SERVER_*` ve benzerleri, bir de ön eki olmayan `HTTPS`, `AUTH_TYPE` ve `UNIQUE_ID`). Düz yazı dosyalarının (`.md`, `.txt`, `.rst` ve benzerleri) satırları okunmaz.
5. Referans dosyasında `X=`, `export X=` ya da yorum satırına alınmış `# X=` varsa değişken listelenmiş sayılır. Geri kalanlar için model commit'in sonucunun hemen ardından şu notu okur:

       env-sync: this commit reads env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4). Add them to .env.example with a placeholder value, never a real secret.

   Her değişken bir kez, eklendiği ilk satırla anılır. En fazla 10 tanesi adıyla yazılır, gerisi sayılır.
6. Aynı anda transcript'e tek bir satır düşer, böylece modele ne söylendiğini görürsün. Satırda talimat yoktur, yalnız değişkenler vardır:

       env-sync: env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4)

   Not ile satır ayrı kanallardır: model satırı, sen de notu hiç okumazsın.
7. [sidebar](../sidebar) açıksa değişkenler transcript yerine onun stream'ine gider, her değişken bir satırda (ad kırmızı, okunduğu yer soluk); transcript temiz kalır. Kayıt, yenileri onu pane'den itene kadar durur. Sidebar yoksa satır yukarıdaki gibi transcript'e düşer.
8. Mod bulguyu bellekteki eski cevaba göre tutmaz. Sonraki her commit'ten sonra ve korunan bir git komutundan önce yapılan her ölçüm iki kaynağı da yeniden okur; bu yüzden bulgu iki yoldan kapanır:

   - referans dosyası artık değişkeni listeliyordur;
   - eklenen satırları değişkeni okuyan dosya, kod değiştiği ya da geri alındığı için artık onu okumuyordur. Ortadan kalkan bir dosya da hiçbir şey okumaz.

   Çözülen bir değişken bulgudan hemen çıkar; geriye hiçbir şey kalmayınca kayıt silinir. Nedenini yeşil bir kayıt söyler:

       env-sync: .env.example now lists the variables it lacked: STRIPE_KEY · REDIS_URL
       env-sync: the code no longer reads: STRIPE_KEY

   Sidebar kapalıysa aynı metin tek bir transcript satırıdır. Model bunların hiçbirini okumaz: bulgu kendi yaptığı işle kapandı, bir not ancak az önce yaptığını tekrarlardı. Yerinde duran ama okunamayan bir dosya değişkenini açık tutar, çünkü okunmamış dosya hiçbir şey kanıtlamaz.
9. Modelin kapatmadığı bir bulgu her ana loop turn'ünün sonunda yeniden ölçülür; geriye kalan, bir sonraki prompt'unla birlikte modele tek bir not olarak gider:

       env-sync: .env.example still lacks 1 env variable(s) the code reads: STRIPE_KEY (src/pay.ts). Add them to .env.example with a placeholder value, or take the reads out.

   Not her prompt'ta değil, her turn'de bir kez gelir. Bu not olmasa model bulguyu yalnız commit anında bir kez duyar ve sonra unuturdu; bulgu da pane'de öylece dururdu. Sana yeni bir satır düşmez, çünkü pane aynı bulguyu zaten gösteriyor.
10. `deny` modunda bulgu açık kaldıkça `git commit`, `git push` ve `git merge` komutlarını da durdurur. Durdurmadan önce iki kaynağı da yeniden ölçer; değişkenleri ekleyen ya da okumaları kaldıran bir commit gate'i kendiliğinden açar. `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`), commit eksik değişkenleri okuyan dosyaların hiçbirini içermiyorsa geçmesine izin verir ve kaç bulgunun hâlâ durduğunu tek satırla söyler. `push` ve `merge` için okunacak bir index yoktur, orada bütün bulgular geçerlidir. Gate'i aşmanın yolu yoktur; kapatmak yalnız sana kalır, `/env-sync mode note` ile. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz.

Bir git hatası sarı bir kayıt olarak yazılır (sidebar kapalıysa transcript'e). Kayıt farklı bir hata gelene kadar bir kez yazılır ve commit'in sonucu olduğu gibi kalır.

Canlı denemede model `.env.example`'ı yalnız `DB_URL`'yi listeleyen bir repository'deki bir dosyaya `process.env.STRIPE_KEY` ekledi, commit'ledi ve notu kelimesi kelimesine aktardı.

## Komut

    /env-sync                 açık mı kapalı mı, mod ve hâlâ eksik olan değişkenler
    /env-sync on | off        varsayılan açık
    /env-sync mode note       yalnız not verir; varsayılan budur
    /env-sync mode deny       bir değişken eksik kaldıkça commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install env-sync@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=env-sync}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via referenceFile, stillRead), $.fs.read (via commitNote, gate, recheckNow, stillRead), $.process.run (via git, scopeOf), $.session.cwd (via beforeCommit, recheckNow), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via denyFor, toPerson)

Reach L2: process çalıştırır.

    1. Okur:     Bash komutunun metnini; repository kökündeki referans dosyasını; açık bir bulgunun geldiği her dosyayı yeniden, turn sonunda da; git üzerinden commit'in eklediği satırları
    2. Çalıştırır: salt okunur git rev-parse, git show ve git diff --cached --name-only -z; argv ile, commit başına en fazla dört kez; bulgu durdukça turn sonunda git rev-parse
    3. Gönderir: commit'in sonucundan sonra modele bir not, bulgu durdukça bir sonraki prompt'la bir not daha, transcript'e bir satır; makineden dışarı bir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını ve modu
    5. Düşman girdi: dizin komutun metninden gelir ve git'e hiçbir zaman shell üzerinden değil, yalnız çalışma dizini olarak ulaşır; not değişkenleri adlandırır, .env.example'daki hiçbir değeri yazmaz

## Sınırlar

- Bir config katmanı üzerinden okunan değişken (Laravel `config('x')`, bir settings sınıfı, `dotenv` şema dosyaları) görülmez; çalışma anında kurulan bir ad (`process.env[name]`) da görülmez.
- Yalnız repository kökündeki referans dosyası okunur. Kendi `.env.example`'ı olan bir monorepo paketi, kökteki dosyaya göre kontrol edilir.
- Mod komutu metin olarak okur; `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit görülmez ve gate'ten geçer.
- Dizinini shell'in genişlettiği bir `cd` ya da `git -C` (`cd $D`, `cd ~/x`, bir backquote) mod'a gerçek dizini söylemez. O commit kontrol edilmez ve sarı satır bu kelimeyi gösterir, örneğin `the commit's directory is not known: cd $D`. Tek tırnak içindeki bir kelime olduğu gibi kalır.
- Bir merge commit'inin birleşik diff'i okunmaz.
- `deny` modunu aşmanın yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/env-sync mode note` ile sen kapatırsın.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit index'e göre daraltılmaz, çünkü index'te henüz olmayan dosyaları da commit'ler. Bunlarda açık bulguların hepsi geçerlidir.
- Bulgu, commit'in değişkeni okuduğu dosyaya göre ölçülür. Başka bir dosyaya taşınan bir okuma orada kaybolmuş sayılır; onu başka yere ekleyen commit de onu yeniden bildirir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
