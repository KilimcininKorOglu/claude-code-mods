# gemini-plan-review

Plan modunda model bir plan yazar, sen de onaylarsın. İstediğin bir adımı atlayan ya da kodun çürüttüğü bir varsayıma dayanan bir planı fark etmeden onaylamak kolaydır. Bu mod her planı sana ulaşmadan önce Gemini'ye inceletir. Model ExitPlanMode'u çağırınca, onay penceresi açılmadan önce Gemini planı ve konuşmayı okur. Engelleyici bir bulgusu olan plan modele geri döner, en fazla iki kez; plan geçince sen görürsün.

## Ne yapar

1. Mod ExitPlanMode tool'unu hook'lar. Bir `tool.call` hook'u izin sorusundan önce çalışır; bu yüzden geri gönderilen bir plan onay penceresini hiç açmaz.
2. Plan dosyasını diskten okur; pencerenin gösterdiği metin budur. Dosya, çağrının `planFilePath`'idir; yoksa engine'in plan modu notunun adını verdiği dosyadır (`## Plan File Info: ... create your plan at /.../x.md`). Çağrının kendi `plan` alanı yalnız hiçbir path bilinmiyorsa kullanılır, çünkü 2.1.278 üzerinde yeni bir plan dosyasından sonraki ilk çağrıda ne `plan` ne `planFilePath` vardı, daha sonraki bir çağrı da planın modelin son düzenlemesinden önceki hâlini taşıyordu (ölçüldü).
3. Planı ve konuşmayı schema'lı tek bir `generateContent` isteğiyle gönderir. Cevap bir bulgu listesidir; her bulgu `blocker` ya da `minor`'dır ve bir mesaj taşır. Plan her zaman bütün gider. Konuşma `maxInputChars`'ı (varsayılan 2.000.000 karakter) aşarsa en uzun tool çıktıları ortak bir uzunluğa kısaltılır; her biri baş ve son kısmını korur. İsteği gemini-core kurar: `gemini-plan-review` için tuttuğu key, model ve thinking seviyesiyle. Cevabı da o okur.
4. `blocker` şunlardan biridir: hedefin gerektirdiği ama planın atladığı bir adım, konuşmanın ya da orada görünen kodun çürüttüğü bir varsayım, ulaşılıp ulaşılmadığı kontrol edilemeyen bir hedef, ya da senin istediğine aykırı bir karar. Geri kalan her şey `minor`'dır.
5. Karar:
   - 1. ya da 2. turda bir blocker: plan geri döner. Model her blocker'ı ve minor notları okur; talimat planı düzeltmesi, ya da yanlış bir bulguyu plan dosyasında `## Gemini plan review` başlığı altında cevaplamasıdır. Gemini sonraki turda o bölümü okur; ona konuşmanın desteklediği bir cevabı kabul etmesi söylenir;
   - 2 turdan sonra hâlâ blocker: plan sana ulaşır. Bir transcript satırı açık blocker'ları sayar, model de onları senin cevabından sonra okur;
   - yalnız minor bulgular ya da hiç bulgu yok: plan sana ulaşır; model senin cevabından sonra notları, ya da incelemenin hiçbir şey bulmadığını söyleyen tek satırı okur.
