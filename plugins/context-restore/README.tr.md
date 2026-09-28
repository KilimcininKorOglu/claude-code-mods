# context-restore

Session'ın ortasında bir skill'i, bir komutu ya da bir rules dosyasını düzeltiyorsun, yeniden çağırıyorsun ve model hâlâ eski metne göre davranıyor. Claude Code bu dosyaları bir kez yükler ve session'ın geri kalanında hep o ilk kopyayı verir. Bu mod böyle bir dosyanın diskte değiştiğini fark eder ve modelin güncel metni almasını sağlar.

## Ne yapar

Claude Code 2.1.280 üzerinde ölçüldü:

- Engine her skill'i ve komutu bir kez yükler ve dosya diskte değişse bile her çağrıda o kopyayı verir. Yazılan bir `/ad` eski metni gönderir, Skill tool çağrısı da `Skill /<name> is already loaded above; instructions unchanged.` cevabını döner.
- Compaction'ın kestiği bir skill'i engine, yeniden çağrıldığında (yazılarak ya da Skill tool'uyla) kendisi baştan gönderir. Mod bu durumda bir şey yapmaz.
- İki prompt arasında değişen bir rules dosyası ya da global `~/.claude/CLAUDE.md`, bir compaction olana kadar modele ulaşmaz.
- Bir skill'in diğer dosyaları (`subcommands/*.md`, `references/*.md`) engine'in kopyasına hiç girmez; model onları Read tool'uyla okur. Session'da daha önce okuduğu kopya, dosya değiştikten sonra da context'te kalır.

Bu yüzden mod üç şey yapar:

1. Bir skill ya da komut her çağrıldığında (`/ad` olarak yazılınca, Skill tool'uyla çağrılınca ya da bir subagent'a önceden yüklenince) metnin geldiği dosyayı okur. Skill, dizinini ilk satırında söyler (`Base directory for this skill: <dizin>`), yani dosyası `<dizin>/SKILL.md`'dir. Komutun dosyası aranır: `<plugin>:<ad>` için plugin'in `commands/<ad>.md` dosyası, değilse projenin ya da senin `commands/<ad>.md` dosyan. Yerleşik bir komutun dosyası yoktur.
   - Placeholder içermeyen bir dosya engine'in metniyle karşılaştırılır. Farklıysa dosyanın metni engine'in kopyasının yerine geçer; engine'in arkasına eklediği argümanlar (`ARGUMENTS: ...`) yerinde kalır. Model artık yeni metni alır, Skill tool çağrısında da.
   - Tek placeholder'ı `$ARGUMENTS` olan bir dosya kalıp olarak karşılaştırılır: diğer her kısım kelimesi kelimesine, her `$ARGUMENTS` herhangi bir metinle eşleşir. Engine'in metni kalıba uymazsa engine'in doldurduğu metin kalır ve arkasından dosyanın güncel metni gelir; yanında bunun yukarıdaki talimatların yerine geçtiğini ve yukarıdaki argümanların hâlâ geçerli olduğunu söyleyen bir not bulunur.
   - Başka bir placeholder (`$1`, `${...}`, `` !`...` ``) içeren dosya karşılaştırılamaz, çünkü engine onu doldurmuştur. Dosya session başladıktan sonra yazıldıysa aynı not arkasından gelir.
   - Yeniden çağrılmayan bir skill ya da komut yeniden gönderilmez.
2. `instructions` attachment'ının taşıdığı her rules dosyasını (her biri `Contents of <yol> (` ile başlar ve yalnız içinde `/rules/` geçen yollar sayılır) ve global `CLAUDE.md`'yi (`~/.claude/CLAUDE.md`, `CLAUDE_CONFIG_DIR` ayarlıysa onun altında) kaydeder. Projenin `CLAUDE.md`'si sayılmaz. Gönderdiğin her prompt'la birlikte, session okuduğundan beri metni değişen bir rules dosyası modele yalnız onun okuduğu bir not olarak gider: dosya ve eskisinin yerine geçen güncel metni. Aynı metinle yeniden kaydedilen bir dosya hiçbir şey göndermez ve her değişiklik bir kez gönderilir.
3. Ana loop'un Read tool'uyla okuduğu her dosyayı son yazılma zamanıyla kaydeder. Subagent'ın okudukları kendi context'inde yaşar, onlar kaydedilmez. Bir skill her çağrıldığında, o skill'in dizininden modelin okuduğu ve o zamandan beri yeniden yazılan dosyalar, çağrının metninin sonunda tek bir satırla modele bildirilir: dosyaların adları ve onları yeniden okuması isteği; metinleri gönderilmez. Satır, model dosyayı yeniden okuyana kadar her çağrıda gelir. Claude Code 2.1.282'de, metni her çağrıda `sub/a.md`'sini okumasını isteyen bir skill'le ölçüldü: model değişen dosyayı hem satırla hem satır olmadan yeniden okudu. Yani bu satır, her çağrıda taze okuma istemeyen bir skill için önemlidir.

Her olay için [sidebar](../sidebar) stream'inde, sidebar kapalıysa transcript'te tek bir satır görürsün. Baştaki kısım soluk, dosya adları varsayılan renktedir; modelin yeniden okuması gereken dosyaların adları sarıdır:

    context-restore: changed on disk, the call got the current text: commit
    context-restore: changed on disk, the new text went to the model: context7.md
    context-restore: changed on disk since the model read it, the call asks to read again: subcommands/ssrf.md (bug-report)

`/context-restore` ayarı, kaç rules dosyasının izlendiğini ve son olayı yazar.

## Komut

    /context-restore            ayar, izlenenler ve son olay
    /context-restore on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install context-restore@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Olay satırlarını sidebar'da görmek istersen [sidebar](../sidebar) mod'unu kur. O olmadan satırlar transcript'e düşer.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=context-restore}, skill.prompt, tool.call{tool=Read}, prompt.attachment{type=instructions}, prompt.submit
    ❯ ./register.ts calls: $.clock.now, $.command.register, $.env.get, $.fs.exists (via commandFileOf, mtimeOf, pluginDirs), $.fs.read (via changedRules, pluginDirs, readBody, recordRules), $.fs.stat (via mtimeOf), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via setEnabled), $.ui.log
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1: dosya okur.

    1. Okur:     session'ın çağırdığı her skill'in ve komutun dosyasını ve son yazılma zamanını; session'ın okuduğu rules dosyalarını ve global CLAUDE.md'yi, son yazılma zamanlarıyla; modelin Read tool'uyla okuduğu her dosyanın son yazılma zamanını; bir plugin'in komut dosyasını bulmak için host'un installed_plugins.json dosyasını
    2. Çalıştırır: hiçbir şey
    3. Gönderir: modele, dosyası değişmiş olarak çağrılan bir skill'in ya da komutun güncel metnini ve okunmuş bir rules dosyasının ya da diskte değişen global CLAUDE.md'nin bütün metnini; çağrılan bir skill'in, model okuduktan sonra değişen dosyalarının adlarını
    4. Saklar:   $.store içinde açık/kapalı ayarını; rules ve okuma kayıtları bellekte durur ve session'la biter
    5. Düşman girdi: gönderilen her metin, session'ın zaten kullandığı bir dosyadır; düşmanca metin içeren bir skill ya da rules dosyası modele engine üzerinden de ulaşır

