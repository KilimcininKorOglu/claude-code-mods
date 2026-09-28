# gemini-compact

Context dolunca Claude onu bir Claude isteğiyle daha sıkıştırır: bütün context'i okur, bir özet yazar ve bu istek Claude kullanımından düşer. Bu mod o işi Gemini'ye verir. İki modu vardır:

- **summary** (varsayılan): Gemini konuşmanın en yeni 6 mesajdan önceki kısmını özetler; o mesajlar özetin ardından kelimesi kelimesine kalır. Claude özet yazmaz; engine'in yerleşik özeti yalnız Gemini başarısız olunca çalışır.
- **prune**: Gemini eski her tool çağrısı için karar verir: çağrı ve çıktısı kalsın mı, çıktısı kısaltılarak mı kalsın, yoksa gitsin mi. Kullanıcının ve asistanın her mesajı kelimesi kelimesine kalır. Hiçbir şey özetlenmez.

Prune fikri Tamara Tran'ın fast-jev-compaction'ından (tamaratran/fast-jev-compaction) gelir; o TypeSafe Jev'e sorar. Buradaki kod yenidir ve Gemini'ye sorar.

## Hangi mod

İki mod da yerleşik compaction'ın Claude isteğinin yerine bir Gemini isteği koyar.

Compaction'dan sonra her Claude isteği geriye kalanı okur. Summary modunda bu, özet ve en yeni mesajlardır; yerleşik özetin bıraktığına yakındır. Prune modunda ise konuşmanın bütün mesajlarıdır, yalnız atılan tool çıktıları eksilir. Bu daha büyüktür, yani sonraki her istek daha fazla okur. Boyutlar uzun bir session'da ölçülmedi.

Claude kullanımından en çok tasarruf için summary modunu seç. Her mesajın birebir metni boyuttan önemliyse prune modunu seç.

## Summary modu

1. `/compact`'ta, engine'in kendi compaction'ında ve cevapla biten bir ana loop turn'ü context'i eşiğin üstünde bıraktığında, `session.compact` hook'u konuşmayı alır.
2. En yeni 6 mesaj kalır. Kesim noktası bir asistan mesajına geri çekilir; böylece hiçbir tool sonucu çağrısı olmadan kalmaz ve özetten sonra kalan kısım bir asistan mesajıyla başlar. Kesilecek bir asistan mesajı yoksa her şey özetlenir.
3. Tek bir `generateContent` isteği kesimden önceki her şeyi Gemini'ye gönderir: her mesajı ve her çağrıyı, input'u ve tam çıktısıyla. Metin `summaryMaxInputChars`'ı (varsayılan 2.000.000 karakter) aşarsa en uzun çıktılar ortak bir uzunluğa kısaltılır; her biri baş ve son kısmını korur. Çıktıların hepsi çıkarıldığında bile sınırı aşan bir konuşma başarısız olur.
4. Gemini dokuz bölümlük düz metin bir özet yazar: istek ve amaç, teknik kavramlar, dosyalar ve kod, hatalar ve düzeltmeler, problem çözme, kullanıcının bütün mesajları kelimesi kelimesine, bekleyen görevler, o anki iş ve sonraki adım. `/compact`'tan sonra yazdığın metin de onunla birlikte Gemini'ye gider.
5. Konuşma, tek bir kullanıcı mesajına (önce bir not, sonra özet) ve ardından kalan mesajlara dönüşür; kalan mesajlar engine'in kendi mesajları olarak geri gider.
6. Şu durumlarda yerleşik özet çalışır ve bir satır nedenini söyler: key yoksa, en yeni mesajlardan önce hiçbir şey yoksa, Gemini başarısız olursa, özet 200 karakterden kısaysa ya da çıktı sınırında (32.768 token) kesildiyse, ya da sonuç konuşmadan küçük değilse.

