# mod-doctor

`claude plugin marketplace update` çalıştırırsın, clone yeni sürümleri alır; ama kurulu plugin'ler, her biri için `claude plugin update` da çalıştırana kadar olduğu yerde kalır. Bu ikinci adımı unutmak kolaydır. Bu mod, hangi marketplace'ten gelirse gelsin, yerel clone'u daha yeni bir sürüm sunan her kurulu plugin'in adını söyler; böylece marketplace için yapıp plugin için yapmadığın bir güncelleme gözden kaçmaz.

## Ne yapar

1. Mod her session başında, her ana loop turn'ünün sonunda ve etkileşimli bir session'da 60 sn'de bir host'un diskte tuttuklarını okur:
   - `~/.claude/plugins/installed_plugins.json` (`CLAUDE_CONFIG_DIR` ayarlıysa, host'un okuduğu gibi `$CLAUDE_CONFIG_DIR/plugins/`). Bu dosya her `<plugin>@<marketplace>` için scope başına kurulu sürümü söyler: user kurulumu ve adını verdiği proje için bir proje kurulumu. Başka bir projenin proje kurulumu okunmaz; geçerli iki kurulumdan eski sürüm karşılaştırılır;
   - her marketplace'in clone'undaki kendi `.claude-plugin/marketplace.json`'ı; plugin'in clone içinde nerede durduğunu söyler (bir marketplace plugin'lerini `plugins/` altında tutar, bir diğeri kökünde tek bir plugin'dir);
   - o plugin'in `.claude-plugin/plugin.json`'ı, yani clone'un sunduğu sürüm.
2. Kurulu sürümü sunulanla her parçanın sayısına göre karşılaştırır; böylece `0.10.0`, `0.9.0`'dan yeni sayılır. Sayı olarak karşılaştıramadığı iki sürüm eşit sayılır, yani başka biçimde bir sürüm hiçbir zaman güncelleme istemez.
3. [sidebar](../sidebar) açıkken geride kalan plugin'ler session boyunca duran tek bir `update available` section'ıdır:

       update available
       sidebar 0.4.1 → 0.5.0
       turkish-native 1.0.0 → 1.2.0
       claude plugin update sidebar@kilimcininkoroglu-mods turkish-native@turkish-native

   Her satırda kurulu sürüm soluk, sunulan sürüm ise atlamanın büyüklüğüne göre renklidir: yeni bir major sürüm kırmızı, yeni bir minor sarı, yeni bir patch yeşil. Sekizinciden sonraki satırlar soluk tek bir satırda sayılır; altlarındaki soluk update komutu ilk sekiz satırın plugin'lerini sayar. Sidebar kapalıysa ya da kurulu değilse aynı bulgu tek bir transcript satırıdır.
4. Kurulu her plugin clone'unun sürümündeyken hiçbir şey çizilmez; bu durum oluşur oluşmaz section kalkar.
5. Her turn sonundaki ölçüm ve 60 sn'lik ölçüm, session başının yakalayamadıklarını yakalar: bu session açıkken başka bir pencerede güncellediğin bir plugin'i ya da marketplace'i ve bu mod ilk ölçtüğünde henüz pane'ini açmamış bir sidebar'ı. 60 sn'lik ölçüm bunları bu session boştayken de yakalar. Bulgu transcript'e bir kez düşer; aynı bulgunun sonraki ölçümü hiçbir şey söylemez.
6. `/mod-doctor` hemen yeniden ölçer ve ayarı, kapsamı, kaç plugin tuttuğunu ve hangilerinin geride olduğunu yazar. `/mod-doctor marketplace <ad>` kapsamı tek bir marketplace'e daraltır, `marketplace all` yeniden genişletir.

Clone ancak son `claude plugin marketplace update` kadar yenidir; yani bu mod "marketplace'i güncelledim, plugin'leri güncelledim mi?" sorusunu cevaplar, "GitHub'da daha yeni bir sürüm var mı?" sorusunu değil.

## Komut

    /mod-doctor                        ayar, kapsam ve geride olan her plugin
    /mod-doctor on | off               varsayılan açık
    /mod-doctor marketplace my-mods    yalnız o marketplace
    /mod-doctor marketplace all        host'un clone'ladığı her marketplace; varsayılan, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install mod-doctor@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Plugin başına satırlar için [sidebar](../sidebar) mod'unu kur. O olmadan mod onun yerine tek bir transcript satırı yazar.

## Nereye uzanır

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=mod-doctor}, turn.complete
    ❯ ./register.ts calls: $.clock.every, $.command.register, $.env.get, $.fs.read (via readText), $.sidebar.clear (via clearShown), $.sidebar.set (via toPerson), $.store.get (via readScope, readSettings), $.store.set (via setEnabled, setScope), $.ui.log (via toPerson)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1: dosya okur.

    1. Okur:     CLAUDE_CONFIG_DIR, HOME, host'un install kaydını, her marketplace clone'unun manifest'ini ve kurulu plugin başına bir plugin.json. Proje dosyası yok, prompt yok, transcript yok.
    2. Çalıştırır: hiçbir şey; update komutu kişinin çalıştıracağı bir metindir
    3. Gönderir: modele hiçbir şey, network'e hiçbir şey; satırlar yalnız kişi içindir
    4. Saklar:   $.store içinde on/off ayarını ve kapsamı
    5. Düşman girdi: her dosya veri olarak okunur, sürümler sayı olarak karşılaştırılır ve başka biçimde bir dosya bulgu üretmeden atlanır

## Sınırlar

- Ölçü upstream repository değil, clone'dur. Önce `claude plugin marketplace update <marketplace>` çalıştır, yoksa mod yeni bir şey bildirmez.
- Plugin'lerini commit sha'sıyla sürümleyen bir marketplace (resmî marketplace böyle yapar) hiçbir şey bildirmez, çünkü iki sha sayı olarak karşılaştırılamaz.
- Marketplace'in başka bir repository'den git alt dizini olarak çektiği bir plugin'in clone'da sürümü yoktur, bu yüzden atlanır.
- Çalışan session'ın yeni kodu yükleyip yüklemediğini söylemez. Session sırasında yapılan bir `claude plugin update`, `/reload-plugins`'e ya da yeniden başlatmaya kadar eski kodu yüklü bırakır.
- Senin yerine hiçbir şey güncellenmez. Mod komutu söyler; çalıştırmak sana kalır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
