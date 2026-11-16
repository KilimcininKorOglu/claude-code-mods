# contract-watch

Model bir fonksiyona parametre ekler. Düzenleme doğru görünür, ancak kodun başka yerlerindeki üç çağıran artık bozulmuştur. Bunu build ya da bir test başarısız olduğunda öğrenirsiniz. Bu mod hatayı düzenleme anında yakalar. Bir Edit çağrısı bir fonksiyonun parametrelerini değiştirdiğinde mod, [ripwire](https://github.com/redhat-et/ripwire)'a bu fonksiyonu kimlerin çağırdığını sorar. Çağıranlar doğrudan Edit çağrısının sonucuna eklenir.

## Ne yapar

1. Mod Edit tool'unu izler. Başarılı bir düzenlemeden sonra `old_string` ve `new_string` içindeki tek satırlık fonksiyon tanımlarını karşılaştırır: Go `func`, JS ve TS fonksiyonları, arrow fonksiyonları ve class metotları, Python `def`, Rust `fn`, Java metotları ve PHP fonksiyonları.
2. İki metnin de farklı parametrelerle tanımladığı bir fonksiyon, değişmiş bir imzadır. Yalnız bir fonksiyonun gövdesini değiştiren bir düzenleme hiçbir şey çalıştırmaz.
3. Değişen her imza için argv ile `ripwire <repo kökü> --edit-check=<dosya>:<ad>` çalıştırılır. ripwire tanımı git HEAD ile karşılaştırır ve çağıranları listeler.
4. ripwire `status="contract-change"` bildirirse model, Edit çağrısının sonucunun hemen ardından şu notu okur:

       contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; check each caller: main (main.go:5), other (main.go:9).

   Her çağıran, içinde bulunduğu tanımla birlikte yazılır. En fazla 10 çağıran adıyla yazılır, geri kalanı sayı olarak verilir. ripwire bir çağıranı `incompatible="1"` ile işaretlerse, ripwire'ın gördüğü bütün tanımlar yeni parametre sayısıyla çelişir. Bu çağıranlar kendi cümleleriyle en başta yazılır:

       contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; these callers do not match the new arity: main (main.go:5). Other callers of that name, which the call graph binds by name and may belong to another type: other (lib.go:9). Check each.

   İkinci grup, birden çok tipin aynı adla metot tanımladığı kod tabanlarında önemlidir. Call graph bir çağrıyı adına göre bağlar. Bu yüzden `Messaging::sendAlert` ile `SNMP_Monitor::sendAlert` aynı görünür. İki grup da nottan çıkarılmaz.
5. Aynı anda transcript'e tek bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır talimat içermez, yalnız bulguyu içerir:

       contract-watch: parse changed from 1 to 2 parameter(s); do not match: main (main.go:5); same name: other (lib.go:9)

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz.
6. [sidebar](../sidebar) açıksa bulgu transcript yerine sidebar'ın stream'ine yazılır ve transcript temiz kalır. İlk satır değişikliği gösterir: eski parametre sayısı soluk, yeni parametre sayısı sarı renktedir. Altında işaretli çağıranların adları kırmızı renkte gelir. Ardından `same name, may be another type` satırından sonra aynı adlı çağıranlar soluk renkte yazılır. Her birinin `(dosya:satır)` kısmı soluk renktedir. Kayıt, yeni kayıtlar onu pane'den çıkarana kadar görünür. Sidebar yoksa satır yukarıdaki gibi transcript'e yazılır.

Not, yalnız ripwire'ın uyumsuz olduğunu kanıtladığı çağıranları değil, bütün çağıranları listeler. Go üzerindeki bir canlı denemede ripwire `incompatible="0"` bildirdi, ancak iki çağıran da hâlâ tek bir argüman veriyordu (2.1.278'de ripwire ile ölçüldü).

7. Mod bildirdiği her imzayı açık tutar ve iki modda da kendisi kapatır. Modelin çalıştırdığı bir sonraki `git commit`, `git push` ya da `git merge` komutunda, komut çalışmadan önce ripwire açık her sembolü yeniden ölçer. Artık hiçbir çağıranı geride kalmayan sembol yeşil bir satırla kapanır ve sidebar kaydı silinir:

       contract-watch: every caller matches parse again

   Bu satır, sözleşme son commit'teki hâliyle yeniden aynı olduğunda yazılır. Sözleşme hâlâ farklıysa ancak hiçbir çağıranda ripwire'ın `incompatible` işareti kalmamışsa, kapanış satırı bunun yerine bu daha dar ölçümü bildirir. Bunun nedeni, adına göre bağlayan bir call graph'ın her çağıranın doğru olduğunu kanıtlayamamasıdır:

       contract-watch: no caller of parse carries the mismatch mark any more

   Ölçüm komuttan sonra değil, önce yapılır. `--edit-check`, working tree'yi git HEAD ile karşılaştırır. Commit yapıldıktan sonra karşılaştırılacak bir şey kalmaz ve her bulgu kapanmış görünürdü. Aynı nedenle açık bir sembolü sözleşmenin durumu değil, yalnız ripwire'ın `incompatible` işareti açık tutar. Değişikliği içeren bir commit'ten sonra sözleşme HEAD ile aynı okunur. Ancak eski parametre sayısında kalan bir çağıran işareti taşımaya devam eder. Bu yüzden bulgu, işaret kaybolana kadar turn sonlarında açık kalır.
