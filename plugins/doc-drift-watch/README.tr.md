# doc-drift-watch

Modelin attığı commit'in hangi doc satırlarını bayattığını modele söyleyen bir Claude Code Mod'u. Modelin çalıştırdığı her `git commit` sonrasında mod, [ripwire](https://github.com/redhat-et/ripwire) ile hangi markdown anchor'larının artık tutmadığını sorar ve commit'in bozduklarını commit'in sonucuna ekler.

## Ne yapar

1. Mod Bash tool'unu hook'lar. `git commit` çalıştıran bir komut kontrol edilir (`git -C <dir> commit` de, `--dry-run` ve `--help` değil).
2. Komut çalışmadan önce repository root'unu bulur: session'ın dizini, commit'ten önceki son `cd` ve commit'in kendi `git -C` değeri. Sonra `ripwire <root> --doc-drift --with-history` komutunu argv ile çalıştırır.
3. Başarılı bir commit'ten sonra aynı komutu tekrar çalıştırır ve iki koşuyu karşılaştırır. İki anchor, doc'u, kind'ı, sebebi ve referansı aynıysa aynı sayılır; satır numarası hesaba katılmaz, çünkü üstteki bir edit onu kaydırır.
4. Sadece commit'in eklediği anchor'lar raporlanır. Model, commit'in sonucundan sonra şu notu okur:

       doc-drift-watch: this commit made 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists. Update them in a follow-up commit, or tell the user why a line stays.

   En fazla 8 satır adlandırılır, gerisi sayılır.
5. Aynı anda transcript'e bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır talimat cümlesi olmadan yalnız bayat satırları taşır:

       doc-drift-watch: 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
6. [sidebar](../sidebar) açıkken bu satırlar oraya gider, doc başına bir entry, kırmızı, stream'in içinde bir kayıt olarak; transcript temiz kalır. Sidebar kapalıyken ya da o mod kurulu değilken yukarıdaki transcript satırı yazılır.
7. Bulgu sonra açık kalır, doc başına bir tane. Her main-loop turn sonunda mod her açık doc'u tekrar ölçer: `ripwire <root> --doc-drift=<doc> --with-history`, yani yalnız o doc'a daraltılmış bir koşu. Anchor'larının hepsi tekrar tutan bir doc kapanır: kırmızı entry temizlenir, yerine bir yeşil satır gelir.

       doc-drift-watch: README.md: 1 doc line(s) hold again

   Silinmiş bir doc bulguyu diğer taraftan kapatır ve satır bunu söyler: `README.md is gone, and its 1 stale line(s) with it`. Bayat satırlarının bir kısmı duran doc açık kalır, çünkü kısmen düzelmiş düzelmemiş sayılır. Açık bir doc'un daha fazla satırını bayatlatan sonraki bir commit onları o doc'un bulgusuna ekler; bulgunun zaten tuttuğu satırlar, commit sonrası drift onları hâlâ raporladığı sürece kalır.
8. Geriye kalan, bir sonraki prompt ile modele tek not olarak ulaşır, turn başına bir not:

       doc-drift-watch: 1 doc(s) still hold stale lines: README.md (1). Update them.

Commit'ten önce de bayat olan bir anchor tekrarlanmaz, yani bir README'deki örnek path her commit'te geri gelmez. Yazarının tarih attığı bir anchor (ripwire `kind="dated-record"`) raporlanmaz, çünkü o kayıt o günün doğrusunu tutar.

Canlı testte model, bir README'nin `other.go:3` ile gösterdiği dosyayı sildi, commit sonrası notu okudu ve kelimesi kelimesine tekrarladı. Aynı README'deki daha eski bir bayat anchor notta yer almadı.

## İki mod

`note` varsayılandır: mod raporlar ve hiçbir şeyi durdurmaz.

`deny` modunda bir doc hâlâ bayat satır tutarken `git commit`, `git push` ve `git merge` durdurulur. Mod cevap vermeden önce her açık doc'u tekrar ölçer, yani modelin düzelttiği bir doc gate'i kendisi açar ve hiçbir gate kalıcı olarak kilitlenmez:

    doc-drift-watch: stopped: 1 doc(s) still hold stale lines: README.md (1). Update them and run the command again; there is no way around this gate.

Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git rev-parse --show-toplevel` ve `git diff --cached --name-only -z`) ve commit açık doc'lardan hiçbirini tutmuyorsa çalışmasına izin verir, kaç bulgunun durduğunu söyleyen bir satırla. `git commit -a`, `-am` ve `--` sonrası pathspec taşıyan bir commit daraltılmaz, çünkü index tek başına onların neyi commit ettiğini söylemez. `push` ve `merge` hiçbir index okumaz, bu yüzden orada her bulgu durur.

Kaçış yolu ve tek seferlik geçiş yoktur. Gate, doc'lar tekrar tuttuğunda ya da `/doc-drift-watch mode note` yazdığınızda açılır.

## Komut

    /doc-drift-watch                  durum: on ya da off, mod ve hâlâ bayat olan doc'lar
    /doc-drift-watch on | off         varsayılan on
    /doc-drift-watch mode note        sadece rapor, varsayılan
    /doc-drift-watch mode deny        bir doc bayatken git commit, push ve merge'i de durdur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install doc-drift-watch@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. [ripwire](https://github.com/redhat-et/ripwire) kurun ve PATH'e koyun. Olmadan her commit bir kere `the docs were not checked: ...` satırını yazar ve commit eskisi gibi çalışır.
2. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=doc-drift-watch}, tool.call{tool=Bash}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.fs.read (via isGone), $.process.run (via driftNow, repoRoot, stagedPaths), $.session.cwd (via beforeCommit, stagedPaths), $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via gate, report, toPerson)

Reach L2, process çalıştırır.

    1. Okur:     Bash komut metnini, her açık doc'un kendi dosyasını; ripwire üzerinden repository'nin markdown, kaynak kodu ve git history'sini
    2. Çalıştırır: git rev-parse, git diff --cached ve ripwire --doc-drift, salt okuma, argv ile: commit başına iki kere, her turn sonunda ve her guarded komutta açık doc başına bir kere
    3. Gönderir: commit'in sonucundan sonra ve bir sonraki prompt'ta modele bir not, transcript'e ya da sidebar'a bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: dizin komut metninden gelir ve git'e yalnız working directory olarak ulaşır, hiçbir zaman shell üzerinden geçmez; doc path'i ripwire'ın kendi çıktısından gelir ve ripwire'a tek bir argv değeri olarak gider

## Sınırlar

- ripwire file:line referanslarını, backtick içindeki sembol adlarını, `= N` sabitlerini ve `[N]` dizi uzunluklarını kontrol eder. Düz metin kontrol edilmez ve ripwire bilerek eksik raporlar: adı başka bir yerde de geçen, yeniden adlandırılmış bir sembol raporlanmaz.
- ripwire commit başına iki kere, her turn sonunda açık doc başına bir kere çalışır. Bu repository'de tüm repo koşusu 0.1 ile 0.2 saniye sürdü, daraltılmış koşu daha az.
- Turn sonu yalnız açık doc'ları ölçer. Commit'in dokunmadığı ve başka bir yolla bayatlayan bir doc turn sonunda değil, bir sonraki commit'te bulunur.
- `--doc-drift=<doc>` path substring'i ile filtreler, yani tek doc'a daraltılmış bir koşu, path'i onu içeren başka bir doc'u da okur. Cevap sonradan doc'un kendi path'i ile filtrelenir.
- `git commit` komutunu gizleyen bir script ya da alias üzerinden atılan commit görülmez.
- `cd ~/x` genişletilmez: root o zaman session'ın dizininden gelir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
