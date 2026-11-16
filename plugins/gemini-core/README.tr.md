# gemini-core

Birden çok mod Gemini'ye istek gönderir. Her mod kendi key'ini, tier'ını ve modelini tutarsa yeni bir key, her mod için ayrı bir ayar değişikliği gerektirir. Bu mod, bütün Gemini modlarının Gemini ayarlarını tek bir yerde tutar: hepsi için key ve tier, her biri için model ve thinking seviyesi. Mod, engine arayüzüne `$.gemini` ekler. `gemini-compact`, `gemini-advisor`, `gemini-review` ve `gemini-plan-review` bu moda bağlıdır ve Gemini isteklerini bu mod ile oluşturur. `council` yüklüyse bu modu kullanır, ancak ona bağlı değildir.

## Ne yapar

1. Her Gemini modu, session başında plugin adıyla ve varsayılan modeliyle kaydolur.
2. Bir mod Gemini'ye istek göndereceği zaman `$.gemini.request`, modun gövdesinden `generateContent` isteğini oluşturur. Key `x-goog-api-key` header'ına yazılır, hiçbir zaman URL'ye yazılmaz. Model, modun modelidir. Thinking seviyesi `generationConfig.thinkingConfig.thinkingLevel` alanına yazılır. Seviye ayarlı değilse gövde olduğu gibi gönderilir ve model kendi varsayılanını kullanır. Bir mod, tek bir istek için başka bir model belirtebilir (`model`). Modun thinking seviyesi bu isteğe de uygulanır.
3. Mod isteği kendi `$.http.fetch` çağrısıyla gönderir ve cevabı `$.gemini.read` okur. Sonuç şunlardan biridir: metin ve token sayıları, Gemini'nin hata mesajı ya da bir HTTP 503'ten sonra aynı isteği yeniden göndermeden önceki bekleme süresi (1, 2, 3 saniye; en fazla dört deneme; modun süre sınırı geçtiyse deneme yapılmaz). Bir HTTP 429 ya da key hatasından sonra `$.gemini.read` aynı isteği sıradaki key ile oluşturur ve mod bu isteği hemen gönderir.

Bir plugin noun'unun method'u 10 saniye içinde cevap vermelidir (2.1.278 üzerinde ölçüldü: bir method içindeki 14 saniyelik bir fetch, `did not answer within 10000ms` ile reddedildi). Bir Gemini isteği bundan uzun sürebilir. Bu yüzden isteği `$.gemini` değil, mod gönderir.

## Thinking seviyeleri

`minimal`, `low`, `medium` ve `high`. Bir modelin hangi seviyeleri kabul ettiği modele göre değişir ve mod bunun bir tablosunu tutmaz. Desteklenmeyen bir seviye, Gemini'den HTTP 400 olarak döner ve isteği gönderen mod bu hatayı gösterir. 2.1.278 üzerinde ölçüldü:

| Model | minimal | low | medium | high |
|---|---|---|---|---|
| `gemini-3.8-flash` | HTTP 400 "Thinking level MINIMAL is not supported for this model" | evet | evet | evet |
| `gemini-3.5-flash-lite` | evet | evet | evet | evet |

Gemini belgelerine göre Gemini 3.1 Pro da `minimal` kabul etmez.

## Komut

    /gemini-core [status]                           tier, kaç key ayarlı, kayıtlı her modun modeli ve thinking seviyesi
    /gemini-core free | paid                        her Gemini modunun tier'ı; free aşağıdaki uyarıyı yazar
    /gemini-core models [refresh]                   key'in listelediği Gemini text modelleri
    /gemini-core model <mod>                        bu listeden modun modelini seçmek için bir pane
    /gemini-core model <mod> <id>                   örneğin: model review gemini-3.7-flash; listede olmayan bir id reddedilir
    /gemini-core thinking <mod> <level|default>     örneğin: thinking compact low; default seviyeyi kaldırır
    /gemini-core reset                              tier plugin option'ından alınır, her mod varsayılan modeline döner ve seviyesi kaldırılır

Bir modu tam adıyla (`gemini-review`) ya da `gemini-` olmadan (`review`) yazabilirsiniz. Ayarlar session'lar arasında korunur ve bir sonraki istekte geçerli olur. Bir mod, bir değişikliği izlemek için `gemini.configure` hook'unu kullanabilir.