İki modda da isteği gemini-core kurar: `gemini-compact` için tuttuğu key, model ve thinking seviyesiyle. Cevabı da o okur. HTTP 503'ten ("high demand") sonra mod 1 sn, 2 sn ve 3 sn sonra yeniden sorar; toplam en fazla dört deneme olur. Beklemesi 60 sn'yi aşacak bir deneme başlamaz. 429'dan ya da bir key hatasından sonra gemini-core, elinde başka key varsa isteği onunla verir.

2.1.277 üzerinde yapılan canlı denemede `/compact` `gemini-3.5-flash-lite` ile 2,6 saniye sürdü, Claude hiçbir compaction isteği göndermedi ve ardından model yalnız özetlenen kısımda geçen bir kelimeyi ve bir dosyayı adıyla andı.

## Prune modu

1. Aynı üç tetik `session.compact` hook'una ulaşır.
2. İlk mesajdaki ya da en yeni 6 mesajdaki bir tool çağrısı, ya da sonucu bunlardan birinde olan bir çağrı, bütünüyle kalır. Diğer her çağrı bir id alır (`c1`, `c2`, ...). Böyle bir çağrı yoksa yerleşik özet çalışır.
3. Tek bir `generateContent` isteği konuşmayı Gemini'ye gönderir: her mesajı ve her çağrıyı, input'u ve tam çıktısıyla. `maxInputChars`'ın (varsayılan 400.000 karakter) üstünde en uzun çıktılar summary modundaki gibi kısaltılır. Bir response schema her id için tam bir cevaba izin verir: `keep`, `truncate` ya da `drop`.
4. Mod cevabı kontrol eder (her id tam bir kez, başka id yok) ve konuşmayı yeniden kurar:
   - `keep`: çağrı ve çıktısı kalır.
   - `truncate`: çağrı kalır; çıktının ilk 300 karakteri ve kesildiğini söyleyen bir satır kalır. Bundan en fazla 120 karakter uzun bir çıktı bütünüyle kalır.
   - `drop`: çağrı ve çıktısı gider. En yakın asistan mesajına kaldırılan çağrıları sayan bir not eklenir, örneğin `[gemini-compact removed 1 earlier tool call(s) and their output after a compaction; they ran: Bash(ls -la /usr/bin)]`. Not olmadığında model, işi silinmiş bir cevabını okudu ve o işi hiç yapmadığını söyledi (2.1.277 üzerinde ölçüldü).
   - Cevabın dokunmadığı bir mesaj engine'in kendi mesajı olarak geri gider.
5. Sonuç %25'ten az küçüldüyse ya da bir şey başarısız olursa (key yok, bir HTTP hatası, schema'ya uymayan bir cevap), engine'in yerleşik özeti çalışır ve bir satır nedenini söyler.

2.1.277 üzerinde yapılan canlı denemede `/compact` `gemini-3.5-flash-lite` ile 1,1 saniye sürdü. Gemini bir `ls` listesini attı, kullanıcının düzenlemek üzere olduğu bir dosyanın `cat` çıktısını tuttu ve konuşma %93 küçüldü.

## Ne gösterir

Transcript'e modele gitmeyen **tek bir satır** düşer, bir de 15 saniye duran bir toast çıkar:

    gemini-compact: summary: 58 → 7 messages · 91% smaller · 312k in, 5k out
    gemini-compact: kept 9/11 messages · 93% smaller · 1 dropped, 0 truncated · 5k in, 59 out
    gemini-compact: built-in summary: under 25% smaller (kept 14/16 messages · 3% smaller · ...)
    gemini-compact: built-in summary: Gemini HTTP 429: Resource has been exhausted

Free tier'da toast'a `· sent to Gemini free tier` eklenir. Engine'in atladığı ya da başarısız olan otomatik bir compaction da bir satır yazar (`automatic compaction skipped: ...`, `automatic compaction failed: ...`).

