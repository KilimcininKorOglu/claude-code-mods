# mod-doctor

`claude plugin marketplace update` komutunu çalıştırdığınızda clone yeni sürümleri alır. Ancak yüklü plugin'ler, her biri için ayrıca `claude plugin update` çalıştırılana kadar eski sürümde kalır. Bu ikinci adım kolayca unutulur. Bu mod, yerel clone'u daha yeni bir sürüm sunan her yüklü plugin'i, hangi marketplace'ten geldiğine bakmadan listeler. Böylece marketplace için yapılıp plugin için yapılmayan bir güncelleme gözden kaçmaz.

## Ne yapar

1. Mod her session başında, her ana loop turn'ünün sonunda ve etkileşimli bir session'da 60 saniyede bir host'un diskte tuttuğu şu dosyaları okur:
   - `~/.claude/plugins/installed_plugins.json` (`CLAUDE_CONFIG_DIR` tanımlıysa, host'un okuduğu gibi `$CLAUDE_CONFIG_DIR/plugins/`). Bu dosya her `<plugin>@<marketplace>` için her scope'taki yüklü sürümü listeler: user kurulumu ve dosyanın adını verdiği proje için proje kurulumu. Başka bir projenin proje kurulumu okunmaz. Geçerli iki kurulum varsa eski sürüm karşılaştırılır.
   - Her marketplace'in clone'undaki kendi `.claude-plugin/marketplace.json` dosyası. Bu dosya plugin'in clone içindeki yerini verir: bir marketplace plugin'lerini `plugins/` altında tutar, bir başkası kökünde tek bir plugin barındırır.
   - O plugin'in `.claude-plugin/plugin.json` dosyası, yani clone'un sunduğu sürüm.
2. Yüklü sürüm, sunulan sürümle her parçanın sayısal değeri üzerinden karşılaştırılır. Bu yüzden `0.10.0`, `0.9.0`'dan yeni sayılır. Sayı olarak karşılaştırılamayan iki sürüm eşit kabul edilir. Bu yüzden farklı biçimdeki bir sürüm hiçbir zaman güncelleme istemez.
3. [sidebar](../sidebar) açıkken geride kalan plugin'ler, session boyunca kalan tek bir `update available` section'ında gösterilir:

       update available
       sidebar 0.4.1 → 0.5.0
       turkish-native 1.0.0 → 1.2.0
       claude plugin update sidebar@kilimcininkoroglu-mods turkish-native@turkish-native

   Her satırda yüklü sürüm soluk renktedir. Sunulan sürümün rengi sürüm farkının büyüklüğünü gösterir: yeni bir major sürüm kırmızı, yeni bir minor sürüm sarı, yeni bir patch yeşil. Sekizinci satırdan sonraki plugin'ler soluk tek bir satırda sayılır. Altlarındaki soluk update komutu ilk sekiz satırdaki plugin'leri içerir. Sidebar kapalıysa ya da yüklü değilse aynı bulgu transcript'e tek bir satır olarak yazılır.
4. Bütün yüklü plugin'ler clone'larının sürümündeyken hiçbir şey çizilmez. Bu durum oluştuğu anda section kaldırılır.
5. Her turn sonundaki ve 60 saniyelik ölçüm, session başındaki ölçümün kaçırdıklarını yakalar: bu session açıkken başka bir pencerede güncellediğiniz bir plugin ya da marketplace ve bu mod ilk ölçümü yaptığında pane'i henüz açılmamış bir sidebar. 60 saniyelik ölçüm bunları bu session boştayken de yakalar. Bulgu transcript'e bir kez yazılır. Aynı bulgunun sonraki ölçümleri hiçbir şey yazmaz.
6. `/mod-doctor` hemen yeniden ölçer. Ardından ayarı, kapsamı, kaç plugin'in kontrol edildiğini ve hangilerinin geride kaldığını yazar. `/mod-doctor marketplace <ad>` kapsamı tek bir marketplace ile sınırlar. `marketplace all` kapsamı yeniden genişletir.

Clone yalnız son `claude plugin marketplace update` kadar günceldir. Bu yüzden mod "Marketplace'i güncelledim, plugin'leri de güncelledim mi?" sorusunu cevaplar. "GitHub'da daha yeni bir sürüm var mı?" sorusunu cevaplamaz.

## Komut

    /mod-doctor                        ayar, kapsam ve geride kalan her plugin
    /mod-doctor on | off               varsayılan açık
    /mod-doctor marketplace my-mods    yalnız o marketplace
    /mod-doctor marketplace all        host'un clone'ladığı her marketplace; varsayılan, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install mod-doctor@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Plugin başına satırlar için [sidebar](../sidebar) modunu yükleyin. Sidebar yüklü değilse mod bunun yerine transcript'e tek bir satır yazar.

## Nelere erişir

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=mod-doctor}, turn.complete
    ❯ ./register.ts calls: $.clock.every, $.command.register, $.env.get, $.fs.read (via readText), $.sidebar.clear (via clearShown), $.sidebar.set (via toPerson), $.store.get (via readScope, readSettings), $.store.set (via setEnabled, setScope), $.ui.log (via toPerson)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1: dosya okur.

    1. Okur:         CLAUDE_CONFIG_DIR, HOME, host'un kurulum kaydı, her marketplace clone'unun manifest'i ve yüklü her plugin için bir plugin.json; proje dosyası, prompt ya da transcript okumaz
    2. Çalıştırır:   hiçbir şey; update komutu, sizin çalıştırmanız için yazılan bir metindir
    3. Gönderir:     modele ve network'e hiçbir şey; satırlar yalnız sizin içindir
    4. Saklar:       açık/kapalı ayarını ve kapsamı $.store içinde
    5. Düşman girdi: her dosya veri olarak okunur, sürümler sayı olarak karşılaştırılır ve farklı biçimdeki bir dosya bulgu üretmeden atlanır

## Sınırlar

- Ölçüm upstream repository'ye değil, clone'a göre yapılır. Önce `claude plugin marketplace update <marketplace>` komutunu çalıştırın. Aksi hâlde mod yeni bir şey bildirmez.
- Plugin'lerinin sürümünü commit sha'sı ile belirleyen bir marketplace (resmî marketplace böyledir) için hiçbir şey bildirilmez, çünkü iki sha sayı olarak karşılaştırılamaz.
- Marketplace'in başka bir repository'den git alt dizini olarak aldığı bir plugin'in clone'da sürümü yoktur. Bu yüzden bu plugin atlanır.
- Mod, çalışan session'ın yeni kodu yükleyip yüklemediğini göstermez. Session sırasında yapılan bir `claude plugin update`, `/reload-plugins` ya da yeniden başlatma yapılana kadar eski kodu yüklü bırakır.
- Mod sizin yerinize hiçbir şeyi güncellemez. Komutu gösterir. Komutu çalıştırmak size kalır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