## Sınırlar

- `$ARGUMENTS` dışında placeholder içeren bir dosyanın değişip değişmediğine, son yazılma zamanının session başlangıcıyla karşılaştırılmasıyla karar verilir. `/reload-plugins` değişmemiş bir modülü başlangıç zamanıyla birlikte korur; bu yüzden session ortasında güncellenip reload edilen bir plugin, böyle bir dosyanın her çağrısında değişmiş görünür.
- `$ARGUMENTS` kalıbı gevşek eşleşir: `Old $ARGUMENTS`'tan `$ARGUMENTS`'a değişen bir dosya engine'in her metnine uyar, bu yüzden o değişiklik fark edilmez.
- Placeholder içeren bir dosyanın güncel metni, engine'in metninden sonra ve placeholder'ları doldurulmadan gelir.
- Dosyası mod'un baktığı iki yerde de olmayan bir komut (bir `--plugin-dir` plugin'i, `commands/` altındaki bir alt dizinde duran komut) engine'in metnini korur.
- Değişen bir rules dosyası modele yazıldığı anda değil, bir sonraki prompt'unla ulaşır. Değişiklikle bir sonraki prompt arasında bir compaction olursa engine dosyayı zaten gönderir.
- `/reload-plugins` engine'in instruction dosyalarını yeni metinleriyle yeniden göndermesine yol açar, yeniden yüklenen modül de o metni başlangıç metni olarak alır. Yani bir düzenlemeden sonra reload yaptıysan mod hiçbir şey göndermez, çünkü engine göndermiştir; mod, arada reload ya da yeniden başlatma olmayan bir düzenleme için işe yarar.
- Projenin CLAUDE.md'si izlenmez, yalnız global olanı izlenir.
- Global CLAUDE.md her değişiklikte modele bütünüyle gider; 21 KB'lık bir dosya için yaklaşık 5k token.
- Modelin okuduğu ve sonra değişen bir skill dosyası yalnız skill'in bir sonraki çağrısında bildirilir, çağrılar arasında değil. `skill.prompt` skill'i hangi loop'un çağırdığını söylemez; bu yüzden bir subagent'a önceden yüklenen skill, yalnız ana loop'un okuduğu bir dosya için de satırı alabilir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