## Komut

    /gemini-compact              on ya da off, mod, gemini-core'un tuttuğu model ve thinking seviyesi, eşik, tier, key var mı, son sonuç
    /gemini-compact on | off     off her compaction'ı yerleşik özete bırakır; gemini-core'da key yokken on reddedilir
    /gemini-compact mode summary | mode prune
    /gemini-compact at <1-99>    context'i bu yüzdenin üstünde bırakan bir turn'den sonra sıkıştırır
    /gemini-compact at off       otomatik compaction yok; /compact ve engine'in kendi compaction'ı yine Gemini'ye sorar
    /gemini-compact reset        plugin option'larına döner ve kapanır

Mod kurulumdan sonra kapalıdır: her compaction yerleşik olandır, mod'un eşiğinde hiçbiri başlamaz ve `/gemini-compact on`'a kadar Gemini'ye hiçbir şey gitmez. Komut ayarları session'lar arasında korunur ve hemen geçerli olur. Mod başlattığı bir compaction'dan sonra, bir turn context'i eşiğin altında bırakana kadar yenisini başlatmaz; böylece eşiğin üstünde kalan bir context her turn'den sonra sıkıştırılmaz.

Key, tier, model (varsayılan `gemini-3.5-flash-lite`) ve thinking seviyesi gemini-core'a aittir:

    /gemini-core model compact gemini-3.5-flash
    /gemini-core thinking compact low
    /gemini-core paid

## Free tier mı paid tier mı

Konuşmada prompt'ların, modelin çalıştırdığı komutlar ve okuduğu dosyaların içeriği vardır. Free tier'da Google bunları kullanabilir, insan denetçiler de okuyabilir; gemini-core README'si Gemini API Additional Terms'ten ilgili kısmı aktarır. Google'a göstermek istemediğin bir projede billing'i açık bir key kullan ve `/gemini-core paid` ayarla. Hiçbir mod bir key'in hangi tier'da olduğunu bilemez; tier ayarı yalnız uyarıyı seçer.

Model başına free tier sınırlarını Google AI Studio gösterir, dokümantasyon göstermez. Ölçülmediler. Uzun bir konuşmanın özeti tek bir büyük istektir; dakika başına bir token sınırı onu HTTP 429 ile reddedebilir, o zaman yerleşik özet çalışır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-compact@kilimcininkoroglu-mods

`gemini-core`'a bağlıdır; `claude plugin install` onu da kurar. Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

Yerel bir checkout'tan tek session için yüklemek istersen gemini-core'u da yanına koy:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/gemini-core --plugin-dir plugins/gemini-compact

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da, onun [After installing](../gemini-core/README.md#after-installing) bölümünde anlatıldığı gibi ayarla, sonra Claude Code'u yeniden başlat.
2. `/gemini-compact on` çalıştır. Key yoksa `still off: gemini-core has no Gemini key` cevabını verir ve kapalı kalır.
3. `/gemini-compact` çalıştır. İlk satır `on · summary · <model> · thinking ... · automatic at 60% · <tier> tier · key set` olmalı.
4. Bir kez `/compact` çalıştır. Transcript satırı `gemini-compact: summary:` ile başlamalı. `built-in summary:` ile başlayan bir satır Gemini'nin neden kullanılmadığını söyler.

0.2.x'ten güncelliyorsan: `claude plugin update` gemini-core'u eklemez (2.1.278 üzerinde ölçüldü), bu yüzden bir kez `claude plugin install gemini-core@kilimcininkoroglu-mods` çalıştır. 0.3.0 key'i, tier'ı ve modeli gemini-core'a taşıdı; `apiKey`, `tier` ve `model` option'ları ile daha önce `/gemini-compact free|paid|model` ile saklanan ayarlar artık okunmuyor, onları gemini-core'da yeniden ayarla. `mode` ve `at` ayarları kalır. 0.4.0 mod'u varsayılan olarak kapattı: daha eski bir sürümden güncellediysen ve önceden `/gemini-compact on` çalıştırmadıysan mod kapalıdır; bir kez `/gemini-compact on` çalıştır.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `mode` | `summary` | `summary` ya da `prune`; `/gemini-compact mode` onu geçersiz kılar |
| `compactAtPercent` | `60` | Otomatik eşik, 0 ile 99 arası; 0 kapatır; `/gemini-compact at` onu geçersiz kılar |
| `keepRecent` | `6` | Kelimesi kelimesine kalan (summary) ya da çağrıları hiç karara gönderilmeyen (prune) en yeni mesaj sayısı; 0 ile 1000 arası |
| `minReduction` | `0.25` | Prune modu: bu oranın (0 ile 1 arası) altında yerleşik özet çalışır |
| `headChars` | `300` | Prune modu: kısaltılan bir çıktıdan kalan karakter; 0 ile 100.000 arası |
| `maxInputChars` | `400000` | Prune modu: Gemini'ye giden en fazla karakter; 10.000 ile 4.000.000 arası |
| `summaryMaxInputChars` | `2000000` | Summary modu: Gemini'ye giden en fazla karakter; 10.000 ile 4.000.000 arası |

Aralık dışındaki bir değerin yerine varsayılan kullanılır.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-compact}, session.compact, turn.complete
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via compactWithGemini, runCommand, storePatch), $.http.fetch (via askGemini), $.session.compact (via maybeCompact), $.session.usage (via maybeCompact), $.store.delete (via runCommand), $.store.get (via loadConfig), $.store.set (via storePatch), $.ui.log, $.ui.toast (via report)

