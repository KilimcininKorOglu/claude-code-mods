# gemini-advisor

Model bir plan kurar, iki yaklaşımdan birini seçer ya da işin bittiğini söyler; buna ikinci kez bakan olmaz. Bu mod modele, kendi kendine çağırdığı bir Gemini danışmanı verir. Model ne yaptığını ya da ne yapacağını ve sorusunu yazar. Gemini o ana kadarki bütün konuşmayı, tool çağrıları ve çıktılarıyla birlikte okur; ikinci görüşü tool sonucu olarak geri gelir.

Fikir Claude API'nin advisor tool'undan geliyor. Orada işi yapan model, kendi transcript'ini okuyan daha güçlü bir modeli çağırır. Burada cevabı Gemini verir, model de kendi mesajını ekler.

## Ne yapar

1. Danışman açıksa mod, session başında tek input'lu (`message`) `mcp__gemini-advisor__advise` tool'unu tanımlar.
2. Engine bir plugin'in tool'unu ToolSearch arkasında listeler; model orada yalnız adını görür (2.1.277 üzerinde ölçüldü). Bu yüzden mod, system prompt'un `env_info_simple` section'ının sonuna bir `# Gemini advisor` notu ekler: tool ne yapar, nasıl yüklenir, ne zaman çağrılır. Not session boyunca değişmez, prompt cache de korunur.
3. Not, çağrıyı sen istemeden dört anda zorunlu kılar: önemli bir değişiklikten ya da çok adımlı bir plandan önce, model tıkandığında (aynı hata iki kez), iki yaklaşım arasında seçim yaparken ve işin bittiğini söylemeden önce. Modele tavsiyeyi kodla karşılaştırmasını ve katılmadığı yeri sana söylemesini de söyler.
4. Çağrı gelince mod konuşmayı `$.session.messages()` ile okur; buna çalışan turn da dahildir (ölçüldü). Her mesajı ve her tool çağrısını input'u ve output'uyla yazar, modelin mesajıyla birlikte tek bir `generateContent` isteğinde gönderir. Metin `maxInputChars`'ı (varsayılan 2.000.000 karakter) aşarsa en uzun tool çıktıları ortak bir uzunluğa kısaltılır; her biri baş ve son kısmını korur. Çıktıların hepsi çıkarıldığında bile sınırı aşan bir konuşma hatadır. İsteği gemini-core kurar: `gemini-advisor` için tuttuğu key, model ve thinking seviyesiyle. Cevabı da o okur.
5. Tavsiye tool sonucu olarak döner. Her başarısızlık nedenini söyleyen bir hata sonucu olarak döner, model onu görür; hiçbir şey yutulmaz. Boş bir tavsiye ve Gemini'nin `maxOutputTokens`'ta kestiği bir tavsiye de hatadır.
6. Gemini arada bir HTTP 503 ("high demand") döner ve bir sonraki istek çoğu zaman çalışır (ölçüldü: iki flash modelde 5 istekten 2'si). Bu durumda mod, gemini-core'un bildirdiği gibi 1 sn, 2 sn ve 3 sn sonra yeniden sorar; toplam en fazla dört deneme olur. Beklemesi 40 sn'yi aşacak bir deneme başlamaz, böylece sonuncusu 60 saniyelik tool timeout'una sığar. 429'dan ya da bir key hatasından sonra gemini-core, elinde başka bir key varsa isteği onunla yeniden gönderir.

2.1.277 üzerinde `gemini-3.8-flash` ile yapılan canlı denemede model iki yaklaşım arasında seçim yaparken danışmanı kendiliğinden çağırdı. 27 mesaj (15k token) gönderdi, tavsiyeyi 7,1 saniyede aldı ve cevabında kullandı. Daha yumuşak bir notla ("call it on your own") model böyle iki turn'de danışmanı çağırmadı; sonra da turn'ün notun saydığı türden olduğunu kendisi söyledi.

## Ne gösterir

Her tavsiyeden sonra 10 saniye duran bir toast çıkar; sonuncusunu `/gemini-advisor` gösterir:

    gemini-advisor: asked gemini-3.8-flash · 27 messages · 15k in, 2k out · sent to Gemini free tier

`sent to Gemini free tier` kısmı yalnız free tier'da çıkar. Subagent'tan gelen bir çağrıda mesaj sayısının yerinde `message only` yazar. Transcript'teki tool satırında modelin mesajı ve tavsiye durur (ctrl+o).

## Komut

    /gemini-advisor              on ya da off, gemini-core'un tuttuğu model, thinking seviyesi ve tier, key var mı, son tavsiye
    /gemini-advisor on | off     gemini-core'da key yokken on reddedilir; off: bir çağrı danışmanın kapalı olduğunu söyler
    /gemini-advisor reset        yeniden off, varsayılan

Danışman kurulumdan sonra kapalıdır: model ne tool ne not alır, Gemini'ye de hiçbir şey gitmez. `on` tool'u hemen tanımlar. System prompt notu ise ayarı hemen değil, `/clear`'da ya da sonraki session'da izler; çünkü session ortasında değişen bir system prompt, sonraki isteğin bütün prompt cache'i yeniden yazmasına yol açar. `off`'tan sonra not `/clear`'da ya da sonraki session'da, tool ise sonraki session'da kalkar; o zamana kadar bir çağrı danışmanın kapalı olduğunu söyler. Ayar bütün pencereler için tektir. Başka bir pencerede verilen `on`, tool'u bu pencerede sonraki turn'de, notu sonraki `/clear`'da ya da session'da tanımlar. Oradaki bir `off` ise buradaki bir çağrının hemen danışmanın kapalı olduğunu söylemesine yol açar.

Key, tier, model (varsayılan `gemini-3.8-flash`) ve thinking seviyesi gemini-core'a aittir; değişiklik bir sonraki çağrıdan itibaren geçerli olur:

    /gemini-core model advisor gemini-3.7-flash
    /gemini-core thinking advisor high
    /gemini-core paid

## Free tier mı paid tier mı

Her çağrı konuşmayı gönderir: prompt'larını, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini. Free tier'da Google bunları kullanabilir, insan denetçiler de okuyabilir; gemini-core README'si Gemini API Additional Terms'ten ilgili kısmı aktarır. Google'a göstermek istemediğin bir projede billing'i açık bir key kullan ve `/gemini-core paid` ayarla.

Canlı denemedeki free key ile `gemini-3.1-pro-preview` HTTP 429 (quota exceeded) döndü; yani pro bir model paid key ister.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-advisor@kilimcininkoroglu-mods

`gemini-core`'a bağlıdır; `claude plugin install` onu da kurar. Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da, onun [After installing](../gemini-core/README.md#after-installing) bölümünde anlatıldığı gibi ayarla, sonra Claude Code'u yeniden başlat.
2. `/gemini-advisor on` çalıştır, ardından `/clear` yap ya da yeni bir session aç; system prompt notu modele ancak böyle ulaşır. Key yoksa `on` `still off: gemini-core has no Gemini key` cevabını verir ve danışman kapalı kalır.
3. `/gemini-advisor` çalıştır. İlk satır `on · <model> · thinking ... · <tier> tier · key set` olmalı.
4. Bir tavsiye çağrısı `Gemini HTTP 429` ile başarısız olursa key'inde o model için kota yok demektir. `/gemini-core model advisor` ile başka bir model seç.

0.1.x'ten güncelliyorsan: `claude plugin update` gemini-core'u eklemez (2.1.278 üzerinde ölçüldü), bu yüzden bir kez `claude plugin install gemini-core@kilimcininkoroglu-mods` çalıştır. 0.2.0 key'i, tier'ı ve modeli gemini-core'a taşıdı; `apiKey`, `tier` ve `model` option'ları ile daha önce `/gemini-advisor free|paid|model` ile saklanan ayarlar artık okunmuyor, onları gemini-core'da yeniden ayarla. 0.3.0 danışmanı varsayılan olarak kapattı: daha eski bir sürümden güncellediysen ve önceden `/gemini-advisor on` çalıştırmadıysan danışman kapalıdır; bir kez `/gemini-advisor on` çalıştır.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `2000000` | Gönderilen konuşmanın en fazla karakter sayısı; 10.000 ile 4.000.000 arası |
| `maxOutputTokens` | `8192` | Thinking dahil en uzun tavsiye; 256 ile 65.536 arası; kesilen tavsiye hatadır |

Aralık dışındaki ya da tam sayı olmayan bir değer yerine varsayılan kullanılır.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, turn.start, classic.SessionStart, command.run{command=gemini-advisor}, prompt.section{name=env_info_simple}, tool.call{tool=mcp__gemini-advisor__advise}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via runCommand, storeEnabled), $.http.fetch (via askGemini), $.session.messages (via conversation), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.tool.register (via declareTool), $.ui.toast (via advise)