`ownModels` ile kaydolan bir mod, her isteğin modelini kendisi seçer. `council` üyeleri için bunu yapar. Status bu modu `council: models set by the mod · thinking model default` olarak gösterir. `model <mod>` bu mod için Google'a hiç sorulmadan reddedilir. Thinking seviyesi ise diğer modlarda olduğu gibi burada ayarlanır.

## Model listesi

Liste, Google'ın `models.list` çağrısından alınır (`GET /v1beta/models`, key `x-goog-api-key` header'ında). Liste, bir komut ona ilk ihtiyaç duyduğunda istenir ve session boyunca bellekte tutulur. `models refresh` listeyi yeniden ister. Bir key başarısız olursa sıradaki key kullanılır. `generateContent` kabul eden ve id'si `gemini-` ile başlayan modeller listede kalır. `tts` ya da `image` içeren id'ler dışarıda bırakılır, çünkü bu modeller ses ya da resimle cevap verir. Denenen key'de Google 58 model listeledi ve bunların 21'i listede kaldı (2.1.278 üzerinde ölçüldü). Filtre yalnız adlara bakar. Bu yüzden başka türden olan ancak adında bunu belirtmeyen yeni bir model listede kalır. Bu durumda isteği gönderen moda Gemini'nin kendi hatası ulaşır.

`/gemini-core model <mod>`, listeyi bir `Select` içinde gösteren bir pane açar. Modun şu anki modeli seçili gelir. Enter seçimi ayarlar, bir toast ile gösterir ve pane'i kapatır. Esc pane'i hiçbir şeyi değiştirmeden kapatır. Terminalde Select, on satırlık kaydırılabilir bir liste çizer. `Select` bileşeni olmayan bir surface (mobil) listeyi ve seçimi yapan komutu gösterir. Komutla verilen bir id listede yoksa en yakın üç id ile birlikte reddedilir:

    gemini-9-flash is not a Gemini text model this key lists; closest: gemini-2.5-flash, gemini-3.5-flash, gemini-3.6-flash.

## Birden çok key

`apiKey` option'ı ve `GEMINI_API_KEY`, virgülle ayrılmış bir liste kabul eder. Option ayarlıysa option kullanılır. Boşluklar ve tekrarlanan key'ler çıkarılır. Key'ler sırayla denenir:

- HTTP 429 (kota), 401, 403 ya da 400 "API key not valid" veya "API key expired" gelirse aynı istek hemen sıradaki key ile gönderilir. Son key'den sonra ilk key'e dönülür ve her key bir istek için bir kez denenir. Modun süre sınırı geçtikten sonra hiçbir key denenmez (review ve compact için 60 saniye, plan-review için 50 saniye, advisor için 40 saniye). Tek bir key varsa hata yalnız bu key'in hatasıdır.
- Hiç key kalmadığında hata, her farklı hatayı bir kez yazar ve bu hatayı alan key'lerin sıra numaralarını verir. Key'in kendisini hiçbir zaman yazmaz: `all 34 keys failed: Gemini HTTP 429: quota (keys 1-4, 6-34); Gemini HTTP 400: API key not valid. (key 5)`.
- Sonraki istek, bir önceki isteğin başarılı olduğu ya da geçtiği key'den başlar. Böylece günlük kotası dolmuş bir key her seferinde ilk sırada denenmez. Bu sıra bellekte tutulur ve modül yeniden yüklendiğinde baştan başlar.
- HTTP 503, modelin yoğunluğunu gösterir ve her key için aynıdır. Bu yüzden aynı key kullanılmaya devam edilir ve yukarıdaki gibi beklenir.

2.1.278 üzerindeki canlı denemede ilk key geçersiz, ikinci key geçerliydi. İlk inceleme 0,4 saniyede HTTP 400, ardından ikinci key'den HTTP 200 aldı. Sonraki inceleme yalnız ikinci key'i kullandı.

