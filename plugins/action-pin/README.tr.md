# action-pin

Bir edit, hareketli bir tag'e sabitlenmiş GitHub Actions step'i eklediğinde modele bunu söyleyen ve yerine yazılacak commit SHA'sını veren bir Claude Code Mod'u. Varsayılan olarak hiçbir şey durdurulmaz; `deny` modunda bir ref hâlâ hareketliyken commit, push ve merge durur.

## Ne yapar

1. Mod Edit ve Write tool'larını hook'lar. Path'i `.github/workflows/<name>.yml` ya da `.github/actions/<name>/action.yml` olan bir çağrı kontrol edilir (`.yaml` da).
2. Yalnız edit'in eklediği satırlar okunur. Ref'i 40 ya da 64 karakterlik hex commit olan bir `uses:` değeri sabitlenmiştir ve geçer. Local bir action (`./.github/actions/setup`) ve bir container (`docker://alpine:3.20`) sabitlenecek commit taşımaz, onlar da geçer. Diğer her ref, bir tag (`@v4`) ya da bir branch (`@main`), raporlanır; `actions/*` ve `github/*` dahil.
3. Raporlanan her action için mod `https://api.github.com/repos/<owner>/<repo>/commits/<ref>` adresine `Accept: application/vnd.github.sha` header'ı ile sorar, bu da commit'i düz metin olarak döner. Token gönderilmez, yani anonim rate limit geçerlidir (adres başına saatte 60 istek). Her action ve ref session başına bir kere sorulur.
4. Model, tool'un sonucundan sonra şu notu okur:

       action-pin: this edit uses actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8. A tag or a branch can be moved to other code after a review, so a workflow with write access runs whatever it points at then. Write each as the SHA with the tag as a comment, for example: uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v4

   En fazla 10 action adlandırılır ve sorulur, gerisi sayılır. GitHub cevap vermediğinde action SHA'sız adlandırılır, not yine de sabitlemeyi ister ve hata bir kere log'lanır.
5. Aynı anda transcript'e bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır talimat cümlesi olmadan yalnız action'ları taşır:

       action-pin: actions by a moving ref: actions/checkout@v4 → 08c6903cd8c0fde910a37f88322edcfb5dd907a8

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
6. [sidebar](../sidebar) açıkken bu action'lar oraya gider, action başına bir satır, stream'in içinde bir kayıt olarak; transcript temiz kalır. Kayıt, yenileri onu pane'in dışına itene kadar durur. Sidebar kapalıyken ya da o mod kurulu değilken yukarıdaki transcript satırı yazılır.

7. Bulgu, workflow o action'ları sabitleyene kadar açık kalır. Sonraki bir Edit ya da Write'tan sonra mod her açık workflow'u tekrar okur; ref'lerinin hepsi sabitlenmiş olan kapanır. Artık var olmayan bir workflow da kapanır, çünkü hiçbir action kullanmıyordur; duran ama okunamayan bir workflow bulgusunu korur, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz:

       action-pin: every action of .github/workflows/ci.yml is pinned to a commit now: actions/checkout@v4
       action-pin: .github/workflows/ci.yml is no longer there: actions/checkout@v4

   Sidebar kapalıyken aynı metin tek bir transcript satırıdır. Model bunların hiçbirini okumaz: SHA'yı kendisi yazdı.

8. Modelin kapatmadığı bir bulgu her main-loop turn sonunda tekrar ölçülür ve geriye kalan, bir sonraki prompt ile modele tek not olarak ulaşır. SHA'lar zaten bellekte olduğu için bu GitHub'a hiçbir şey sormaz:

       action-pin: 1 action(s) are still used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, or take the step out.

   Turn başına bir not, prompt başına değil. Bu olmasa bulgu bir kere, edit anında söylenir ve model onu unutmuşken pane'de dururdu. Siz yeni bir şey okumazsınız: pane zaten aynı bulguyu taşır.

9. `deny` modunda mod ayrıca, bir workflow hâlâ hareketli bir ref ile action kullanırken `git commit`, `git push` ve `git merge` komutlarını durdurur. Bir komutu durdurmadan önce her açık workflow'u tekrar okur, yani modelin sabitlediği bir dosya gate'i kendisi açar. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only`) ve commit açık workflow'lardan hiçbirini tutmuyorsa çalışmasına izin verir, kaç bulgunun durduğunu söyleyen bir satırla. `push` ve `merge` hiçbir index okumaz, bu yüzden orada her bulgu durur. Kaçış yolu yoktur; gate'i yalnız kişi `/action-pin mode note` ile kapatır. `note` varsayılandır ve hiçbir şeyi durdurmaz.

## Komut

    /action-pin                 on ya da off, mod ve hâlâ hareketli olan workflow'lar
    /action-pin on | off        varsayılan on
    /action-pin mode note       sadece not; varsayılan
    /action-pin mode deny       bir ref hareketliyken commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install action-pin@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=action-pin}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isThere), $.fs.read (via stillMoving), $.http.fetch (via resolveSha), $.process.run (via stagedPaths), $.session.cwd (via stagedPaths), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via gate, report, toPerson)

Reach L3, network'e çıkar.

    1. Okur:     her Edit ve Write'ın path'ini ve yeni metnini; Bash komut metnini; bulgu açıkken her açık workflow'u tekrar, turn sonunda da
    2. Çalıştırır: git rev-parse --show-toplevel ve git diff --cached --name-only, deny modunda bir commit anında, commit'in hangi dosyaları tuttuğunu okumak için
    3. Gönderir: açık action adını ve ref'ini (örneğin actions/checkout ve v4) api.github.com adresine, edit başına en fazla 10 tane, her biri session başına bir kere; token yok, repository içeriği yok, dosya path'i yok
    4. Saklar:   $.store içinde on/off ayarını ve modu; çözülen SHA'lar bir session boyunca bellekte kalır
    5. Düşman girdi: cevap yalnız 40 hex karakter olduğunda kullanılır ve sadece notun içine yazılır; mod hiçbir dosyayı düzenlemez

## Sınırlar

- Kontrol lexical'dır: block comment ya da YAML string içindeki bir `uses:` satırı da sayılır.
- Repository'de zaten duran bir workflow kontrol edilmez; yalnız bir edit'in eklediği satırlar kontrol edilir.
- Anonim rate limit'in ya da private bir repository'nin gizlediği bir action notu SHA'sız alır.
- Bir kere çözülen SHA session boyunca saklanır, yani session sırasında taşınan bir tag ilk cevabını korur.
- Bulgu ancak workflow o action'ları artık ref ile kullanmadığında kapanır. Okunamayan bir dosya bulguyu açık tutar.
- `deny` modunun kaçış yolu yoktur. Bulgu düzeltilemiyorsa kişi gate'i `/action-pin mode note` ile kapatır.
- Gate komut metnini okur. `git commit` komutunu gizleyen bir script ya da alias üzerinden atılan commit durdurulmaz.
- `git commit -a`, `-am` ve `--` sonrası pathspec taşıyan bir commit index'e göre daraltılmaz, çünkü bunlar index'in henüz tutmadığı dosyaları commit eder. Onlar için her açık bulgu durur.
- Index, session'ın kendi dizinindeki repository'de okunur. Başka bir repository'deki workflow'un bulgusu onunla hiç eşleşmez, yani öyle bir commit çalışır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
