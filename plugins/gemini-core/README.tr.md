# gemini-core

Birkaç mod Gemini'ye soruyor. Her biri kendi key'ini, tier'ını ve modelini tutarsa yeni bir key, mod başına bir ayar değişikliği demektir. Bu mod bütün Gemini mod'larının Gemini ayarlarını tek yerde tutar: hepsi için key ve tier, her biri için model ve thinking seviyesi. Engine arayüzüne `$.gemini` ekler. `gemini-compact`, `gemini-advisor`, `gemini-review` ve `gemini-plan-review` ona bağlıdır ve Gemini isteklerini onun üzerinden kurar. `council` kuruluysa onu kullanır ama ona bağlı değildir.

## Ne yapar

1. Her Gemini mod'u session başında plugin adıyla ve varsayılan modeliyle kaydolur.
2. Bir mod Gemini'ye soracağı zaman `$.gemini.request`, mod'un gövdesinden `generateContent` isteğini kurar: key `x-goog-api-key` header'ına girer, hiçbir zaman URL'ye girmez; model mod'un modelidir; thinking seviyesi `generationConfig.thinkingConfig.thinkingLevel`'a yazılır. Seviye yoksa gövde olduğu gibi gider ve model kendi varsayılanını kullanır. Bir mod tek bir istek için başka bir model verebilir (`model`); mod'un thinking seviyesi o isteğe de uygulanır.
3. İsteği mod kendi `$.http.fetch`'iyle gönderir, cevabı `$.gemini.read` okur. Sonuç metin ve token sayılarıdır, ya da Gemini'nin hata mesajıdır, ya da HTTP 503'ten sonra aynı isteği yeniden göndermeden önceki beklemedir (1 sn, 2 sn, 3 sn; en fazla dört deneme; mod'un süre sınırı geçtiyse deneme yok). HTTP 429'dan ya da bir key hatasından sonra aynı isteği sıradaki key ile verir, mod da onu hemen gönderir.

Bir plugin noun'unun method'u 10 saniye içinde cevap vermek zorundadır (2.1.278 üzerinde ölçüldü: method içindeki 14 saniyelik bir fetch `did not answer within 10000ms` ile reddedildi). Bir Gemini isteği bundan uzun sürebilir; bu yüzden isteği `$.gemini` değil, mod gönderir.

## Thinking seviyeleri

`minimal`, `low`, `medium` ve `high`. Bir modelin hangi seviyeleri kabul ettiği modelden modele değişir ve mod bunun tablosunu tutmaz: desteklenmeyen bir seviye Gemini'den HTTP 400 olarak döner, soran mod da onu gösterir. 2.1.278 üzerinde ölçüldü:

| Model | minimal | low | medium | high |
|---|---|---|---|---|
| `gemini-3.8-flash` | HTTP 400 "Thinking level MINIMAL is not supported for this model" | evet | evet | evet |
| `gemini-3.5-flash-lite` | evet | evet | evet | evet |

Gemini dokümanlarına göre Gemini 3.1 Pro da `minimal` kabul etmiyor.

## Komut

    /gemini-core [status]                           tier, kaç key ayarlı, kayıtlı her mod'un modeli ve thinking seviyesi
    /gemini-core free | paid                        her Gemini mod'unun tier'ı; free aşağıdaki uyarıyı yazar
    /gemini-core models [refresh]                   key'in listelediği Gemini text modelleri
    /gemini-core model <mod>                        o listeden mod'un modelini seçmek için bir pane
    /gemini-core model <mod> <id>                   örneğin: model review gemini-3.7-flash; listede olmayan bir id reddedilir
    /gemini-core thinking <mod> <level|default>     örneğin: thinking compact low; default seviyeyi kaldırır
    /gemini-core reset                              tier plugin option'ından, her mod varsayılan modeline ve seviyesiz

Bir mod'u tam adıyla (`gemini-review`) ya da `gemini-` olmadan (`review`) yazabilirsin. Ayarlar session'lar arasında korunur ve bir sonraki istekte geçerli olur. Bir mod değişikliği izlemek için `gemini.configure`'u hook'layabilir.

`ownModels` ile kaydolan bir mod her isteğin modelini kendisi seçer; `council` üyeleri için bunu yapar. Status onu `council: models set by the mod · thinking model default` diye gösterir ve `model <mod>` onun için Google'a hiç sormadan reddedilir. Thinking seviyesi ise diğer mod'larda olduğu gibi burada ayarlanır.

## Model listesi

Liste Google'ın `models.list` çağrısından gelir (`GET /v1beta/models`, key `x-goog-api-key` header'ında). Bir komut ona ilk ihtiyaç duyduğunda sorulur ve session boyunca bellekte kalır; `models refresh` yeniden sorar. Bir key başarısız olursa sıradaki key sorulur. `generateContent` kabul eden ve id'si `gemini-` ile başlayan modeller kalır; `tts` ya da `image` geçen id'ler dışarıda kalır, çünkü onlar ses ya da resimle cevap verir. Denenen key'de Google 58 model listeledi, bunların 21'i kaldı (2.1.278 üzerinde ölçüldü). Filtre yalnız adlara bakar: başka türden olup adında bunu söylemeyen yeni bir model listede kalır, o zaman soran mod'a Gemini'nin kendi hatası ulaşır.