Google rate limit'leri key başına değil, proje başına uygular ("Rate limits are applied per project, not per API key", Gemini API rate limits). Bu yüzden aynı projenin iki key'i tek bir kotayı paylaşır. Free kotayı toplamak için birden çok projenin key'lerini kullanmak, Google APIs Terms of Service'e aykırıdır: "You agree to, and will not attempt to circumvent, such limitations documented with each API." İkinci bir key, çalışmayı bırakan bir key'in yerine ya da free bir key'in yanında paid bir key olarak kullanılır. Bütün key'ler tek bir tier ayarını paylaşır.

## Free tier mı, paid tier mı

Gemini modları konuşmayı, tool çıktılarını ve diff'leri gönderir. Gemini API Additional Terms, free tier için şunları söyler: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services", "human reviewers may read, annotate, and process your API input and output" ve "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Google'a göstermek istemediğiniz bir projede billing'i açık bir key kullanın ve `/gemini-core paid` ayarını yapın. Mod bir key'in hangi tier'da olduğunu bilemez. Tier ayarı yalnız modların gösterdiği uyarıyı seçer.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-core@kilimcininkoroglu-mods

Her Gemini modu `dependencies` içinde `gemini-core`'u listeler. Bu yüzden bir Gemini modu yüklendiğinde bu mod da yüklenir. Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Google AI Studio'dan aldığınız key'i iki yerden birine girin. Key yoksa her Gemini modu `no Gemini key` bildirir: gemini-compact yerleşik özeti çalıştırır, gemini-review commit'i incelemeden çalıştırır, gemini-plan-review planı incelemeden size gösterir ve advisor çağrısı başarısız olur.
   - Environment. Satırı shell profilinize (`~/.zshrc`, `~/.bashrc`) ekleyin. Ardından yeni bir terminal açın ve Claude Code'u bu terminalden başlatın:

         export GEMINI_API_KEY="key1"
         export GEMINI_API_KEY="key1,key2"    # birkaç key, sırayla denenir

   - Plugin option'ı. Option bir secret olarak saklanır ve environment'tan önce gelir. Option'ı `/plugin` configure akışında ayarlayın ya da yükleme sırasında `claude plugin install gemini-core@kilimcininkoroglu-mods --config apiKey=...` ile verin. Bu yol key'i shell geçmişinizde de bırakır.
2. Claude Code'u yeniden başlatın ve `/gemini-core` komutunu çalıştırın. İlk satır tier'ı ve key sayısını gösterir, örneğin `free tier · 2 keys, tried in turn`. `no key: set GEMINI_API_KEY ...` satırı, Claude Code'un key'i almadığını gösterir.
3. Tier'ı seçin. Varsayılan tier `free` değeridir ve bu durumda her Gemini modu bir free tier uyarısı gösterir. Billing'i açık bir key ile `/gemini-core paid` komutunu çalıştırın. Paid ve free key'leri birlikte kullanıyorsanız paid key'i başa yazın, çünkü tek bir tier bütün key'leri kapsar.
4. İstediğiniz her Gemini modunu açın: `/gemini-review on`, `/gemini-plan-review on`, `/gemini-advisor on`, `/gemini-compact on`. Her mod yüklendikten sonra kapalıdır ve açılana kadar Gemini'ye hiçbir şey göndermez. Bu modda key yokken `on` reddedilir.
5. Her modun modelinin key'inizde cevap verdiğini kontrol edin. Free bir key'in bir model için kotası olmayabilir: canlı denemelerdeki free key, gemini-review, gemini-plan-review ve gemini-advisor'ın varsayılan modeli olan `gemini-3.8-flash` için HTTP 429, `gemini-3.5-flash` için HTTP 200 döndürdü (ölçüldü). `/gemini-core models` ve `/gemini-core model <mod>` ile başka bir model seçin.

Ayarlarını kendisi tutan bir Gemini modu sürümünden güncelliyorsanız (gemini-review ve gemini-advisor 0.1.x, gemini-compact 0.2.x): `claude plugin update` gemini-core'u eklemez. Bu yüzden bir kez `claude plugin install gemini-core@kilimcininkoroglu-mods` komutunu çalıştırın. Modun eski `apiKey`, `tier` ve `model` option'ları ile sakladığı `free`, `paid` ve `model` ayarları okunmaz. 1'den 5'e kadar olan adımları yeniden yapın.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `apiKey` | `GEMINI_API_KEY` | Her Gemini modunun Gemini API key'i ya da virgülle ayrılmış birkaç key; bir secret olarak saklanır |
| `tier` | `free` | `free` ya da `paid`; `/gemini-core free\|paid` bu değerin yerine geçer |

