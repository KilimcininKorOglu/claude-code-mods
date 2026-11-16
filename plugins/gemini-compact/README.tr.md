# gemini-compact

Context dolduğunda Claude onu bir Claude isteği daha göndererek sıkıştırır. Bu istek bütün context'i okur ve bir özet yazar. Bu istek de Claude kullanımınızdan düşer. Bu mod bu işi Gemini'ye verir. Modun iki modu vardır:

- **summary** (varsayılan): Gemini, konuşmanın en yeni 6 mesajdan önceki kısmını özetler. Bu 6 mesaj, özetten sonra kelimesi kelimesine kalır. Claude özet yazmaz. Engine'in yerleşik özeti yalnız Gemini başarısız olduğunda çalışır.
- **prune**: Gemini, her eski tool çağrısı için karar verir: çağrı ve çıktısı kalır, çıktısı kısaltılarak kalır ya da kaldırılır. Kullanıcının ve asistanın her mesajı kelimesi kelimesine kalır. Hiçbir şey özetlenmez.

Prune fikri, Tamara Tran'ın fast-jev-compaction projesinden (tamaratran/fast-jev-compaction) alındı. O proje TypeSafe Jev'e sorar. Buradaki kod yeni yazıldı ve Gemini'ye sorar.

## Hangi mod

İki mod da yerleşik compaction'ın Claude isteğinin yerine bir Gemini isteği koyar.

Compaction'dan sonra her Claude isteği geriye kalan metni okur. Summary modunda bu, özet ve en yeni mesajlardır. Bu, yerleşik özetin bıraktığı boyuta yakındır. Prune modunda ise bu, konuşmanın bütün mesajlarıdır, yalnız kaldırılan tool çıktıları eksiktir. Bu daha büyüktür. Bu yüzden sonraki her istek daha fazla okur. Boyutlar uzun bir session'da ölçülmedi.

Claude kullanımından en fazla tasarruf için summary modunu seçin. Her mesajın birebir metni boyuttan daha önemliyse prune modunu seçin.

## Summary modu

1. `/compact` sırasında, engine'in kendi compaction'ında ve cevapla biten bir ana loop turn'ü context'i eşiğin üstünde bıraktığında, `session.compact` hook'u konuşmayı alır.
2. En yeni 6 mesaj kalır. Kesim noktası bir asistan mesajına geri çekilir. Böylece hiçbir tool sonucu, çağrısı olmadan kalmaz ve özetten sonra kalan kısım bir asistan mesajıyla başlar. Kesim yapılacak bir asistan mesajı yoksa her şey özetlenir.
3. Tek bir `generateContent` isteği, kesimden önceki her şeyi Gemini'ye gönderir: her mesajı ve her çağrıyı, input'u ve tam çıktısıyla. Metin `summaryMaxInputChars` sınırını (varsayılan 2.000.000 karakter) aşarsa en uzun çıktılar ortak bir uzunluğa kısaltılır. Her çıktının başı ve sonu korunur. Bütün çıktılar çıkarıldığında bile sınırı aşan bir konuşmanın compaction'ı başarısız olur.
4. Gemini dokuz bölümlük, düz metin bir özet yazar: istek ve amaç, teknik kavramlar, dosyalar ve kod, hatalar ve düzeltmeler, problem çözme, kullanıcının bütün mesajları kelimesi kelimesine, bekleyen görevler, o anki iş ve sonraki adım. `/compact` komutundan sonra yazdığınız metin de özetle birlikte Gemini'ye gönderilir.
5. Konuşma, tek bir kullanıcı mesajına (önce bir not, ardından özet) ve onu izleyen kalan mesajlara dönüşür. Kalan mesajlar, engine'in kendi mesajları olarak geri gönderilir.
6. Şu durumlarda yerleşik özet çalışır ve bir satır nedeni bildirir: key yoksa, en yeni mesajlardan önce hiçbir şey yoksa, Gemini başarısız olursa, özet 200 karakterden kısaysa ya da çıktı sınırında (32.768 token) kesildiyse ya da sonuç konuşmadan küçük değilse.