`/gemini-core model <mod>` listeyi bir `Select` içinde gösteren bir pane açar; mod'un şu anki modeli seçili gelir. Enter seçimi ayarlar, bir toast ile gösterir ve pane'i kapatır; Esc hiçbir şeyi değiştirmeden kapatır. Terminalde Select on satırlık kaydırılabilir bir liste çizer. `Select`'i olmayan bir surface (mobil) listeyi ve seçimi yapan komutu gösterir. Komutla verilen bir id listede yoksa en yakın üç id ile birlikte reddedilir:

    gemini-9-flash is not a Gemini text model this key lists; closest: gemini-2.5-flash, gemini-3.5-flash, gemini-3.6-flash.

## Birden çok key

`apiKey` option'ı ve `GEMINI_API_KEY` virgülle ayrılmış bir liste kabul eder; option ayarlıysa o geçerlidir. Boşluklar ve tekrarlanan key'ler atılır. Key'ler sırayla denenir:

- HTTP 429 (kota), 401, 403, ya da 400 "API key not valid" veya "API key expired" gelirse aynı istek hemen sıradaki key ile gider. Son key'den sonra ilk key'e dönülür ve her key istek başına bir kez denenir. Mod'un süre sınırı geçtikten sonra hiçbir key denenmez (review ve compact için 60 sn, plan-review için 50 sn, danışman için 40 sn). Tek key varsa hata yalnız o key'in başarısızlığıdır.
- Key kalmadığında hata her farklı başarısızlığı bir kez yazar ve onu alan key'lerin sıra numaralarını verir, key'in kendisini hiçbir zaman yazmaz: `all 34 keys failed: Gemini HTTP 429: quota (keys 1-4, 6-34); Gemini HTTP 400: API key not valid. (key 5)`.
- Sonraki istek, bir öncekinin başarılı olduğu ya da geçtiği key'den başlar; böylece günlük kotası bitmiş bir key her seferinde ilk sorulmaz. Bu sıra bellekte tutulur ve modül yeniden yüklenince baştan başlar.
- HTTP 503 modelin yüküdür ve her key için aynıdır; bu yüzden aynı key'de kalınır ve yukarıdaki gibi beklenir.

2.1.278 üzerindeki canlı denemede ilk key geçersiz, ikincisi çalışır durumdaydı. İlk review 0,4 saniyede HTTP 400, ardından ikinci key'den HTTP 200 aldı; sonraki review yalnız ikinci key'e sordu.

Google rate limit'leri key başına değil proje başına uygular ("Rate limits are applied per project, not per API key", Gemini API rate limits); yani aynı projenin iki key'i tek bir kotayı paylaşır. Free kotayı toplamak için birkaç projenin key'lerini kullanmak Google APIs Terms of Service'e aykırıdır: "You agree to, and will not attempt to circumvent, such limitations documented with each API." İkinci key, çalışmayı bırakan bir key için ya da free bir key'in yanındaki paid bir key içindir. Bütün key'ler tek tier ayarını paylaşır.

## Free tier mı paid tier mı

Gemini mod'ları konuşmayı, tool çıktılarını ve diff'leri gönderir. Gemini API Additional Terms free tier için şunları söyler: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services", "human reviewers may read, annotate, and process your API input and output" ve "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Google'a göstermek istemediğin bir projede billing'i açık bir key kullan ve `/gemini-core paid` ayarla. Mod bir key'in hangi tier'da olduğunu bilemez; tier yalnız mod'ların gösterdiği uyarıyı seçer.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-core@kilimcininkoroglu-mods

Her Gemini mod'u `dependencies` içinde `gemini-core`'u sayar, yani birini kurunca bu da kurulur. Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Google AI Studio'dan aldığın key'i iki yerden birine ver. Key yoksa her Gemini mod'u `no Gemini key` der: gemini-compact yerleşik özeti çalıştırır, gemini-review commit'i incelemeden geçirir, gemini-plan-review planı incelemeden sana getirir, danışman çağrısı da başarısız olur.
   - Environment. Satırı shell profiline (`~/.zshrc`, `~/.bashrc`) ekle, yeni bir terminal aç ve Claude Code'u oradan başlat:

         export GEMINI_API_KEY="key1"
         export GEMINI_API_KEY="key1,key2"    # birkaç key, sırayla denenir

   - Plugin option'ı; secret olarak saklanır ve environment'tan önce gelir. `/plugin` configure akışında ayarla, ya da kurulumda `claude plugin install gemini-core@kilimcininkoroglu-mods --config apiKey=...` ile ver; bu yol key'i shell geçmişinde de bırakır.
