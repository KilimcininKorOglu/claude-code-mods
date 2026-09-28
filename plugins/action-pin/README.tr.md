# action-pin

`actions/checkout@v4` diye yazılmış bir GitHub Actions adımı, workflow hangi gün çalışırsa o gün tag'in gösterdiği kodu çalıştırır. Tag ya da branch sen inceledikten sonra başka bir koda kaydırılabilir. Bu mod, modelin düzenlediği workflow'ları izler: bir edit hareket eden bir ref'e bağlı adım eklerse modele yerine yazması gereken commit SHA'sını söyler. Varsayılan hâlinde hiçbir şeyi durdurmaz; `deny` modunda her ref sabitlenene kadar commit, push ve merge bekler.

## Ne yapar

1. Edit ve Write tool'larını izler. Path'i `.github/workflows/<name>.yml` ya da `.github/actions/<name>/action.yml` olan çağrıya bakar (`.yaml` da olur).
2. Yalnız edit'in eklediği satırları okur. Ref'i 40 ya da 64 karakterlik hex bir commit olan `uses:` değeri zaten sabitlenmiştir, geçer. Yerel bir action'ın (`./.github/actions/setup`) ve bir container'ın (`docker://alpine:3.20`) sabitlenecek commit'i yoktur, onlar da geçer. Geri kalan her ref, yani bir tag (`@v4`) ya da bir branch (`@main`), bildirilir; `actions/*` ve `github/*` de buna dahil.
3. Bildirdiği her action için `Accept: application/vnd.github.sha` header'ıyla `https://api.github.com/repos/<owner>/<repo>/commits/<ref>` adresine sorar, GitHub da commit'i düz metin olarak döner. Token gönderilmez, bu yüzden anonim rate limit geçerlidir (adres başına saatte 60 istek). Her action ve ref bir session'da bir kez sorulur.
4. Model tool'un sonucunun hemen ardından şu notu okur:

       action-pin: this edit uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8. A tag or a branch can be moved to other code after a review, so a workflow with write access runs whatever it points at then. Write each as the SHA with the tag as a comment, for example: uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v4

   Notta en fazla 10 action adıyla geçer ve yalnız bunlar GitHub'a sorulur; fazlası yalnız sayılır. GitHub cevap vermezse action SHA'sız geçer ama not yine sabitlemeyi ister. Hata log'a bir kez yazılır ve farklı bir hata gelene kadar tekrarlanmaz.
5. Aynı anda transcript'e tek satır düşer, böylece modele ne söylendiğini görürsün. Satırda workflow ve action'ları vardır, talimat yoktur. Workflow'un adı geçer, çünkü edit'i model gördü, sen görmedin:

       action-pin: .github/workflows/ci.yml uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8

   Not ile satır ayrı kanallardır: model satırı, sen de notu hiç okumazsın. Workflow'un path'i, session'ın başladığı git repository'sinin köküne göre yazılır; repository dışındaysan session'ın dizinine göre. Bu path sidebar kaydının da key'idir, yani her workflow'un kendi kaydı olur. Kök session başlarken bir kez okunur, çünkü Bash'teki bir `cd` session'ın dizinini değiştirir.
6. [sidebar](../sidebar) açıksa bulgu transcript yerine onun stream'ine gider, transcript temiz kalır. Önce kırmızıyla workflow gelir, sonra her action için bir satır: action varsayılan renkte, hareket eden ref kırmızı, gösterdiği commit soluk. Sidebar yoksa satır yukarıdaki gibi transcript'e düşer.
7. Bulgu, workflow o action'ları sabitleyene kadar açık kalır. Sonraki her Edit ya da Write'tan sonra mod açık workflow'ların hepsini yeniden okur; ref'lerinin hepsi sabitlenmiş olan kapanır. Artık yerinde olmayan workflow da kapanır, çünkü hiçbir action kullanmıyordur. Yerinde olup okunamayan workflow'un bulgusu açık kalır, çünkü okunmamış dosya hiçbir şey kanıtlamaz:

       action-pin: every action of .github/workflows/ci.yml is pinned to a commit now: actions/checkout@v4
       action-pin: .github/workflows/ci.yml is no longer there: actions/checkout@v4

   Sidebar'da kırmızı kayıt silinir, yerine yeşil bir kayıt gelir; sidebar kapalıysa aynı metin transcript'e tek satır olarak düşer. Model bunların hiçbirini okumaz, çünkü SHA'yı kendisi yazdı.
