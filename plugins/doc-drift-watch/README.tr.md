# doc-drift-watch

Model bir dosyayı siler ya da bir fonksiyonun adını değiştirir ve commit eder. Ancak bir yerdeki README hâlâ `other.go:3` referansını gösterir. Bir okuyucu bu referansı izleyene kadar hata fark edilmez. Bu mod bu hatayı commit anında yakalar. Modelin çalıştırdığı her `git commit` komutundan sonra [ripwire](https://github.com/redhat-et/ripwire)'a hangi markdown anchor'larının artık doğru olmadığını sorar. Commit'in bozduğu anchor'lar commit'in sonucuna eklenir.

## Ne yapar

1. Mod Bash tool'unu izler. `git commit` çalıştıran komutlar kontrol edilir. `git -C <dizin> commit` ve önünde git'in global flag'leri olan biçimler de kontrol edilir. `--dry-run`, `--help` ya da `-h` içeren komutlar kontrol edilmez.
2. Komut çalışmadan önce mod repository kökünü bulur. Bunun için session'ın dizinini, commit'ten önceki son `cd` komutunu ve commit'in `git -C` değerini kullanır. Ardından argv ile `ripwire <kök> --doc-drift --with-history` komutunu çalıştırır.
3. Başarılı bir commit'ten sonra aynı komut yeniden çalıştırılır ve iki sonuç karşılaştırılır. Dokümanı, türü, nedeni ve referansı aynı olan eskimiş bir anchor aynı anchor sayılır. Satır numarası karşılaştırmaya katılmaz, çünkü üstteki bir düzenleme satırı kaydırır.
4. Yalnız commit'in eklediği eskimiş anchor'lar bildirilir. Model, commit'in sonucunun hemen ardından şu notu okur:

       doc-drift-watch: this commit made 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists. Update them in a follow-up commit, or tell the user why a line stays.

   En fazla 8 satır adıyla yazılır, geri kalanı sayı olarak verilir.
5. Aynı anda transcript'e tek bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır talimat içermez, yalnız eskimiş satırları içerir:

       doc-drift-watch: 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz.
6. [sidebar](../sidebar) açıksa satırlar transcript yerine sidebar'ın stream'ine, her doküman için bir kayıt olarak yazılır ve transcript temiz kalır. `doküman:satır` kısmı soluk, eskimiş referans kırmızı renktedir. Kaymış bir satırda şu anda bulunan içerik sarı renktedir. Sidebar yoksa satır yukarıdaki gibi transcript'e yazılır.
7. Bulgu bundan sonra her doküman için ayrı olarak açık kalır. Her ana loop turn'ünün sonunda mod açık her dokümanı `ripwire <kök> --doc-drift=<doküman> --with-history` ile, yani yalnız o dokümana daraltılmış bir çalıştırmayla yeniden ölçer. Bütün anchor'ları yeniden doğru olan dokümanın bulgusu kapanır: kaydı silinir ve yerine yeşil bir satır yazılır.

       doc-drift-watch: README.md: 1 doc line(s) hold again

   Silinen bir dokümanın bulgusu da kapanır ve satır bunu bildirir: `README.md is gone, and its 1 stale line(s) with it`. Eskimiş satırlarının yalnız bir kısmı düzeltilen doküman açık kalır, çünkü kısmen düzeltilmiş bir doküman düzeltilmiş sayılmaz. Açık bir dokümanın başka satırlarını da eskiten sonraki bir commit, bu satırları o dokümanın bulgusuna ekler. Bulgunun zaten içerdiği satırlar, commit'ten sonraki ölçüm onları hâlâ bildirdiği sürece bulguda kalır.
8. Hâlâ açık olan bulgular, bir sonraki prompt'unuzla birlikte modele tek bir not olarak gönderilir. Not her turn için bir kez gönderilir:

       doc-drift-watch: 1 doc(s) still hold stale lines: README.md (1). Update them.

Commit'ten önce de eskimiş olan bir anchor tekrar bildirilmez. Böylece README'deki bir örnek path her commit'te yeniden bildirilmez. Yazarının tarih eklediği bir anchor da (ripwire `kind="dated-record"`) bildirilmez, çünkü bu anchor yazıldığı andaki doğru durumu kayıt altına alır.

Canlı denemede model, bir README'nin `other.go:3` ile gösterdiği dosyayı sildi. Commit'ten sonra notu okudu ve notu kelimesi kelimesine aktardı. Aynı README'deki daha eski bir eskimiş anchor notta yoktu.

## İki mod

Varsayılan mod `note` modudur: mod bulguları bildirir ve hiçbir işlemi durdurmaz.

`deny` modunda bir doküman eskimiş bir satır içerdiği sürece `git commit`, `git push` ya da `git merge` durdurulur. Mod cevap vermeden önce açık her dokümanı yeniden ölçer. Böylece modelin düzelttiği bir doküman kontrolü kendiliğinden açar ve hiçbir kontrol kalıcı olarak kapalı kalmaz:

    doc-drift-watch: stopped: 1 doc(s) still hold stale lines: README.md (1). Update them and run the command again; there is no way around this gate.

Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git rev-parse --show-toplevel` ve `git diff --cached --name-only -z`). Commit açık dokümanların hiçbirini içermiyorsa çalışır ve kaç bulgunun hâlâ açık olduğu tek bir satırla bildirilir. `git commit -a`, `-am` ve `--` işaretinden sonra pathspec verilen commit'ler daraltılmaz, çünkü bu commit'lerin neyi içerdiğini yalnız index göstermez. `push` ve `merge` index okumaz. Bu yüzden bu komutlarda bütün bulgular geçerlidir.

Bu kontrolü atlamanın bir yolu ya da tek seferlik bir izin yoktur. Kontrol, dokümanlar yeniden doğru olduğunda ya da siz `/doc-drift-watch mode note` ayarını yaptığınızda açılır.

## Komut

    /doc-drift-watch                  durum: açık mı kapalı mı, mod ve hâlâ eskimiş olan dokümanlar
    /doc-drift-watch on | off         varsayılan açık
    /doc-drift-watch mode note        yalnız bildirir; varsayılan
    /doc-drift-watch mode deny        bir doküman eskimiş kaldığı sürece git commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install doc-drift-watch@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. [ripwire](https://github.com/redhat-et/ripwire)'ı yükleyin ve PATH'e ekleyin. ripwire yoksa bir commit `the docs were not checked: ...` satırını sarı bir kayıt olarak yazar (sidebar kapalıysa transcript'e). Bu satır farklı bir hata gelene kadar yalnız bir kez yazılır ve commit her zamanki gibi çalışır.
2. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=doc-drift-watch}, tool.call{tool=Bash}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.fs.read (via isGone), $.process.run (via driftNow, repoRoot, stagedPaths), $.session.cwd (via beforeCommit, stagedPaths), $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via gate, toPerson)

Reach L2: process çalıştırır.

    1. Okur:         Bash komutunun metnini ve açık her dokümanın kendi dosyasını; ripwire ile repository'nin markdown dosyalarını, kaynak kodunu ve git geçmişini
    2. Çalıştırır:   argv ile salt okunur git rev-parse, git diff --cached ve ripwire --doc-drift: her commit için iki kez; her turn sonunda ve korunan bir komutta her açık doküman için bir kez
    3. Gönderir:     commit'in sonucundan sonra ve bir sonraki prompt'ta modele bir not; transcript'e ya da sidebar'a bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde
    5. Düşman girdi: dizin komutun metninden gelir ve git'e hiçbir zaman bir shell üzerinden değil, yalnız çalışma dizini olarak verilir; doküman path'i ripwire'ın kendi çıktısından gelir ve ripwire'a tek bir argv değeri olarak verilir

## Sınırlar

- ripwire dosya:satır referanslarını, backtick içindeki sembol adlarını, `= N` sabitlerini ve `[N]` dizi boyutlarını kontrol eder. Düz metin kontrol edilmez. ripwire bilerek eksik bildirir: adı değiştirilmiş, ancak eski adı başka bir yerde hâlâ geçen bir sembol bildirilmez.
- ripwire her commit için iki kez, her turn sonunda da her açık doküman için bir kez çalışır. Bu repository'de bütün repository'yi kapsayan bir çalıştırma 0,1 ile 0,2 saniye sürdü. Daraltılmış bir çalıştırma daha kısa sürdü.
- Turn sonunda yalnız açık dokümanlar ölçülür. Hiçbir commit'in değiştirmediği, ancak başka bir nedenle eskiyen bir doküman turn sonunda değil, bir sonraki commit'te bulunur.
- `--doc-drift=<doküman>` path'in bir parçasına göre filtreler. Bu yüzden tek bir dokümana daraltılmış bir çalıştırma, path'i o dokümanın path'ini içeren başka bir dokümanı da okur. Sonuç ardından dokümanın kendi path'ine göre filtrelenir.
- `git commit` komutunu gizleyen bir script ya da alias ile yapılan bir commit fark edilmez.
- Dizinini shell'in genişlettiği bir `cd` ya da `git -C` (`cd $D`, `cd ~/x`, bir backquote) moda gerçek dizini vermez. Bu commit kontrol edilmez ve sarı satır bu kelimeyi gösterir, örneğin `the commit's directory is not known: cd $D`. Tek tırnak içindeki bir kelime olduğu gibi okunur.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
