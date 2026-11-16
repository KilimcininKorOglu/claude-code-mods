# council

Bazı sorunlar bir deneme daha yapmakla çözülmez: aynı hata her düzeltmeden sonra yine çıkar ya da iki tasarımın ikisi de doğru görünür. Böyle durumlarda ikinci bir görüş yardımcı olur. Birbirinden bağımsız birkaç görüş daha da çok yardımcı olur. Bu mod sorunu bir model kuruluna sorar. Kurulun her üyesi aynı soruyu kendi başına cevaplar. Session'ın kendi modeli de başkan olarak bu cevaplardan tek bir karar çıkarır. Model takıldığında kurulu bir tool ile çağırır. Siz de kurulu `/council <soru>` ile kendiniz toplayabilirsiniz.

## Ne yapar

1. Üyeler Opus 5.5, Sonnet 5.5, Fable 5.2 ve Haiku 5.5'tir. [gemini-core](../gemini-core) yüklüyse ve bir key'i varsa `gemini-3.8-flash` da üyelere katılır. gemini-core yoksa ya da key'i yoksa Gemini üyeleri atlanır ve sonuç bunun nedenini bildirir. Üye listesi `/council members` ile değiştirilir.
2. Bütün üyelere aynı anda sorulur:
   - Session'ın kendi modeliyle çalışan üye, session'ı `$.model.fork` ile fork'lar. Böylece bütün konuşmayı prompt cache'ten okur.
   - Diğer her Claude üyesi konuşmayı `$.model.complete` ile, `high` effort'ta metin olarak alır. Konuşma 400.000 karakteri aşarsa önce en uzun tool çıktıları kısaltılır, ardından en eski mesajlar dışarıda bırakılır. `/council members` ile seçilen Haiku 4.5 en fazla 560.000 karakter okur, çünkü context window'u 200k token'dır. Haiku 5.5'in context window'u diğer üyeler gibi 1M token'dır.
   - Bir Gemini üyesi aynı metni, key'i, tier'ı ve thinking seviyesini tutan gemini-core üzerinden alır. Her istek kendi modelini belirttiği için gemini-core 0.3.0 ya da sonrası gerekir.
3. Başkan da session'ı fork'lar. Cevapları model adlarıyla değil, harflerle (`Member A`, `Member B`) okur. Üyelerin nerede anlaştığını, nerede ayrıldığını ve konuşmanın hangi tarafı desteklediğini yazar. Üyelerin gözden kaçırdıklarını ve bir sonraki adımı da yazar.
4. Çağıran, kararı ve her cevabı okur. Her cevabın başında harfi, modeli ve süresi yazar. Başarısız olan bir üye, nedeniyle birlikte belirtilir. Hiçbir üye cevap vermezse çağrı bütün nedenlerle birlikte reddedilir ve başkan çalışmaz.
5. Bir subagent'ın çağrısı konuşmayı göndermez, çünkü fork ve `$.session.messages()` ana thread'i okur. Bu durumda her üye ve başkan yalnız soruyu, completion olarak alır.

## Model kurulu ne zaman çağırır

Tool'un adı `mcp__council__convene`'dir ve tek bir `question` girdisi alır. Tool, ToolSearch ile yüklenmesi gerekmeden listelenir. System prompt'taki bir not da modele tool'u ne zaman çağıracağını söyler:

- aynı hata, onu düzeltmek için yapılan iki denemeden sonra hâlâ devam ediyorsa;
- araştırmaya rağmen kök neden hâlâ belirsizse;
- ikisinin de gerçek artıları ve eksileri olan iki tasarım arasında seçim yapması gerekiyorsa;
- geri alınması zor bir değişiklikten önce.

Not session başında ve `/clear` sırasında sabitlenir. Bu yüzden `/council on`, tool'u modele hemen verir, notu ise bir sonraki session'dan itibaren verir. Modelin tool'u kaç kez çağırabileceğine bir sınır yoktur. Ayar bütün pencereler için ortaktır. Başka bir pencerede çalıştırılan `/council on`, bu penceredeki modele tool'u bir sonraki turn'ünde, notu ise bir sonraki `/clear` ya da session'da verir. Başka bir pencerede çalıştırılan `/council off` ise bu penceredeki tool'un çağrıları hemen reddetmesine neden olur.

