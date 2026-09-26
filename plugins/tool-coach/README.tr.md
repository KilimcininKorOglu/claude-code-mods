# tool-coach

Model hata alan bir tool çağrısını aynı input ile tekrarlarsa bu Claude Code Mod'u çağrıyı durdurur. Bir dosya ya da bir komut bir şeyi değiştirene kadar çağrı yeniden çalışmaz. Model bunun yerine daha önce aldığı hatayı okur.

## Ne yapar

1. Mod her tool çağrısını hook'lar: yerleşik tool'lar, MCP tool'ları ve subagent'ların çağrıları. Bash dışarıda kalır, çünkü başarısız bir komut çoğu zaman haklı bir nedenle yeniden çalışır. Örneğin bir düzeltmeden sonra test yeniden çalıştırılır.
2. Sonucu hata olan bir çağrı hatasıyla birlikte saklanır. Bu, tool'un kendi bildirdiği hataları (`File does not exist`, `String to replace not found`, bir MCP hatası) ve engine'in reddettiği input'u (`InputValidationError`) kapsar.
3. Aynı tool ve aynı input ile gelen aynı çağrı çalışmaz. Model sonuç yerine şunu okur:

       this exact Read call failed a moment ago, and no file or command has changed anything since, so it would fail the same way. Its error was:
       File does not exist. Note: your current working directory is /w.
       Read the error, change the input, and call again.

   İki çağrının input'u aynı değerleri taşıyorsa, key'lerin sırası ne olursa olsun, bu iki çağrı aynıdır. `description` alanı yalnız çağrıyı etiketler, bu yüzden karşılaştırılmaz. Ana döngü ve her subagent kendi başarısız çağrılarını ayrı tutar.
4. Başka bir input ile gelen çağrı her zamanki gibi çalışır.
5. Başarılı bir Edit, Write, NotebookEdit ya da Bash çağrısı saklanan bütün çağrıları siler. Çünkü bu çağrı, başarısız çağrının ihtiyacını karşılamış olabilir: bir dosya artık vardır ya da bir komut bir sunucu başlatmıştır. Her yeni turn da kayıtları siler, çünkü siz bir şeyi elle değiştirmiş olabilirsiniz.
6. Aynı anda bir satır yazılır, böylece hangi çağrının reddedildiğini görürsünüz. [sidebar](../sidebar) açıksa satır onun stream'ine bir entry olarak girer: tool adı kırmızı, geri kalanı soluk. Sidebar kapalıysa satır transcript'e yazılır:

       tool-coach: Read call repeated after it failed, not run

Canlı kontrolde model var olmayan bir dosyayı okudu, sonra aynı Read çağrısını tekrar istedi. İkinci çağrı çalışmadı ve model daha önce aldığı hatayı raporladı. Bir Write dosyayı oluşturduktan sonra aynı Read çalıştı ve metni döndürdü. Başarısız bir Bash komutu, istendiği gibi yeniden çalıştı.

## Komut

    /tool-coach            açık ya da kapalı
    /tool-coach on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install tool-coach@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına şunu ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=tool-coach}, turn.start, tool.call
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L0, çizer ve hatırlar.

    1. Okur:        her tool çağrısının tool adını, input'unu ve sonucunu
    2. Çalıştırır:  hiçbir şey
    3. Gönderir:    başarısız bir çağrı aynen tekrarlanınca modele bir deny metni, sidebar'a ya da transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:      $.store içinde açık/kapalı ayarını; başarısız çağrılar bir değişikliğe ya da sonraki turn'e kadar bellekte durur
    5. Düşman girdi: bir çağrının input'u ve hatası yalnız karşılaştırılır ve modele geri alıntılanır, asla çalıştırılmaz ya da açılmaz

## Sınırlar

- Mod bir tool'un input schema'sını okuyamaz, bu yüzden ilk çağrıdan önce input'u kontrol etmez. Engine schema'yı kendisi kontrol eder ve `InputValidationError` döndürür. Mod tekrarı durdurur.
- Modun görmediği bir değişiklik, örneğin başka bir programın yazdığı bir dosya, saklanan çağrıları silmez. Sonraki turn siler.
- Başarısız bir çağrı, dosya ya da komut dışındaki bir nedenle aynı input ile sonradan başarılı olabilir. Örneğin bir MCP sunucusu yeniden bağlanmıştır. Model bu durumda başka bir input kullanmalı ya da sonraki turn'ü beklemelidir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, üstünde build başarısız olur
    make typecheck   # /plugin-types çıktısı .claude/types/ gerekir
    make validate
    make test        # claude plugin test