İki modda da isteği gemini-core oluşturur: `gemini-compact` için tuttuğu key, model ve thinking seviyesiyle. Cevabı da gemini-core okur. Bir HTTP 503 ("high demand") hatasından sonra mod 1, 2 ve 3 saniye sonra yeniden sorar. Toplam en fazla dört deneme yapılır. Beklemesi 60 saniyeyi aşacak bir deneme başlatılmaz. Bir 429 ya da key hatasından sonra gemini-core, başka bir key'i varsa isteği o key ile yeniden gönderir.

2.1.277 üzerinde yapılan canlı denemede `/compact`, `gemini-3.5-flash-lite` ile 2,6 saniye sürdü. Claude hiçbir compaction isteği göndermedi. Ardından model, yalnız özetlenen kısımda geçen bir kelimeyi ve bir dosyayı adıyla belirtti.

## Prune modu

1. Aynı üç tetikleyici `session.compact` hook'una ulaşır.
2. İlk mesajdaki ya da en yeni 6 mesajdaki bir tool çağrısı ve sonucu bu mesajlardan birinde olan bir çağrı tamamıyla kalır. Diğer her çağrı bir id alır (`c1`, `c2`, ...). Böyle bir çağrı yoksa yerleşik özet çalışır.
3. Tek bir `generateContent` isteği konuşmayı Gemini'ye gönderir: her mesajı ve her çağrıyı, input'u ve tam çıktısıyla. `maxInputChars` sınırının (varsayılan 400.000 karakter) üstünde en uzun çıktılar, summary modundaki gibi kısaltılır. Bir response schema, her id için tam olarak bir cevaba izin verir: `keep`, `truncate` ya da `drop`.
4. Mod cevabı kontrol eder (her id tam bir kez, başka id yok) ve konuşmayı yeniden oluşturur:
   - `keep`: çağrı ve çıktısı kalır.
   - `truncate`: çağrı kalır. Çıktının ilk 300 karakteri ve çıktının kesildiğini bildiren bir satır kalır. Bu sınırdan en fazla 120 karakter uzun bir çıktı tamamıyla kalır.
   - `drop`: çağrı ve çıktısı kaldırılır. En yakın asistan mesajına, kaldırılan çağrıları listeleyen bir not eklenir, örneğin `[gemini-compact removed 1 earlier tool call(s) and their output after a compaction; they ran: Bash(ls -la /usr/bin)]`. Not olmadığında model, yaptığı işin kaldırıldığı bir cevabını okudu ve bu işi hiç yapmadığını söyledi (2.1.277 üzerinde ölçüldü).
   - Cevabın değiştirmediği bir mesaj, engine'in kendi mesajı olarak geri gönderilir.
5. Sonuç %25'ten az küçüldüyse ya da bir adım başarısız olursa (key yok, bir HTTP hatası, schema'ya uymayan bir cevap) engine'in yerleşik özeti çalışır ve bir satır nedeni bildirir.

2.1.277 üzerinde yapılan canlı denemede `/compact`, `gemini-3.5-flash-lite` ile 1,1 saniye sürdü. Gemini bir `ls` listesini kaldırdı ve kullanıcının düzenlemek üzere olduğu bir dosyanın `cat` çıktısını tuttu. Konuşma %93 küçüldü.

## Ne gösterir

Transcript'e modele gönderilmeyen **tek bir satır** yazılır. Ayrıca 15 saniye görünen bir toast çıkar:

    gemini-compact: summary: 58 → 7 messages · 91% smaller · 312k in, 5k out
    gemini-compact: kept 9/11 messages · 93% smaller · 1 dropped, 0 truncated · 5k in, 59 out
    gemini-compact: built-in summary: under 25% smaller (kept 14/16 messages · 3% smaller · ...)
    gemini-compact: built-in summary: Gemini HTTP 429: Resource has been exhausted

Free tier'da toast'a `· sent to Gemini free tier` eklenir. Engine'in atladığı ya da başarısız olan otomatik bir compaction da bir satır yazar (`automatic compaction skipped: ...`, `automatic compaction failed: ...`).

