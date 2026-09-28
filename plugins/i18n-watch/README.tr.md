# i18n-watch

Model bir component'e `t('checkout.total')` ekler; key hiçbir locale dosyasında yoktur ya da yalnız İngilizce'de vardır. Sayfa o zaman ham key'i, ya da Türkçe sayfada İngilizce metni gösterir ve bunu bir kullanıcı görene kadar kimse fark etmez. Bu mod, bir edit bir ya da birkaç locale dosyasında olmayan çeviri key'leri kullandığında bunu modele söyler. Not Edit'in sonucuyla birlikte gelir, böylece model key'leri aynı turn'de ekler. Varsayılan olarak hiçbir şey durdurulmaz; `deny` modunda bir key eksik kaldıkça commit, push ve merge durur.

## Ne yapar

1. Mod Edit ve Write tool'larını hook'lar. Bir kaynak dosyada (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.php`, `.py`, `.rb`, `.erb`, `.haml`, `.slim`) başarılı bir çağrıdan sonra edit'in eklediği çeviri çağrılarını okur: `new_string`'de olup `old_string`'de olmayanları, ya da bir Write'ın bütün çağrılarını.
2. Okunan çağrılar, ilk argümanı tırnak içinde olan `t`, `$t`, `i18n.t`, `__`, `trans`, `trans_choice`, `@lang`, `_`, `gettext` ve `ngettext`'tir; `this.`, `vm.`, `i18n.`, `$i18n.`, `I18n.` ve `i18n.global.`'dan sonra gelenler de. Değişken bir argüman, bir template literal ve bir Rails lazy key'i (`t('.title')`) atlanır.
3. Session dizininin şu alt dizinlerindeki locale dosyalarını okur; en fazla 4 seviye derine ve 200 dosyaya kadar iner, `node_modules`'ı ve 2 MB'ı aşan dosyaları atlar: `locales`, `lang`, `i18n`, `translations`, `locale`, `config/locales`, `resources/lang`, `src/locales`, `src/i18n`, `public/locales`. Session dizini, session'ın başladığı dizindir ve başta bir kez okunur, çünkü bir Bash `cd`'si session'ın kendi dizinini değiştirir. Edit edilen dosya, session'ın başladığı git repository'sine göre adlandırılır; yani `apps/web`'de açılan bir session `apps/api`'deki bir dosyayı `apps/api/x.ts` diye yazar. Git repository'si dışında dosya session dizinine göre adlandırılır. Bu kök de session başında bir kez okunur.

   | Biçim | Örnek path | Key'ler |
   |---|---|---|
   | JSON (i18next, vue-i18n, Laravel) | `locales/tr.json`, `locales/tr/checkout.json`, `lang/tr.json` | iç içe key'ler noktalı path olarak; `item_one` `item`'ı da tanımlar |
   | PHP array (Laravel) | `lang/tr/messages.php` | `messages.key`, iç içe array'ler noktalı path olarak |
   | YAML (Rails, Symfony) | `config/locales/tr.yml`, `translations/messages.tr.yaml` | noktalı path'ler; Rails'in en üst key'i (`tr:`) dışarıda kalır |
   | gettext | `locale/tr/LC_MESSAGES/django.po` | her `msgid` |

   Dil bir dizinden (`tr/`, `en-US/`) ya da dosya adından (`tr.json`, `messages.tr.yaml`) gelir. Bir namespace dosyasındaki key `ns.key` ve `ns:key` olarak da sayılır.
4. Bir dilde olmayan ya da hiçbir dilde olmayan key eksik sayılır. Her key çağrıldığı satırla birlikte yazılır, böylece doğrudan açabilirsin. Model Edit'in sonucundan sonra şu notu okur:

       i18n-watch: this edit uses translation keys the locale files lack: checkout.total:42 (missing in tr, de) · checkout.vat:58 (missing in every locale). Add them to each locale file.

   En fazla 10 key adıyla yazılır, gerisi sayılır. Yalnız bu edit'in eklediği key'ler bildirilir; daha önce bildirilmiş bir key bulguda kalır ama yeniden söylenmez.
5. Aynı anda transcript'e tek bir satır düşer, böylece modele ne söylendiğini görürsün. Satırda talimat yoktur, yalnız dosya ve key'leri vardır. Dosyanın adı geçer, çünkü edit'i model gördü, sen görmedin:

       i18n-watch: keys src/Cart.vue uses that the locale files lack: checkout.total:42 (missing in tr, de) · checkout.vat:58 (missing in every locale)

   Not ile satır ayrı kanallardır: model satırı, sen de notu hiç okumazsın.
6. [sidebar](../sidebar) açıksa bu key'ler transcript yerine onun stream'ine bir kayıt olarak gider: önce dosya, sonra her key için bir satır. Key kırmızı, satır numarası soluk, `every locale` kırmızı, birkaç locale'den oluşan liste sarıdır. Transcript temiz kalır. Kayıt, yenileri onu pane'den itene kadar durur. Sidebar kapalıysa ya da kurulu değilse satır yukarıdaki gibi transcript'e düşer.

7. Bulgu hiçbir zaman hatırlanmış bir cevap değildir. Tuttuğu key'ler bir iddiadır; her ölçüm kaynak dosyayı diskten yeniden okur ve artık çağrılmayan key'leri düşürür. Bu yüzden bulgu iki yoldan kapanır; ölçüm her Edit ve Write'tan sonra, her ana loop turn'ünün sonunda ve korunan bir git komutundan önce yapılır:

   - her locale key'leri kazanmıştır;
   - kod onları artık çağırmıyordur, çünkü edit metni silmiş, başka bir metinle değiştirmiş ya da başka bir dosyaya taşımıştır. Ortadan kalkan bir dosya da bulgusunu kapatır.

   Kayıt silinir ve yeşil yeni bir kayıt bunlardan hangisi olduğunu söyler:

       i18n-watch: every locale now has the keys src/Cart.vue lacked: checkout.total · checkout.vat
       i18n-watch: index.php no longer uses: Unauthorized Access

   Sidebar kapalıysa aynı metin tek bir transcript satırıdır. Model bunların hiçbirini okumaz: bulgu kendi yaptığı işle kapandı, bir not ancak az önce yaptığını tekrarlardı. Yerinde duran ama okunamayan bir dosya bulgusunu korur, çünkü okunmamış dosya hiçbir şey kanıtlamaz.

8. Modelin kapatmadığı bir bulgu her ana loop turn'ünün sonunda yeniden ölçülür; geriye kalan, bir sonraki prompt'unla birlikte modele tek bir not olarak gider:

       i18n-watch: 1 file(s) still use translation keys the locale files lack: index.php (Unauthorized Access:42). Add the keys to every locale file, or take the calls out.

   Not her prompt'ta değil, her turn'de bir kez gelir. Bu olmasa bulgu yalnız edit anında bir kez söylenir, model onu unuturken pane'de öylece dururdu. Sen yeni bir şey okumazsın, çünkü pane aynı bulguyu zaten gösteriyor.

9. `deny` modunda bir dosya locale dosyalarında olmayan key'leri kullanmaya devam ettikçe mod `git commit`, `git push` ve `git merge`'ü de durdurur; `--dry-run`, `--help` ya da `-h` taşıyan bir komut durdurulmaz. `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`), commit açık dosyaların hiçbirini içermiyorsa geçmesine izin verir ve kaç tanesinin hâlâ durduğunu tek satırla söyler. `push` ve `merge` için okunacak bir index yoktur, orada bütün bulgular geçerlidir. Gate'i aşmanın yolu yoktur; kapatmak yalnız sana kalır, `/i18n-watch mode note` ile. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz, ama bir git komutunda bulguları yine ölçer; böylece çözülmüş bir bulgu pane'de kalmaz.

Locale dosyaları bir turn'de onlara ihtiyaç duyan ilk edit'te okunur, bir locale dosyasının Edit ya da Write'ından sonra da yeniden okunur. Bu dizinleri olmayan bir projede hiçbir şey olmaz. Okunamayan ya da parse edilemeyen bir locale dosyası atlanır ve session başına bir kez yazılır.

Canlı denemede model `locales/en.json` ve `locales/tr.json` olan bir projede bir dosyaya `t('cart.total')` ekledi, Edit'ten sonra notu okudu ve kelimesi kelimesine aktardı.

## Komut

    /i18n-watch                 açık mı kapalı mı, mod ve hâlâ key'i eksik olan dosyalar
    /i18n-watch on | off        varsayılan açık
    /i18n-watch mode note       yalnız not verir; varsayılan budur
    /i18n-watch mode deny       bir key eksik kaldıkça commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install i18n-watch@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=i18n-watch}, turn.start, tool.call{tool=Bash}, turn.complete, prompt.submit, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isDir, usedNow), $.fs.list (via walkLocales), $.fs.read (via loadCatalog, usedNow), $.fs.stat (via isDir), $.process.run (via shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via catalogOf, gate, toPerson)

Reach L2: index'i okumak için git çalıştırır.

    1. Okur:     her Edit ve Write çağrısının metnini; Bash komut metnini; raporlanan her kaynak dosyayı yeniden; session dizini altındaki locale dizinlerini ve dosyalarını
    2. Çalıştırır: session başlangıcında bir kere git rev-parse --show-toplevel, dosyaları repository köküne göre adlandırmak için; deny modunda guarded bir komutta git rev-parse --show-toplevel ve git diff --cached --name-only -z, commit'in hangi dosyaları tuttuğunu okumak için
    3. Gönderir: eksik key kullanan bir edit'ten sonra modele bir not, bulgu dururken sonraki prompt'la bir tane daha ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu; locale key'leri bir tur boyunca bellekte yaşar
    5. Düşman girdi: locale dosyaları yalnız veri olarak parse edilir (JSON.parse ve satır regex'leri), hiçbir zaman çalıştırılmaz; PHP dosyaları execute edilmez

## Sınırlar

- Yalnız session dizini altındaki locale dizinleri okunur. Locale'leri `apps/web/src/locales`'te duran bir monorepo, session repository kökünde başlarsa görülmez.
- Laravel PHP dosyası çalıştırılmaz, satır satır okunur: tek satırda açılıp kapanan bir array, hesaplanan bir key ve `include` ile alınan bir array görülmez.
- YAML girintiye göre okunur. Anchor'lar, alias'lar ve flow mapping'ler (`{a: b}`) izlenmez.
- Çalışma anında kurulan bir key (`t(name)`, `` t(`a.${b}`) ``) kontrol edilmez.
- Dil kodu iki harftir, isteğe bağlı bir bölge ya da yazı sistemi alabilir (`tr`, `pt_BR`, `zh-Hant`); `fil` gibi üç harfli bir kod tanınmaz.
- Edit'in yalnız yerini değiştirdiği bir key (`old_string`'de de vardı) kontrol edilmez; Bash üzerinden yapılan bir edit de edilmez.
- `deny` modunu aşmanın yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/i18n-watch mode note` ile sen kapatırsın.
- Gate komut metnini okur. `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit durdurulmaz.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit index'e göre daraltılmaz, çünkü index'te henüz olmayan dosyaları da commit'ler. Bunlarda açık bulguların hepsi geçerlidir.
- Index komut çalışmadan önce okunur. Okuma ile çalışma arasında dosyaları değişen bir commit (bu sırada başka bir process'in stage'lemesi gibi), okuma anında index'in tuttuğuna göre ölçülür.
- Bulguyu dosyanın yaptığı çağrılar kapatır, locale dosyalarının kendi durumu değil. Kodun artık çağırmadığı bir key, locale dosyalarında hâlâ eksik olsa da bulgudan düşer, çünkü onu artık hiçbir şey çağırmıyor.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
