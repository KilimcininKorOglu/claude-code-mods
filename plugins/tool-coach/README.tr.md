# tool-coach

Var olmayan bir dosyanın Read'i başarısız olur, model aynı Read'i bir daha, bir daha ister: her tur bir isteğe mal olur ve aynı hatayı getirir. Bu mod, modelin az önce başarısız olan bir tool çağrısını aynı input ile tekrarlamasını durdurur. Bir dosya ya da bir komut bir şeyi değiştirene kadar çağrı yeniden çalışmaz; model bunun yerine daha önce aldığı hatayı okur.

## Ne yapar

1. Mod her tool çağrısını hook'lar: yerleşik tool'lar, MCP tool'ları ve subagent'ların çağrıları. Bash dışarıda kalır, çünkü başarısız bir komut çoğu zaman haklı bir nedenle yeniden çalışır; örneğin bir düzeltmeden sonraki test.
2. Sonucu hata olan bir çağrı hatasıyla birlikte saklanır. Bu, tool'un kendi bildirdiği hataları (`File does not exist`, `String to replace not found`, bir MCP hatası) ve engine'in reddettiği input'u (`InputValidationError`) kapsar.
3. Aynı tool ve aynı input ile gelen aynı çağrı çalışmaz. Model sonuç yerine şunu okur:

       this exact Read call failed a moment ago, and no file or command has changed anything since, so it would fail the same way. Its error was:
       File does not exist. Note: your current working directory is /w.
       Read the error, change the input, and call again.

   Hata, modelin okuduğu hatadır ve 300 karakterde kesilir. İki çağrının input'u, key'lerin sırası ne olursa olsun aynı değerleri taşıyorsa bu iki çağrı aynıdır. `description` alanı yalnız çağrıyı etiketler, bu yüzden karşılaştırılmaz. Ana loop ve her subagent kendi başarısız çağrılarını ayrı tutar.
4. Başka bir input ile gelen çağrı her zamanki gibi çalışır.
5. Başarılı bir Edit, Write, NotebookEdit ya da Bash çağrısı saklanan bütün çağrıları siler, çünkü başarısız çağrının ihtiyacını karşılamış olabilir: bir dosya artık vardır ya da bir komut bir sunucu başlatmıştır. Her yeni turn da onları siler, çünkü sen bir şeyi elle değiştirmiş olabilirsin; `/tool-coach on` ya da `off` da siler.
6. Aynı anda bir satır yazılır, böylece hangi çağrının reddedildiğini görürsün. [sidebar](../sidebar) açıksa satır onun stream'ine bir kayıt olarak gider: tool adı kırmızı, geri kalanı soluk. Sidebar kapalıysa satır transcript'e düşer:

       tool-coach: Read call repeated after it failed, not run

Canlı denemede model var olmayan bir dosyayı okudu, sonra aynı Read'i yeniden istedi. İkinci çağrı çalışmadı ve model daha önce aldığı hatayı bildirdi. Bir Write dosyayı oluşturduktan sonra aynı Read çalıştı ve metni döndürdü. Başarısız bir Bash komutu istendiği gibi yeniden çalıştı.

## Komut

    /tool-coach            açık mı kapalı mı
    /tool-coach on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install tool-coach@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=tool-coach}, turn.start, tool.call
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L0: çizer ve hatırlar.

    1. Okur:        her tool çağrısının tool adını, input'unu ve sonucunu
    2. Çalıştırır:  hiçbir şey
    3. Gönderir:    başarısız bir çağrı aynen tekrarlanınca modele bir deny metni, sidebar'a ya da transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:      $.store içinde açık/kapalı ayarını; başarısız çağrılar bir değişikliğe ya da sonraki turn'e kadar bellekte durur
    5. Düşman girdi: bir çağrının input'u ve hatası yalnız karşılaştırılır ve modele geri alıntılanır, asla çalıştırılmaz ya da açılmaz

## Sınırlar

- Mod bir tool'un input schema'sını okuyamaz, bu yüzden ilk çağrıdan önce input'u kontrol etmez. Schema'yı engine kendisi kontrol eder ve `InputValidationError` döner; mod tekrarı durdurur.
- Mod'un görmediği bir değişiklik, örneğin başka bir programın yazdığı bir dosya, saklanan çağrıları silmez. Sonraki turn siler.
- Başarısız bir çağrı, dosya ya da komut dışındaki bir nedenle aynı input ile sonradan başarılı olabilir; örneğin bir MCP sunucusu yeniden bağlanmıştır. Model o zaman başka bir input kullanmalı ya da sonraki turn'ü beklemelidir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
