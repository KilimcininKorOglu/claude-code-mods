# i18n-watch

Bir edit'in, bir ya da birden fazla locale dosyasında olmayan translation key'lerini kullandığını modele söyleyen bir Claude Code Mod'u. Not Edit'in sonucuyla birlikte gelir, yani model key'leri aynı turda ekler. Varsayılan olarak hiçbir şey durmaz; `deny` modunda bir key eksikken commit, push ve merge durur.

## Ne yapar

1. Mod Edit ve Write tool'larını hook'lar. Bir kaynak dosyada (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.php`, `.py`, `.rb`, `.erb`, `.haml`, `.slim`) başarılı bir çağrıdan sonra edit'in eklediği translation çağrılarını okur: `new_string` içinde olup `old_string` içinde olmayanları, ya da bir Write'ın her çağrısını.
2. Okunan çağrılar, tırnaklı ilk argümanı olan `t`, `$t`, `i18n.t`, `__`, `trans`, `trans_choice`, `@lang`, `_`, `gettext` ve `ngettext`; ayrıca `this.`, `vm.`, `i18n.`, `$i18n.`, `I18n.` ve `i18n.global.` sonrası biçimleri. Değişken argüman, template literal ve Rails lazy key (`t('.title')`) atlanır.
3. Locale dosyalarını session dizininin şu dizinleri altında, en fazla 4 seviye derinlikte ve 200 dosya olarak okur: `locales`, `lang`, `i18n`, `translations`, `locale`, `config/locales`, `resources/lang`, `src/locales`, `src/i18n`, `public/locales`. Session dizini, session'ın başladığı dizindir ve başlangıçta bir kere okunur, çünkü bir Bash `cd` session'ın kendi dizinini taşır. Edit edilen dosya da o dizine göre adlandırılır, yani proje içindeki bir path proje kökünden yazılır.

   | Format | Örnek path | Key'ler |
   |---|---|---|
   | JSON (i18next, vue-i18n, Laravel) | `locales/tr.json`, `locales/tr/checkout.json`, `lang/tr.json` | iç içe key'ler noktalı path olarak; `item_one` aynı zamanda `item`'i tanımlar |
   | PHP array (Laravel) | `lang/tr/messages.php` | `messages.key`, iç içe array'ler noktalı path olarak |
   | YAML (Rails, Symfony) | `config/locales/tr.yml`, `translations/messages.tr.yaml` | noktalı path'ler; bir Rails üst key'i (`tr:`) dışarıda bırakılır |
   | gettext | `locale/tr/LC_MESSAGES/django.po` | her `msgid` |

   Dil bir dizinden (`tr/`, `en-US/`) ya da dosya adından (`tr.json`, `messages.tr.yaml`) gelir. Bir namespace dosyasındaki key aynı zamanda `ns.key` ve `ns:key` olarak da sayılır.
4. Bir key, bir dilde yoksa ya da hiçbir dilde yoksa eksiktir. Her key çağrıldığı satırla adlandırılır, böylece açabilirsiniz. Model bu notu Edit'in sonucundan sonra okur:

       i18n-watch: this edit uses translation keys the locale files lack: checkout.total:42 (missing in tr, de) · checkout.vat:58 (missing in every locale). Add them to each locale file.

   En fazla 10 key adlandırılır, kalanı sayılır.
5. Aynı anda transcript'e bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır yalnız key'leri taşır, talimat cümlesi olmadan:

       i18n-watch: keys the locale files lack: checkout.total:42 (missing in tr, de) · checkout.vat:58 (missing in every locale)

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
6. [sidebar](../sidebar) açıkken bu key'ler oraya gider, key başına bir satır olarak, stream'inde bir entry halinde, ve transcript temiz kalır. Entry, yenileri pane'den itene kadar durur. Sidebar kapalıyken ya da o mod kurulu değilken transcript satırı yukarıdaki gibi yazılır.

7. Bir bulgu hiçbir zaman hatırlanmış bir cevap değildir. Tuttuğu key'ler bir iddiadır ve her ölçüm kaynak dosyayı diskten yeniden okur ve artık çağırmadığı key'leri düşürür. Yani bir bulgu iki yoldan kapanır ve ikisi de her Edit ve Write'tan sonra, ve bir guarded git komutundan önce ölçülür:

   - her locale key'leri kazandı;
   - kod onları çağırmayı bıraktı, çünkü edit string'i sildi, başkasıyla değiştirdi ya da başka bir dosyaya taşıdı. Silinmiş bir dosya da bulgusunu kapatır.

   Entry temizlenir ve yeni bir satır hangisi olduğunu söyler:

       i18n-watch: every locale now has the keys src/Cart.vue lacked: checkout.total · checkout.vat
       i18n-watch: index.php no longer uses: Unauthorized Access

   Sidebar kapalıyken aynı metin tek bir transcript satırıdır. Model bunun hiçbirini okumaz: bulgu kendi işiyle kapandı, bir not yalnız az önce yaptığını tekrar ederdi. Var olan ama okunamayan bir dosya bulgusunu açık tutar, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz.

8. Modelin kapatmadığı bir bulgu her ana döngü turunun sonunda yeniden ölçülür ve kalan, bir sonraki prompt'la modele tek bir not olarak ulaşır:

       i18n-watch: 1 file(s) still use translation keys the locale files lack: index.php (Unauthorized Access:42). Add the keys to every locale file, or take the calls out.

   Tur başına bir not, prompt başına değil. Bu olmasa bulgu bir kere, edit anında söylenir ve sonra model onu unutmuşken pane'de dururdu. Siz yeni bir şey okumazsınız: pane zaten aynı bulguyu taşıyor.

9. `deny` modunda mod ayrıca, bir dosya locale dosyalarının tutmadığı key'leri kullandığı sürece `git commit`, `git push` ve `git merge` komutlarını durdurur. Bir `git commit` yalnız kendi dosyaları için cevap verir: mod index'i okur (`git diff --cached --name-only`) ve index açık dosyaların hiçbirini tutmuyorsa commit'in çalışmasına izin verir, size kaçının hâlâ durduğunu söyleyen bir satırla. Bir `push` ve bir `merge` okunacak index tutmaz, yani orada her bulgu durur. Kaçış yolu yok; gate'i yalnız kişi `/i18n-watch mode note` ile kapatır. `note` modu varsayılandır ve hiçbir şeyi durdurmaz, ama bulguları bir git komutunda yine de ölçer, böylece çözülmüş bir bulgu pane'de kalmaz.

Locale dosyaları, bir turda key ekleyen ilk edit'te ve bir locale dosyasının Edit ya da Write'ından sonra okunur. Bu dizinleri olmayan bir proje hiçbir şey almaz. Okunamayan ya da parse edilemeyen bir locale dosyası atlanır ve session başına bir kere log'lanır.

Canlı kontrolde model, `locales/en.json` ve `locales/tr.json` olan bir projenin dosyasına `t('cart.total')` ekledi, notu Edit'ten sonra okudu ve kelimesi kelimesine alıntıladı.

## Komut

    /i18n-watch                 on ya da off, mod ve hâlâ key'i eksik olan dosyalar
    /i18n-watch on | off        varsayılan on
    /i18n-watch mode note       yalnız not; varsayılan
    /i18n-watch mode deny       bir key eksikken commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install i18n-watch@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=i18n-watch}, turn.start, tool.call{tool=Bash}, turn.complete, prompt.submit, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isDir, usedNow), $.fs.list (via walkLocales), $.fs.read (via loadCatalog, usedNow), $.fs.stat (via isDir), $.process.run (via stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via catalogOf, gate, toPerson)

Reach L2, index'i okumak için git çalıştırır.

    1. Okur:     her Edit ve Write çağrısının metnini; Bash komut metnini; raporlanan her kaynak dosyayı yeniden; session dizini altındaki locale dizinlerini ve dosyalarını
    2. Çalıştırır: deny modunda guarded bir komutta git rev-parse --show-toplevel ve git diff --cached --name-only, commit'in hangi dosyaları tuttuğunu okumak için
    3. Gönderir: eksik key kullanan bir edit'ten sonra modele bir not, bulgu dururken sonraki prompt'la bir tane daha ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu; locale key'leri bir tur boyunca bellekte yaşar
    5. Düşman girdi: locale dosyaları yalnız veri olarak parse edilir (JSON.parse ve satır regex'leri), hiçbir zaman çalıştırılmaz; PHP dosyaları execute edilmez

## Sınırlar

- Yalnız session dizini altındaki locale dizinleri okunur. Locale'leri `apps/web/src/locales` içinde olan bir monorepo, session repository kökünde başladığında görülmez.
- Bir Laravel PHP dosyası satır satır okunur, çalıştırılmaz: tek satırda açılıp kapanan bir array, hesaplanmış bir key ve `include` edilen bir array görülmez.
- YAML indent ile okunur. Anchor'lar, alias'lar ve flow mapping'ler (`{a: b}`) izlenmez.
- Çalışma anında kurulan bir key (`t(name)`, `` t(`a.${b}`) ``) kontrol edilmez.
- Bir dil kodu, isteğe bağlı bir region ya da script ile iki harftir (`tr`, `pt_BR`, `zh-Hant`); `fil` gibi üç harfli bir kod tanınmaz.
- Edit'in yalnız taşıdığı bir key (`old_string` içinde de vardı) kontrol edilmez, Bash üzerinden yapılan bir edit de öyle.
- `deny` modunun kaçış yolu yoktur. Bir bulgu düzeltilemediğinde kişi gate'i `/i18n-watch mode note` ile kapatır.
- Gate komut metnini okur. `git commit`'i gizleyen bir script ya da alias üzerinden atılan commit durdurulmaz.
- Bir `git commit -a`, bir `-am` ve `--` sonrası pathspec taşıyan bir commit index'e göre daraltılmaz, çünkü bunlar index'in henüz tutmadığı dosyaları commit eder. Onlar için her açık bulgu durur.
- Index, komut çalışmadan önce okunur. Okuma ile çalışma arasında dosyaları değişen bir commit (bu arada başka bir process stage ediyorsa) okuma anındaki index'e göre ölçülür.
- Bir bulgu dosyanın yaptığı çağrılarla kapanır, locale dosyalarının kendi kullanımıyla değil. Kodun çağırmayı bıraktığı bir key, locale dosyaları hâlâ eksik olsa bile bulgudan düşer, çünkü artık onu hiçbir şey çağırmıyor.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
