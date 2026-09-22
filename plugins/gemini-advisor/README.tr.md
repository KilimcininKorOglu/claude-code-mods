# gemini-advisor

Modele, kendi kendine çağırdığı bir Gemini danışmanı veren bir Claude Code Mod'u. Model ne yaptığını, ne yapmak üzere olduğunu ve sorusunu yazar; Gemini o ana kadarki tüm konuşmayı, tool çağrıları ve çıktıları dahil, okur ve ikinci bir görüşle cevap verir. Cevap tool sonucu olarak geri gelir.

Fikir, Claude API'deki advisor tool'unu izler: orada executor model, kendi transcript'ini okuyan daha güçlü bir modeli çağırır. Bu mod onun yerine Gemini'ye sorar ve model kendi mesajını da gönderir.

## Ne yapar

1. Session başlangıcında, açıkken, mod `mcp__gemini-advisor__advise` tool'unu tek bir input ile (`message`) tanımlar.
2. Engine bir plugin'in tool'unu ToolSearch arkasında listeler; orada model yalnız adını görür (2.1.277 üzerinde ölçüldü). Bu yüzden mod, system prompt'un `env_info_simple` section'ının sonuna bir `# Gemini advisor` notu ekler: tool'un ne yaptığı, nasıl yükleneceği ve ne zaman çağrılacağı. Not session sırasında değişmez, yani prompt cache tutar.
3. Not, çağrıyı dört anda zorunlu kılar, kullanıcı istemeden: önemli bir değişiklikten ya da çok adımlı bir plandan önce, tıkandığında (aynı hata iki kere), iki yaklaşım arasında seçim yaparken ve işin bittiğini söylemeden önce. Not ayrıca modele tavsiyeyi kodla karşılaştırmasını söyler.
4. Bir çağrıda mod konuşmayı `$.session.messages()` ile okur (bu, çalışan turn'ü de içerir, ölçüldü), her mesajı ve her tool çağrısını input'u ve output'u ile birlikte yazar ve modelin mesajıyla birlikte tek bir `generateContent` isteğinde gönderir. 2.000.000 karakterin üstünde önce en uzun çıktılar baş ve son kısmına kısaltılır. İsteği gemini-core kurar: `gemini-advisor` için tuttuğu key, model ve thinking seviyesi ile; cevabı da o okur.
5. Tavsiye tool sonucu olarak geri gelir. Her başarısızlık, sebebini söyleyen bir hata sonucu olarak geri gelir, yani model onu görür; hiçbir şey yutulmaz.
6. Gemini arada bir HTTP 503 ("high demand") döner ve sonraki istek çoğu zaman çalışır (ölçüldü: iki flash modelde 5 istekten 2'si). gemini-core bunu okuduğu şekliyle mod 1 sn, 2 sn ve 3 sn sonra tekrar sorar, en fazla dört kere, ve 40 saniye geçtikten sonra yeni deneme başlatmaz, böylece sonuncusu 60 saniyelik tool timeout'una sığar.

2.1.277 üzerinde `gemini-3.8-flash` ile yapılan canlı testte model iki yaklaşım arasında seçim yaparken danışmanı kendiliğinden çağırdı, 27 mesaj (15k token) gönderdi, tavsiyeyi 7,1 saniyede aldı ve cevabında tavsiyeyi kullandı. Daha yumuşak bir notla ("call it on your own") model böyle iki turn'de onu çağırmadı ve sonrasında turn'ün notun adlandırdığı türden olduğunu söyledi.

## Ne gösterir

Her tavsiyeden sonra bir toast ve `/gemini-advisor` içinde sonuncusu:

    gemini-advisor: asked gemini-3.8-flash · 27 messages · 15k in, 2k out · sent to Gemini free tier

Transcript'teki tool satırı modelin mesajını ve tavsiyeyi tutar (ctrl+o).

## Komut

    /gemini-advisor              on ya da off, gemini-core'un tuttuğu model, thinking seviyesi ve tier, key var mı, son tavsiye
    /gemini-advisor on | off     gemini-core'da key yokken on reddedilir; off: bir çağrı danışmanın kapalı olduğunu söyler
    /gemini-advisor reset        tekrar off, varsayılan

Danışman kurulumdan sonra kapalıdır: model tool ve not almaz ve Gemini'ye hiçbir şey gönderilmez. `on` tool'u hemen tanımlar. System prompt notu ayarı `/clear` ya da sonraki session'da izler, hemen değil; çünkü session ortasında system prompt'u değiştirmek sonraki isteğin tüm prompt cache'ini yeniden yazmasına yol açar. `off` sonrasında not `/clear` ya da sonraki session'da kalkar, tool sonraki session'da; o ana kadar bir çağrı danışmanın kapalı olduğunu söyler.

Key, tier, model (varsayılan `gemini-3.8-flash`) ve thinking seviyesi gemini-core'a aittir; değişiklik bir sonraki çağrıdan itibaren geçerlidir:

    /gemini-core model advisor gemini-3.7-flash
    /gemini-core thinking advisor high
    /gemini-core paid

## Free tier ya da paid tier

Her çağrı konuşmayı gönderir: prompt'larınızı, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini. Free tier'da Google bunları kullanabilir ve insan denetçiler okuyabilir; gemini-core README'si Gemini API Additional Terms'ten alıntılar. Google'a göstermeyeceğiniz bir projede billing açık bir key kullanın ve `/gemini-core paid` ayarlayın.

Canlı testte kullanılan free key ile `gemini-3.1-pro-preview` HTTP 429 (quota exceeded) döndü, yani bir pro model paid key ister.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-advisor@kilimcininkoroglu-mods

`gemini-core`'a bağlıdır; `claude plugin install` onu da ekler. Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da ayarlayın, onun [After installing](../gemini-core/README.md#after-installing) bölümünde yazdığı gibi, sonra Claude Code'u yeniden başlatın.
2. `/gemini-advisor on` çalıştırın, sonra `/clear` yapın ya da yeni bir session başlatın; böylece system prompt notu modele ulaşır. Key olmadan `on` komutu `still off: gemini-core has no Gemini key` cevabını verir ve kapalı kalır.
3. `/gemini-advisor` çalıştırın. İlk satır `on · <model> · thinking ... · <tier> tier · key set` demelidir.
4. Bir tavsiye çağrısı `Gemini HTTP 429` ile başarısız olursa key'inizde o model için kota yok demektir. `/gemini-core model advisor` ile başka bir model seçin.

0.1.x'ten güncellemeden sonra: `claude plugin update` gemini-core'u eklemez (2.1.278 üzerinde ölçüldü), bu yüzden bir kere `claude plugin install gemini-core@kilimcininkoroglu-mods` çalıştırın. 0.2.0 sürümü key, tier ve model'i gemini-core'a taşıdı; daha önce saklanan `apiKey`, `tier` ve `model` option'ları ile `/gemini-advisor free|paid|model` ayarları artık okunmuyor, onları gemini-core'da yeniden ayarlayın. 0.3.0 sürümü danışmanı varsayılan olarak kapattı: daha eski bir sürümden güncellediyseniz, daha önce `/gemini-advisor on` çalıştırmadıysanız kapalıdır; bir kere `/gemini-advisor on` çalıştırın.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `2000000` | En fazla kaç karakter konuşma gönderilir |
| `maxOutputTokens` | `8192` | En uzun tavsiye, thinking dahil; kesilmiş bir tavsiye hatadır |

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=gemini-advisor}, prompt.section{name=env_info_simple}, tool.call{tool=mcp__gemini-advisor__advise}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via runCommand, storeEnabled), $.http.fetch (via askGemini), $.session.messages (via conversation), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.tool.register (via declareTool), $.ui.toast (via advise)

