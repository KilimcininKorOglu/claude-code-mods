# gemini-compact

Compaction'ı Claude'dan Gemini'ye taşıyan bir Claude Code Mod'u. İki modu vardır:

- **summary** (varsayılan): Gemini, en yeni 6 mesajdan öncesini özetler ve o mesajlar özetin ardından kelimesi kelimesine kalır. Claude hiçbir özet yazmaz; engine'in yerleşik özeti yalnız Gemini başarısız olduğunda çalışır.
- **prune**: Gemini, eski her tool çağrısı için, çağrının ve çıktısının kalıp kalmayacağını, çıktısı kısaltılarak mı kalacağını ya da gideceğini söyler. Her kullanıcı ve assistant mesajı kelimesi kelimesine kalır. Hiçbir şey özetlenmez.

Prune fikri, Tamara Tran'ın TypeSafe Jev'e soran fast-jev-compaction mod'unu izler (tamaratran/fast-jev-compaction). Kod yenidir ve Gemini'ye sorar.

## Hangi mod

Yerleşik compaction tek bir Claude isteğidir: tüm context'i okur ve bir özet yazar, ve o istek sizin Claude kullanımınıza sayılır. İki mod da o isteğin yerine bir Gemini isteği koyar.

Compaction'dan sonra her Claude isteği geriye kalanı okur. summary modunda bu, özet ve en yeni mesajlardır; yerleşik özetin bıraktığına yakındır. prune modunda ise konuşmanın her mesajı eksi atılan tool çıktısıdır; bu daha büyüktür, yani sonraki her istek daha fazlasını okur. Boyutlar uzun bir session'da ölçülmedi.

En çok Claude kullanımını korumak için summary modunu kullanın. Her mesajın tam ifadesi boyuttan önemliyse prune modunu kullanın.

## Summary modu

1. `/compact` anında, engine'in kendi compaction'ında ve context eşiğin üstündeyken biten bir turn'den sonra, `session.compact` hook'u konuşmayı alır.
2. En yeni 6 mesaj kalır. Kesim noktası geriye, bir assistant mesajına kayar; böylece bir tool sonucu hiçbir zaman çağrısı olmadan kalmaz ve korunan kısım özetten sonra bir assistant mesajıyla açılır.
3. Tek bir `generateContent` isteği kesimden öncesini Gemini'ye gönderir: her mesajı ve her çağrıyı input'u ile tam output'u ile birlikte. 2.000.000 karakterin üstünde önce en uzun çıktılar baş ve son kısmına kısaltılır.
4. Gemini dokuz bölümlü düz metin bir özet yazar: istek ve niyet, teknik kavramlar, dosyalar ve kod, hatalar ve düzeltmeler, problem çözme, her kullanıcı mesajı kelimesi kelimesine, bekleyen işler, şu anki iş ve sonraki adım. `/compact` sonrasına yazdığınız metin ona iletilir.
5. Konuşma, tek bir kullanıcı mesajına (bir not, sonra özet) ve onu izleyen korunan mesajlara dönüşür; bunlar engine'in kendi mesajları olarak geri döner.
6. Key yoksa, Gemini başarısız olursa, özet 200 karakterin altındaysa ya da output limitinde (32.768 token) kesilmişse, veya sonuç konuşmadan küçük değilse yerleşik özet çalışır ve bir satır sebebini söyler.

İki modda da isteği gemini-core kurar: `gemini-compact` için tuttuğu key, model ve thinking seviyesi ile; cevabı da o okur. HTTP 503 ("high demand") sonrasında mod 1 sn, 2 sn ve 3 sn sonra tekrar sorar, en fazla dört kere, ve 60 saniye geçtikten sonra yeni deneme başlatmaz.

2.1.277 üzerindeki canlı testte `/compact`, `gemini-3.5-flash-lite` ile 2,6 saniye sürdü, Claude hiç compaction isteği göndermedi ve sonrasında model yalnız özetlenen kısımda geçen bir kelimeyi ve bir dosyayı adlandırdı.

## Prune modu

1. Aynı üç tetikleyici `session.compact` hook'una ulaşır.
2. İlk mesajdaki ve en yeni 6 mesajdaki tool çağrıları bütün olarak korunur. Diğer her çağrı bir id alır (`c1`, `c2`, ...).
3. Tek bir `generateContent` isteği konuşmayı Gemini'ye gönderir: her mesajı ve her çağrıyı input'u ile tam output'u ile birlikte. 400.000 karakterin üstünde önce en uzun çıktılar baş ve son kısmına kısaltılır. Bir response schema, id başına tam olarak bir cevaba izin verir: `keep`, `truncate` ya da `drop`.
4. Mod cevabı kontrol eder (her id tam bir kere, başka id yok) ve konuşmayı yeniden kurar:
   - `keep`: çağrı ve çıktısı kalır.
   - `truncate`: çağrı kalır, çıktı ilk 300 karakterini ve kesildiğini söyleyen bir satırı korur.
   - `drop`: çağrı ve çıktısı gider. En yakın assistant mesajındaki bir not kaldırılan çağrıları adlandırır, örneğin `[gemini-compact removed 1 earlier tool call(s) and their output after a compaction; they ran: Bash(ls -la /usr/bin)]`. Not olmadan model, işi gitmiş bir cevabı okudu ve o işi hiç yapmadığını söyledi (2.1.277 üzerinde ölçüldü).
   - Cevabın dokunmadığı bir mesaj engine'in kendi mesajı olarak geri döner.
