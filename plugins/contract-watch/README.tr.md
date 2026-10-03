# contract-watch

Model bir fonksiyona parametre ekler, edit gayet düzgün görünür, ama kodun başka yerlerindeki üç çağıran artık bozulmuştur; bunu build ya da bir test patlayınca öğrenirsin. Bu mod bunu edit anında yakalar: bir Edit bir fonksiyonun parametrelerini değiştirince [ripwire](https://github.com/redhat-et/ripwire)'a o fonksiyonu kimlerin çağırdığını sorar ve çağıranları doğrudan Edit'in sonucuna ekler.

## Ne yapar

1. Edit tool'unu izler. Başarılı bir edit'ten sonra `old_string` ve `new_string` içindeki tek satırlık fonksiyon tanımlarını karşılaştırır: Go `func`, JS ve TS fonksiyonları, arrow fonksiyonlar ve class metotları, Python `def`, Rust `fn`, Java metotları ve PHP fonksiyonları.
2. İki metnin de farklı parametrelerle tanımladığı bir fonksiyon, değişmiş bir imzadır. Yalnız bir fonksiyonun gövdesine dokunan edit hiçbir şey çalıştırmaz.
3. Değişen her imza için argv ile `ripwire <repo kökü> --edit-check=<dosya>:<ad>` çalıştırır. ripwire tanımı git HEAD ile karşılaştırır ve çağıranları listeler.
4. ripwire `status="contract-change"` bildirirse model Edit'in sonucunun hemen ardından şu notu okur:

       contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; check each caller: main (main.go:5), other (main.go:9).

   Her çağıran, içinde bulunduğu tanımla birlikte anılır; en fazla 10 tanesi adıyla yazılır, gerisi sayılır. ripwire bir çağıranı `incompatible="1"` ile işaretlerse, gördüğü bütün tanımlar yeni parametre sayısıyla çelişiyor demektir. Bu çağıranlar kendi cümleleriyle en başta gelir:

       contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; these callers do not match the new arity: main (main.go:5). Other callers of that name, which the call graph binds by name and may belong to another type: other (lib.go:9). Check each.

   İkinci grup, birkaç tipin aynı adla metot tanımladığı kod tabanlarında önemlidir: call graph bir çağrıyı adına göre bağlar, yani `Messaging::sendAlert` ile `SNMP_Monitor::sendAlert` aynı görünür. İki grup da atılmaz.
5. Aynı anda transcript'e tek bir satır düşer, böylece modele ne söylendiğini görürsün. Satırda talimat yoktur, yalnız bulgu vardır:

       contract-watch: parse changed from 1 to 2 parameter(s); do not match: main (main.go:5); same name: other (lib.go:9)

   Not ile satır ayrı kanallardır: model satırı, sen de notu hiç okumazsın.
6. [sidebar](../sidebar) açıksa bulgu transcript yerine onun stream'ine gider, transcript temiz kalır. İlk satır değişikliği gösterir (eski parametre sayısı soluk, yenisi sarı). Altında işaretli çağıranların adları kırmızı gelir, ardından `same name, may be another type` satırından sonra aynı adlı çağıranlar soluk olarak; her birinin `(dosya:satır)` kısmı soluktur. Kayıt, yenileri onu pane'den itene kadar durur. Sidebar yoksa satır yukarıdaki gibi transcript'e düşer.

Not, yalnız ripwire'ın uyumsuz olduğunu kanıtladıklarını değil, bütün çağıranları listeler: Go üzerindeki bir canlı denemede ripwire `incompatible="0"` bildirirken iki çağıran da hâlâ tek argüman veriyordu (2.1.278'de ripwire ile ölçüldü).

7. Mod bildirdiği her imzayı açık tutar ve iki modda da kendisi kapatır. Modelin çalıştırdığı bir sonraki `git commit`, `git push` ya da `git merge` komutunda, komut çalışmadan önce ripwire açık her sembolü yeniden ölçer. Artık hiçbir çağıranın geride kalmadığı sembol yeşil bir satırla kapanır ve sidebar kaydı silinir:

       contract-watch: every caller matches parse again

   Bu satır, sözleşme son commit'tekiyle yeniden aynı olduğunda gelir. Sözleşme hâlâ farklı ama hiçbir çağıranda ripwire'ın `incompatible` işareti kalmamışsa, kapanış satırı bunun yerine bu daha dar ölçümü söyler; çünkü adına göre bağlayan bir call graph her çağıranın doğru olduğunu kanıtlayamaz:

       contract-watch: no caller of parse carries the mismatch mark any more

   Ölçüm komuttan sonra değil, önce yapılır. `--edit-check` working tree'yi git HEAD ile karşılaştırır; commit yerleştikten sonra karşılaştırılacak bir şey kalmaz ve her bulgu kapanmış görünürdü. Aynı nedenle açık bir sembolü sözleşmenin durumu değil, yalnız ripwire'ın incompatible işareti açık tutar: değişikliği alan bir commit'ten sonra sözleşme HEAD ile aynı okunur, ama eski parametre sayısında kalmış bir çağıran işareti taşımaya devam eder; bulgu da işaret kaybolana kadar turn sonunda açık kalır.
