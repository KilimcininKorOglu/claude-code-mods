# tool-coach

Var olmayan bir dosyayı okuyan bir Read çağrısı başarısız olur. Model ardından aynı Read çağrısını tekrar tekrar yapar. Her tekrar bir isteğe mal olur ve aynı hatayı getirir. Bu mod, modelin az önce başarısız olan bir tool çağrısını aynı input ile tekrarlamasını engeller. Bir dosya ya da bir komut bir şeyi değiştirene kadar çağrı yeniden çalıştırılmaz. Model bunun yerine daha önce aldığı hatayı okur.

## Ne yapar

1. Mod her tool çağrısını izler: yerleşik tool'lar, MCP tool'ları ve subagent'ların çağrıları. Bash bu kapsamın dışındadır, çünkü başarısız bir komutun yeniden çalıştırılması çoğu zaman doğru bir adımdır. Örnek: bir düzeltmeden sonra testin yeniden çalıştırılması.
2. Sonucu hata olan bir çağrı, hatasıyla birlikte saklanır. Bu kapsamda tool'un kendi bildirdiği hatalar (`File does not exist`, `String to replace not found`, bir MCP hatası) ve engine'in reddettiği input'lar (`InputValidationError`) vardır.
3. Aynı tool ve aynı input ile gelen tekrar çağrı çalıştırılmaz. Model sonuç yerine şu metni okur:

       this exact Read call failed a moment ago, and no file or command has changed anything since, so it would fail the same way. Its error was:
       File does not exist. Note: your current working directory is /w.
       Read the error, change the input, and call again.

   Metindeki hata, modelin daha önce okuduğu hatadır ve 300 karakterde kesilir. İki çağrının input'u, key sırası ne olursa olsun aynı değerleri taşıyorsa iki çağrı aynı sayılır. `description` alanı yalnız çağrıyı etiketler, bu yüzden karşılaştırmaya katılmaz. Ana loop ve her subagent kendi başarısız çağrılarını ayrı tutar.
4. Farklı bir input ile gelen çağrı her zamanki gibi çalışır.
5. Başarılı bir Edit, Write, NotebookEdit ya da Bash çağrısı saklanan bütün çağrıları siler. Bunun nedeni, bu çağrının başarısız çağrının ihtiyacını karşılamış olabilmesidir: bir dosya artık vardır ya da bir komut bir sunucu başlatmıştır. Her yeni turn da saklanan çağrıları siler, çünkü bir şeyi elle değiştirmiş olabilirsiniz. `/tool-coach on` ve `off` da bunları siler.
6. Aynı anda bir satır yazılır. Bu sayede hangi çağrının reddedildiğini görürsünüz. [sidebar](../sidebar) açıksa satır sidebar'ın stream'ine bir kayıt olarak yazılır: tool adı kırmızı, satırın geri kalanı soluk renktedir. Sidebar kapalıysa satır transcript'e yazılır:

       tool-coach: Read call repeated after it failed, not run

Canlı denemede model var olmayan bir dosyayı okumaya çalıştı ve ardından aynı Read çağrısını tekrarladı. İkinci çağrı çalıştırılmadı ve model daha önce aldığı hatayı bildirdi. Bir Write çağrısı dosyayı oluşturduktan sonra aynı Read çalıştı ve dosyanın metnini döndürdü. Başarısız bir Bash komutu istendiği gibi yeniden çalıştı.

## Komut

    /tool-coach            açık mı kapalı mı
    /tool-coach on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install tool-coach@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=tool-coach}, turn.start, tool.call
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L0: yalnız ekrana yazar ve bellekte tutar.

    1. Okur:         her tool çağrısının tool adını, input'unu ve sonucunu
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     başarısız bir çağrı aynen tekrarlandığında modele bir deny metni; sidebar'a ya da transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını $.store içinde; başarısız çağrılar bir değişikliğe ya da sonraki turn'e kadar bellekte durur
    5. Düşman girdi: bir çağrının input'u ve hatası yalnız karşılaştırılır ve modele alıntı olarak geri verilir; hiçbir zaman çalıştırılmaz ya da açılmaz

## Sınırlar

- Mod bir tool'un input schema'sını okuyamaz, bu yüzden ilk çağrıdan önce input'u kontrol etmez. Schema'yı engine kendisi kontrol eder ve `InputValidationError` döndürür. Mod yalnız tekrarı engeller.
- Modun görmediği bir değişiklik, örneğin başka bir programın yazdığı bir dosya, saklanan çağrıları silmez. Saklanan çağrılar sonraki turn'de silinir.
- Başarısız bir çağrı, dosya ya da komut dışındaki bir nedenle aynı input ile sonradan başarılı olabilir. Örnek: yeniden bağlanan bir MCP sunucusu. Bu durumda modelin farklı bir input kullanması ya da sonraki turn'ü beklemesi gerekir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