## Komut

    /gemini-compact              açık mı kapalı mı, mod, gemini-core'un tuttuğu model ve thinking seviyesi, eşik, tier, key var mı, son sonuç
    /gemini-compact on | off     off, her compaction'ı yerleşik özete bırakır; gemini-core'da key yokken on reddedilir
    /gemini-compact mode summary | mode prune
    /gemini-compact at <1-99>    context'i bu yüzdenin üstünde bırakan bir turn'den sonra sıkıştırır
    /gemini-compact at off       otomatik compaction yok; /compact ve engine'in kendi compaction'ı yine Gemini'ye sorar
    /gemini-compact reset        plugin option'larına döner ve modu kapatır

Mod yüklendikten sonra kapalıdır: her compaction yerleşik compaction'dır, modun eşiğinde hiçbir compaction başlamaz ve `/gemini-compact on` komutuna kadar Gemini'ye hiçbir şey gönderilmez. Komut ayarları session'lar arasında korunur ve hemen geçerli olur. Mod, başlattığı bir compaction'dan sonra, bir turn context'i eşiğin altında bırakana kadar yeni bir compaction başlatmaz. Böylece eşiğin üstünde kalan bir context her turn'den sonra sıkıştırılmaz.

Key, tier, model (varsayılan `gemini-3.5-flash-lite`) ve thinking seviyesi gemini-core'da tutulur:

    /gemini-core model compact gemini-3.5-flash
    /gemini-core thinking compact low
    /gemini-core paid

## Free tier mı, paid tier mı

Konuşma, prompt'larınızı, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini içerir. Free tier'da Google bu verileri kullanabilir ve insan denetçiler de okuyabilir. gemini-core README'si, Gemini API Additional Terms belgesinin ilgili kısmını aktarır. Google'a göstermek istemediğiniz bir projede billing'i açık bir key kullanın ve `/gemini-core paid` ayarını yapın. Hiçbir mod bir key'in hangi tier'da olduğunu bilemez. Tier ayarı yalnız hangi uyarının gösterileceğini seçer.

Her modelin free tier sınırlarını Google AI Studio gösterir, belgeler göstermez. Bu sınırlar ölçülmedi. Uzun bir konuşmanın özeti tek bir büyük istektir. Dakika başına bir token sınırı bu isteği HTTP 429 ile reddedebilir. Bu durumda yerleşik özet çalışır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-compact@kilimcininkoroglu-mods

Mod `gemini-core`'a bağlıdır ve `claude plugin install` onu da yükler. Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

Modu yerel bir checkout'tan tek bir session için yüklemek için gemini-core'u da ekleyin:

    claude --plugin-dir plugins/gemini-core --plugin-dir plugins/gemini-compact

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da, gemini-core'un [Kurulumdan sonra](../gemini-core/README.tr.md#kurulumdan-sonra) bölümünde anlatıldığı gibi ayarlayın. Ardından Claude Code'u yeniden başlatın.
2. `/gemini-compact on` komutunu çalıştırın. Key yoksa komut `still off: gemini-core has no Gemini key` cevabını verir ve mod kapalı kalır.
3. `/gemini-compact` komutunu çalıştırın. İlk satır `on · summary · <model> · thinking ... · automatic at 60% · <tier> tier · key set` olmalıdır.
4. Bir kez `/compact` komutunu çalıştırın. Transcript satırı `gemini-compact: summary:` ile başlamalıdır. `built-in summary:` ile başlayan bir satır, Gemini'nin neden kullanılmadığını bildirir.

