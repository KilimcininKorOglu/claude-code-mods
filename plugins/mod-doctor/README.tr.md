# mod-doctor

Yerel clone'u zaten daha yeni bir sürüm sunan her kurulu plugin'i, her marketplace'ten, adlandıran bir Claude Code Mod'u. Böylece marketplace için çalıştırıp plugin için çalıştırmadığınız bir update fark edilmeden kalmaz.

## Ne yapar

1. Her session başlangıcında ve session'ın ilk turunun sonunda bir kere daha mod, host'un diskte tuttuğunu okur: her `<plugin>@<marketplace>` için scope başına kurulu sürümü adlandıran `~/.claude/plugins/installed_plugins.json` (user kurulumu ve adlandırdığı proje için bir project kurulumu; başka bir projenin project kurulumu okunmaz, geçerli iki kurulumdan eski sürüm karşılaştırılır; `CLAUDE_CONFIG_DIR` ayarlıysa dosya host gibi `$CLAUDE_CONFIG_DIR/plugins/` altından okunur); her marketplace'in clone'undaki kendi `.claude-plugin/marketplace.json` dosyası, o plugin'in içeride nerede olduğunu söyler (bir marketplace plugin'lerini `plugins/` altında tutar, bir diğeri kökünde tek bir plugin'dir); ve o plugin'in `.claude-plugin/plugin.json` dosyası, clone'un sunduğu sürüm.
2. Kurulu sürümü sunulan sürümle her parçanın sayısına göre karşılaştırır, yani `0.10.0`, `0.9.0` sürümünden yeni sayılır. Sayı olarak karşılaştıramadığı iki sürüm eşit sayılır, yani başka biçimde bir sürüm hiçbir zaman update istemez.
3. [sidebar](../sidebar) açıkken geride kalan plugin'ler session boyunca duran tek bir `update available` section'ıdır:

       update available
       sidebar 0.4.1 → 0.5.0
       turkish-native 1.0.0 → 1.2.0
       claude plugin update sidebar@kilimcininkoroglu-mods turkish-native@turkish-native

   Her satırda kurulu sürüm soluktur, sunulan sürüm ise atlamaya göre renklenir: yeni bir major sürüm kırmızı, yeni bir minor sürüm sarı, yeni bir patch yeşil. Sekizinciden sonraki satırlar tek bir soluk satırda sayılır. Sidebar kapalıyken ya da o mod kurulu değilken aynı bulgu tek bir transcript satırıdır.
4. Her kurulu plugin clone'unun sürümündeyken hiçbir şey çizilmez ve bu doğru olur olmaz section kaldırılır.
5. İkinci ölçüm, ilkinin çözemediği iki durumu çözer: bu session açıkken başka bir pencerede güncellediğiniz bir plugin, ve bu mod ilk ölçtüğünde kendi plugin'i pane'ini henüz açmamış bir sidebar. Bulgu transcript'e bir kere ulaşır; aynı bulgunun ikinci ölçümü hiçbir şey söylemez.
6. `/mod-doctor` anında yeniden ölçer ve ayarı, kapsamı, kaç plugin tuttuğunu ve hangilerinin geride olduğunu yazar. `/mod-doctor marketplace <name>` bunu tek bir marketplace'e daraltır, `marketplace all` yeniden genişletir.

Clone yalnız son `claude plugin marketplace update` kadar yenidir, yani bu mod "marketplace'i güncelledim, plugin'leri güncelledim mi?" sorusuna cevap verir, "GitHub'da daha yeni bir sürüm var mı?" sorusuna değil.

## Komut

    /mod-doctor                        ayar, kapsam ve geride olan her plugin
    /mod-doctor on | off               varsayılan on
    /mod-doctor marketplace my-mods    yalnız o marketplace
    /mod-doctor marketplace all        host'un clone'ladığı her marketplace; varsayılan, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install mod-doctor@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Plugin başına satırlar için [sidebar](../sidebar) mod'unu kurun. O olmadan mod tek bir transcript satırı yazar.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=mod-doctor}, turn.complete
    ❯ ./register.ts calls: $.command.register, $.env.get, $.fs.read (via readText), $.sidebar.clear (via clearShown), $.sidebar.set (via toPerson), $.store.get, $.store.set (via setEnabled, setScope), $.ui.log (via toPerson)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1, dosya okur.

    1. Okur:     CLAUDE_CONFIG_DIR, HOME, host'un install kaydını, her marketplace clone'unun manifest'ini ve kurulu plugin başına bir plugin.json. Proje dosyası yok, prompt yok, transcript yok.
    2. Çalıştırır: hiçbir şey; update komutu kişinin çalıştıracağı bir metindir
    3. Gönderir: modele hiçbir şey, network'e hiçbir şey; satırlar yalnız kişi içindir
    4. Saklar:   $.store içinde on/off ayarını ve kapsamı
    5. Düşman girdi: her dosya veri olarak okunur, sürümler sayı olarak karşılaştırılır ve başka biçimde bir dosya bulgu üretmeden atlanır

## Sınırlar

- Ölçü clone'dur, upstream repository değil. Önce `claude plugin marketplace update <marketplace>` çalıştırın, yoksa mod yeni bir şey bildirmez.
- Plugin'lerini commit sha ile sürümleyen bir marketplace (resmi olan öyle yapar) hiçbir şey bildirmez, çünkü iki sha sayı olarak karşılaştırılamaz.
- Marketplace'in başka bir repository'den git alt dizini olarak çektiği bir plugin'in clone'da sürümü yoktur, bu yüzden atlanır.
- Kayıt session başına iki kere okunur: başlangıcında ve ilk ana döngü turunun sonunda. Aynı session'daki daha sonraki bir update, `/mod-doctor` ya da sonraki session'a kadar görülmez.
- Çalışan session'ın yeni kodu yükleyip yüklemediğini söylemez. Bir session sırasında yapılan `claude plugin update`, `/reload-plugins` ya da bir restart'a kadar eski kodu yüklü bırakır.
- Proje kapsamında ve kullanıcı kapsamında kurulu bir plugin yalnız ilk kaydı olarak okunur.
- Sizin için hiçbir şey güncellenmez. Mod komutu adlandırır; onu çalıştırmak sizin işinizdir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
