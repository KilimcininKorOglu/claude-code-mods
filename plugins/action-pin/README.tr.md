# action-pin

Bir GitHub Actions adımı `actions/checkout@v4` diye yazılmışsa, workflow hangi gün çalışırsa çalışsın o gün tag'in gösterdiği kodu çalıştırır. Adımı inceledikten sonra tag ya da branch başka bir koda çevrilebilir. Bu mod, modelin düzenlediği workflow'ları izler; bir edit hareketli bir ref'e bağlı adım eklediğinde modele, yerine yazması gereken commit SHA'sını söyler. Varsayılanı hiçbir şeyi durdurmaz; `deny` modunda her ref sabitlenene kadar commit, push ve merge bekler.

## Ne yapar

1. Her Edit ve Write çağrısını izler; dosya yolu `.github/workflows/<name>.yml` ya da `.github/actions/<name>/action.yml` olanları inceler (`.yaml` de sayılır).
2. Yalnızca edit'in eklediği satırlara bakar. `uses:` değeri 40 ya da 64 karakterlik hex bir commit olan ref zaten sabitlenmiştir; bunlar geçer. Yerel action'ların (`./.github/actions/setup`) ve container'ların (`docker://alpine:3.20`) sabitlenecek bir commit'i yoktur; bunlar da geçer. Geri kalan her ref, yani bir tag (`@v4`) ya da bir branch (`@main`), bildirilir; `actions/*` ve `github/*` de buna dahildir.
3. Bildirdiği her action için `Accept: application/vnd.github.sha` header'ıyla `https://api.github.com/repos/<owner>/<repo>/commits/<ref>` adresine bir istek yollar; GitHub commit'i düz metin olarak döndürür. Token gönderilmez; bu yüzden anonim rate limit geçerlidir (adres başına saatte 60 istek). Her action ve ref, bir session'da yalnızca bir kez sorulur.
4. Model, tool sonucunun hemen ardından şu notu okur:

       action-pin: this edit uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8. A tag or a branch can be moved to other code after a review, so a workflow with write access runs whatever it points at then. Write each as the SHA with the tag as a comment, for example: uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v4

   Not en fazla 10 action adı taşır ve yalnız bunlar GitHub'a sorulur; fazlası yalnızca sayılır. GitHub cevap vermezse action, SHA'sız geçer ama not yine sabitlemeyi ister. Bir hata log'a bir kez yazılır; farklı bir hata gelene kadar tekrarlanmaz.
5. Aynı anda transcript'e tek bir satır düşer; böylece modele ne söylendiğini görürsünüz. Satır workflow'u ve action'ları sayar, talimat taşımaz. Workflow'un adı geçer, çünkü edit'i model gördü, siz görmediniz:

       action-pin: .github/workflows/ci.yml uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8

   Not ile satır ayrı kanallardır: model satırı okumaz, siz de notu okumazsınız. Workflow'un dosya yolu, session'ın başladığı git repository'sinin köküne göre yazılır; dosya repository dışındaysa session'ın dizinine göre. Bu yol aynı zamanda sidebar kaydının key'idir; böylece her workflow'un kendi kaydı olur. Kök, session başlarken bir kez okunur; Bash'te yapılan bir `cd` session'ın dizinini değiştirdiği için sonradan okunmaz.
6. [sidebar](../sidebar) açıksa bulgu, transcript yerine onun stream'ine gider ve transcript temiz kalır. Önce workflow kırmızıyla gelir; ardından her action için bir satır düşer: action adı varsayılan renkte, hareketli ref kırmızı, gösterdiği commit soluktur. Sidebar yoksa satır, yukarıdaki gibi transcript'e düşer.
7. Bulgu, workflow o action'ları sabitleyene kadar açık kalır. Sonraki her Edit ve Write'ın ardından mod, açık workflow'ların hepsini yeniden okur; ref'leri tamamen sabitlenmiş olanın bulgusu kapanır. Dosya artık yerinde değilse bulgu yine kapanır, çünkü dosya artık hiçbir action kullanmıyor demektir. Yerinde olduğu hâlde okunamayan workflow'un bulgusu açıktır; okunmayan dosya hiçbir şey kanıtlamaz:

       action-pin: every action of .github/workflows/ci.yml is pinned to a commit now: actions/checkout@v4
       action-pin: .github/workflows/ci.yml is no longer there: actions/checkout@v4

   Sidebar'da kırmızı kayıt silinir, yerine yeşili gelir; sidebar kapalıysa aynı metin transcript'e tek satır olarak düşer. Model bunların hiçbirini okumaz; SHA'yı kendisi yazdı.
