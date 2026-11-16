# context-restore

Session'ın ortasında bir skill'i, bir komutu ya da bir rules dosyasını düzeltirsiniz ve yeniden çağırırsınız. Ancak model hâlâ eski metne göre davranır. Claude Code bu dosyaları bir kez yükler ve session'ın geri kalanında hep bu ilk kopyayı kullanır. Bu mod, böyle bir dosyanın diskte değiştiğini fark eder ve modelin güncel metni almasını sağlar.

## Ne yapar

Claude Code 2.1.280 üzerinde ölçüldü:

- Engine her skill'i ve komutu bir kez yükler. Dosya diskte değişse bile her çağrıda bu kopyayı kullanır. Elle yazılan bir `/ad` eski metni gönderir. Skill tool çağrısı da `Skill /<name> is already loaded above; instructions unchanged.` cevabını döndürür.
- Compaction'ın kestiği bir skill'i engine, skill yeniden çağrıldığında (elle yazılarak ya da Skill tool'uyla) kendisi baştan gönderir. Mod bu durumda bir şey yapmaz.
- İki prompt arasında değişen bir rules dosyası ya da global `~/.claude/CLAUDE.md` dosyası, bir compaction olana kadar modele ulaşmaz.
- Bir skill'in diğer dosyaları (`subcommands/*.md`, `references/*.md`) engine'in kopyasına hiç girmez. Model bu dosyaları Read tool'uyla okur. Session'da daha önce okunan kopya, dosya değiştikten sonra da context'te kalır.

Bu yüzden mod üç iş yapar:

1. Bir skill ya da komut her çağrıldığında (`/ad` olarak yazıldığında, Skill tool'uyla çağrıldığında ya da bir subagent'a önceden yüklendiğinde) mod, metnin geldiği dosyayı okur. Bir skill dizinini ilk satırında bildirir (`Base directory for this skill: <dizin>`). Bu yüzden skill'in dosyası `<dizin>/SKILL.md` dosyasıdır. Bir komutun dosyası aranır: `<plugin>:<ad>` için plugin'in `commands/<ad>.md` dosyası, diğer durumlarda projenin ya da sizin `commands/<ad>.md` dosyanız. Yerleşik bir komutun dosyası yoktur.
   - Placeholder içermeyen bir dosya engine'in metniyle karşılaştırılır. Metinler farklıysa dosyanın metni engine'in kopyasının yerine geçer. Engine'in metnin arkasına eklediği argümanlar (`ARGUMENTS: ...`) yerinde kalır. Bu durumda model, Skill tool çağrısında da yeni metni alır.
   - Tek placeholder'ı `$ARGUMENTS` olan bir dosya kalıp olarak karşılaştırılır: diğer bütün kısımlar kelimesi kelimesine karşılaştırılır, her `$ARGUMENTS` ise herhangi bir metinle eşleşir. Engine'in metni kalıba uymazsa engine'in doldurduğu metin yerinde kalır ve arkasından dosyanın güncel metni gelir. Yanında, bu metnin yukarıdaki talimatların yerine geçtiğini ve yukarıdaki argümanların hâlâ geçerli olduğunu bildiren bir not bulunur.
   - Başka bir placeholder (`$1`, `${...}`, `` !`...` ``) içeren dosya karşılaştırılamaz, çünkü engine bu placeholder'ları doldurmuştur. Dosya session başladıktan sonra yazıldıysa aynı not metnin arkasından gelir.
   - Yeniden çağrılmayan bir skill ya da komut yeniden gönderilmez.
2. Mod, `instructions` attachment'ının içerdiği her rules dosyasını kaydeder. Her dosya `Contents of <path> (` ile başlar ve path'inde `/rules/` geçen dosyalar sayılır. Global `CLAUDE.md` dosyası ve bu dosyanın `@` ile bağladığı her dosya da kaydedilir: `~/.claude` altındaki ya da `CLAUDE_CONFIG_DIR` tanımlıysa onun altındaki her dosya. Yalnız path'inde `..` geçmeyen markdown dosyaları sayılır, çünkü attachment'taki bir dosyanın metni böyle bir başlığa benzeyen bir satır içerebilir. Projenin `CLAUDE.md` dosyası ve bu dosyanın bağladığı dosyalar sayılmaz. Gönderdiğiniz her prompt ile birlikte, session okuduğundan beri metni değişen bir rules dosyası modele, yalnız modelin okuduğu bir not olarak gönderilir: dosyanın adı ve eski metnin yerine geçen güncel metin. Aynı metinle yeniden kaydedilen bir dosya için hiçbir şey gönderilmez. Her değişiklik yalnız bir kez gönderilir.
3. Mod, ana loop'un Read tool'uyla okuduğu her dosyayı son yazılma zamanıyla kaydeder. Subagent'ların okudukları kendi context'lerinde kalır, bu yüzden kaydedilmez. Bir skill her çağrıldığında, o skill'in dizininden modelin okuduğu ve o zamandan beri yeniden yazılan dosyalar, çağrının metninin sonunda tek bir satırla modele bildirilir. Satır dosyaların adlarını verir ve modelden onları yeniden okumasını ister. Dosyaların metni gönderilmez. Satır, model dosyayı yeniden okuyana kadar her çağrıda gelir. Claude Code 2.1.282 üzerinde, metni her çağrıda `sub/a.md` dosyasının okunmasını isteyen bir skill ile ölçüldü: model değişen dosyayı hem satır varken hem de satır yokken yeniden okudu. Bu yüzden bu satır, her çağrıda dosyanın yeniden okunmasını istemeyen bir skill için önemlidir.

Her olay için [sidebar](../sidebar) stream'inde, sidebar kapalıysa transcript'te tek bir satır görürsünüz. Baştaki kısım soluk, dosya adları varsayılan renktedir. Modelin yeniden okuması gereken dosyaların adları sarı renktedir:

    context-restore: changed on disk, the call got the current text: commit
    context-restore: changed on disk, the new text went to the model: context7.md
    context-restore: changed on disk since the model read it, the call asks to read again: subcommands/ssrf.md (bug-report)

`/context-restore` ayarı, kaç rules dosyasının izlendiğini ve son olayı yazar.

## Komut

    /context-restore            ayar, izlenen dosyalar ve son olay
    /context-restore on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install context-restore@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Olay satırlarını sidebar'da görmek için [sidebar](../sidebar) modunu yükleyin. Sidebar yüklü değilse satırlar transcript'e yazılır.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=context-restore}, skill.prompt, tool.call{tool=Read}, prompt.attachment{type=instructions}, prompt.submit
    ❯ ./register.ts calls: $.clock.now, $.command.register, $.env.get, $.fs.exists (via commandFileOf, mtimeOf, pluginDirs), $.fs.read (via changedRules, pluginDirs, readBody, recordRules), $.fs.stat (via mtimeOf), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via setEnabled), $.ui.log
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1: dosya okur.

    1. Okur:         session'ın çağırdığı her skill'in ve komutun dosyasını ve son yazılma zamanını; session'ın okuduğu rules dosyalarını, global CLAUDE.md'yi ve onun bağladığı dosyaları, son yazılma zamanlarıyla; modelin Read tool'uyla okuduğu her dosyanın son yazılma zamanını; bir plugin'in komut dosyasını bulmak için host'un installed_plugins.json dosyasını
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     modele: dosyası değişmiş olarak çağrılan bir skill'in ya da komutun güncel metnini; okunmuş bir rules dosyasının, global CLAUDE.md'nin ya da onun bağladığı bir dosyanın diskte değişen metninin tamamını; çağrılan bir skill'in, model okuduktan sonra değişen dosyalarının adlarını
    4. Saklar:       açık/kapalı ayarını $.store içinde; rules ve okuma kayıtları bellekte tutulur ve session ile birlikte silinir
    5. Düşman girdi: gönderilen her metin, session'ın zaten kullandığı bir dosyadır; düşmanca metin içeren bir skill ya da rules dosyası modele engine üzerinden de ulaşır; bir dosyanın metnindeki sahte bir `Contents of <path> (` başlığı, path'inde `..` geçen ya da markdown olmayan bir dosyayı izletemez