8. Modelin kapatmadığı bir bulgu her ana loop turn'ünün sonunda aynı şekilde ölçülür; geriye kalan, bir sonraki prompt'unla birlikte modele tek bir not olarak gider. ripwire bu makinede, açık sembol başına bir kez çalışır:

       contract-watch: 1 changed signature(s) still leave a caller behind: parse changed from 1 to 2 parameter(s), 1 caller(s) do not match. Bring each caller to the new signature, or take the signature change back.

   Not her prompt'ta değil, her turn'de bir kez gelir. Bu not olmasa model bulguyu yalnız edit anında bir kez duyar ve sonra unuturdu; bulgu da pane'de öylece dururdu. Sana yeni bir satır düşmez, çünkü pane aynı bulguyu zaten gösteriyor.
9. `deny` modunda mod, değişmiş bir imza bir çağıranı geride bıraktığı sürece bu git komutunu da durdurur. Gate nottan daha dar bir ölçü kullanır: onu yalnız `incompatible` sayısı sıfırdan büyük olan bir kontrol tutar, yani ripwire'ın sabit parametre sayısı kanıtıyla adını verdiği çağıranlar. `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`, repository başına bir kez) ve commit bu imzaların bulunduğu dosyaların hiçbirini içermiyorsa geçmesine izin verir, sana kaç bulgunun hâlâ durduğunu tek satırla söyler. `push` ve `merge` için okunacak bir index yoktur, orada bütün bulgular geçerlidir. Gate'i aşmanın yolu yoktur; kapatmak yalnız sana kalır, `/contract-watch mode note` ile. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz.

Canlı denemede model Edit'inden sonra notu okudu ve iki çağıranın güncellenene kadar derlenmeyeceğini söyledi.

## Komut

    /contract-watch                 açık mı kapalı mı, mod ve bir çağıranı geride bırakan imzalar
    /contract-watch on | off        varsayılan açık
    /contract-watch mode note       yalnız not verir; varsayılan budur
    /contract-watch mode deny       bir çağıran uyuşmadığı sürece commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install contract-watch@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. [ripwire](https://github.com/redhat-et/ripwire)'ı kur ve PATH'e ekle. ripwire yoksa değişen bir imza `the callers were not checked: ...` satırını sarı bir kayıt olarak yazar (sidebar kapalıysa transcript'e). Satır farklı bir hata gelene kadar bir kez yazılır ve edit her zamanki gibi geçer.
2. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=contract-watch}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}
    ❯ ./register.ts calls: $.command.register, $.process.run (via askRipwire, locate, stagedIn), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via isEnabled, readSettings), $.store.set (via runCommand, setMode), $.ui.log (via atGitCommand, toPerson)

Reach L2: process çalıştırır.

    1. Okur:     her Edit'in eski ve yeni metnini; Bash komutunun metnini; ripwire üzerinden repository'nin kaynağını ve git HEAD'i
    2. Çalıştırır: git rev-parse, git diff --cached --name-only -z ve ripwire --edit-check; salt okunur, argv ile; imzayı değiştiren bir edit'ten sonra, ayrıca bir git commit, push ya da merge öncesinde ve her turn sonunda açık sembol başına bir kez
    3. Gönderir: Edit'in sonucundan sonra modele bir not, bulgu durdukça bir sonraki prompt'la bir not daha, transcript'e bir satır; makineden dışarı bir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını ve modu
    5. Düşman girdi: fonksiyon adı düzenlenen metinden gelir ve ripwire'a hiçbir zaman shell üzerinden değil, tek bir argv öğesi olarak ulaşır

## Sınırlar

- Yalnız tek satırlık tanımlar okunur. Parametreleri birkaç satıra yayılan bir imza görülmez.
- Adı değiştirilen bir fonksiyon kontrol edilmez: eski ad ortadan kalktığı için ripwire'ın karşılaştıracağı bir şey yoktur.
- Karşılaştırma git HEAD'e göredir. Aynı fonksiyonun imzası commit'ten önce ikinci kez değişirse not tekrarlanır.
- Yalnız Edit tool'u izlenir. Bir dosyayı baştan yazan Write izlenmez.
- Git repository'si dışında hiçbir şey çalışmaz.
- ripwire'ın index'lemediği bir fonksiyon, örneğin bir PHP dosyasının `<script>` bloğundaki bir JavaScript fonksiyonu, kontrol edilmez. Sidebar soluk tek bir satır gösterir, `<name>: ripwire does not index it, its callers were not checked`; model hiçbir şey okumaz. ripwire'ın artık index'lemediği açık bir sembol silinmiş ya da adı değişmiştir; bulgusu kapanır.
- Gate, ripwire'ın `incompatible` sayısına bakar ve bu sayı kendi içinde bir alt sınırdır: ripwire'ın adıyla bağlayamadığı bir çağıran gate'i tutmaz. Daha geniş ölçü not olarak kalır.
- `deny` modunu aşmanın yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/contract-watch mode note` ile sen kapatırsın.
- Gate komutun metnine bakar. `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit durdurulmaz; bulgu o zaman bir sonraki turn sonunda ölçülür.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit index'e göre daraltılmaz, çünkü index'te henüz olmayan dosyaları da commit'ler. Bunlarda açık bulguların hepsi geçerlidir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