8. Modelin kapatmadığı bulgu, her main-loop turn'ünün sonunda yeniden ölçülür; geri kalanlar bir sonraki prompt'la birlikte modele tek bir not olarak gider. SHA'lar bellekte durduğu için GitHub'a hiçbir şey sorulmaz:

       action-pin: 1 action(s) are still used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, or take the step out.

   Not her prompt'ta değil, turn başına bir kez gelir. Bu not olmasaydı model bulguyu yalnızca edit anında duyar ve unuturdu; bulgu da pane'de öylece dururdu. Size yeni bir satır düşmez; pane aynı bulguyu zaten gösteriyor.
9. `deny` modunda mod, bir workflow hâlâ hareketli bir ref'le action kullanırken `git commit`, `git push` ve `git merge` komutlarını da durdurur. Durdurmadan önce açık workflow'ların hepsini yeniden okur; model bir dosyayı sabitlediyse gate kendiliğinden açılır. `git commit` yalnızca kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`); commit, açık workflow'ların hiçbirini taşımıyorsa geçer ve size kaç bulgunun sürdüğünü tek satırla söyler. `push` ve `merge` için okunacak bir index yoktur; orada bütün bulgular geçerlidir. Gate'i aşmanın bir yolu yoktur; onu yalnız siz kapatabilirsiniz, `/action-pin mode note` ile. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz.

## Komut

    /action-pin                 açık mı kapalı mı, mod ve hâlâ hareket eden workflow'lar
    /action-pin on | off        açar ya da kapatır; kurulumdan sonra açıktır
    /action-pin mode note       yalnız not verir; varsayılan budur
    /action-pin mode deny       ref hareket ettiği sürece commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install action-pin@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=action-pin}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isThere), $.fs.read (via stillMoving), $.http.fetch (via resolveSha), $.process.run (via shownRootOf, stagedPaths), $.session.cwd (via stagedPaths), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via gate, report, toPerson)

Reach L3: network'e çıkar.

    1. Okur:     her Edit ve Write'ın dosya yolunu ve yeni metnini; Bash komutunun metnini; bulgu açıkken her açık workflow'u yeniden, turn sonunda da
    2. Çalıştırır: session başlarken bir kez git rev-parse --show-toplevel, workflow'ları repository köküne göre göstermek için; deny modunda bir commit anında git rev-parse --show-toplevel ve git diff --cached --name-only -z, commit'in hangi dosyaları içerdiğini okumak için
    3. Gönderir: herkese açık action adını ve ref'ini (örneğin actions/checkout ve v4) api.github.com'a, edit başına en fazla 10 tane, her birini session başına bir kez; token yok, repository içeriği yok, dosya yolu yok
    4. Saklar:   $.store içinde açık/kapalı ayarını ve modu; çözülen SHA'lar bir session boyunca bellekte durur
    5. Düşman girdi: cevap yalnız 40 hex karakterse kullanılır ve yalnız notun içine yazılır; mod hiçbir dosyayı düzenlemez

## Sınırlar

- Kontrol metin üzerinden yapılır: block comment ya da YAML string içindeki bir `uses:` satırı da sayılır.
- Repository'de zaten duran bir workflow'a bakılmaz; yalnızca edit'in eklediği satırlara bakılır.
- Anonim rate limit'e takılan ya da private bir repository'de bulunan action'ın notunda SHA olmaz.
- Bir kez çözülen SHA session boyunca saklanır. Session içinde taşınan bir tag, ilk cevabı korur.
- Bulgu ancak workflow o action'ları artık bir ref'le kullanmadığında kapanır. Okunamayan dosya bulguyu açık tutar.
- `deny` modunu aşmanın yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/action-pin mode note` ile siz kapatırsınız.
- Gate, komutun metnine bakar. `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit durdurulmaz.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit, index'e göre daraltılmaz; çünkü index'te henüz olmayan dosyaları da commit'ler. Bu commit'lerde açık bulguların hepsi geçerlidir.
- Index, session'ın kendi dizinindeki repository'den okunur. Başka bir repository'deki workflow'un bulgusu bu index'le eşleşmez; böyle bir commit geçer.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
