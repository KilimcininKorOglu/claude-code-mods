# contract-watch

Model bir fonksiyon signature'ını değiştirdiğinde hangi caller'ların kontrol edilmesi gerektiğini modele söyleyen bir Claude Code Mod'u. Bir Edit bir fonksiyonun parametrelerini değiştirdiğinde mod, [ripwire](https://github.com/redhat-et/ripwire) ile onu kimin çağırdığını sorar ve caller'ları Edit'in sonucuna ekler, build ya da test onları bulmadan önce.

## Ne yapar

1. Mod Edit tool'unu hook'lar. Başarılı bir edit'ten sonra `old_string` ve `new_string` içindeki tek satırlık fonksiyon tanımlarını karşılaştırır: Go `func`, JS ve TS fonksiyonları, arrow function'lar ve class method'ları, Python `def`, Rust `fn`, Java method'ları ve PHP fonksiyonları.
2. İki metnin de farklı parametrelerle tanımladığı bir fonksiyon, değişmiş bir signature'dır. Gövde edit'i hiçbir şey çalıştırmaz.
3. Değişen her signature için `ripwire <repo root> --edit-check=<file>:<name>` komutunu argv ile çalıştırır. ripwire tanımı git HEAD ile karşılaştırır ve caller'ları listeler.
4. ripwire `status="contract-change"` raporladığında model, Edit'in sonucundan sonra şu notu okur:

       contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; check each caller: main (main.go:5), other (main.go:9).

   Bir caller, içinde durduğu tanımla adlandırılır; en fazla 10 tanesi adlandırılır, gerisi sayılır. ripwire bir caller'ı `incompatible="1"` olarak işaretlediğinde, gördüğü her tanım yeni arity ile uyuşmuyor demektir ve o caller'lar kendi cümleleri altında önce gelir:

       contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; these callers do not match the new arity: main (main.go:5). Other callers of that name, which the call graph binds by name and may belong to another type: other (lib.go:9). Check each.

   İkinci grup, birden çok tipin aynı adda bir method tanımladığı bir kod tabanında önemlidir: call graph bir çağrıyı adına göre bağlar, yani `Messaging::sendAlert` ile `SNMP_Monitor::sendAlert` aynı okunur. İki grup da atılmaz.
5. Aynı anda transcript'e bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır talimat cümlesi olmadan yalnız bulguyu taşır:

       contract-watch: parse changed from 1 to 2 parameter(s); do not match: main (main.go:5); same name: other (lib.go:9)

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
6. [sidebar](../sidebar) açıkken bulgu oraya gider: ilk satırda değişim (eski parametre sayısı soluk, yenisi sarı), altında işaretli caller'ların adları kırmızı ve bir `same name, may be another type` satırından sonra aynı adlı olanlar soluk, her birinin `(file:line)` kısmı soluk, stream'in içinde bir kayıt olarak; transcript temiz kalır. Kayıt, yenileri onu pane'in dışına itene kadar durur. Sidebar kapalıyken ya da o mod kurulu değilken yukarıdaki transcript satırı yazılır.

Not, yalnız ripwire'ın uyumsuz kanıtladıklarını değil, her caller'ı listeler: Go üzerindeki canlı bir testte iki caller da hâlâ tek argüman geçerken ripwire `incompatible="0"` raporladı (ripwire ile 2.1.278 üzerinde ölçüldü).

7. Mod raporladığı her signature'ı açık tutar ve iki modda da kendisi kapatır. Modelin çalıştırdığı bir sonraki `git commit`, `git push` ya da `git merge` anında, o komut çalışmadan önce, ripwire her açık sembolü tekrar ölçer. Artık hiçbir caller'ın kaçırmadığı bir sembol yeşil bir satırla kapanır ve bulgunun sidebar kaydı düşer:

       contract-watch: every caller matches parse again

   Bu satır, contract son commit ile yeniden aynı okunduğunda gelir. Contract hâlâ farklıyken hiçbir caller ripwire'ın `incompatible` işaretini taşımıyorsa, kapanış satırı onun yerine bu daha dar ölçümü adlandırır, çünkü adına göre bağlayan bir call graph her caller'ın doğru olduğunu kanıtlayamaz:

       contract-watch: no caller of parse carries the mismatch mark any more

   Ölçüm komuttan sonra değil, önce çalışır: `--edit-check` working tree'yi git HEAD ile karşılaştırır, yani commit düştükten sonra karşılaştıracak bir şey kalmaz ve her bulgu kapanmış okunurdu. Aynı sebeple açık bir symbol contract status'üyle değil, yalnız ripwire'ın incompatible işaretiyle tutulur: bir commit değişikliği aldıktan sonra contract HEAD gibi okunur ve eski arity'de kalan bir caller işareti hâlâ taşır, yani bulgu tur sonunda işaret gidene kadar açık kalır.
