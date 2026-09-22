# gemini-core

Her Gemini mod'unun Gemini ayarlarını tek bir yerde tutan bir Claude Code Mod'u: hepsi için key ve tier, her biri için model ve thinking seviyesi. Engine arayüzüne `$.gemini` ekler; `gemini-compact`, `gemini-advisor`, `gemini-review` ve `gemini-plan-review` ona bağlıdır ve Gemini isteklerini onun üzerinden kurar.

## Ne yapar

1. Her Gemini mod'u session başlangıcında plugin adı ve varsayılan modeli ile kaydolur.
2. Bir mod Gemini'ye sorduğunda `$.gemini.request`, mod'un gövdesinden `generateContent` isteğini kurar: key `x-goog-api-key` header'ında, hiçbir zaman URL'de değil; mod'un modeli; ve thinking seviyesi `generationConfig.thinkingConfig.thinkingLevel` içinde. Seviye yoksa gövde olduğu gibi gönderilir, yani model kendi varsayılanını kullanır.
3. İsteği mod kendi `$.http.fetch` çağrısıyla gönderir ve `$.gemini.read` cevabı okur: metni ve token sayılarını, Gemini'nin hata mesajını, ya da HTTP 503 sonrası aynı isteğin tekrar gönderilmesi için bir bekleme (1 sn, 2 sn, 3 sn, en fazla dört deneme; mod'un süresi dolduktan sonra deneme yok). HTTP 429 ya da key hatası sonrasında aynı isteği sıradaki key ile cevaplar ve mod onu hemen gönderir.

Bir plugin noun'unun method'u 10 saniye içinde cevap vermek zorundadır (2.1.278 üzerinde ölçüldü: içindeki 14 saniyelik bir fetch `did not answer within 10000ms` ile reddedildi). Bir Gemini isteği daha uzun sürebilir, bu yüzden istek `$.gemini` içinde değil, mod tarafından gönderilir.

## Thinking seviyeleri

`minimal`, `low`, `medium` ve `high`. Bir modelin hangi seviyeleri aldığı modele göre değişir ve mod bunların tablosunu tutmaz: desteklenmeyen bir seviye Gemini'nin HTTP 400'üdür ve soran mod onu gösterir. 2.1.278 üzerinde ölçüldü:

| Model | minimal | low | medium | high |
|---|---|---|---|---|
| `gemini-3.8-flash` | HTTP 400 "Thinking level MINIMAL is not supported for this model" | evet | evet | evet |
| `gemini-3.5-flash-lite` | evet | evet | evet | evet |

Gemini dokümanları Gemini 3.1 Pro'nun da `minimal` almadığını söyler.

## Komut

    /gemini-core [status]                           tier, kaç key ayarlı, kayıtlı her mod'un modeli ve thinking seviyesi
    /gemini-core free | paid                        her Gemini mod'unun tier'ı; free aşağıdaki uyarıyı yazar
    /gemini-core models [refresh]                   key'in listelediği Gemini text modelleri
    /gemini-core model <mod>                        o listeden mod'un modelini seçmek için bir pane
    /gemini-core model <mod> <id>                   örneğin: model review gemini-3.7-flash; listede olmayan bir id reddedilir
    /gemini-core thinking <mod> <level|default>     örneğin: thinking compact low; default seviyeyi kaldırır
    /gemini-core reset                              tier plugin option'ından, her mod varsayılan modeline ve seviyesiz

Bir mod tam adıyla (`gemini-review`) ya da `gemini-` olmadan (`review`) adlandırılır. Ayarlar session'lar arasında saklanır ve bir sonraki istekte geçerli olur. Bir mod değişimi izlemek için `gemini.configure` olayını hook'layabilir.

## Model listesi

Liste Google'ın `models.list` çağrısından gelir (`GET /v1beta/models`, key `x-goog-api-key` header'ında), session başına bir kere sorulur, `models refresh` ile tekrar. Bir key başarısız olduğunda sıradaki key sorulur. `generateContent` alan ve id'si `gemini-` ile başlayan modelleri tutar; `tts` ya da `image` içeren id'leri dışarıda bırakır, çünkü onlar ses ya da resimle cevap verir. Kontrol edilen key'de Google 58 model listeledi ve 21 tanesi kaldı (2.1.278 üzerinde ölçüldü). Filtre yalnız adları okur, yani adında bunu söylemeyen başka türden yeni bir model listede kalır; o zaman Gemini'nin kendi hatası soran mod'a ulaşır.