Reach L3: network'e çıkar.

    1. Okur:     her compaction'da konuşmayı (mesajlar, tool input'ları ve output'ları); her ana loop turn'ünden sonra context doluluğunu; kendi $.store dosyasını; gemini-core'dan key'i taşıyan isteği
    2. Çalıştırır: hiçbir process; eşiğin üstünde biten bir turn'den sonra bir $.session.compact, context yeniden eşiğin altına inene kadar en fazla bir kez
    3. Gönderir: konuşmayı (summary: en yeni mesajlar dışında hepsini; prune: tamamını), compaction başına bir istek (503 sonrası en fazla dört, 429 ya da key hatası sonrası ek key başına bir tane daha), gemini-core'un kurduğu URL'ye (generativelanguage.googleapis.com), key x-goog-api-key header'ında, hiçbir zaman URL'de değil
    4. Saklar:   $.store içinde üç komut ayarını (enabled, mode, atPercent); son sonuç bellekte yaşar
    5. Düşman girdi: Gemini cevabı güvenilmezdir: bir prune cevabı yalnız schema biçiminde ve her aday id tam bir kez geçiyorsa uygulanır; bir özet, modelin okuduğu bir kullanıcı mesajının metni olur, yani düşman bir özet modeli okuduğu bir dosyadaki metin gibi yönlendirebilir; bozuk her şey yerleşik özete düşer

## Sınırlar

- Bir özet ve bir drop kararı bir modelin yargısıdır. Özet, en yeni mesajların tekrarlamadığı ayrıntıyı kaybeder. Prune notu modele hangi çağrıların çalıştığını söyler, model de bir tool'u yeniden çalıştırabilir.
- Compaction'dan sonra context cache'e yeniden yazılır. Prune modunda context yerleşik bir özetten büyük kaldığı için sonraki mesaj daha büyük bir cache yazımı öder.
- Uzun bir konuşmanın özeti Gemini'de daha uzun sürer ve compaction onu bekler. Yalnız kısa konuşmalar ölçüldü.
- Bir subagent'ın kendi compaction'ı engine'e bırakılır.
- Engine'in önceden hesapladığı bir compaction (`precompute`) da Gemini'ye sorar. Engine'in bu sonucu ardından gelen compaction için kullanıp kullanmadığı ölçülmedi.
- `claude plugin test`'in test engine'i bir `$.session.compact()` çağrısına `trigger` geçirmez. `plugin` trigger'ı ve ona cevap veren hook canlı bir session'da ölçüldü.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