0.2.x sürümünden güncelliyorsanız: `claude plugin update` gemini-core'u eklemez (2.1.278 üzerinde ölçüldü). Bu yüzden bir kez `claude plugin install gemini-core@kilimcininkoroglu-mods` komutunu çalıştırın. 0.3.0 sürümü key'i, tier'ı ve modeli gemini-core'a taşıdı. `apiKey`, `tier` ve `model` option'ları ile daha önce `/gemini-compact free|paid|model` ile saklanan ayarlar artık okunmaz. Bu ayarları gemini-core'da yeniden yapın. `mode` ve `at` ayarları korunur. 0.4.0 sürümü modu varsayılan olarak kapattı. Daha eski bir sürümden güncellediyseniz ve daha önce `/gemini-compact on` çalıştırmadıysanız mod kapalıdır. Bir kez `/gemini-compact on` komutunu çalıştırın.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `mode` | `summary` | `summary` ya da `prune`; `/gemini-compact mode` bu değerin yerine geçer |
| `compactAtPercent` | `60` | Otomatik eşik, 0 ile 99 arası; 0 kapatır; `/gemini-compact at` bu değerin yerine geçer |
| `keepRecent` | `6` | Kelimesi kelimesine kalan (summary) ya da çağrıları hiç karara gönderilmeyen (prune) en yeni mesaj sayısı; 0 ile 1000 arası |
| `minReduction` | `0.25` | Prune modu: küçülme bu oranın (0 ile 1 arası) altındaysa yerleşik özet çalışır |
| `headChars` | `300` | Prune modu: kısaltılan bir çıktıdan kalan karakter sayısı; 0 ile 100.000 arası |
| `maxInputChars` | `400000` | Prune modu: Gemini'ye gönderilen en fazla karakter sayısı; 10.000 ile 4.000.000 arası |
| `summaryMaxInputChars` | `2000000` | Summary modu: Gemini'ye gönderilen en fazla karakter sayısı; 10.000 ile 4.000.000 arası |

Aralık dışındaki bir değerin yerine varsayılan değer kullanılır.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-compact}, session.compact, turn.complete
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via compactWithGemini, runCommand, storePatch), $.http.fetch (via askGemini), $.session.compact (via maybeCompact), $.session.usage (via maybeCompact), $.store.delete (via runCommand), $.store.get (via loadConfig), $.store.set (via storePatch), $.ui.log, $.ui.toast (via report)

Reach L3: network'e erişir.

    1. Okur:         her compaction'da konuşmayı (mesajlar, tool input'ları ve output'ları); her ana loop turn'ünden sonra context doluluğunu; kendi $.store dosyasını; gemini-core'dan key'i içeren isteği
    2. Çalıştırır:   hiçbir process; eşiğin üstünde biten bir turn'den sonra bir $.session.compact, context yeniden eşiğin altına inene kadar en fazla bir kez
    3. Gönderir:     konuşmayı (summary: en yeni mesajlar dışında hepsini; prune: tamamını), her compaction için bir istekle (bir 503 sonrasında en fazla dört, bir 429 ya da key hatası sonrasında her ek key için bir istek daha), gemini-core'un oluşturduğu URL'ye (generativelanguage.googleapis.com); key x-goog-api-key header'ında gönderilir, hiçbir zaman URL'de değil
    4. Saklar:       üç komut ayarını (enabled, mode, atPercent) $.store içinde; son sonuç bellekte tutulur
    5. Düşman girdi: Gemini cevabı güvenilmezdir: bir prune cevabı yalnız schema biçimindeyse ve her aday id tam bir kez geçiyorsa uygulanır; bir özet, modelin okuduğu bir kullanıcı mesajının metni olur, bu yüzden düşmanca bir özet, modelin okuduğu bir dosyadaki metin gibi modeli yönlendirebilir; bozuk her cevapta yerleşik özet çalışır

## Sınırlar

- Bir özet ve bir drop kararı, bir modelin yargısıdır. Özet, en yeni mesajların tekrarlamadığı ayrıntıları kaybeder. Prune notu modele hangi çağrıların çalıştığını bildirir. Böylece model bir tool'u yeniden çalıştırabilir.
- Compaction'dan sonra context cache'e yeniden yazılır. Prune modunda context yerleşik bir özetten büyük kalır. Bu yüzden sonraki mesaj daha büyük bir cache write maliyeti öder.
- Uzun bir konuşmanın özeti Gemini'de daha uzun sürer ve compaction bu özeti bekler. Yalnız kısa konuşmaların süresi ölçüldü.
- Bir subagent'ın kendi compaction'ı engine'e bırakılır.
- Engine'in önceden hesapladığı bir compaction (`precompute`) da Gemini'ye sorar. Engine'in bu sonucu sonraki compaction için kullanıp kullanmadığı ölçülmedi.
- `claude plugin test`'in test engine'i, bir `$.session.compact()` çağrısına `trigger` değeri vermez. `plugin` trigger'ı ve ona cevap veren hook canlı bir session'da ölçüldü.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
