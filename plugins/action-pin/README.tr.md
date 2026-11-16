# action-pin

GitHub Actions'ta `actions/checkout@v4` olarak yazılan bir adım, workflow'un çalıştığı gün bu tag'in gösterdiği kodu çalıştırır. Ayrıca bir tag ya da branch, siz adımı inceledikten sonra başka bir koda taşınabilir. Bu mod, modelin düzenlediği workflow'ları izler. Bir düzenleme, değişebilen bir ref'e bağlı bir adım eklediğinde modele bunun yerine yazması gereken commit SHA'sı bildirilir. Varsayılan modda hiçbir işlem durdurulmaz. `deny` modunda ise bütün ref'ler sabitlenene kadar commit, push ve merge bekletilir.

## Ne yapar

1. Mod Edit ve Write tool'larını izler. Çağrının dosya path'i `.github/workflows/<ad>.yml` ya da `.github/actions/<ad>/action.yml` (`.yaml` de olur) ise çağrı kontrol edilir.
2. Yalnız düzenlemenin eklediği satırlar okunur. `uses:` değerindeki ref 40 ya da 64 karakterlik hex bir commit ise ref zaten sabitlenmiştir ve kabul edilir. Yerel action'ların (`./.github/actions/setup`) ve container'ların (`docker://alpine:3.20`) sabitlenecek bir commit'i yoktur, bu yüzden bunlar da kabul edilir. Diğer bütün ref'ler (`@v4` gibi bir tag ya da `@main` gibi bir branch) bildirilir. `actions/*` ve `github/*` de bu kapsamdadır.
3. Bildirilen her action için `Accept: application/vnd.github.sha` header'ıyla `https://api.github.com/repos/<owner>/<repo>/commits/<ref>` adresine istek gönderilir. GitHub commit'i düz metin olarak döndürür. Token gönderilmez, bu yüzden anonim rate limit geçerlidir (her IP adresi için saatte 60 istek). Her action ve ref bir session'da yalnız bir kez sorgulanır.
4. Tool sonucunun hemen ardından model şu notu okur:

       action-pin: this edit uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8. A tag or a branch can be moved to other code after a review, so a workflow with write access runs whatever it points at then. Write each as the SHA with the tag as a comment, for example: uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v4

   Notta en fazla 10 action adıyla yazılır ve yalnız bunlar GitHub'da sorgulanır. Geri kalanlar sayı olarak verilir. GitHub cevap vermezse action SHA olmadan yazılır, ancak not yine sabitlemeyi ister. Hata log'a bir kez yazılır. Aynı hata tekrar geldiğinde yazılmaz, farklı bir hata geldiğinde yeniden yazılır.
5. Aynı anda transcript'e tek bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır workflow'un adını ve action'larını içerir, talimat içermez. Workflow'un adı yazılır, çünkü düzenlemeyi model gördü, siz görmediniz:

       action-pin: .github/workflows/ci.yml uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz. Workflow path'i, session'ın başladığı git repository'sinin köküne göre yazılır. Dosya repository dışındaysa path, session'ın dizinine göre yazılır. Bu path aynı zamanda sidebar kaydının key'idir. Böylece her workflow'un kendi kaydı olur. Kök dizin session başında bir kez okunur, çünkü Bash'te çalışan bir `cd` session'ın dizinini değiştirir.
6. [sidebar](../sidebar) açıksa bulgu transcript yerine sidebar'ın stream'ine yazılır ve transcript temiz kalır. Önce workflow kırmızı renkte yazılır. Ardından her action için bir satır gelir: action adı varsayılan renkte, değişebilen ref kırmızı, ref'in gösterdiği commit soluk renktedir. Sidebar yoksa satır yukarıdaki gibi transcript'e yazılır.
7. Bulgu, workflow bu action'ları sabitleyene kadar açık kalır. Sonraki her Edit ve Write çağrısından sonra mod açık bütün workflow'ları yeniden okur. Bütün ref'leri sabitlenmiş olan workflow'un bulgusu kapanır. Silinen bir workflow'un bulgusu da kapanır, çünkü dosya artık hiçbir action kullanmaz. Yerinde duran ancak okunamayan bir dosyanın bulgusu açık kalır, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz:

       action-pin: every action of .github/workflows/ci.yml is pinned to a commit now: actions/checkout@v4
       action-pin: .github/workflows/ci.yml is no longer there: actions/checkout@v4

   Sidebar'da kırmızı kayıt silinir ve yerine yeşil bir kayıt yazılır. Sidebar kapalıysa aynı metin transcript'e tek bir satır olarak yazılır. Model bunların hiçbirini okumaz, çünkü SHA'yı kendisi yazmıştır.
