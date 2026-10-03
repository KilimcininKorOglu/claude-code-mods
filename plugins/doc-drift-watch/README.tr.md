# doc-drift-watch

Model bir dosyayı siler ya da bir fonksiyonun adını değiştirir, commit'ler ve bir yerdeki README hâlâ `other.go:3`'ü gösterir. Bir okur o bağlantıyı izleyene kadar kimse fark etmez. Bu mod bunu commit anında yakalar: modelin çalıştırdığı her `git commit`'ten sonra [ripwire](https://github.com/redhat-et/ripwire)'a hangi markdown anchor'larının artık tutmadığını sorar ve commit'in bozduklarını commit'in sonucuna ekler.

## Ne yapar

1. Bash tool'unu izler. `git commit` çalıştıran komutlar kontrol edilir; `git -C <dizin> commit` ya da önünde git'in global flag'leri olan biçimleri de. `--dry-run`, `--help` ya da `-h` taşıyanlar kontrol edilmez.
2. Komut çalışmadan önce repository kökünü session'ın dizininden, commit'ten önceki son `cd`'den ve commit'in `git -C`'sinden bulur ve argv ile `ripwire <kök> --doc-drift --with-history` çalıştırır.
3. Başarılı bir commit'ten sonra aynı komutu yeniden çalıştırır ve iki sonucu karşılaştırır. Dokümanı, türü, nedeni ve referansı aynı olan eskimiş anchor aynı anchor sayılır; satır numarası hesaba katılmaz, çünkü üstündeki bir düzenleme onu kaydırır.
4. Yalnız commit'in eklediği anchor'lar bildirilir. Model commit'in sonucunun hemen ardından şu notu okur:

       doc-drift-watch: this commit made 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists. Update them in a follow-up commit, or tell the user why a line stays.

   En fazla 8 satır adıyla yazılır, gerisi sayılır.
5. Aynı anda transcript'e tek bir satır düşer, böylece modele ne söylendiğini görürsün. Satırda talimat yoktur, yalnız eskimiş satırlar vardır:

       doc-drift-watch: 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists

   Not ile satır ayrı kanallardır: model satırı, sen de notu hiç okumazsın.
6. [sidebar](../sidebar) açıksa satırlar transcript yerine onun stream'ine gider, her doküman için bir kayıt olarak; transcript temiz kalır. `doküman:satır` kısmı soluk, eskimiş referans kırmızı, kaymış bir satırda şimdi duran şey sarıdır. Sidebar yoksa satır yukarıdaki gibi transcript'e düşer.
7. Bulgu bundan sonra doküman başına bir tane olarak açık kalır. Her ana loop turn'ünün sonunda mod açık her dokümanı `ripwire <kök> --doc-drift=<doküman> --with-history` ile, yani yalnız o dokümana daraltılmış bir çalıştırmayla yeniden ölçer. Anchor'larının hepsi yeniden tutan doküman kapanır: kaydı silinir, yerine yeşil bir satır gelir.

       doc-drift-watch: README.md: 1 doc line(s) hold again

   Ortadan kalkan bir doküman bulguyu öbür taraftan kapatır ve satır bunu söyler: `README.md is gone, and its 1 stale line(s) with it`. Eskimiş satırlarının yalnız bir kısmını düzelten doküman açık kalır, çünkü yarısı düzeltilmiş olan düzeltilmiş sayılmaz. Açık bir dokümanın başka satırlarını da eskiten sonraki bir commit, onları o dokümanın bulgusuna ekler; bulgunun zaten tuttuğu satırlar, commit'ten sonraki ölçüm onları hâlâ bildirdiği sürece kalır.
8. Geriye kalan, bir sonraki prompt'unla birlikte modele tek bir not olarak gider; her turn'de bir not:

       doc-drift-watch: 1 doc(s) still hold stale lines: README.md (1). Update them.

Commit'ten önce de eskimiş olan bir anchor tekrarlanmaz; böylece README'deki bir örnek yol her commit'te geri gelmez. Yazarının tarih koyduğu bir anchor da (ripwire `kind="dated-record"`) bildirilmez, çünkü o anda doğru olanı kayda geçirir.

Canlı denemede model bir README'nin `other.go:3` ile gösterdiği dosyayı sildi, commit'ten sonra notu okudu ve onu kelimesi kelimesine aktardı. Aynı README'deki daha eski bir eskimiş anchor notta yoktu.

## İki mod

Varsayılan `note`'tur: mod bildirir, hiçbir şeyi durdurmaz.