Reach L3: network'e çıkar.

    1. Okur:     her danışman çağrısında konuşmayı (mesajlar, tool input'ları ve output'ları); kendi $.store dosyasını; gemini-core'dan key'i taşıyan isteği
    2. Çalıştırır: hiçbir process; açıkken system prompt'a bir not ekler ve bir tool tanımlar
    3. Gönderir: konuşmayı ve modelin mesajını, çağrı başına bir istek (503 sonrası en fazla dört, 429 ya da key hatası sonrası ek key başına bir tane daha), gemini-core'un kurduğu URL'ye (generativelanguage.googleapis.com), key x-goog-api-key header'ında, hiçbir zaman URL'de değil
    4. Saklar:   $.store içinde on/off ayarını; son kullanım satırı bellekte yaşar
    5. Düşman girdi: tavsiye, modelin tool sonucu olarak okuduğu güvenilmez metindir; yani düşman ya da yanlış bir tavsiye, modeli okuduğu bir dosyadaki metin gibi yönlendirebilir; not modele onu doğrulamasını söyler

## Sınırlar

- Danışmanı çağırıp çağırmamak modelin kendi kararıdır. Canlı deneme tek bir turn türünü kapsadı.
- Tool açıklaması hiçbir modelin adını anmaz. Engine ilk gönderdiği açıklamayı session boyunca korur: model değiştikten sonra yeniden kaydedilen bir tool modele yine eski metinle ulaştı (2.1.278 üzerinde ölçüldü). Bir çağrının hangi modele gittiğini toast ve `/gemini-advisor` söyler.
- Engine tool'u 60 saniyelik bir MCP timeout'uyla sunar (debug log, 2.1.277). Daha uzun süren bir çağrı başarısız olur ve model hatayı okur.
- Not `env_info_simple` section'ına eklenir. System prompt'unda bu section olmayan bir kurulum not almaz; model yalnız tool'un adını görür. Yalnız bir kurulum denendi.
- Bir subagent'ın çağrısı yalnız kendi mesajını gönderir, çünkü `$.session.messages()`'ın subagent içinde hangi transcript'i verdiği doğrulanmadı.
- `$.session.messages()` uzun bir transcript'in en yeni 4096 mesajını verir.
- Her çağrı bütün konuşmayı gönderir; session uzadıkça her çağrı büyür ve yavaşlar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