## Ne görürsünüz

[sidebar](../sidebar) açıksa koşuyu kalıcı bir section izler. Section önce soruyu ve koşunun ne kadar sürdüğünü gösterir. Ardından her üyeyi durum kelimesiyle gösterir: `running` sarı, `answered` süresi ve token'larıyla yeşil, `failed` nedeniyle kırmızı. Sonra başkanı, en sonda da kararın ilk kelimelerini gösterir. Her modelin adı ailesine göre renklidir: opus kırmızı, fable sarı, sonnet yeşil, haiku soluk, Gemini mavi.

    council: run
    avg.js boş dizi için ne dönmeli: NaN, 0, yoksa hata mı fırl… · done in 44s
    opus 5.5 · fork · answered 11s · 89k in, 902 out
    sonnet 5.5 · complete · answered 17s · 6.7k in, 1.1k out
    fable 5.1 · complete · answered 24s · 6.7k in, 1.4k out
    haiku 4.5 · complete · answered 9s · 5.2k in, 634 out
    gemini-3.8-flash · gemini · answered 8s · 4.7k in, 1.3k out · free tier
    chair · opus 5.5 · fork · done 20s

Sidebar kapalıysa koşunun sonunda tek bir satır görürsünüz:

    council: 1 of 2 members answered in 4s; the chair wrote the verdict

## Komut

    /council                               açık mı kapalı mı, üyeler, başkan ve son koşu (/council status da olur)
    /council on | off                      modelin tool'a sahip olup olmadığı; varsayılan kapalı
    /council members                       üyeler
    /council members <model> ...           opus, sonnet, fable, haiku, bir claude- id'si, bir gemini- ya da gemma- id'si
    /council members reset                 varsayılan üyeler
    /council <soru>                        kurulu hemen toplar; mod kapalıyken de çalışır

`/council <soru>` hemen `convened: 5 members` cevabını verir. Üyeler ve başkan cevap verdiğinde mod kararı `/council:send` ile modele iletir. Model kararı sizin mesajınız olarak okur ve karardan ne çıkardığını size anlatır. O sırada çalışan bir turn varsa karar, turn bitene kadar bekler (2.1.283 üzerinde ölçüldü).

## Maliyet

Her koşu, her üye için bir ve başkan için bir istek gönderir. Claude Code 2.1.283 üzerinde ölçüldü:

