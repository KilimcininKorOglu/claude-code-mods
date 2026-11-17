# gemini-advisor

Model bir plan yapar, iki yaklaşımdan birini seçer ya da işin bittiğini söyler. Bu karara ikinci kez bakan olmaz. Bu mod modele, kendi başına çağırdığı bir Gemini danışmanı verir. Model ne yaptığını ya da ne yapacağını ve sorusunu yazar. Gemini o ana kadarki konuşmayı, tool çağrıları ve çıktılarıyla birlikte okur. Gemini'nin ikinci görüşü tool sonucu olarak geri gelir. `maxInputChars` sınırını (varsayılan 2.000.000) aşan bir konuşmanın orta kısmı kesilir. Bir subagent'ın çağrısında yalnız subagent'ın mesajı gönderilir.

Fikir, Claude API'nin advisor tool'undan alındı. Orada işi yapan model, kendi transcript'ini okuyan daha güçlü bir modeli çağırır. Burada cevabı Gemini verir ve model kendi mesajını da gönderir.

## Ne yapar

1. Danışman açıksa mod, session başında tek input'lu (`message`) `mcp__gemini-advisor__advise` tool'unu tanımlar.
2. Engine bir plugin'in tool'unu varsayılan olarak ToolSearch arkasında listeler. Model orada yalnız tool'un adını görür. Bir `tool.describe` hook'u bu tool'u doğrudan listeler. Böylece model, ne zaman çağrılacağını söyleyen açıklamayı okur. Mod ayrıca system prompt'un `env_info_simple` section'ının sonuna bir `# Gemini advisor` notu ekler. Not, tool'un ne yaptığını ve ne zaman çağrılacağını söyler. Not session boyunca değişmez. Bu yüzden prompt cache korunur.
3. Not, çağrıyı siz istemeden dört durumda zorunlu kılar: önemli bir değişiklikten ya da çok adımlı bir plandan önce, model takıldığında (aynı hata iki kez), iki yaklaşım arasında seçim yaparken ve işin bittiğini söylemeden önce. Not ayrıca modelden tavsiyeyi kodla karşılaştırmasını ve katılmadığı noktaları size söylemesini ister.
4. Bir çağrı geldiğinde mod konuşmayı `$.session.messages()` ile okur. Çalışan turn da buna dahildir (ölçüldü). Mod her mesajı ve her tool çağrısını input'u ve output'uyla birlikte yazar. Bu metni, modelin mesajıyla birlikte tek bir `generateContent` isteğiyle gönderir. Metin `maxInputChars` sınırını (varsayılan 2.000.000 karakter) aşarsa en uzun tool çıktıları ortak bir uzunluğa kısaltılır. Her çıktının başı ve sonu korunur. Bütün çıktılar çıkarıldığında bile sınırı aşan bir konuşma hatadır. İsteği gemini-core oluşturur: `gemini-advisor` için tuttuğu key, model ve thinking seviyesiyle. Cevabı da gemini-core okur.
5. Tavsiye tool sonucu olarak döner. Her başarısızlık, nedenini söyleyen bir hata sonucu olarak döner ve model bu hatayı görür. Hiçbir hata gizlenmez. Boş bir tavsiye ve Gemini'nin `maxOutputTokens` sınırında kestiği bir tavsiye de hatadır.
6. Gemini zaman zaman HTTP 503 ("high demand") döndürür ve bir sonraki istek çoğu zaman çalışır (ölçüldü: iki flash modelde 5 istekten 2'si). Bu durumda mod, gemini-core'un bildirdiği gibi 1, 2 ve 3 saniye sonra yeniden sorar. Toplam en fazla dört deneme yapılır. Beklemesi 40 saniyeyi aşacak bir deneme başlatılmaz. Böylece son deneme 60 saniyelik tool timeout'una sığar. Bir 429 ya da key hatasından sonra gemini-core, başka bir key'i varsa isteği o key ile yeniden gönderir.

2.1.277 üzerinde `gemini-3.8-flash` ile yapılan canlı denemede model, iki yaklaşım arasında seçim yaparken danışmanı kendiliğinden çağırdı. 27 mesaj (15k token) gönderdi, tavsiyeyi 7,1 saniyede aldı ve cevabında tavsiyeyi kullandı. Daha yumuşak bir notla ("call it on your own") model böyle iki turn'de danışmanı çağırmadı. Ardından turn'ün, notun saydığı türden bir turn olduğunu kendisi söyledi.

## Ne gösterir

Her tavsiyeden sonra 10 saniye görünen bir toast çıkar. `/gemini-advisor` son tavsiyeyi gösterir:

    gemini-advisor: asked gemini-3.8-flash · 27 messages · 15k in, 2k out · sent to Gemini free tier

`sent to Gemini free tier` kısmı yalnız free tier'da görünür. Bir subagent'tan gelen çağrıda mesaj sayısının yerinde `message only` yazar. Transcript'teki tool satırı, modelin mesajını ve tavsiyeyi içerir (ctrl+o).

## Komut

    /gemini-advisor              açık mı kapalı mı, gemini-core'un tuttuğu model, thinking seviyesi ve tier, key var mı, son tavsiye
    /gemini-advisor on | off     gemini-core'da key yokken on reddedilir; off: bir çağrı danışmanın kapalı olduğunu bildirir
    /gemini-advisor reset        yeniden kapalı, varsayılan

Danışman yüklendikten sonra kapalıdır: model ne tool ne de not alır ve Gemini'ye hiçbir şey gönderilmez. `on` tool'u hemen tanımlar. System prompt notu ise ayarı hemen değil, `/clear` sırasında ya da bir sonraki session'da izler. Bunun nedeni, session ortasında değişen bir system prompt'un, sonraki isteğin bütün prompt cache'i yeniden yazmasına neden olmasıdır. `off` komutundan sonra not `/clear` sırasında ya da bir sonraki session'da, tool ise bir sonraki session'da kaldırılır. O zamana kadar bir çağrı danışmanın kapalı olduğunu bildirir. Ayar bütün pencereler için ortaktır. Başka bir pencerede çalıştırılan `on`, tool'u bu pencerede bir sonraki turn'de, notu ise bir sonraki `/clear` ya da session'da tanımlar. Başka bir pencerede çalıştırılan `off` ise bu penceredeki bir çağrının hemen danışmanın kapalı olduğunu bildirmesine neden olur.

Key, tier, model (varsayılan `gemini-3.8-flash`) ve thinking seviyesi gemini-core'da tutulur. Bir değişiklik bir sonraki çağrıdan itibaren geçerli olur:

    /gemini-core model advisor gemini-3.7-flash
    /gemini-core thinking advisor high
    /gemini-core paid

## Free tier mı, paid tier mı

Her çağrı konuşmayı gönderir: prompt'larınızı, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini. Free tier'da Google bu verileri kullanabilir ve insan denetçiler de okuyabilir. gemini-core README'si, Gemini API Additional Terms belgesinin ilgili kısmını aktarır. Google'a göstermek istemediğiniz bir projede billing'i açık bir key kullanın ve `/gemini-core paid` ayarını yapın.

Canlı denemedeki free key ile `gemini-3.1-pro-preview` HTTP 429 (quota exceeded) döndürdü. Bu yüzden pro bir model ücretli bir key gerektirir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-advisor@kilimcininkoroglu-mods

Mod `gemini-core`'a bağlıdır ve `claude plugin install` onu da yükler. Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da, gemini-core'un [Kurulumdan sonra](../gemini-core/README.tr.md#kurulumdan-sonra) bölümünde anlatıldığı gibi ayarlayın. Ardından Claude Code'u yeniden başlatın.
2. `/gemini-advisor on` komutunu çalıştırın. Ardından `/clear` yapın ya da yeni bir session açın. System prompt notu modele ancak bu şekilde ulaşır. Key yoksa `on` komutu `still off: gemini-core has no Gemini key` cevabını verir ve danışman kapalı kalır.
3. `/gemini-advisor` komutunu çalıştırın. İlk satır `on · <model> · thinking ... · <tier> tier · key set` olmalıdır.
4. Bir tavsiye çağrısı `Gemini HTTP 429` ile başarısız olursa key'inizde bu model için kota yoktur. `/gemini-core model advisor` ile başka bir model seçin.

0.1.x sürümünden güncelliyorsanız: `claude plugin update` gemini-core'u eklemez (2.1.278 üzerinde ölçüldü). Bu yüzden bir kez `claude plugin install gemini-core@kilimcininkoroglu-mods` komutunu çalıştırın. 0.2.0 sürümü key'i, tier'ı ve modeli gemini-core'a taşıdı. `apiKey`, `tier` ve `model` option'ları ile daha önce `/gemini-advisor free|paid|model` ile saklanan ayarlar artık okunmaz. Bu ayarları gemini-core'da yeniden yapın. 0.3.0 sürümü danışmanı varsayılan olarak kapattı. Daha eski bir sürümden güncellediyseniz ve daha önce `/gemini-advisor on` çalıştırmadıysanız danışman kapalıdır. Bir kez `/gemini-advisor on` komutunu çalıştırın.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `2000000` | Gönderilen konuşmanın en fazla karakter sayısı; 10.000 ile 4.000.000 arası |
| `maxOutputTokens` | `8192` | Thinking dahil en uzun tavsiye; 256 ile 65.536 arası; kesilen bir tavsiye hatadır |

Aralık dışındaki ya da tam sayı olmayan bir değerin yerine varsayılan değer kullanılır.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, turn.start, classic.SessionStart, command.run{command=gemini-advisor}, tool.describe{tool=/"^mcp__gemini-advisor__advise$"/}, prompt.section{name=env_info_simple}, tool.call{tool=mcp__gemini-advisor__advise}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via runCommand, storeEnabled), $.http.fetch (via askGemini), $.session.messages (via conversation), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.tool.register (via declareTool), $.ui.toast (via advise)

Reach L3: network'e erişir.

    1. Okur:         her danışman çağrısında konuşmayı (mesajlar, tool input'ları ve output'ları); kendi $.store dosyasını; gemini-core'dan key'i içeren isteği
    2. Çalıştırır:   hiçbir process; açıkken system prompt'a bir not ekler ve bir tool tanımlar
    3. Gönderir:     konuşmayı ve modelin mesajını, her çağrı için bir istekle (bir 503 sonrasında en fazla dört, bir 429 ya da key hatası sonrasında her ek key için bir istek daha), gemini-core'un oluşturduğu URL'ye (generativelanguage.googleapis.com); key x-goog-api-key header'ında gönderilir, hiçbir zaman URL'de değil
    4. Saklar:       açık/kapalı ayarını $.store içinde; son kullanım satırı bellekte tutulur
    5. Düşman girdi: tavsiye, modelin tool sonucu olarak okuduğu güvenilmez bir metindir; bu yüzden düşmanca ya da yanlış bir tavsiye, modelin okuduğu bir dosyadaki metin gibi modeli yönlendirebilir; not modelden tavsiyeyi doğrulamasını ister

## Sınırlar

- Danışmanı çağırıp çağırmamak modelin kendi kararıdır. Canlı deneme tek bir turn türünü kapsadı.
- Tool açıklaması hiçbir modelin adını vermez. Engine, ilk gönderdiği açıklamayı session boyunca korur: model değiştikten sonra yeniden kaydedilen bir tool, modele yine eski metinle ulaştı (2.1.278 üzerinde ölçüldü). Bir çağrının hangi modele gittiğini toast ve `/gemini-advisor` gösterir.
- Bir plugin tool çağrısı timeout olmadan 333 saniye sürdü (2.1.283 üzerinde ölçüldü). Bu yüzden yavaş gelen bir Gemini cevabı beklenir.
- Not `env_info_simple` section'ına eklenir. System prompt'unda bu section olmayan bir kurulum notu almaz ve model yalnız tool'un adını görür. Yalnız bir kurulum denendi.
- Bir subagent'ın çağrısı yalnız kendi mesajını gönderir, çünkü `$.session.messages()`'ın bir subagent içinde hangi transcript'i döndürdüğü doğrulanmadı.
- `$.session.messages()`, uzun bir transcript'in en yeni 4096 mesajını döndürür.
- Her çağrı konuşmayı `maxInputChars` sınırına kadar gönderir. Bu yüzden session uzadıkça her çağrı büyür ve yavaşlar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