Reach L3, network'e çıkar.

    1. Okur:     her danışman çağrısında konuşmayı (mesajlar, tool input'ları ve output'ları); kendi $.store dosyasını; gemini-core'dan key'i taşıyan isteği
    2. Çalıştırır: hiçbir process; açıkken system prompt'a bir not ekler ve bir tool tanımlar
    3. Gönderir: konuşmayı ve modelin mesajını, çağrı başına bir istek (503 sonrası en fazla dört, 429 ya da key hatası sonrası ek key başına bir tane daha), gemini-core'un kurduğu URL'ye (generativelanguage.googleapis.com), key x-goog-api-key header'ında, hiçbir zaman URL'de değil
    4. Saklar:   $.store içinde on/off ayarını; son kullanım satırı bellekte yaşar
    5. Düşman girdi: tavsiye, modelin tool sonucu olarak okuduğu güvenilmez metindir; yani düşman ya da yanlış bir tavsiye, modeli okuduğu bir dosyadaki metin gibi yönlendirebilir; not modele onu doğrulamasını söyler

## Sınırlar

- Modelin danışmanı çağırıp çağırmaması kendi kararıdır. Canlı test tek tür bir turn'ü kapsadı.
- Tool açıklaması hiçbir modeli adlandırmaz. Engine ilk gönderdiği açıklamayı session boyunca korur: model değişiminden sonra yeniden kaydedilen bir tool modele yine eski metinle ulaştı (2.1.278 üzerinde ölçüldü). Toast ve `/gemini-advisor` bir çağrının hangi modele gittiğini adlandırır.
- Engine tool'u 60 saniyelik MCP timeout'u ile sunar (debug log, 2.1.277). Daha uzun süren bir çağrı başarısız olur ve model hatayı okur.
- Not `env_info_simple` section'ına eklenir. System prompt'unda böyle bir section olmayan bir kurulum not almaz ve model yalnız tool'un adını görür. Yalnız bir kurulum kontrol edildi.
- Bir subagent'ın çağrısı yalnız kendi mesajını gönderir, çünkü subagent içinde `$.session.messages()` hangi transcript'i cevaplar, doğrulanmadı.
- `$.session.messages()` uzun bir transcript'in en yeni 4096 mesajını cevaplar.
- Her çağrı tüm konuşmayı gönderir, yani uzun bir session her çağrıyı daha büyük ve daha yavaş yapar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