6. Senin gönderdiğin bir prompt (composer'dan, bridge'den ya da SDK'dan) sonraki plana 2 turunu yeniden verir; onay penceresine ulaşan bir plan da öyle. Bir background bildirimi ya da bir peer mesajı vermez.
7. İnceleme cevap veremezse plan sana ulaşır, bir transcript satırı nedenini söyler ve model de nedeni okur. Nedenler: key yok, bir HTTP hatası, bozuk ya da çıktı sınırında kesilmiş bir cevap, okunamayan bir plan dosyası, ya da tool çıktıları olmadan da sınırı aşan bir konuşma.
8. 503'ten sonra mod, gemini-core'un bildirdiği gibi 1 sn, 2 sn ve 3 sn sonra yeniden sorar; toplam en fazla dört deneme olur. Beklemesi 50 sn'yi aşacak bir deneme başlamaz. 429'dan ya da bir key hatasından sonra gemini-core, elinde başka bir key varsa isteği onunla yeniden gönderir.

2.1.278 üzerinde `gemini-3.5-flash` ile yapılan canlı denemede istenen şey, birim testiyle birlikte bir `--json` flag'iydi; plan ise `1. Add a --json flag to /task-poke. 2. Done.` idi. 1. tur planı `The plan does not include the requested unit test for the --json flag` ile geri gönderdi. Model test adımını ekledi ve ikinci çağrı onay penceresini açtı. Free bir key'de `gemini-3.8-flash` ile aynı inceleme yalnız 503 aldı ve plan onay penceresine nedeniyle birlikte ulaştı.

## Ne gösterir

Her incelemeden sonra 10 saniye duran bir toast çıkar; sonuncusunu `/gemini-plan-review` gösterir:

    gemini-plan-review: plan reviewed · 1 blocker, 0 minor · 621 in, 1k out · sent to Gemini free tier

`sent to Gemini free tier` kısmı yalnız free tier'da çıkar. Bir plan geri döndüğünde, açık blocker'larla geçtiğinde ya da incelenmediğinde transcript'e bir satır düşer:

    gemini-plan-review: plan sent back (round 1 of 2): plan reviewed · 1 blocker, 0 minor · 621 in, 1k out
    gemini-plan-review: plan reached you without a review: Gemini HTTP 503: This model is currently experiencing high demand. ...

## Komut

    /gemini-plan-review              on ya da off, gemini-core'un tuttuğu model, thinking seviyesi ve tier, key var mı, son inceleme
    /gemini-plan-review on | off     off: planlar incelenmeden sana ulaşır; gemini-core'da key yokken on reddedilir
    /gemini-plan-review reset        yeniden off, varsayılan

İnceleme kurulumdan sonra kapalıdır; key'i ayarlayıp açana kadar Gemini'ye hiçbir şey gitmez.

Key, tier, model (varsayılan `gemini-3.8-flash`) ve thinking seviyesi gemini-core'a aittir:

    /gemini-core model plan-review gemini-3.5-flash
    /gemini-core thinking plan-review low
    /gemini-core paid

## Free tier mı paid tier mı

Her inceleme planı ve konuşmayı gönderir: prompt'larını, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini. Free tier'da Google bunları kullanabilir, insan denetçiler de okuyabilir; gemini-core README'si Gemini API Additional Terms'ten ilgili kısmı aktarır. Google'a göstermek istemediğin bir projede billing'i açık bir key kullan ve `/gemini-core paid` ayarla.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-plan-review@kilimcininkoroglu-mods

`gemini-core`'a bağlıdır; `claude plugin install` onu da kurar. Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da, onun [After installing](../gemini-core/README.md#after-installing) bölümünde anlatıldığı gibi ayarla, sonra Claude Code'u yeniden başlat.
2. `/gemini-plan-review on` çalıştır. Key yoksa `still off: gemini-core has no Gemini key` cevabını verir ve kapalı kalır.
3. `/gemini-plan-review` çalıştır. İlk satır `on · <model> · thinking ... · <tier> tier · key set` olmalı.
4. Bir plan sana `Gemini HTTP 429` ya da tekrar eden `Gemini HTTP 503` ile ulaşırsa `/gemini-core model plan-review` ile başka bir model seç.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `2000000` | Gönderilen konuşmanın en fazla karakter sayısı, 10.000 ile 4.000.000 arası; plan her zaman bütün gider |

Aralık dışındaki ya da tam sayı olmayan bir değerin yerine varsayılan kullanılır.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-plan-review}, prompt.submit, prompt.attachment{type=plan_mode}, tool.call{tool=ExitPlanMode}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.fs.read (via planOf), $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via review, runCommand, storeEnabled), $.http.fetch (via askGemini), $.session.messages (via review), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.ui.log (via notReviewed, verdictOf), $.ui.toast (via verdictOf)

Reach L3: network'e çıkar.

    1. Okur:     her ExitPlanMode çağrısında plan dosyasını; plan dosyasının path'i için plan modu notunu; her prompt'un origin'ini; konuşmayı (mesajlar, tool input'ları ve output'ları); kendi $.store dosyasını; gemini-core'dan key'i taşıyan isteği
    2. Çalıştırır: hiçbir şey
    3. Gönderir: planı ve konuşmayı, ExitPlanMode çağrısı başına bir istek (503 sonrası en fazla dört, 429 ya da key hatası sonrası ek key başına bir tane daha), gemini-core'un kurduğu URL'ye (generativelanguage.googleapis.com), key x-goog-api-key header'ında, hiçbir zaman URL'de değil
    4. Saklar:   $.store içinde on/off ayarını; tur sayısı, plan dosyası path'i ve son inceleme satırı bellekte yaşar
    5. Düşman girdi: bir plan ya da bir konuşma Gemini'nin bulgularını yönlendirebilir, yani zayıf bir plan geçebilir ya da sağlam bir plan geri dönebilir; model yanlış bir bulguyu planda cevaplayabilir ve 2 turdan sonra Gemini ne derse desin plan sana ulaşır

## Sınırlar

- Bir inceleme bir modelin görüşüdür. Bir sorunu kaçırabilir, planın zaten çözdüğü bir sorunu da bildirebilir.
- Her `$.http.fetch` tam bir cevap almadan 30 saniye geçince biter (2.1.278 üzerinde ölçüldü). Yavaş bir model o zaman planı incelemeden geçirir.
- Bir subagent'ın ExitPlanMode'u incelenmez, çünkü senin onay pencereni açmaz.
- Plan modu notunun metni engine'e aittir. Bir build onu değiştirirse yeni bir plan dosyasından sonraki ilk çağrı path taşımaz ve o plan sana `the call carries no plan text` ile ulaşır.
- Her inceleme bütün konuşmayı gönderir; session uzadıkça her inceleme büyür ve yavaşlar. `$.session.messages()` en yeni 4096 mesajı verir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