2. Claude Code'u yeniden başlat ve `/gemini-core` çalıştır. İlk satır tier'ı ve key sayısını söyler, örneğin `free tier · 2 keys, tried in turn`. `no key: set GEMINI_API_KEY ...` satırı Claude Code'un key'i almadığı anlamına gelir.
3. Tier'ı seç. Varsayılan `free`'dir ve o zaman her Gemini mod'u bir free tier uyarısı gösterir. Billing'i açık bir key ile `/gemini-core paid` çalıştır. Paid ve free key'i birlikte kullanıyorsan paid key'i başa koy, çünkü tek tier bütün key'leri kapsar.
4. İstediğin her Gemini mod'unu aç: `/gemini-review on`, `/gemini-plan-review on`, `/gemini-advisor on`, `/gemini-compact on`. Her biri kurulumdan sonra kapalıdır ve o zamana kadar Gemini'ye hiçbir şey göndermez; bu mod'da key yokken `on` reddedilir.
5. Her mod'un modelinin senin key'inde cevap verdiğini kontrol et. Free bir key'in bir model için kotası olmayabilir: canlı denemelerin free key'i gemini-review, gemini-plan-review ve gemini-advisor'ın varsayılanı olan `gemini-3.8-flash` için HTTP 429, `gemini-3.5-flash` için HTTP 200 döndü (ölçüldü). `/gemini-core models` ve `/gemini-core model <mod>` ile başka bir model seç.

Ayarlarını kendisi tutan bir Gemini mod sürümünden güncelliyorsan (gemini-review ve gemini-advisor 0.1.x, gemini-compact 0.2.x): `claude plugin update` gemini-core'u eklemez, bu yüzden bir kez `claude plugin install gemini-core@kilimcininkoroglu-mods` çalıştır. Mod'un eski `apiKey`, `tier` ve `model` option'ları ile sakladığı `free`, `paid` ve `model` ayarları okunmaz; 1'den 5'e kadar olan adımları yeniden yap.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `apiKey` | `GEMINI_API_KEY` | Her Gemini mod'unun Gemini API key'i, ya da virgülle ayrılmış birkaç key; secret olarak saklanır |
| `tier` | `free` | `free` ya da `paid`; `/gemini-core free\|paid` onu geçersiz kılar |

## Mod yazarı için

Contract `types/index.d.ts` dosyasıdır. Onu kullanan bir mod:

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

`request`, tek bir isteği mod'un modelinden başka bir modele göndermek için `model` alır. Bunu her istekte yapan bir mod `ownModels: true` ile kaydolur: `$.gemini.enroll({ consumer: 'my-mod', defaultModel, ownModels: true })`.

Bir hook'un budget'ı 10 saniyedir; `$.clock.sleep` bu budget'tan düşer, `$.http.fetch`'in beklemesi düşmez (2.1.283 üzerinde ölçüldü). Tek bir hook içinde birkaç modele aynı anda soran bir mod `retryInMs`'ten sonra beklemeden yeniden gönderebilir, çünkü paralel isteklerin beklemeleri toplanır.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ types ./types/index.d.ts declares on $: $.gemini
    ❯ ./register.ts hooks: engine.create, session.start, command.run{command=gemini-core}, ui.render{component=Pane}, ui.close
    ❯ ./register.ts calls: $.command.register, $.env.get, $.gemini.configure (via applyChange, pickModel), $.gemini.settings (via openPicker, statusOf), $.http.fetch (via listModels), $.store.delete, $.store.get, $.store.set, $.ui.close (via pickModel), $.ui.open (via openPicker), $.ui.resolve, $.ui.toast
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: GEMINI_API_KEY

Reach L3: network'e çıkar. `/gemini-core models` ve bir model değişikliği Google'dan model listesini ister. Kurduğu generateContent istekleri key'i onları gönderen mod'a taşır.

    1. Okur:     GEMINI_API_KEY ya da apiKey option'ını; kendi $.store dosyasını
    2. Çalıştırır: hiçbir process; model seçimi için bir pane açar
    3. Gönderir: model listesi isteğini (GET generativelanguage.googleapis.com/v1beta/models, konuşma yok), session başına bir kere ve refresh'te, key x-goog-api-key header'ında; kurduğu istekleri Gemini mod'ları gönderir
    4. Saklar:   $.store içinde tier'ı, kayıtlı mod'ları varsayılan modelleriyle, hangilerinin kendi modellerini adlandırdığını, ve her mod'un modeli ile thinking seviyesini
    5. Düşman girdi: `$.gemini.request` çağıran her plugin key'i alır, bu yüzden yalnız güvendiğiniz Gemini mod'larını kurun; model id'si, bir isteğin adlandırdığı da, `[a-z0-9.-]` ile eşleşmek zorundadır, çünkü URL path'ine girer; cevap metni JSON olarak okunur ve hiç çalıştırılmaz

## Sınırlar

- Key, `$.gemini.request` çağıran her plugin'e ulaşır.
- Gemini mod'larının gemini-core'dan önce kendilerinin tuttuğu ayarlar (kendi `tier` ve `model` değerleri) okunmaz.
- 2.1.278'in test engine'i `engine.create` çalıştırmaz; bu yüzden testler `$.gemini`'yi bellekteki bir store üzerinde kurar, mod'ların testleri de `gemini.*` çağrılarını kendileri cevaplar.
- Plugin noun'ları early access aşamasında; 10 saniyelik sınır ve diğerleri 2.1.278 üzerinde ölçüldü.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