## Sınırlar

- `$ARGUMENTS` dışında placeholder içeren bir dosyanın değişip değişmediği, son yazılma zamanı session'ın başlangıç zamanıyla karşılaştırılarak belirlenir. `/reload-plugins` değişmemiş bir modülü başlangıç zamanıyla birlikte korur. Bu yüzden session ortasında güncellenip reload edilen bir plugin, böyle bir dosyanın her çağrısında değişmiş görünür.
- `$ARGUMENTS` kalıbı gevşek eşleşir. `Old $ARGUMENTS` metninden `$ARGUMENTS` metnine değişen bir dosya, engine'in her metnine uyar. Bu yüzden bu değişiklik fark edilmez.
- Placeholder içeren bir dosyanın güncel metni, engine'in metninden sonra ve placeholder'lar doldurulmadan gönderilir.
- Dosyası, modun baktığı iki yerde de olmayan bir komut (bir `--plugin-dir` plugin'i ya da `commands/` altındaki bir alt dizinde bulunan bir komut) engine'in metnini korur.
- Değişen bir rules dosyası modele, yazıldığı anda değil, bir sonraki prompt'unuzla ulaşır. Değişiklik ile bir sonraki prompt arasında bir compaction olursa engine dosyayı zaten gönderir.
- `/reload-plugins`, engine'in instruction dosyalarını yeni metinleriyle yeniden göndermesine neden olur. Yeniden yüklenen modül de bu metni başlangıç metni olarak alır. Bu yüzden bir düzenlemeden sonra reload yapıldıysa mod hiçbir şey göndermez, çünkü engine metni zaten göndermiştir. Mod, arada reload ya da yeniden başlatma olmayan bir düzenleme için işe yarar.
- Projenin CLAUDE.md dosyası izlenmez. Yalnız global CLAUDE.md ve bu dosyanın `~/.claude` altında bağladığı dosyalar izlenir. Global CLAUDE.md'nin `~/.claude` dışından ya da session başladıktan sonra bağladığı bir dosya izlenmez.
- Global CLAUDE.md her değişiklikte modele tamamıyla gönderilir. 21 KB'lık bir dosya için bu yaklaşık 5k token'dır.
- Modelin okuduğu ve sonra değişen bir skill dosyası, yalnız skill'in bir sonraki çağrısında bildirilir, iki çağrı arasında bildirilmez. `skill.prompt`, skill'i hangi loop'un çağırdığını bildirmez. Bu yüzden bir subagent'a önceden yüklenen bir skill, yalnız ana loop'un okuduğu bir dosya için de bu satırı alabilir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
