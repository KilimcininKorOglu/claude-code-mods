# i18n-watch

Model bir component'e `t('checkout.total')` ekler. Ancak bu key hiçbir locale dosyasında yoktur ya da yalnız İngilizce dosyada vardır. Bu durumda sayfa ham key'i ya da Türkçe sayfada İngilizce metni gösterir. Bu hatayı bir kullanıcı görene kadar kimse fark etmez. Bu mod, bir düzenleme bir ya da birden çok locale dosyasında olmayan çeviri key'leri kullandığında bunu modele bildirir. Not, Edit çağrısının sonucuyla birlikte gelir. Böylece model key'leri aynı turn'de ekler. Varsayılan modda hiçbir işlem durdurulmaz. `deny` modunda bir key eksik kaldığı sürece commit, push ve merge durdurulur.

## Ne yapar

1. Mod Edit ve Write tool'larını izler. Bir kaynak dosyada (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.php`, `.py`, `.rb`, `.erb`, `.haml`, `.slim`) başarılı bir çağrıdan sonra düzenlemenin eklediği çeviri çağrıları okunur: `new_string` içinde olup `old_string` içinde olmayan çağrılar ya da bir Write çağrısının bütün çağrıları.
2. Okunan çağrılar, ilk argümanı tırnak içinde olan `t`, `$t`, `i18n.t`, `__`, `trans`, `trans_choice`, `@lang`, `_`, `gettext` ve `ngettext` çağrılarıdır. `this.`, `vm.`, `i18n.`, `$i18n.`, `I18n.` ve `i18n.global.` ön ekinden sonra gelen çağrılar da okunur. Değişken bir argüman, bir template literal ve bir Rails lazy key'i (`t('.title')`) atlanır.
3. Mod, session dizininin şu alt dizinlerindeki locale dosyalarını okur: `locales`, `lang`, `i18n`, `translations`, `locale`, `config/locales`, `resources/lang`, `src/locales`, `src/i18n`, `public/locales`. En fazla 4 seviye derine ve 200 dosyaya kadar iner. `node_modules` dizinini ve 2 MB'ı aşan dosyaları atlar. Session dizini, session'ın başladığı dizindir ve session başında bir kez okunur, çünkü Bash'te çalışan bir `cd` session'ın dizinini değiştirir. Düzenlenen dosyanın path'i, session'ın başladığı git repository'sinin köküne göre yazılır. Örneğin `apps/web` içinde açılan bir session, `apps/api` altındaki bir dosyayı `apps/api/x.ts` olarak yazar. Git repository'si dışında path, session dizinine göre yazılır. Bu kök dizin de session başında bir kez okunur.

   | Biçim | Örnek path | Key'ler |
   |---|---|---|
   | JSON (i18next, vue-i18n, Laravel) | `locales/tr.json`, `locales/tr/checkout.json`, `lang/tr.json` | iç içe key'ler noktalı path olarak; `item_one`, `item` key'ini de tanımlar |
   | PHP array (Laravel) | `lang/tr/messages.php` | `messages.key`, iç içe array'ler noktalı path olarak |
   | YAML (Rails, Symfony) | `config/locales/tr.yml`, `translations/messages.tr.yaml` | noktalı path'ler; Rails'in en üst key'i (`tr:`) dahil edilmez |
   | gettext | `locale/tr/LC_MESSAGES/django.po` | her `msgid` |

   Dil, bir dizin adından (`tr/`, `en-US/`) ya da dosya adından (`tr.json`, `messages.tr.yaml`) alınır. Bir namespace dosyasındaki bir key, `ns.key` ve `ns:key` olarak da sayılır.
4. Bir dilde olmayan ya da hiçbir dilde olmayan bir key eksik sayılır. Her key, çağrıldığı satırla birlikte yazılır. Böylece satırı doğrudan açabilirsiniz. Model, Edit çağrısının sonucundan sonra şu notu okur:

       i18n-watch: this edit uses translation keys the locale files lack: checkout.total:42 (missing in tr, de) · checkout.vat:58 (missing in every locale). Add them to each locale file.

   En fazla 10 key adıyla yazılır, geri kalanı sayı olarak verilir. Yalnız bu düzenlemenin eklediği key'ler bildirilir. Daha önce bildirilmiş bir key bulguda kalır, ancak yeniden bildirilmez.