`/gemini-core model <mod>` listeyi bir `Select` içinde taşıyan bir pane açar, mod'un şu anki modeli seçili. Enter seçimi ayarlar, bir toast ile gösterir ve pane'i kapatır; Esc değişiklik olmadan kapatır. Terminalde Select on satırlık kaydırmalı bir liste çizer. `Select` olmayan bir surface (mobil) listeyi ve seçimi yapan komutu gösterir. Komutla verilen bir id, listede yoksa reddedilir; en yakın üç id ile birlikte:

    gemini-9-flash is not a Gemini text model this key lists; closest: gemini-2.5-flash, gemini-3.5-flash, gemini-3.6-flash.

## Birden çok key

`apiKey` option'ı ve `GEMINI_API_KEY`, virgülle ayrılmış bir liste alır; option ayarlıysa o kazanır. Key'ler sırayla denenir:

- HTTP 429 (kota), 401, 403 ya da 400 "API key not valid" aynı isteği hemen sıradaki key ile gönderir. Son key başa döner ve her key istek başına bir kere denenir. Mod'un süresi dolduktan sonra hiçbir key denenmez (review ve compact için 60 sn, danışman için 40 sn).
- Key kalmadığında hata her farklı başarısızlığı bir kere, onu alan key'lerin sıra numaralarıyla adlandırır, hiçbir key'i değil: `all 34 keys failed: Gemini HTTP 429: quota (keys 1-4, 6-34); Gemini HTTP 400: API key not valid. (key 5)`.
- Sonraki istek, bir öncekinin başarılı olduğu ya da geçtiği key'den başlar; böylece günlük kotası tükenmiş bir key her seferinde ilk sorulmaz. Bu sıra bellekte tutulur ve modül yeniden yüklendiğinde başa döner.
- HTTP 503 modelin yüküdür, her key için aynıdır; bu yüzden aynı key'de kalır ve yukarıdaki gibi bekler.

2.1.278 üzerindeki canlı testte önce geçersiz, sonra çalışan bir key ile ilk review 0,4 saniyede HTTP 400 aldı ve ikinci key'den HTTP 200 aldı; sonraki review yalnız ikinci key'i sordu.

Google rate limit'leri key başına değil, proje başına uygular ("Rate limits are applied per project, not per API key", Gemini API rate limits), yani bir projenin iki key'i tek kotayı paylaşır. Free kotayı toplamak için birkaç projenin key'lerini kullanmak Google APIs Terms of Service'e aykırıdır: "You agree to, and will not attempt to circumvent, such limitations documented with each API." İkinci bir key, çalışmayı bırakan bir key için ya da free bir key'in yanındaki paid key içindir. Tüm key'ler tek tier ayarını paylaşır.

## Free tier ya da paid tier

Gemini mod'ları konuşmayı, tool çıktılarını ve diff'leri gönderir. Gemini API Additional Terms, free tier için şunu söyler: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services", "human reviewers may read, annotate, and process your API input and output" ve "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Google'a göstermeyeceğiniz bir projede billing açık bir key kullanın ve `/gemini-core paid` ayarlayın. Mod bir key'in hangi tier'da olduğunu bilemez; tier yalnız mod'ların gösterdiği uyarıyı seçer.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-core@kilimcininkoroglu-mods

Bir Gemini mod'u `dependencies` içinde `gemini-core` listeler, yani birini kurmak bunu da kurar. Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Google AI Studio'dan bir key verin, iki yerden biriyle. Key olmadan her Gemini mod'u `no Gemini key` raporlar: gemini-compact yerleşik özeti çalıştırır, gemini-review commit'in incelenmeden çalışmasına izin verir, gemini-plan-review planın incelenmeden size ulaşmasına izin verir ve danışman çağrısı başarısız olur.
   - Environment. Satırı shell profilinize ekleyin (`~/.zshrc`, `~/.bashrc`), yeni bir terminal açın ve Claude Code'u oradan başlatın:

         export GEMINI_API_KEY="key1"
         export GEMINI_API_KEY="key1,key2"    # birkaç key, sırayla denenir

   - Plugin option'ı, secret olarak saklanır. Environment'a üstün gelir. `/plugin` configure akışında ayarlayın, ya da kurulumda `claude plugin install gemini-core@kilimcininkoroglu-mods --config apiKey=...` ile; bu key'i shell geçmişinizde de bırakır.