`deny` modunda bir doküman eskimiş bir satır taşıdığı sürece `git commit`, `git push` ya da `git merge` durdurulur. Mod cevap vermeden önce açık her dokümanı yeniden ölçer; böylece modelin düzelttiği bir doküman gate'i kendiliğinden açar ve hiçbir gate kalıcı olarak kapalı kalmaz:

    doc-drift-watch: stopped: 1 doc(s) still hold stale lines: README.md (1). Update them and run the command again; there is no way around this gate.

`git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git rev-parse --show-toplevel` ve `git diff --cached --name-only -z`) ve commit açık dokümanların hiçbirini içermiyorsa geçmesine izin verir, kaç bulgunun hâlâ durduğunu tek satırla söyler. `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit daraltılmaz, çünkü neyi commit'lediklerini yalnız index söylemez. `push` ve `merge` index okumaz, orada bütün bulgular geçerlidir.

Kaçış yolu da, tek seferlik bir geçiş de yoktur. Gate, dokümanlar yeniden tutunca ya da sen `/doc-drift-watch mode note` ayarlayınca açılır.

## Komut

    /doc-drift-watch                  durum: açık mı kapalı mı, mod ve hâlâ eskimiş dokümanlar
    /doc-drift-watch on | off         varsayılan açık
    /doc-drift-watch mode note        yalnız bildirir; varsayılan budur
    /doc-drift-watch mode deny        bir doküman eskimiş kaldıkça git commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install doc-drift-watch@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. [ripwire](https://github.com/redhat-et/ripwire)'ı kur ve PATH'e ekle. ripwire yoksa bir commit `the docs were not checked: ...` satırını sarı bir kayıt olarak yazar (sidebar kapalıysa transcript'e). Satır farklı bir hata gelene kadar bir kez yazılır ve commit her zamanki gibi çalışır.
2. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=doc-drift-watch}, tool.call{tool=Bash}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.fs.read (via isGone), $.process.run (via driftNow, repoRoot, stagedPaths), $.session.cwd (via beforeCommit, stagedPaths), $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via gate, toPerson)

Reach L2: process çalıştırır.

    1. Okur:     Bash komutunun metnini, açık her dokümanın kendi dosyasını; ripwire üzerinden repository'nin markdown'ını, kaynağını ve git geçmişini
    2. Çalıştırır: salt okunur git rev-parse, git diff --cached ve ripwire --doc-drift, argv ile: commit başına iki kez, her turn sonunda ve korunan bir komutta açık doküman başına bir kez
    3. Gönderir: commit'in sonucundan sonra ve bir sonraki prompt'ta modele bir not, transcript'e ya da sidebar'a bir satır; makineden dışarı bir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını ve modu
    5. Düşman girdi: dizin komutun metninden gelir ve git'e hiçbir zaman shell üzerinden değil, yalnız çalışma dizini olarak ulaşır; doküman yolu ripwire'ın kendi çıktısından gelir ve ripwire'a tek bir argv değeri olarak geçer

## Sınırlar

- ripwire dosya:satır referanslarını, backtick içindeki sembol adlarını, `= N` sabitlerini ve `[N]` dizi boyutlarını kontrol eder. Düz yazı kontrol edilmez; ripwire da bilerek eksik bildirir: adı başka bir yerde hâlâ geçen, adı değişmiş bir sembol bildirilmez.
- ripwire commit başına iki kez, her turn sonunda da açık doküman başına bir kez çalışır. Bu repository'de bütün repository'yi kapsayan bir çalıştırma 0,1 ile 0,2 saniye sürdü, daraltılmış olanı daha kısa.
- Turn sonu yalnız açık dokümanları ölçer. Hiçbir commit'in dokunmadığı ve başka bir yoldan eskiyen doküman turn sonunda değil, bir sonraki commit'te bulunur.
- `--doc-drift=<doküman>` yolun bir parçasına göre filtreler; yani tek dokümana daraltılmış bir çalıştırma, yolu o dokümanın yolunu içeren başka bir dokümanı da okur. Cevap ardından dokümanın kendi yoluna göre süzülür.
- `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit görülmez.
- Dizinini shell'in genişlettiği bir `cd` ya da `git -C` (`cd $D`, `cd ~/x`, bir backquote) mod'a gerçek dizini söylemez. O commit kontrol edilmez ve sarı satır bu kelimeyi gösterir, örneğin `the commit's directory is not known: cd $D`. Tek tırnak içindeki bir kelime olduğu gibi kalır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