5. Aynı anda transcript'e tek bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır talimat içermez, yalnız dosyayı ve key'lerini içerir. Dosyanın adı yazılır, çünkü düzenlemeyi model gördü, siz görmediniz:

       i18n-watch: keys src/Cart.vue uses that the locale files lack: checkout.total:42 (missing in tr, de) · checkout.vat:58 (missing in every locale)

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz.
6. [sidebar](../sidebar) açıksa bu key'ler transcript yerine sidebar'ın stream'ine bir kayıt olarak yazılır: önce dosya, ardından her key için bir satır. Key kırmızı, satır numarası soluk, `every locale` kırmızı, birkaç locale'den oluşan bir liste sarı renktedir. Transcript temiz kalır. Kayıt, yeni kayıtlar onu pane'den çıkarana kadar görünür. Sidebar kapalıysa ya da yüklü değilse satır yukarıdaki gibi transcript'e yazılır.

7. Mod bulguyu bellekteki eski bir cevaba göre tutmaz. Bulgudaki key'ler yalnız bir iddiadır. Her ölçüm kaynak dosyayı diskten yeniden okur ve dosyanın artık çağırmadığı key'leri bulgudan çıkarır. Ölçüm her Edit ve Write çağrısından sonra, her ana loop turn'ünün sonunda ve korunan bir git komutundan önce yapılır. Bulgu iki yoldan kapanır:

   - Her locale dosyası key'leri içerir.
   - Kod key'leri artık çağırmaz, çünkü düzenleme metni silmiş, başka bir metinle değiştirmiş ya da başka bir dosyaya taşımıştır. Artık yerinde olmayan bir dosyanın bulgusu da kapanır.

   Kayıt silinir ve yeşil yeni bir kayıt bu iki yoldan hangisinin gerçekleştiğini bildirir:

       i18n-watch: every locale now has the keys src/Cart.vue lacked: checkout.total · checkout.vat
       i18n-watch: index.php no longer uses: Unauthorized Access

   Sidebar kapalıysa aynı metin transcript'e tek bir satır olarak yazılır. Model bunların hiçbirini okumaz, çünkü bulgu modelin kendi yaptığı işle kapanmıştır. Bir not, modelin az önce yaptığı işi yalnız tekrarlardı. Yerinde duran ancak okunamayan bir dosyanın bulgusu açık kalır, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz.

8. Modelin kapatmadığı bir bulgu, her ana loop turn'ünün sonunda yeniden ölçülür. Hâlâ açık olan bulgular, bir sonraki prompt'unuzla birlikte modele tek bir not olarak gönderilir:

       i18n-watch: 1 file(s) still use translation keys the locale files lack: index.php (Unauthorized Access:42). Add the keys to every locale file, or take the calls out.

   Bu not her turn için bir kez gönderilir, her prompt için değil. Bu not olmasaydı model bulguyu yalnız düzenleme anında bir kez duyar ve ardından unuturdu. Bulgu da pane'de kalırdı. Size yeni bir satır gösterilmez, çünkü pane aynı bulguyu zaten gösterir.

9. `deny` modunda bir dosya, locale dosyalarında olmayan key'leri kullandığı sürece mod `git commit`, `git push` ve `git merge` komutlarını da durdurur. `--dry-run`, `--help` ya da `-h` içeren bir komut durdurulmaz. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`). Commit açık dosyaların hiçbirini içermiyorsa çalışır ve kaç bulgunun hâlâ açık olduğu size tek bir satırla bildirilir. `push` ve `merge` için okunacak bir index yoktur. Bu yüzden bu komutlarda bütün bulgular geçerlidir. Gate'i atlamanın bir yolu yoktur. Gate'i yalnız siz `/i18n-watch mode note` ile kapatabilirsiniz. Varsayılan mod `note` modudur ve hiçbir işlemi durdurmaz. Ancak bu mod da bir git komutunda bulguları ölçer. Böylece çözülmüş bir bulgu pane'de kalmaz.

Locale dosyaları, bir turn'de bu dosyalara ihtiyaç duyan ilk düzenlemede okunur. Bir locale dosyasında yapılan bir Edit ya da Write çağrısından sonra da yeniden okunur. Bu dizinleri olmayan bir projede hiçbir şey yapılmaz. Okunamayan ya da parse edilemeyen bir locale dosyası atlanır ve her session'da bir kez log'a yazılır.

