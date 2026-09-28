# council

Bazı sorunlar bir deneme daha yapınca çözülmez: aynı hata her düzeltmeden sağ çıkar ya da iki tasarımın ikisi de doğru görünür. Böyle anlarda ikinci bir görüş işe yarar, birbirinden bağımsız birkaç görüş daha da çok işe yarar. Bu mod sorunu bir model kuruluna sorar: her üye aynı soruyu kendi başına cevaplar, session'ın kendi modeli de başkan olarak bu cevaplardan tek bir karar çıkarır. Model takıldığında bunu bir tool üzerinden çağırır; sen de `/council <soru>` ile kendin çalıştırabilirsin.

## Ne yapar

1. Üyeler Opus 5.5, Sonnet 5, Fable 5.1 ve Haiku 4.5'tir; [gemini-core](../gemini-core) kuruluysa ve bir key'i varsa `gemini-3.8-flash` da onlara katılır. gemini-core yoksa ya da key'i yoksa Gemini üyeleri atlanır ve sonuç nedenini söyler. Listeyi `/council members` değiştirir.
2. Üyelerin hepsine aynı anda sorulur:
   - Session'ın kendi modeliyle çalışan üye, session'ı `$.model.fork` ile fork'lar; böylece bütün konuşmayı prompt cache'ten okur.
   - Diğer her Claude üyesi konuşmayı `$.model.complete` üzerinden, `high` effort'ta metin olarak alır. 400.000 karakteri aşınca önce en uzun tool çıktıları kısaltılır, sonra en eski mesajlar dışarıda bırakılır. Haiku 4.5 en fazla 560.000 karakter okur, çünkü penceresi 200k token'dır.
   - Bir Gemini üyesi aynı metni key'i, tier'ı ve thinking seviyesini tutan gemini-core üzerinden alır. Her request kendi modelini söylediği için gemini-core 0.3.0 veya üstü gerekir.
3. Başkan da session'ı fork'lar. Cevapları model adlarıyla değil harflerle (`Member A`, `Member B`) okur; üyelerin nerede anlaştığını, nerede ayrıştığını ve konuşmanın hangi tarafı desteklediğini, neyi gözden kaçırdıklarını ve bir sonraki adımı yazar.
4. Çağıran, kararı ve her cevabı okur; her cevabın başında harfi, modeli ve süresi yazar. Başarısız olan üye nedeniyle birlikte anılır. Hiçbir üye cevap vermezse çağrı her nedenle birlikte reddedilir ve başkan çalışmaz.
5. Bir subagent'ın çağrısı konuşmayı göndermez, çünkü fork da `$.session.messages()` da ana thread'i okur. Bu durumda her üye ve başkan yalnız soruyu, completion olarak alır.

## Model onu ne zaman çağırır

Tool `mcp__council__convene`'dir ve tek bir `question` girdisi alır. ToolSearch'e gerek kalmadan listelenir; system prompt'taki bir not da modele onu ne zaman çağıracağını söyler:

- aynı hata onu düzeltmek için yapılan iki denemeden sağ çıktıysa;
- araştırmaya rağmen kök neden hâlâ belirsizse;
- ikisinin de gerçek artıları ve eksileri olan iki tasarım arasında seçim yapması gerekiyorsa;
- geri alınması zor bir değişiklikten önce.

Not session başında ve `/clear`'da sabitlenir; yani `/council on` tool'u modele hemen, notu ise bir sonraki session'dan itibaren verir. Modelin onu kaç kez çağırabileceğine bir sınır yoktur. Ayar bütün pencereler için ortaktır: başka bir penceredeki `/council on`, bu penceredeki modele tool'u bir sonraki turn'ünde, notu bir sonraki `/clear`'ında ya da session'ında verir; oradaki bir `/council off` ise tool'un burada hemen reddetmesine yol açar.

## Ne görürsün