5. Sonuç %25'ten az küçüldüyse ya da bir şey başarısız olduysa (key yok, bir HTTP hatası, schema'yı bozan bir cevap), engine'in yerleşik özeti çalışır ve bir satır sebebini söyler.

2.1.277 üzerindeki canlı testte `/compact`, `gemini-3.5-flash-lite` ile 1,1 saniye sürdü. Gemini bir `ls` listesini attı ve kullanıcının düzenlemek üzere olduğu bir dosyanın `cat` çıktısını korudu; konuşma %93 küçüldü.

## Ne gösterir

**Transcript'te bir satır**, modele gitmez, ve bir toast:

    gemini-compact: summary: 58 → 7 messages · 91% smaller · 312k in, 5k out
    gemini-compact: kept 9/11 messages · 93% smaller · 1 dropped, 0 truncated · 5k in, 59 out
    gemini-compact: built-in summary: under 25% smaller (kept 14/16 messages · 3% smaller · ...)
    gemini-compact: built-in summary: Gemini HTTP 429: Resource has been exhausted

Free tier'da toast `· sent to Gemini free tier` ekler.

## Komut

    /gemini-compact              on ya da off, mod, gemini-core'un tuttuğu model ve thinking seviyesi, eşik, tier, key var mı, son sonuç
    /gemini-compact on | off     off her compaction'ı yerleşik özete bırakır; gemini-core'da key yokken on reddedilir
    /gemini-compact mode summary | mode prune
    /gemini-compact at <1-99>    context bu yüzdenin üstündeyken biten bir turn'den sonra compact et
    /gemini-compact at off       otomatik compaction yok; /compact ve engine'in kendi compaction'ı yine Gemini'ye sorar
    /gemini-compact reset        plugin option'larına dön, ve off

Mod kurulumdan sonra kapalıdır: her compaction yerleşiktir, hiçbiri mod'un eşiğinde başlamaz ve `/gemini-compact on` yazılana kadar Gemini'ye hiçbir şey gönderilmez. Komut ayarları session'lar arasında saklanır ve hemen geçerli olur. Kendi başlattığı bir compaction'dan sonra mod, context eşiğin altındayken biten bir turn olana kadar başka bir tane başlatmaz; böylece eşiğin üstünde kalan bir context her turn'den sonra compact edilmez.

Key, tier, model (varsayılan `gemini-3.5-flash-lite`) ve thinking seviyesi gemini-core'a aittir:

    /gemini-core model compact gemini-3.5-flash
    /gemini-core thinking compact low
    /gemini-core paid

## Free tier ya da paid tier

Konuşma; prompt'larınızı, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini tutar. Free tier'da Google bunları kullanabilir ve insan denetçiler okuyabilir; gemini-core README'si Gemini API Additional Terms'ten alıntılar. Google'a göstermeyeceğiniz bir projede billing açık bir key kullanın ve `/gemini-core paid` ayarlayın. Hiçbir mod bir key'in hangi tier'da olduğunu bilemez; tier ayarı yalnız uyarıyı seçer.

Model başına free tier limitleri Google AI Studio'da gösterilir, dokümantasyonda değil. Ölçülmedi. Uzun bir konuşmanın özeti tek bir büyük istektir, yani dakika başına token limiti onu HTTP 429 ile reddedebilir; o zaman yerleşik özet çalışır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-compact@kilimcininkoroglu-mods

`gemini-core`'a bağlıdır; `claude plugin install` onu da ekler. Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

