# action-pin

GitHub Actions'ta bir adım `actions/checkout@v4` diye yazılmışsa, workflow'un çalıştığı gün tag hangi kodu gösteriyorsa o kod çalışır. Üstelik adımı siz inceledikten sonra da tag ya da branch başka bir koda çevrilebilir. Bu mod, modelin düzenlediği workflow'ları izler: bir edit, hareketli bir ref'e bağlı adım eklediğinde modele oraya yazması gereken commit SHA'sını söyler. Varsayılanı hiçbir şeyi durdurmaz; `deny` modundaysa her ref sabitlenene kadar commit, push ve merge'i bekletir.

## Ne yapar

1. Edit ve Write tool'larını izler. Çağrının dosya yolu `.github/workflows/<name>.yml` ya da `.github/actions/<name>/action.yml` (`.yaml` de olur) ise o çağrı denetimden geçer.
2. Yalnızca edit'in eklediği satırlara bakılır. `uses:` değeri 40 ya da 64 karakterlik hex bir commit'e işaret ediyorsa ref zaten sabittir; geçer. Yerel action'ların (`./.github/actions/setup`) ve container'ların (`docker://alpine:3.20`) sabitlenecek bir commit'i yoktur; onlar da geçer. Geri kalan her ref (bir tag `@v4`, bir branch `@main`) bildirilir; `actions/*` ve `github/*` de bunların içindedir.
3. Bildirilen her action için `Accept: application/vnd.github.sha` header'ıyla `https://api.github.com/repos/<owner>/<repo>/commits/<ref>` adresine istek atılır; GitHub, commit'i düz metin olarak döndürür. Token gönderilmediği için anonim rate limit geçerlidir (adres başına saatte 60 istek). Her action ve ref, bir session'da yalnızca bir kez sorulur.
4. Tool sonucunun hemen ardından model şu notu okur:

       action-pin: this edit uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8. A tag or a branch can be moved to other code after a review, so a workflow with write access runs whatever it points at then. Write each as the SHA with the tag as a comment, for example: uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v4

   Notta en fazla 10 action adı anılır; yalnız bunlar GitHub'a sorulur, gerisi yalnızca sayılır. GitHub cevap vermezse action, SHA'sız anılır ama not yine sabitlemeyi ister. Hata, log'a bir kez yazılır; aynı hata tekrar geldiğinde yazılmaz, farklı bir hata gelince yeniden yazılır.
5. Aynı anda transcript'e de tek bir satır düşer; modele ne söylendiğini böyle görürsünüz. Satırda workflow'un adı ve action'ları vardır; talimat yoktur. Workflow'un adının anılmasının sebebi şu: edit'i model gördü, siz görmediniz.

       action-pin: .github/workflows/ci.yml uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8

   Not ile satır ayrı kanallardır; model satırı okumaz, siz de notu okumazsınız. Workflow yolu, session'ın başladığı git repository'sinin köküne göre yazılır; dosya repository dışındaysa session'ın dizinine göre. Bu yol aynı zamanda sidebar kaydının key'idir; böylece her workflow'un kendi kaydı olur. Kök, session başlarken bir kez okunur; çünkü Bash'te yapılan bir `cd`, session'ın dizinini değiştirebilir.
6. [sidebar](../sidebar) açıksa bulgu, transcript yerine sidebar'ın stream'ine gider ve transcript temiz kalır. Önce workflow kırmızıyla gelir; ardından her action için bir satır düşer: action adı varsayılan renkte, hareketli ref kırmızı, ref'in gösterdiği commit soluktur. Sidebar yoksa satır, yukarıdaki gibi transcript'e düşer.
7. Bulgu, workflow o action'ları sabitleyene kadar açık kalır. Sonraki her Edit ve Write'ın ardından mod, açık workflow'ların hepsini yeniden okur; ref'leri tamamen sabitlenmiş olanın bulgusu kapanır. Dosya ortadan kalkmışsa bulgu yine kapanır; dosya artık hiçbir action kullanmıyordur. Dosya yerindedir ama okunamıyorsa bulgu açıktır; okunamayan dosya hiçbir şeyi kanıtlamaz:

       action-pin: every action of .github/workflows/ci.yml is pinned to a commit now: actions/checkout@v4
       action-pin: .github/workflows/ci.yml is no longer there: actions/checkout@v4

   Sidebar'da kırmızı kayıt silinir, yerine yeşil kayıt gelir; sidebar kapalıysa aynı metin transcript'e tek satır olarak düşer. Model bunların hiçbirini okumaz; SHA'yı kendisi yazdı.
