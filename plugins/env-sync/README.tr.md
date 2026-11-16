# env-sync

Model koda `process.env.STRIPE_KEY` ekler ve commit eder. Ancak `.env.example` dosyası bu değişkeni hâlâ içermez. Repository'yi clone'layan bir sonraki kişi uygulamayı başlatır ve ödemelerin neden çalışmadığını anlamaz. Bu mod her commit'i kontrol eder. Modelin çalıştırdığı her `git commit` komutundan sonra commit'in eklediği satırları okur. Referans dosyasında listelenmeyen env değişkenleri commit'in sonucuna eklenir. Commit'in kendisi hiçbir zaman durdurulmaz.

## Ne yapar

1. Mod Bash tool'unu izler. `git commit` çalıştıran komutlar kontrol edilir. `git -C <dizin> commit` ve önünde git'in global flag'leri olan biçimler de kontrol edilir. `--dry-run`, `--help` ya da `-h` içeren komutlar kontrol edilmez.
2. Komut çalışmadan önce mod repository kökünü bulur. Bunun için session'ın dizinini, commit'ten önceki son `cd` komutunu ve commit'in `git -C` değerini kullanır. Ardından `HEAD` değerini kaydeder.
3. `HEAD` değerini ilerleten başarılı bir komuttan sonra mod, kök dizindeki ilk referans dosyasını okur: `.env.example`, bu dosya yoksa `.env.sample`, o da yoksa `.env.dist`. Böyle bir dosyası olmayan bir repository'de hiçbir şey yapılmaz.
4. Mod eklenen satırları `git show --format= --unified=0 HEAD` ile okur ve şu env okumalarını arar:

   | Dil | Okumalar |
   |---|---|
   | JavaScript, TypeScript | `process.env.X`, `process.env['X']`, `import.meta.env.X` |
   | Python | `os.getenv('X')`, `os.environ['X']`, `os.environ.get('X')`, `getenv('X')` |
   | Go | `os.Getenv("X")`, `os.LookupEnv("X")` |
   | PHP, Laravel | `env('X')`, `getenv('X')`, `$_ENV['X']`, `$_SERVER['X']` |
   | Rust | `std::env::var("X")`, `env::var("X")`, `env::var_os("X")` |
   | Ruby | `ENV['X']`, `ENV.fetch('X')` |
   | Java, Kotlin | `System.getenv("X")` |

   Değişken adı büyük harflerden oluşur (`[A-Z][A-Z0-9_]*`). `NODE_ENV`, `HOME`, `PATH`, `USER`, `PWD`, `SHELL`, `TMPDIR`, `TERM`, `LANG` ve `CI` atlanır. Web sunucusunun `$_SERVER` içine koyduğu request değerleri de atlanır: `HTTP_*`, `REQUEST_*`, `SERVER_*` ve benzerleri, ayrıca ön eki olmayan `HTTPS`, `AUTH_TYPE` ve `UNIQUE_ID`. Düz metin dosyalarının (`.md`, `.txt`, `.rst` ve benzerleri) satırları okunmaz.
5. Referans dosyasında `X=`, `export X=` ya da yorum satırı olarak `# X=` varsa değişken listelenmiş sayılır. Diğer değişkenler için model, commit'in sonucunun hemen ardından şu notu okur:

       env-sync: this commit reads env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4). Add them to .env.example with a placeholder value, never a real secret.

   Her değişken yalnız bir kez, eklendiği ilk satırla birlikte yazılır. En fazla 10 değişken adıyla yazılır, geri kalanı sayı olarak verilir.
6. Aynı anda transcript'e tek bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır talimat içermez, yalnız değişkenleri içerir:

       env-sync: env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4)

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz.
7. [sidebar](../sidebar) açıksa değişkenler transcript yerine sidebar'ın stream'ine, her değişken için bir satır olarak yazılır ve transcript temiz kalır. Değişkenin adı kırmızı, okunduğu yer soluk renktedir. Kayıt, yeni kayıtlar onu pane'den çıkarana kadar görünür. Sidebar yoksa satır yukarıdaki gibi transcript'e yazılır.
8. Mod bulguyu bellekteki eski bir cevaba göre tutmaz. Sonraki her commit'ten sonra ve korunan bir git komutundan önce yapılan her ölçüm iki kaynağı da yeniden okur. Bu yüzden bulgu iki yoldan kapanır:

   - Referans dosyası artık değişkeni listeler.
   - Eklenen satırlarında değişkeni okuyan dosya, kod değiştiği ya da geri alındığı için artık değişkeni okumaz. Silinen bir dosya da hiçbir şey okumaz.

   Çözülen bir değişken bulgudan hemen çıkarılır. Hiçbir değişken kalmadığında kayıt silinir. Yeşil bir kayıt nedeni bildirir:

       env-sync: .env.example now lists the variables it lacked: STRIPE_KEY · REDIS_URL
       env-sync: the code no longer reads: STRIPE_KEY

   Sidebar kapalıysa aynı metin transcript'e tek bir satır olarak yazılır. Model bunların hiçbirini okumaz, çünkü bulgu modelin kendi yaptığı işle kapanmıştır. Bir not, modelin az önce yaptığı işi yalnız tekrarlardı. Yerinde duran ancak okunamayan bir dosya, değişkeni açık tutar, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz.