Tek bir session için local checkout'tan, yanında gemini-core ile yükleyin:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/gemini-core --plugin-dir plugins/gemini-compact

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da ayarlayın, onun [After installing](../gemini-core/README.md#after-installing) bölümünde yazdığı gibi, sonra Claude Code'u yeniden başlatın.
2. `/gemini-compact on` çalıştırın. Key olmadan `still off: gemini-core has no Gemini key` cevabını verir ve kapalı kalır.
3. `/gemini-compact` çalıştırın. İlk satır `on · summary · <model> · thinking ... · automatic at 60% · <tier> tier · key set` demelidir.
4. Bir kere `/compact` çalıştırın. Transcript satırı `gemini-compact: summary:` ile başlamalıdır. `built-in summary:` ile başlayan bir satır Gemini'nin neden kullanılmadığını adlandırır.

0.2.x'ten güncellemeden sonra: `claude plugin update` gemini-core'u eklemez (2.1.278 üzerinde ölçüldü), bu yüzden bir kere `claude plugin install gemini-core@kilimcininkoroglu-mods` çalıştırın. 0.3.0 sürümü key, tier ve model'i gemini-core'a taşıdı; daha önce saklanan `apiKey`, `tier` ve `model` option'ları ile `/gemini-compact free|paid|model` ayarları artık okunmuyor, onları gemini-core'da yeniden ayarlayın. `mode` ve `at` ayarları kalır. 0.4.0 sürümü mod'u varsayılan olarak kapattı: daha eski bir sürümden güncellediyseniz, daha önce `/gemini-compact on` çalıştırmadıysanız kapalıdır; bir kere `/gemini-compact on` çalıştırın.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `mode` | `summary` | `summary` ya da `prune`; `/gemini-compact mode` onu ezer |
| `compactAtPercent` | `60` | Otomatik eşik; 0 kapatır; `/gemini-compact at` onu ezer |
| `keepRecent` | `6` | Kelimesi kelimesine korunan en yeni mesaj sayısı (summary) ya da çağrıları karar için hiç gönderilmeyen mesaj sayısı (prune) |
| `minReduction` | `0.25` | Prune modu: bu oranın altında yerleşik özet çalışır |
| `headChars` | `300` | Prune modu: kısaltılan bir çıktıdan korunan karakter sayısı |
| `maxInputChars` | `400000` | Prune modu: Gemini'ye en fazla gönderilen karakter |
| `summaryMaxInputChars` | `2000000` | Summary modu: Gemini'ye en fazla gönderilen karakter |

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-compact}, session.compact, turn.complete
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via compactWithGemini, runCommand, storePatch), $.http.fetch (via askGemini), $.session.compact (via maybeCompact), $.session.usage (via maybeCompact), $.store.delete (via runCommand), $.store.get (via loadConfig), $.store.set (via storePatch), $.ui.log, $.ui.toast (via report)

Reach L3, network'e çıkar.

    1. Okur:     her compaction'da konuşmayı (mesajlar, tool input'ları ve output'ları); her main-loop turn'ünden sonra context doluluğunu; kendi $.store dosyasını; gemini-core'dan key'i taşıyan isteği
    2. Çalıştırır: hiçbir process; eşiğin üstünde biten bir turn'den sonra bir $.session.compact, context tekrar eşiğin altına inene kadar en fazla bir kere
    3. Gönderir: konuşmayı (summary: en yeni mesajlar dışında hepsi; prune: tamamı), compaction başına bir istek (503 sonrası en fazla dört, 429 ya da key hatası sonrası ek key başına bir tane daha), gemini-core'un kurduğu URL'ye (generativelanguage.googleapis.com), key x-goog-api-key header'ında, hiçbir zaman URL'de değil
    4. Saklar:   $.store içinde üç komut ayarını (enabled, mode, atPercent); son sonuç bellekte yaşar
    5. Düşman girdi: Gemini cevabı güvenilmezdir: bir prune cevabı yalnız schema şeklinde ve her aday id bir kere geçtiğinde uygulanır; bir özet, modelin okuduğu tek bir kullanıcı mesajının metni olur, yani düşman bir özet modeli, okuduğu bir dosyadaki metin gibi yönlendirebilir; bozuk her şey yerleşik özete düşer

## Sınırlar

- Bir özet ve bir atma, bir modelin kararıdır. Özet, en yeni mesajların tekrarlamadığı ayrıntıyı kaybeder. Prune notu modele hangi çağrıların çalıştığını söyler, böylece bir tool'u tekrar çalıştırabilir.
- Compaction'dan sonra context tekrar cache'e yazılır. Prune modunda yerleşik özetten büyük kalır, yani sonraki mesaj daha büyük bir cache write öder.
- Uzun bir konuşmanın özeti Gemini'nin daha uzun sürmesine yol açar; compaction onu bekler. Yalnız kısa konuşmalar ölçüldü.
- Bir subagent'ın kendi compaction'ı engine'e bırakılır.
- Engine'in önceden hesapladığı bir compaction (`precompute`) da Gemini'ye sorar. Engine'in o sonucu sonraki compaction'da yeniden kullanıp kullanmadığı ölçülmedi.
- `claude plugin test` test engine'i bir `$.session.compact()` çağrısına `trigger` geçirmez. `plugin` tetikleyicisi ve onu cevaplayan hook canlı bir session'da ölçüldü.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