8. Modelin kapatmadığı bir bulgu, her ana loop turn'ünün sonunda aynı şekilde ölçülür. Hâlâ açık olan bulgular, bir sonraki prompt'unuzla birlikte modele tek bir not olarak gönderilir. ripwire bu bilgisayarda, her açık sembol için bir kez çalışır:

       contract-watch: 1 changed signature(s) still leave a caller behind: parse changed from 1 to 2 parameter(s), 1 caller(s) do not match. Bring each caller to the new signature, or take the signature change back.

   Bu not her turn için bir kez gönderilir, her prompt için değil. Bu not olmasaydı model bulguyu yalnız düzenleme anında bir kez duyar ve ardından unuturdu. Bulgu da pane'de kalırdı. Size yeni bir satır gösterilmez, çünkü pane aynı bulguyu zaten gösterir.
9. `deny` modunda, değişmiş bir imza bir çağıranı geride bıraktığı sürece aynı anda git komutu da durdurulur. Gate nottan daha dar bir ölçüm kullanır: gate'i yalnız `incompatible` sayısı sıfırdan büyük olan bir kontrol kapalı tutar. Bu sayı, ripwire'ın sabit parametre sayısı kanıtıyla adlandırdığı çağıranlardır. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`, her repository için bir kez). Commit, bu imzaların bulunduğu dosyaların hiçbirini içermiyorsa çalışır ve kaç bulgunun hâlâ açık olduğu size tek bir satırla bildirilir. `push` ve `merge` için okunacak bir index yoktur. Bu yüzden bu komutlarda bütün bulgular geçerlidir. Gate'i atlamanın bir yolu yoktur. Gate'i yalnız siz `/contract-watch mode note` ile kapatabilirsiniz. Varsayılan mod `note` modudur ve hiçbir işlemi durdurmaz.

Canlı denemede model, Edit çağrısından sonra notu okudu ve iki çağıranın güncellenene kadar derlenmeyeceğini söyledi.

## Komut

    /contract-watch                 açık mı kapalı mı, mod ve bir çağıranı geride bırakan imzalar
    /contract-watch on | off        varsayılan açık
    /contract-watch mode note       yalnız not verir; varsayılan
    /contract-watch mode deny       bir çağıran uyuşmadığı sürece commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install contract-watch@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. [ripwire](https://github.com/redhat-et/ripwire)'ı yükleyin ve PATH'e ekleyin. ripwire yoksa değişen bir imza, `the callers were not checked: ...` satırını sarı bir kayıt olarak yazar (sidebar kapalıysa transcript'e). Bu satır farklı bir hata gelene kadar yalnız bir kez yazılır ve düzenleme her zamanki gibi uygulanır.
2. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=contract-watch}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}
    ❯ ./register.ts calls: $.command.register, $.process.run (via askRipwire, locate, stagedIn), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via isEnabled, readSettings), $.store.set (via runCommand, setMode), $.ui.log (via atGitCommand, toPerson)

Reach L2: process çalıştırır.

    1. Okur:         her Edit çağrısının eski ve yeni metnini; Bash komutunun metnini; ripwire ile repository'nin kaynak kodunu ve git HEAD'i
    2. Çalıştırır:   argv ile salt okunur git rev-parse, git diff --cached --name-only -z ve ripwire --edit-check; imzayı değiştiren bir düzenlemeden sonra; ayrıca bir git commit, push ya da merge öncesinde ve her turn sonunda her açık sembol için bir kez
    3. Gönderir:     Edit çağrısının sonucundan sonra modele bir not; bulgu açık kaldığı sürece bir sonraki prompt'la bir not daha; transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde
    5. Düşman girdi: fonksiyon adı düzenlenen metinden gelir ve ripwire'a hiçbir zaman bir shell üzerinden değil, tek bir argv öğesi olarak verilir

## Sınırlar

- Yalnız tek satırlık tanımlar okunur. Parametreleri birden çok satıra yayılan bir imza fark edilmez.
- Adı değiştirilen bir fonksiyon kontrol edilmez, çünkü eski ad artık yoktur ve ripwire'ın karşılaştıracağı bir şey kalmaz.
- Karşılaştırma git HEAD'e göre yapılır. Aynı fonksiyonun imzası commit'ten önce ikinci kez değişirse not tekrarlanır.
- Yalnız Edit tool'u izlenir. Bir dosyayı baştan yazan Write çağrısı izlenmez.
- Bir git repository'si dışında hiçbir şey çalışmaz.
- ripwire'ın index'lemediği bir fonksiyon, örneğin bir PHP dosyasının `<script>` bloğundaki bir JavaScript fonksiyonu, kontrol edilmez. Sidebar soluk tek bir satır gösterir: `<name>: ripwire does not index it, its callers were not checked`. Model hiçbir şey okumaz. ripwire'ın artık index'lemediği açık bir sembol silinmiş ya da adı değiştirilmiştir. Bu sembolün bulgusu kapanır.
- Gate, ripwire'ın `incompatible` sayısına bakar ve bu sayı bir alt sınırdır: ripwire'ın adıyla bağlayamadığı bir çağıran gate'i kapalı tutmaz. Daha geniş ölçüm, not olarak kalır.
- `deny` modunu atlamanın bir yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/contract-watch mode note` ile siz kapatırsınız.
- Gate komutun metnini okur. `git commit` komutunu gizleyen bir script ya da alias ile yapılan bir commit durdurulmaz. Bu durumda bulgu bir sonraki turn sonunda ölçülür.
- `git commit -a`, `-am` ve `--` işaretinden sonra pathspec verilen commit'ler index'e göre daraltılmaz, çünkü bu komutlar index'te henüz olmayan dosyaları da commit eder. Bu commit'lerde açık bulguların hepsi geçerlidir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