8. Modelin kapatmadığı bulgu, her main-loop turn'ünün sonunda yeniden ölçülür ve geride kalanlar, bir sonraki prompt'la birlikte modele tek bir not olarak iletilir. SHA'lar bellekte durduğu için bu, GitHub'a hiçbir şey sormaz:

       action-pin: 1 action(s) are still used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, or take the step out.

   Not her prompt'ta değil, turn başına bir kez gelir. Bu not olmasaydı model bulguyu yalnızca edit anında duyar, sonra unuturdu; bulgu da pane'de askıda kalırdı. Size yeni bir satır düşmez; pane aynı bulguyu zaten gösteriyor.
9. `deny` modunda mod, bir workflow hâlâ hareketli bir ref'le action kullanırken `git commit`, `git push` ve `git merge` komutlarını da durdurur. Durdurmadan önce açık workflow'ların hepsini yeniden okur; model bir dosyayı sabitlediyse gate kendiliğinden açılır. `git commit` yalnızca kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`) ve commit, açık workflow'ların hiçbirini içermiyorsa geçmesine izin verir; yanında kaç bulgunun sürdüğünü söyleyen tek satır düşer. `push` ve `merge` için okunacak bir index yoktur; orada bütün bulgular geçerlidir. Gate'in aşılacak bir yolu yoktur; onu yalnızca siz kapatabilirsiniz: `/action-pin mode note`. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz.

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

    1. Okur:     her Edit ve Write'ın dosya yolunu ve eklediği metni; Bash komutunun metnini; bulgu sürerken her açık workflow'u yeniden, turn sonunda da
    2. Çalıştırır: session başlarken bir kez git rev-parse --show-toplevel, workflow'ları repository köküne göre gösterebilmek için; deny modunda bir commit anında git rev-parse --show-toplevel ve git diff --cached --name-only -z, commit'in hangi dosyaları taşıdığını okumak için
    3. Gönderir: herkese açık action adını ve ref'ini (örneğin actions/checkout ve v4) api.github.com'a, edit başına en fazla 10 tane, her biri session başına bir kez; token yok, repository içeriği yok, dosya yolu yok
    4. Saklar:   $.store içinde açık/kapalı ayarını ve modu; çözülen SHA'lar, bir session boyunca bellekte durur
    5. Düşman girdi: dönen cevap yalnızca 40 hex karakterse kullanılır ve yalnızca notun içine yazılır; mod hiçbir dosyayı düzenlemez

## Sınırlar

- Denetim metin üzerinden yapılır: block comment ya da YAML string içinde kalan bir `uses:` satırı da sayılır.
- Repository'de hâlihazırda duran workflow'lara bakılmaz; yalnızca edit'in eklediği satırlar denetlenir.
- Anonim rate limit'e takılan ya da private bir repository'de bulunan action, notunu SHA'sız alır.
- Bir kez çözülen SHA session boyunca saklanır; session içinde taşınan bir tag, ilk cevabını korur.
- Bulgu, workflow o action'ları ref'le kullanmayı bıraktığında kapanır. Okunamayan dosya, bulgunun açık kalmasını sağlar.
- `deny` modunun aşılacak bir yolu yoktur. Bir bulgu düzeltilemeyecek durumdaysa gate'i `/action-pin mode note` ile siz kapatırsınız.
- Gate, komutun metnine bakar. `git commit`'i gizleyen bir script ya da alias üzerinden atılan commit durdurulmaz.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit'ler index'e göre daraltılmaz; çünkü bunlar, index'te henüz olmayan dosyaları da commit'ler. Bu commit'lerde açık bulguların hepsi geçerlidir.
- Index, session'ın kendi dizinindeki repository'den okunur. Başka bir repository'deki workflow'un bulgusu bu index'le eşleşmez; böyle bir commit geçer.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