8. Modelin kapatmadığı bulgu her main-loop turn'ünün sonunda yeniden ölçülür. Geriye kalan, bir sonraki prompt'unla birlikte modele tek not olarak gider. SHA'lar zaten bellekte olduğu için GitHub'a hiçbir şey sorulmaz:

       action-pin: 1 action(s) are still used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, or take the step out.

   Not her prompt'ta değil, turn başına bir kez gelir. Bu not olmasa model bulguyu yalnız edit anında bir kez duyar ve sonra unuturdu; bulgu da pane'de öylece dururdu. Sana yeni bir satır düşmez, çünkü pane aynı bulguyu zaten gösteriyor.
9. `deny` modunda mod, bir workflow hâlâ hareket eden bir ref'le action kullanıyorken `git commit`, `git push` ve `git merge` komutlarını da durdurur. Durdurmadan önce açık workflow'ların her birini yeniden okur; model bir dosyayı sabitlediyse gate kendiliğinden açılır. `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`), commit açık workflow'ların hiçbirini içermiyorsa geçmesine izin verir ve sana kaç bulgunun hâlâ durduğunu tek satırla söyler. `push` ve `merge` için okunacak bir index yoktur, orada bütün bulgular geçerlidir. Gate'i aşmanın yolu yoktur; kapatmak yalnız sana kalır, `/action-pin mode note` ile. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz.

## Komut

    /action-pin                 açık mı kapalı mı, mod ve hâlâ hareket eden workflow'lar
    /action-pin on | off        açar ya da kapatır; kurulumdan sonra açıktır
    /action-pin mode note       yalnız not verir; varsayılan budur
    /action-pin mode deny       ref hareket ettiği sürece commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install action-pin@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=action-pin}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isThere), $.fs.read (via stillMoving), $.http.fetch (via resolveSha), $.process.run (via shownRootOf, stagedPaths), $.session.cwd (via stagedPaths), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via gate, report, toPerson)

Reach L3: network'e çıkar.

    1. Okur:     her Edit ve Write'ın path'ini ve yeni metnini; Bash komutunun metnini; bulgu açıkken her açık workflow'u yeniden, turn sonunda da
    2. Çalıştırır: session başlarken bir kez git rev-parse --show-toplevel, workflow'ları repository köküne göre göstermek için; deny modunda bir commit anında git rev-parse --show-toplevel ve git diff --cached --name-only -z, commit'in hangi dosyaları içerdiğini okumak için
    3. Gönderir: herkese açık action adını ve ref'ini (örneğin actions/checkout ve v4) api.github.com'a, edit başına en fazla 10 tane, her birini session başına bir kez; token yok, repository içeriği yok, dosya path'i yok
    4. Saklar:   $.store içinde açık/kapalı ayarını ve modu; çözülen SHA'lar bir session boyunca bellekte durur
    5. Düşman girdi: cevap yalnız 40 hex karakterse kullanılır ve yalnız notun içine yazılır; mod hiçbir dosyayı düzenlemez

## Sınırlar

- Kontrol metin üzerinden yapılır: block comment ya da YAML string içindeki bir `uses:` satırı da sayılır.
- Repository'de zaten duran bir workflow'a bakılmaz; yalnız edit'in eklediği satırlara bakılır.
- Anonim rate limit'e takılan ya da private bir repository'de duran action'ın notunda SHA olmaz.
- Bir kez çözülen SHA session boyunca saklanır. Session sırasında kaydırılan bir tag ilk cevabını korur.
- Bulgu ancak workflow o action'ları artık bir ref'le kullanmadığında kapanır. Okunamayan dosya bulguyu açık tutar.
- `deny` modunu aşmanın yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/action-pin mode note` ile sen kapatırsın.
- Gate komutun metnine bakar. `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit durdurulmaz.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit index'e göre daraltılmaz, çünkü index'te henüz olmayan dosyaları da commit'ler. Bunlarda açık bulguların hepsi geçerlidir.
- Index, session'ın kendi dizinindeki repository'den okunur. Başka bir repository'deki workflow'un bulgusu bununla hiç eşleşmez, o yüzden böyle bir commit geçer.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
