# council

Zor bir problemde bir model konsülüne danışan bir Claude Code Mod'u. Birkaç model aynı soruyu birbirinden bağımsız cevaplar, sonra oturumun modeli başkan olarak cevaplardan tek bir karar yazar. Model takıldığında konsülü bir tool ile kendisi çağırır, siz de `/council <soru>` ile çalıştırırsınız.

## Ne yapar

1. Üyeler Opus 5.5, Sonnet 5, Fable 5.1 ve Haiku 4.5'tir. [gemini-core](../gemini-core) kurulu ve key'i varsa `gemini-3.8-flash` de katılır. gemini-core ya da key yoksa Gemini üyeleri atlanır ve sonuç nedenini yazar. `/council members` listeyi değiştirir.
2. Bütün üyelere aynı anda sorulur:
   - Oturumun kendi modelinde çalışan üye oturumu `$.model.fork` ile fork'lar, yani bütün konuşmayı prompt cache'ten okur.
   - Diğer her Claude üyesi konuşmayı metin olarak `$.model.complete` ile, `high` effort'ta alır. 400.000 karakterin üstünde önce en uzun tool çıktıları kısaltılır, sonra en eski mesajlar dışarıda bırakılır. Haiku 4.5 en fazla 560.000 karakter okur, çünkü penceresi 200k token'dır.
   - Bir Gemini üyesi aynı metni key'i, tier'ı ve thinking seviyesini tutan gemini-core üzerinden alır. gemini-core 0.3.0 ya da sonrası gerekir, çünkü her istek kendi modelini adlandırır.
3. Başkan da oturumu fork'lar. Cevapları modele göre değil harfle (`Member A`, `Member B`) okur. Üyelerin nerede anlaştığını, nerede ayrıldığını ve konuşmanın hangi tarafı desteklediğini, neyi kaçırdıklarını ve sonraki adımı yazar.
4. Çağıran taraf kararı ve her cevabı okur. Her cevabın başında harfi, modeli ve süresi durur. Başarısız olan üye nedeniyle birlikte adlandırılır. Hiçbir üye cevap vermezse çağrı her nedeni sayarak reddedilir ve başkan çalışmaz.
5. Bir subagent'ın çağrısı konuşma göndermez, çünkü fork ve `$.session.messages()` ana thread'i okur. O zaman her üye ve başkan yalnız soruyu completion ile alır.

## Model ne zaman çağırır

Tool, tek bir `question` girdisi alan `mcp__council__convene`'dir. ToolSearch olmadan listelenir ve system prompt'taki bir not modele ne zaman çağıracağını söyler:

- aynı hata iki düzeltme denemesinden sonra sürüyorsa;
- araştırmaya rağmen kök neden hâlâ belirsizse;
- her birinin gerçek trade-off'ları olan iki tasarım arasında seçim yapması gerekiyorsa;
- geri alınması zor bir değişiklikten önce.

Not session başında ve `/clear` sonrasında sabitlenir. Bu yüzden `/council on` tool'u modele hemen verir, notu ise sonraki session'dan itibaren. Modelin kaç kez çağıracağına bir sınır yoktur. Ayar bütün pencereler için tektir: başka bir pencerede çalışan `/council on`, bu penceredeki modele tool'u sonraki turn'de, notu sonraki `/clear`'da ya da session'da verir. Oradaki bir `/council off` ise tool'un burada hemen reddetmesini sağlar.

## Ne görürsünüz

[sidebar](../sidebar) açıkken sabit bir bölüm çalışmayı izler: her üye çalışırken sarı, cevap verince süresi ve token'larıyla yeşil, başarısız olunca nedeniyle kırmızıdır. Altında başkan ve kararın ilk kelimeleri durur:

    council: run
    avg.js boş dizi için ne dönmeli: NaN, 0, yoksa hata mı fırl… · done in 44s
    opus 5.5 · fork · answered 11s · 89k in, 902 out
    sonnet 5 · complete · answered 17s · 6.7k in, 1.1k out
    fable 5.1 · complete · answered 24s · 6.7k in, 1.4k out
    haiku 4.5 · complete · answered 9s · 5.2k in, 634 out
    gemini-3.8-flash · gemini · answered 8s · 4.7k in, 1.3k out · free tier
    chair · opus 5.5 · fork · done 20s

Sidebar kapalıyken sonda tek bir satır:

    council: 1 of 2 members answered in 4s; the chair wrote the verdict

## Komut

    /council                               on ya da off, üyeler, başkan, son çalışma
    /council on | off                      modelin tool'a sahip olup olmadığı; varsayılan off
    /council members                       üyeler
    /council members <model> ...           opus, sonnet, fable, haiku, bir claude- id'si, bir gemini- ya da gemma- id'si
    /council members reset                 varsayılan üyeler
    /council <soru>                        konsülü şimdi çalıştırır, mod kapalıyken de

`/council <soru>` hemen `convened: 5 members` cevabını verir. Üyeler ve başkan cevap verdiğinde mod kararı modele `/council:send` ile verir. Model onu sizin mesajınız olarak okur ve ondan ne çıkardığını söyler. Bu sırada çalışan bir turn kararı kendi sonuna kadar bekletir (2.1.283 üzerinde ölçüldü).