8. Modelin kapatmadığı bir bulgu her main-loop turn sonunda aynı şekilde ölçülür ve geriye kalan, bir sonraki prompt ile modele tek not olarak ulaşır. ripwire bu makinede, açık sembol başına bir kere çalışır:

       contract-watch: 1 changed signature(s) still leave a caller behind: parse changed from 1 to 2 parameter(s), 1 caller(s) do not match. Bring each caller to the new signature, or take the signature change back.

   Turn başına bir not, prompt başına değil. Bu olmasa bulgu bir kere, edit anında söylenir ve model onu unutmuşken pane'de dururdu. Siz yeni bir şey okumazsınız: pane zaten aynı bulguyu taşır.
9. `deny` modunda aynı an komutu da durdurur, değişmiş bir signature bir caller'ı geride bıraktığı sürece. Gate nottan daha dar bir ölçüm alır: yalnız `incompatible` sayısı sıfırdan büyük olan bir kontrol gate'i tutar, yani ripwire'ın sabit arity kanıtıyla adlandırdığı caller'lar. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only`, repository başına bir kere) ve commit o signature'ların yaşadığı dosyalardan hiçbirini tutmuyorsa çalışmasına izin verir, kaç bulgunun durduğunu söyleyen bir satırla. `push` ve `merge` hiçbir index okumaz, bu yüzden orada her bulgu durur. Kaçış yolu yoktur; gate'i yalnız kişi `/contract-watch mode note` ile kapatır. `note` varsayılandır ve hiçbir şeyi durdurmaz.

Canlı testte model Edit'inden sonra notu okudu ve iki caller'ın güncellenmeden derlenmeyeceğini söyledi.

## Komut

    /contract-watch                 on ya da off, mod ve caller geride bırakan signature'lar
    /contract-watch on | off        varsayılan on
    /contract-watch mode note       sadece not; varsayılan
    /contract-watch mode deny       bir caller uyuşmuyorken commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install contract-watch@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. [ripwire](https://github.com/redhat-et/ripwire) kurun ve PATH'e koyun. Olmadan her değişen signature bir kere `the callers were not checked: ...` satırını yazar ve edit eskisi gibi çalışır.
2. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=contract-watch}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}
    ❯ ./register.ts calls: $.command.register, $.process.run (via askRipwire, locate, stagedIn), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via atGitCommand, toPerson)

Reach L2, process çalıştırır.

    1. Okur:     her Edit'in eski ve yeni metnini; Bash komut metnini; ripwire üzerinden repository'nin kaynak kodunu ve git HEAD'ini
    2. Çalıştırır: git rev-parse, git diff --cached --name-only ve ripwire --edit-check, salt okuma, argv ile: signature değiştiren bir edit'ten sonra, bir git commit, push ya da merge öncesinde ve her turn sonunda açık sembol başına bir kere
    3. Gönderir: Edit'in sonucundan sonra modele bir not, bulgu dururken bir sonraki prompt ile bir not daha, ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: fonksiyon adı düzenlenen metinden gelir ve ripwire'a tek bir argv değeri olarak ulaşır, hiçbir zaman shell üzerinden geçmez

## Sınırlar

- Yalnız tek satırdaki bir tanım okunur. Parametreleri birkaç satıra yayılan bir signature görülmez.
- Yeniden adlandırılmış bir fonksiyon kontrol edilmez: eski ad gitmiştir, yani ripwire'ın karşılaştıracak bir şeyi yoktur.
- Karşılaştırma git HEAD'e karşıdır. Commit'ten önce aynı fonksiyonun ikinci bir signature edit'i notu tekrarlar.
- Yalnız Edit tool'u izlenir. Tüm dosyayı değiştiren bir Write izlenmez.
- git repository'si dışında hiçbir şey çalışmaz.
- ripwire'ın index'lemediği bir fonksiyon, örneğin bir PHP dosyasının `<script>` bloğundaki bir JavaScript fonksiyonu, kontrol edilmez. Sidebar soluk bir satır gösterir, `<name>: ripwire does not index it, its callers were not checked`, ve model hiçbir şey okumaz. ripwire'ın artık index'lemediği açık bir sembol silinmiş ya da yeniden adlandırılmıştır, ve bulgusu kapanır.
- Gate, ripwire'ın `incompatible` sayısını izler; o sayı kendisi bir alt sınırdır: ripwire'ın adına göre bağlayamadığı bir caller gate'i tutmaz. Not daha geniş ölçüm olarak kalır.
- `deny` modunun kaçış yolu yoktur. Bulgu düzeltilemiyorsa kişi gate'i `/contract-watch mode note` ile kapatır.
- Gate komut metnini okur. `git commit` komutunu gizleyen bir script ya da alias üzerinden atılan commit durdurulmaz; bulgu o zaman bir sonraki turn sonunda ölçülür.
- `git commit -a`, `-am` ve `--` sonrası pathspec taşıyan bir commit index'e göre daraltılmaz, çünkü bunlar index'in henüz tutmadığı dosyaları commit eder. Onlar için her açık bulgu durur.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