8. Modelin kapatmadığı bir bulgu, her main loop turn'ünün sonunda yeniden ölçülür. Hâlâ açık olan bulgular, bir sonraki prompt'unuzla birlikte modele tek bir not olarak gönderilir. SHA'lar zaten bellekte olduğu için bu ölçüm GitHub'a istek göndermez:

       action-pin: 1 action(s) are still used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, or take the step out.

   Bu not her turn için bir kez gönderilir, her prompt için değil. Bu not olmasaydı bulgu yalnız düzenleme anında bir kez bildirilir, ardından pane'de kalır ve model onu unuturdu. Size yeni bir satır gösterilmez, çünkü pane aynı bulguyu zaten gösterir.
9. `deny` modunda bir workflow hâlâ değişebilen bir ref ile action kullandığı sürece mod `git commit`, `git push` ve `git merge` komutlarını da durdurur. Mod bir komutu durdurmadan önce açık bütün workflow'ları yeniden okur. Model bir dosyayı sabitlediyse gate kendiliğinden açılır. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`). Commit açık workflow'ların hiçbirini içermiyorsa çalışır ve kaç bulgunun hâlâ açık olduğu size tek bir satırla bildirilir. `push` ve `merge` için okunacak bir index yoktur. Bu yüzden bu komutlarda bütün bulgular geçerlidir. Gate'i atlamanın bir yolu yoktur. Gate'i yalnız siz `/action-pin mode note` ile kapatabilirsiniz. Varsayılan mod `note` modudur ve hiçbir işlemi durdurmaz.

## Komut

    /action-pin                 açık mı kapalı mı, mod ve hâlâ değişebilen ref kullanan workflow'lar
    /action-pin on | off        varsayılan açık
    /action-pin mode note       yalnız not verir; varsayılan
    /action-pin mode deny       bir ref değişebilir kaldığı sürece commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install action-pin@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=action-pin}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isThere), $.fs.read (via stillMoving), $.http.fetch (via resolveSha), $.process.run (via shownRootOf, stagedPaths), $.session.cwd (via stagedPaths), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via gate, report, toPerson)

Reach L3: network'e erişir.

    1. Okur:         her Edit ve Write çağrısının path'ini ve eklediği metni; Bash komutunun metnini; bulgu açık kaldığı sürece ve turn sonunda açık her workflow'u yeniden
    2. Çalıştırır:   workflow'ları repository köküne göre göstermek için session başında bir kez git rev-parse --show-toplevel; deny modunda bir commit sırasında, commit'in hangi dosyaları içerdiğini okumak için git rev-parse --show-toplevel ve git diff --cached --name-only -z
    3. Gönderir:     herkese açık action adını ve ref'ini (örneğin actions/checkout ve v4) api.github.com'a; her düzenleme için en fazla 10 tane, her biri session başına bir kez; token, repository içeriği ya da dosya path'i göndermez
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde; çözülen SHA'lar bir session boyunca bellekte tutulur
    5. Düşman girdi: cevap yalnız 40 hex karakterden oluşuyorsa kullanılır ve yalnız notun içine yazılır; mod hiçbir dosyayı düzenlemez

## Sınırlar

- Kontrol metin üzerinden yapılır: bir block comment ya da bir YAML string içindeki `uses:` satırı da sayılır.
- Repository'de zaten bulunan workflow'lar kontrol edilmez. Yalnız bir düzenlemenin eklediği satırlar kontrol edilir.
- Anonim rate limit'e takılan ya da private bir repository'de bulunan bir action için not SHA olmadan gönderilir.
- Bir kez çözülen SHA session boyunca saklanır. Bu yüzden session sırasında taşınan bir tag için ilk cevap kullanılmaya devam eder.
- Bulgu, workflow bu action'ları bir ref ile kullanmayı bıraktığında kapanır. Okunamayan bir dosya bulguyu açık tutar.
- `deny` modunu atlamanın bir yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/action-pin mode note` ile siz kapatırsınız.
- Gate komutun metnini okur. `git commit` komutunu gizleyen bir script ya da alias ile yapılan bir commit durdurulmaz.
- `git commit -a`, `-am` ve `--` işaretinden sonra pathspec verilen commit'ler index'e göre daraltılmaz, çünkü bu komutlar index'te henüz olmayan dosyaları da commit eder. Bu commit'lerde açık bulguların hepsi geçerlidir.
- Index, session'ın kendi dizinindeki repository'den okunur. Başka bir repository'deki bir workflow'un bulgusu bu index ile eşleşmez. Bu yüzden böyle bir commit çalışır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