9. Modelin kapatmadığı bir bulgu, her ana loop turn'ünün sonunda yeniden ölçülür. Hâlâ açık olan bulgular, bir sonraki prompt'unuzla birlikte modele tek bir not olarak gönderilir:

       env-sync: .env.example still lacks 1 env variable(s) the code reads: STRIPE_KEY (src/pay.ts). Add them to .env.example with a placeholder value, or take the reads out.

   Bu not her turn için bir kez gönderilir, her prompt için değil. Bu not olmasaydı model bulguyu yalnız commit anında bir kez duyar ve ardından unuturdu. Bulgu da pane'de kalırdı. Size yeni bir satır gösterilmez, çünkü pane aynı bulguyu zaten gösterir.
10. `deny` modunda bir bulgu açık kaldığı sürece mod `git commit`, `git push` ve `git merge` komutlarını da durdurur. Mod bir komutu durdurmadan önce iki kaynağı da yeniden ölçer. Böylece değişkenleri ekleyen ya da okumaları kaldıran bir commit gate'i kendiliğinden açar. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`). Commit, eksik değişkenleri okuyan dosyaların hiçbirini içermiyorsa çalışır ve kaç bulgunun hâlâ açık olduğu tek bir satırla bildirilir. `push` ve `merge` için okunacak bir index yoktur. Bu yüzden bu komutlarda bütün bulgular geçerlidir. Gate'i atlamanın bir yolu yoktur. Gate'i yalnız siz `/env-sync mode note` ile kapatabilirsiniz. Varsayılan mod `note` modudur ve hiçbir işlemi durdurmaz.

Bir git hatası sarı bir kayıt olarak yazılır (sidebar kapalıysa transcript'e). Kayıt, farklı bir hata gelene kadar yalnız bir kez yazılır ve commit'in sonucu değiştirilmez.

Canlı denemede `.env.example` dosyası yalnız `DB_URL` değişkenini listeleyen bir repository kullanıldı. Model bir dosyaya `process.env.STRIPE_KEY` ekledi, commit etti ve notu kelimesi kelimesine aktardı.

## Komut

    /env-sync                 açık mı kapalı mı, mod ve hâlâ eksik olan değişkenler
    /env-sync on | off        varsayılan açık
    /env-sync mode note       yalnız not verir; varsayılan
    /env-sync mode deny       bir değişken eksik kaldığı sürece commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install env-sync@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=env-sync}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via referenceFile, stillRead), $.fs.read (via commitNote, gate, recheckNow, stillRead), $.process.run (via git, scopeOf), $.session.cwd (via beforeCommit, recheckNow), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via denyFor, toPerson)

Reach L2: process çalıştırır.

    1. Okur:         Bash komutunun metnini; repository kökündeki referans dosyasını; açık bir bulgunun geldiği her dosyayı yeniden, turn sonunda da; git ile commit'in eklediği satırları
    2. Çalıştırır:   argv ile salt okunur git rev-parse, git show ve git diff --cached --name-only -z, her commit için en fazla dört kez; bulgu açık kaldığı sürece turn sonunda git rev-parse
    3. Gönderir:     commit'in sonucundan sonra modele bir not; bulgu açık kaldığı sürece bir sonraki prompt'la bir not daha; transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde
    5. Düşman girdi: dizin komutun metninden gelir ve git'e hiçbir zaman bir shell üzerinden değil, yalnız çalışma dizini olarak verilir; not yalnız değişken adlarını yazar, .env.example içindeki hiçbir değeri yazmaz

## Sınırlar

- Bir config katmanı ile okunan bir değişken (Laravel `config('x')`, bir settings sınıfı, `dotenv` şema dosyaları) fark edilmez. Çalışma anında oluşturulan bir ad (`process.env[name]`) da fark edilmez.
- Yalnız repository kökündeki referans dosyası okunur. Kendi `.env.example` dosyası olan bir monorepo paketi, kök dizindeki dosyaya göre kontrol edilir.
- Mod komutu metin olarak okur. Bu yüzden `git commit` komutunu gizleyen bir script ya da alias ile yapılan bir commit fark edilmez ve gate'ten geçer.
- Dizinini shell'in genişlettiği bir `cd` ya da `git -C` (`cd $D`, `cd ~/x`, bir backquote) moda gerçek dizini vermez. Bu commit kontrol edilmez ve sarı satır bu kelimeyi gösterir, örneğin `the commit's directory is not known: cd $D`. Tek tırnak içindeki bir kelime olduğu gibi okunur.
- Bir merge commit'inin birleşik diff'i okunmaz.
- `deny` modunu atlamanın bir yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/env-sync mode note` ile siz kapatırsınız.
- `git commit -a`, `-am` ve `--` işaretinden sonra pathspec verilen commit'ler index'e göre daraltılmaz, çünkü bu komutlar index'te henüz olmayan dosyaları da commit eder. Bu commit'lerde açık bulguların hepsi geçerlidir.
- Bulgu, commit'in değişkeni okuduğu dosyaya göre ölçülür. Başka bir dosyaya taşınan bir okuma, eski dosyada kaldırılmış sayılır. Okumayı başka bir dosyaya ekleyen commit de onu yeniden bildirir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