- Beş varsayılan üyeli bir koşu 25 ile 44 saniye sürdü. Süreyi en yavaş üye belirler. Fork'lar 4 ile 11 saniye sürdü ve konuşmayı cache'ten okudu (kısa bir session'da 83k token).
- Varsayılan sınır olan 400.000 karakterlik konuşma, Opus 5.5, Sonnet 5 ve Fable 5.1'de 163.828, Haiku 4.5'te 128.018, gemini-3.8-flash'ta 120.057 input token'a karşılık gelir.

Milyon input token başına liste fiyatları Fable 5.2 için $8, Sonnet 5.5 için $2, Haiku 5.5 için $0,10'dur. Haiku 5.5, 100.000 token'ı aşan bir prompt'un tamamını $0,50'den faturalandırır. Yukarıdaki token sayıları önceki üyelerde ölçüldü. Fable 5.2 ve Haiku 5.5'in token sayıları ölçülmedi. Bu yüzden burada bir koşunun toplam dolar maliyeti verilmez. İki fork'un maliyeti cache okumasıdır. Daha kısa bir konuşmanın maliyeti orantılı olarak daha düşüktür. Bir Claude aboneliğinde bu istekler bunun yerine kullanım limitlerinizden düşer. Maliyeti azaltmak için `/council members` ile bir üyeyi çıkarın, örneğin `/council members opus sonnet haiku gemini-3.8-flash`.

`gemini-3.1-pro-preview`, denemedeki her free tier key'de HTTP 429 döndürdü, çünkü free tier'da bu model için kota yoktur. Bu modeli üyelere yalnız ücretli bir key ile ekleyin.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install council@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Modelin kurulu kendi başına çağırması için `/council on` komutunu çalıştırın. Mod yüklendikten sonra kapalıdır. `/council <soru>` iki durumda da çalışır.
3. Gemini üyeleri için gemini-core 0.3.0 ya da sonrasını yükleyin ve ona bir key verin (gemini-core'un README'sine bakın). council, gemini-core'a bağımlı değildir. gemini-core olmadan yalnız Claude üyeleriyle çalışır.

## Seçenekler

| Seçenek | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `400000` | Session'ı fork'lamayan her üyenin konuşmadan okuyacağı karakter sayısı; 20.000 ile 2.000.000 arası |

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, turn.start, classic.SessionStart, command.run{command=council}, prompt.section{name=env_info_simple}, tool.describe{tool=/"^mcp__council__convene$"/}, tool.call{tool=/"^mcp__council__convene$"/}, turn.step
    ❯ ./register.ts calls: $.clock.after (via runManual), $.clock.now (via askClaude, askGemini, askGeminiModel, convene, drawRun, ended, verdictOf), $.command.register, $.command.run (via send), $.gemini.enroll (via enrollGemini), $.gemini.read (via askGeminiModel), $.gemini.request (via askGeminiModel), $.gemini.settings (via geminiReach), $.http.fetch (via askGeminiModel), $.model.complete (via askChair, askClaude), $.model.fork (via askChair, askClaude), $.prompt.submit (via send), $.session.messages (via contextOf), $.sidebar.set (via drawRun), $.store.delete (via runCommand), $.store.get (via isEnabled, membersNow), $.store.set (via runCommand, storeEnabled), $.tool.register (via declareTool)
    ❯ ./register.ts calls: $.ui.log (via enrollGemini, runManual, send, toPerson)

Reach L3: her üye için bir, başkan için bir istek gönderir.

    1. Okur:         ana thread'in konuşmasını, soruyu ve ana loop'un her isteğinin modelini
    2. Çalıştırır:   hiçbir process
    3. Gönderir:     konuşmayı ve soruyu, her Claude üyesine Claude Code'un kendi API bağlantısı üzerinden, her Gemini üyesi için gemini-core üzerinden Google'a
    4. Saklar:       açık/kapalı ayarını ve üye listesini $.store içinde; bir koşu bellekte tutulur
    5. Düşman girdi: cevaplar modelin okuduğu metinlerdir ve hiçbir zaman çalıştırılmaz; bir üye id'si, Gemini URL'sine eklenmeden önce [a-z0-9.-] ile eşleşmek zorundadır; free tier bir Gemini key'i, gönderilen verilerin Google tarafından okunmasına izin verir

## Sınırlar

- Her üye yalnız kendisine gönderilen bilgiyle cevap verir. Session'ı fork'lamayan bir üye konuşmayı `maxInputChars` sınırında kesilmiş bir metin olarak okur. Bu yüzden kesilen kısmı kaçırabilir.
- Başkan session'ın modelinde çalışır ve kendi ailesinden gelen cevapları da değerlendirir. Harfler hangi cevabın hangi modelden geldiğini gizler, ancak cevapların içeriğini gizlemez.
- Bir üyenin ya da başkanın cevabı, thinking dahil 8.192 token ile sınırlıdır. 5 dakika içinde cevap vermeyen bir üye başarısız sayılır.
- Gemini HTTP 503 döndürdüğünde istek, gemini-core'un belirttiği bekleme yapılmadan hemen yeniden gönderilir, çünkü `$.clock.sleep` hook'un 10 saniyelik süre sınırından düşer (2.1.283 üzerinde ölçüldü). Art arda yapılan üç hızlı deneme aynı yoğunluğa takılabilir.
- 2.1.283 üzerinde ölçüldü: bir plugin tool çağrısı timeout olmadan 333 saniye sürdü. 2.1.277'de sınır 60 saniyeydi. Bu yüzden daha eski bir Claude Code yavaş bir koşuyu yarıda kesebilir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