Canlı denemede `locales/en.json` ve `locales/tr.json` dosyaları olan bir proje kullanıldı. Model bir dosyaya `t('cart.total')` ekledi, Edit çağrısından sonra notu okudu ve kelimesi kelimesine aktardı.

## Komut

    /i18n-watch                 açık mı kapalı mı, mod ve hâlâ key'i eksik olan dosyalar
    /i18n-watch on | off        varsayılan açık
    /i18n-watch mode note       yalnız not verir; varsayılan
    /i18n-watch mode deny       bir key eksik kaldığı sürece commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install i18n-watch@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=i18n-watch}, turn.start, tool.call{tool=Bash}, turn.complete, prompt.submit, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isDir, usedNow), $.fs.list (via walkLocales), $.fs.read (via loadCatalog, usedNow), $.fs.stat (via isDir), $.process.run (via shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via catalogOf, gate, toPerson)

Reach L2: index'i okumak için git çalıştırır.

    1. Okur:         her Edit ve Write çağrısının metnini; Bash komutunun metnini; bildirilen her kaynak dosyayı yeniden; session dizini altındaki locale dizinlerini ve dosyalarını
    2. Çalıştırır:   dosyaları repository köküne göre yazmak için session başında bir kez git rev-parse --show-toplevel; deny modunda korunan bir komutta, commit'in hangi dosyaları içerdiğini okumak için git rev-parse --show-toplevel ve git diff --cached --name-only -z
    3. Gönderir:     eksik key kullanan bir düzenlemeden sonra modele bir not; bulgu açık kaldığı sürece bir sonraki prompt'la bir not daha; transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde; locale key'leri bir turn boyunca bellekte tutulur
    5. Düşman girdi: locale dosyaları yalnız veri olarak parse edilir (JSON.parse ve satır regex'leri), hiçbir zaman çalıştırılmaz; PHP dosyaları çalıştırılmaz

## Sınırlar

- Yalnız session dizini altındaki locale dizinleri okunur. Locale dosyaları `apps/web/src/locales` içinde bulunan bir monorepo'da, session repository kökünde başlarsa bu dosyalar okunmaz.
- Laravel PHP dosyası çalıştırılmaz, satır satır okunur. Bu yüzden tek satırda açılıp kapanan bir array, hesaplanan bir key ve `include` ile eklenen bir array fark edilmez.
- YAML girintiye göre okunur. Anchor'lar, alias'lar ve flow mapping'ler (`{a: b}`) izlenmez.
- Çalışma anında oluşturulan bir key (`t(name)`, `` t(`a.${b}`) ``) kontrol edilmez.
- Dil kodu iki harftir ve isteğe bağlı olarak bir bölge ya da yazı sistemi içerebilir (`tr`, `pt_BR`, `zh-Hant`). `fil` gibi üç harfli bir kod tanınmaz.
- Düzenlemenin yalnız yerini değiştirdiği bir key (`old_string` içinde de olan bir key) kontrol edilmez. Bash ile yapılan bir düzenleme de kontrol edilmez.
- `deny` modunu atlamanın bir yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/i18n-watch mode note` ile siz kapatırsınız.
- Gate komutun metnini okur. `git commit` komutunu gizleyen bir script ya da alias ile yapılan bir commit durdurulmaz.
- `git commit -a`, `-am` ve `--` işaretinden sonra pathspec verilen commit'ler index'e göre daraltılmaz, çünkü bu komutlar index'te henüz olmayan dosyaları da commit eder. Bu commit'lerde açık bulguların hepsi geçerlidir.
- Index, komut çalışmadan önce okunur. Dosyaları bu okuma ile komutun çalışması arasında değişen bir commit (örneğin bu sırada başka bir process'in dosya stage'lemesi), okuma anındaki index'e göre ölçülür.
- Bulguyu dosyanın yaptığı çağrılar kapatır, locale dosyalarının durumu değil. Kodun artık çağırmadığı bir key, locale dosyalarında hâlâ eksik olsa da bulgudan çıkarılır, çünkü artık hiçbir kod onu çağırmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