## Mod yazarları için

Contract, `types/index.d.ts` dosyasıdır. Bu contract'ı kullanan bir mod:

```ts
const prepared = await $.gemini.request({ consumer: 'my-mod', body })
if ('error' in prepared) return fail(prepared.error)
const started = await $.clock.now()
let http = prepared.http
for (let attempt = 1; ; attempt++) {
  const r = await $.http.fetch(http.url, http.init)
  const read = await $.gemini.read({ http, status: r.status, ok: r.ok, text: r.text, attempt, elapsedMs: (await $.clock.now()) - started })
  if ('answer' in read || 'error' in read) return read
  if ('next' in read) http = read.next
  else await $.clock.sleep(read.retryInMs)
}
```

`request`, tek bir isteği modun modelinden farklı bir modele göndermek için `model` alır. Bunu her istekte yapan bir mod `ownModels: true` ile kaydolur: `$.gemini.enroll({ consumer: 'my-mod', defaultModel, ownModels: true })`.

Bir hook'un süre sınırı 10 saniyedir. `$.clock.sleep` bu süreden düşer, `$.http.fetch`'in bekleme süresi düşmez (2.1.283 üzerinde ölçüldü). Tek bir hook içinde birden çok modele aynı anda istek gönderen bir mod, `retryInMs` değerinden sonra beklemeden yeniden gönderebilir, çünkü paralel isteklerin bekleme süreleri toplanır.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ types ./types/index.d.ts declares on $: $.gemini
    ❯ ./register.ts hooks: engine.create, session.start, command.run{command=gemini-core}, ui.render{component=Pane} (default matcher key: plugin), ui.close
    ❯ ./register.ts calls: $.command.register, $.env.get, $.gemini.configure (via applyChange, pickModel), $.gemini.settings (via openPicker, statusOf), $.http.fetch (via listModels), $.store.delete, $.store.get, $.store.set, $.ui.close (via pickModel), $.ui.open (via openPicker), $.ui.resolve, $.ui.toast
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: GEMINI_API_KEY

Reach L3: network'e erişir. `/gemini-core models` ve bir model değişikliği Google'dan model listesini ister. Modun oluşturduğu generateContent istekleri, key'i bu istekleri gönderen moda taşır.

    1. Okur:         GEMINI_API_KEY ya da apiKey option'ını; kendi $.store dosyasını
    2. Çalıştırır:   hiçbir process; model seçimi için bir pane açar
    3. Gönderir:     model listesi isteğini (GET generativelanguage.googleapis.com/v1beta/models, konuşma gönderilmez), her session'da bir kez ve refresh sırasında, key x-goog-api-key header'ında; oluşturduğu istekleri Gemini modları gönderir
    4. Saklar:       tier'ı, kayıtlı modları varsayılan modelleriyle, hangilerinin kendi modellerini seçtiğini ve her modun modelini ve thinking seviyesini $.store içinde
    5. Düşman girdi: $.gemini.request çağıran her plugin key'i alır, bu yüzden yalnız güvendiğiniz Gemini modlarını yükleyin; bir model id'si (bir isteğin belirttiği id de) [a-z0-9.-] ile eşleşmek zorundadır, çünkü URL path'ine eklenir; cevap metni JSON olarak okunur ve hiçbir zaman çalıştırılmaz

## Sınırlar

- Key, `$.gemini.request` çağıran her plugin'e ulaşır.
- Gemini modlarının gemini-core'dan önce kendilerinin tuttuğu ayarlar (kendi `tier` ve `model` değerleri) okunmaz.
- 2.1.278'in test engine'i `engine.create` çalıştırmaz. Bu yüzden testler `$.gemini`'yi bellekteki bir store üzerinde oluşturur. Modların testleri de `gemini.*` çağrılarını kendileri cevaplar.
- Plugin noun'ları early access aşamasındadır. 10 saniyelik sınır ve diğer değerler 2.1.278 üzerinde ölçüldü.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