## Maliyet

Her çalışma üye başına bir istek ve başkan için bir istek yapar. Claude Code 2.1.283 üzerinde ölçüldü:

- Beş varsayılan üyeyle bir çalışma 25 ile 44 saniye sürdü; süreyi en yavaş üye belirler. Fork'lar 4 ile 11 saniye sürdü ve konuşmayı cache'ten okudu (kısa bir session'da 83k token).
- Varsayılan sınır olan 400.000 karakterlik konuşma Opus 5.5, Sonnet 5 ve Fable 5.1'de 163.828, Haiku 4.5'te 128.018, gemini-3.8-flash'ta 120.057 input token'dır.

Liste fiyatlarıyla tam 400.000 karakterlik bir çalışma yaklaşık $2,20 tutar (tahmini): Fable 5.1 yaklaşık $1,70 (milyon input token başına $10), Sonnet 5 yaklaşık $0,34, Haiku 4.5 yaklaşık $0,13, iki fork birkaç sentlik cache okuması. Daha kısa bir konuşma orantılı olarak daha az tutar. Claude aboneliğinde istekler bunun yerine kullanım limitlerine sayılır. Maliyeti düşürmek için `/council members` ile bir üyeyi çıkarın, örneğin `/council members opus sonnet haiku gemini-3.8-flash`.

`gemini-3.1-pro-preview` kontroldeki bütün free tier key'lerinde HTTP 429 döndü, çünkü free tier'da bu modelin kotası yok. Onu üyelere yalnız paid bir key ile ekleyin.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install council@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Modelin konsülü kendisi çağırması gerekiyorsa `/council on` çalıştırın. Kurulumdan sonra kapalıdır ve `/council <soru>` her iki durumda da çalışır.
3. Gemini üyeleri için gemini-core 0.3.0 ya da sonrasını kurun ve ona bir key verin (README'sine bakın). Konsül ona bağlı değildir ve o olmadan yalnız Claude üyeleriyle çalışır.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `400000` | Oturumu fork'lamayan her üyenin konuşmadan kaç karakter okuduğu; 20.000 ile 2.000.000 arası |

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, turn.start, classic.SessionStart, command.run{command=council}, prompt.section{name=env_info_simple}, tool.describe{tool=/"^mcp__council__convene$"/}, tool.call{tool=/"^mcp__council__convene$"/}, turn.step
    ❯ ./register.ts calls: $.clock.after (via runManual), $.clock.now (via askClaude, askGemini, askGeminiModel, convene, drawRun, ended, verdictOf), $.command.register, $.command.run (via send), $.gemini.enroll (via enrollGemini), $.gemini.read (via askGeminiModel), $.gemini.request (via askGeminiModel), $.gemini.settings (via geminiReach), $.http.fetch (via askGeminiModel), $.model.complete (via askChair, askClaude), $.model.fork (via askChair, askClaude), $.prompt.submit (via send), $.session.messages (via contextOf), $.sidebar.set (via drawRun), $.store.delete (via runCommand), $.store.get (via isEnabled, membersNow), $.store.set (via runCommand, storeEnabled), $.tool.register (via declareTool), $.ui.log (via enrollGemini, runManual, send, toPerson)

Reach L3, üye başına bir istek ve başkan için bir istek.

    1. Okur:     ana thread'in konuşmasını, soruyu ve her main-loop isteğinin modelini
    2. Çalıştırır: hiçbir process
    3. Gönderir: konuşmayı ve soruyu her Claude üyesine Claude Code'un kendi API bağlantısıyla, her Gemini üyesi için gemini-core üzerinden Google'a
    4. Saklar:   $.store içinde on/off ayarını ve üye listesini; bir çalışma bellekte yaşar
    5. Düşman girdi: cevaplar modelin okuduğu metindir ve hiç çalıştırılmaz; bir üye id'si Gemini URL'ine girmeden önce [a-z0-9.-] ile eşleşmek zorundadır; free tier bir Gemini key'i gönderileni Google'ın okumasına izin verir

## Sınırlar

- Her üye kendisine gönderilenden cevap verir. Fork'lamayan bir üye konuşmayı `maxInputChars` sınırında kesilmiş metin olarak okur, yani kesilen kısmı kaçırabilir.
- Başkan oturumun modelinde çalışır ve kendi ailesinden gelen cevapları da değerlendirir. Harfler hangi cevabın hangi modelden geldiğini gizler, cevapların ne söylediğini gizlemez.
- Gemini HTTP 503 sonrasında istek gemini-core'un söylediği beklemeyi yapmadan hemen tekrar gider, çünkü `$.clock.sleep` hook'un 10 saniyelik budget'ından düşer (2.1.283 üzerinde ölçüldü). Üç hızlı tekrar aynı yüke denk gelebilir.
- 2.1.283 üzerinde ölçüldü: bir plugin tool çağrısı 333 saniye timeout olmadan çalıştı. 2.1.277'de sınır 60 saniyeydi, yani daha eski bir Claude Code yavaş bir çalışmayı kesebilir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # --plugin-dir ../sidebar --plugin-dir ../gemini-core ile /plugin-types'ın ürettiği .claude/types/ gerekir
    make validate
    make test        # claude plugin test