[sidebar](../sidebar) açıksa koşuyu duran bir section izler: soru ve koşunun ne kadar sürdüğü, sonra her üye durum kelimesiyle (`running` sarı, `answered` süresi ve token'larıyla yeşil, `failed` nedeniyle kırmızı), ardından başkan, en sonda da kararın ilk kelimeleri. Her modelin adı ailesine göre renklenir: opus kırmızı, fable sarı, sonnet yeşil, haiku soluk, Gemini mavi.

    council: run
    avg.js boş dizi için ne dönmeli: NaN, 0, yoksa hata mı fırl… · done in 44s
    opus 5.5 · fork · answered 11s · 89k in, 902 out
    sonnet 5 · complete · answered 17s · 6.7k in, 1.1k out
    fable 5.1 · complete · answered 24s · 6.7k in, 1.4k out
    haiku 4.5 · complete · answered 9s · 5.2k in, 634 out
    gemini-3.8-flash · gemini · answered 8s · 4.7k in, 1.3k out · free tier
    chair · opus 5.5 · fork · done 20s

Sidebar kapalıysa sonda tek bir satır görürsün:

    council: 1 of 2 members answered in 4s; the chair wrote the verdict

## Komut

    /council                               açık mı kapalı mı, üyeler, başkan ve son koşu (/council status da olur)
    /council on | off                      modelin tool'a sahip olup olmadığı; varsayılan kapalı
    /council members                       üyeler
    /council members <model> ...           opus, sonnet, fable, haiku, bir claude- id'si, bir gemini- ya da gemma- id'si
    /council members reset                 varsayılan üyeler
    /council <soru>                        kurulu hemen toplar; mod kapalıyken de çalışır

`/council <soru>` hemen `convened: 5 members` cevabını verir. Üyeler ve başkan cevap verince mod kararı `/council:send` ile modele iletir; model bunu senin mesajın olarak okur ve kararın içinden ne aldığını sana anlatır. O sırada çalışan bir turn varsa karar turn bitene kadar bekler (2.1.283'te ölçüldü).

## Maliyet

Her koşu, üye başına bir ve başkan için bir request yapar. Claude Code 2.1.283 üzerinde ölçüldü:

- Beş varsayılan üyeli bir koşu 25 ile 44 saniye sürdü; süreyi en yavaş üye belirler. Fork'lar 4 ile 11 saniye sürdü ve konuşmayı cache'ten okudu (kısa bir session'da 83k token).
- Varsayılan sınır olan 400.000 karakterlik konuşma Opus 5.5, Sonnet 5 ve Fable 5.1'de 163.828, Haiku 4.5'te 128.018, gemini-3.8-flash'ta 120.057 input token eder.

Liste fiyatlarıyla tam 400.000 karakterlik bir koşu tahminen yaklaşık $2,20 tutar: Fable 5.1 yaklaşık $1,70 (milyon input token başına $10), Sonnet 5 yaklaşık $0,34, Haiku 4.5 yaklaşık $0,13, iki fork da birkaç sentlik cache okuması. Daha kısa bir konuşma orantılı olarak daha ucuzdur. Claude aboneliğinde bu request'ler bunun yerine kullanım limitlerinden düşer. Maliyeti azaltmak için `/council members` ile bir üyeyi çıkar, örneğin `/council members opus sonnet haiku gemini-3.8-flash`.

`gemini-3.1-pro-preview` denemedeki her free tier key'de HTTP 429 döndü, çünkü free tier'da bu model için kota yok. Onu üyelere yalnız ücretli bir key'le ekle.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install council@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Modelin kurulu kendi başına çağırmasını istiyorsan `/council on` çalıştır. Kurulumdan sonra kapalıdır; `/council <soru>` her iki durumda da çalışır.
3. Gemini üyeleri için gemini-core 0.3.0 veya üstünü kur ve ona bir key ver (onun README'sine bak). council ona bağımlı değildir; o olmadan yalnız Claude üyeleriyle çalışır.

## Seçenekler

| Seçenek | Varsayılan | Neyi ayarlar |
|---|---|---|
| `maxInputChars` | `400000` | Session'ı fork'lamayan her üyenin konuşmadan kaç karakter okuyacağı; 20.000 ile 2.000.000 arası |

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, turn.start, classic.SessionStart, command.run{command=council}, prompt.section{name=env_info_simple}, tool.describe{tool=/"^mcp__council__convene$"/}, tool.call{tool=/"^mcp__council__convene$"/}, turn.step
    ❯ ./register.ts calls: $.clock.after (via runManual), $.clock.now (via askClaude, askGemini, askGeminiModel, convene, drawRun, ended, verdictOf), $.command.register, $.command.run (via send), $.gemini.enroll (via enrollGemini), $.gemini.read (via askGeminiModel), $.gemini.request (via askGeminiModel), $.gemini.settings (via geminiReach), $.http.fetch (via askGeminiModel), $.model.complete (via askChair, askClaude), $.model.fork (via askChair, askClaude), $.prompt.submit (via send), $.session.messages (via contextOf), $.sidebar.set (via drawRun), $.store.delete (via runCommand), $.store.get (via isEnabled, membersNow), $.store.set (via runCommand, storeEnabled), $.tool.register (via declareTool), $.ui.log (via enrollGemini, runManual, send, toPerson)

Reach L3: üye başına bir, başkan için bir request.

    1. Okur:     ana thread'in konuşmasını, soruyu ve her ana loop request'inin modelini
    2. Çalıştırır: hiçbir process
    3. Gönderir: konuşmayı ve soruyu her Claude üyesine Claude Code'un kendi API bağlantısı üzerinden, her Gemini üyesi için de gemini-core üzerinden Google'a
    4. Saklar:   $.store içinde açık/kapalı ayarını ve üye listesini; bir koşu bellekte durur
    5. Düşman girdi: cevaplar modelin okuduğu metinlerdir, hiçbir zaman çalıştırılmaz; bir üye id'si Gemini URL'sine ulaşmadan önce [a-z0-9.-] ile eşleşmek zorundadır; free tier bir Gemini key'i, gönderilenleri Google'ın okumasına izin verir

## Sınırlar

- Her üye yalnız kendisine gönderilenden cevap verir. Fork'lamayan bir üye konuşmayı `maxInputChars`'ta kesilmiş metin olarak okur, yani kesilen kısmı kaçırabilir.
- Başkan session'ın modelinde çalışır ve kendi ailesinden gelen cevapları da değerlendirir; harfler hangi cevabın hangi modelden geldiğini gizler, cevapların ne söylediğini değil.
- Bir üyenin ya da başkanın cevabı thinking dahil 8.192 token'la sınırlıdır; 5 dakika içinde cevap vermeyen üye başarısız sayılır.
- Gemini HTTP 503 döndüğünde request, gemini-core'un söylediği beklemeyi yapmadan hemen yeniden gider, çünkü `$.clock.sleep` hook'un 10 saniyelik bütçesinden düşer (2.1.283'te ölçüldü). Art arda üç hızlı deneme aynı yoğunluğa takılabilir.
- 2.1.283'te ölçüldü: bir plugin tool çağrısı zaman aşımına uğramadan 333 saniye sürdü. 2.1.277'de sınır 60 saniyeydi, yani daha eski bir Claude Code yavaş bir koşuyu yarıda kesebilir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # --plugin-dir ../sidebar --plugin-dir ../gemini-core ile /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