2. Claude Code'u yeniden başlatın ve `/gemini-core` çalıştırın. İlk satır tier'ı ve key sayısını adlandırır, örneğin `free tier · 2 keys, tried in turn`. `no key: set GEMINI_API_KEY ...` satırı, Claude Code'un key'i almadığını söyler.
3. Tier'ı seçin. Varsayılan `free`'dir ve her Gemini mod'u o zaman bir free tier uyarısı gösterir. Billing açık bir key ile `/gemini-core paid` çalıştırın. Paid ve free key'i karıştırdığınızda paid key'i başa koyun, çünkü tek tier tüm key'leri kapsar.
4. İstediğiniz her Gemini mod'unu açın: `/gemini-review on`, `/gemini-plan-review on`, `/gemini-advisor on`, `/gemini-compact on`. Her biri kurulumdan sonra kapalıdır ve o ana kadar Gemini'ye hiçbir şey göndermez; bu mod'da key yokken `on` reddedilir.
5. Her mod'un modelinin sizin key'inizde cevap verdiğini kontrol edin. Free bir key'in bir model için kotası olmayabilir: canlı testlerin free key'i, gemini-review, gemini-plan-review ve gemini-advisor'ın varsayılanı olan `gemini-3.8-flash` için HTTP 429, `gemini-3.5-flash` için HTTP 200 döndü (ölçüldü). `/gemini-core models` ve `/gemini-core model <mod>` ile başka bir model seçin.

Kendi ayarlarını tutan bir Gemini mod'undan güncellemeden sonra (gemini-review ve gemini-advisor 0.1.x, gemini-compact 0.2.x): `claude plugin update` gemini-core'u eklemez, bu yüzden bir kere `claude plugin install gemini-core@kilimcininkoroglu-mods` çalıştırın. Mod'un eski `apiKey`, `tier` ve `model` option'ları ile sakladığı `free`, `paid` ve `model` ayarları okunmaz, yani 1'den 5'e kadarki adımları tekrar yapın.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `apiKey` | `GEMINI_API_KEY` | Her Gemini mod'unun Gemini API key'i, ya da virgülle ayrılmış birkaçı, secret olarak saklanır |
| `tier` | `free` | `free` ya da `paid`; `/gemini-core free\|paid` onu ezer |

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

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ types ./types/index.d.ts declares on $: $.gemini
    ❯ ./register.ts hooks: engine.create, session.start, command.run{command=gemini-core}, ui.render{component=Pane}, ui.close
    ❯ ./register.ts calls: $.command.register, $.env.get, $.gemini.configure (via applyChange, pickModel), $.gemini.settings (via openPicker, statusOf), $.http.fetch (via listModels), $.store.delete, $.store.get, $.store.set, $.ui.close (via pickModel), $.ui.open (via openPicker), $.ui.resolve, $.ui.toast
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: GEMINI_API_KEY

Reach L3, network'e çıkar: `/gemini-core models` ve bir model değişimi Google'a model listesini sorar. Kurduğu generateContent istekleri key'i onları gönderen mod'a taşır.

    1. Okur:     GEMINI_API_KEY ya da apiKey option'ını; kendi $.store dosyasını
    2. Çalıştırır: hiçbir process; model seçimi için bir pane açar
    3. Gönderir: model listesi isteğini (GET generativelanguage.googleapis.com/v1beta/models, konuşma yok), session başına bir kere ve refresh'te, key x-goog-api-key header'ında; kurduğu istekleri Gemini mod'ları gönderir
    4. Saklar:   $.store içinde tier'ı, kayıtlı mod'ları varsayılan modelleriyle, ve her mod'un modeli ile thinking seviyesini
    5. Düşman girdi: `$.gemini.request` çağıran her plugin key'i alır, bu yüzden yalnız güvendiğiniz Gemini mod'larını kurun; model id'si `[a-z0-9.-]` ile eşleşmek zorundadır, çünkü URL path'ine girer; cevap metni JSON olarak okunur ve hiç çalıştırılmaz

## Sınırlar

- Key, `$.gemini.request` çağıran her plugin'e ulaşır.
- Gemini mod'larının gemini-core'u kullanmadan önce tuttuğu ayarlar (kendi `tier` ve `model` değerleri) okunmaz.
- 2.1.278 test engine'i `engine.create` çalıştırmaz, bu yüzden testler `$.gemini` nesnesini bellekteki bir store üzerinde kurar ve mod'ların testleri `gemini.*` çağrılarını kendisi cevaplar.
- Plugin noun'ları early access; 10 saniyelik sınır ve gerisi 2.1.278 üzerinde ölçüldü.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
