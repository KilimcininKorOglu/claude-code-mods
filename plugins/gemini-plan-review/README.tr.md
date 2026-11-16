# gemini-plan-review

Plan modunda model bir plan yazar ve siz planı onaylarsınız. İstediğiniz bir adımı atlayan ya da kodun çürüttüğü bir varsayıma dayanan bir planı fark etmeden onaylamak kolaydır. Bu mod her planı, size ulaşmadan önce Gemini'ye inceletir. Model ExitPlanMode çağırdığında, onay penceresi açılmadan önce Gemini planı ve konuşmayı okur. Engelleyici bir bulgusu olan plan, en fazla iki kez modele geri gönderilir. Plan incelemeden geçtiğinde siz görürsünüz.

## Ne yapar

1. Mod ExitPlanMode tool'unu izler. Bir `tool.call` hook'u izin sorusundan önce çalışır. Bu yüzden geri gönderilen bir plan onay penceresini hiç açmaz.
2. Mod plan dosyasını diskten okur. Onay penceresinin gösterdiği metin de bu dosyadır. Dosya, çağrının `planFilePath` değeridir. Bu değer yoksa engine'in plan modu notunun adını verdiği dosya kullanılır (`## Plan File Info: ... create your plan at /.../x.md`). Çağrının kendi `plan` alanı yalnız hiçbir path bilinmiyorsa kullanılır. Bunun nedeni şudur: 2.1.278 üzerinde yeni bir plan dosyasından sonraki ilk çağrıda ne `plan` ne de `planFilePath` vardı. Daha sonraki bir çağrı da planın, modelin son düzenlemesinden önceki hâlini içeriyordu (ölçüldü).
3. Mod planı ve konuşmayı, schema'lı tek bir `generateContent` isteğiyle gönderir. Cevap bir bulgu listesidir. Her bulgu `blocker` ya da `minor` olarak işaretlenir ve bir mesaj içerir. Plan her zaman tamamıyla gönderilir. Konuşma `maxInputChars` sınırını (varsayılan 2.000.000 karakter) aşarsa en uzun tool çıktıları ortak bir uzunluğa kısaltılır. Her çıktının başı ve sonu korunur. İsteği gemini-core oluşturur: `gemini-plan-review` için tuttuğu key, model ve thinking seviyesiyle. Cevabı da gemini-core okur.
4. `blocker` şunlardan biridir: hedefin gerektirdiği ama planın atladığı bir adım, konuşmanın ya da konuşmada görünen kodun çürüttüğü bir varsayım, ulaşılıp ulaşılmadığı kontrol edilemeyen bir hedef ya da sizin isteğinize aykırı bir karar. Diğer her şey `minor` olarak işaretlenir.
5. Karar şöyle verilir:
   - 1. ya da 2. turda bir blocker varsa plan geri gönderilir. Model her blocker'ı ve minor notları okur. Talimat, modelden planı düzeltmesini ya da yanlış bir bulguyu plan dosyasında `## Gemini plan review` başlığı altında cevaplamasını ister. Gemini sonraki turda bu bölümü okur. Gemini'den, konuşmanın desteklediği bir cevabı kabul etmesi istenir.
   - 2 turdan sonra hâlâ blocker varsa plan size ulaşır. Bir transcript satırı açık blocker'ları listeler. Model de bu blocker'ları sizin cevabınızdan sonra okur.
   - Yalnız minor bulgular varsa ya da hiç bulgu yoksa plan size ulaşır. Model, sizin cevabınızdan sonra notları ya da incelemenin hiçbir şey bulmadığını bildiren tek bir satırı okur.
6. Sizin gönderdiğiniz bir prompt (composer'dan, bridge'den ya da SDK'dan) sonraki plana yeniden 2 tur hakkı verir. Onay penceresine ulaşan bir plan da aynı etkiyi yapar. Bir background bildirimi ya da bir peer mesajı bu etkiyi yapmaz.
7. İnceleme cevap veremezse plan size ulaşır. Bir transcript satırı nedeni bildirir ve model de nedeni okur. Olası nedenler: key yok, bir HTTP hatası, bozuk ya da çıktı sınırında kesilmiş bir cevap, okunamayan bir plan dosyası ya da tool çıktıları olmadan da sınırı aşan bir konuşma.
8. Bir 503 hatasından sonra mod, gemini-core'un bildirdiği gibi 1, 2 ve 3 saniye sonra yeniden sorar. Toplam en fazla dört deneme yapılır. Beklemesi 50 saniyeyi aşacak bir deneme başlatılmaz. Bir 429 ya da key hatasından sonra gemini-core, başka bir key'i varsa isteği o key ile yeniden gönderir.

2.1.278 üzerinde `gemini-3.5-flash` ile yapılan canlı denemede istek, birim testiyle birlikte bir `--json` flag'iydi. Plan ise `1. Add a --json flag to /task-poke. 2. Done.` idi. 1. tur planı `The plan does not include the requested unit test for the --json flag` ile geri gönderdi. Model test adımını ekledi ve ikinci çağrı onay penceresini açtı. Free tier bir key ile `gemini-3.8-flash` kullanıldığında aynı inceleme yalnız 503 cevapları aldı ve plan onay penceresine nedeniyle birlikte ulaştı.

## Ne gösterir

Her incelemeden sonra 10 saniye görünen bir toast çıkar. `/gemini-plan-review` son incelemeyi gösterir:

    gemini-plan-review: plan reviewed · 1 blocker, 0 minor · 621 in, 1k out · sent to Gemini free tier

`sent to Gemini free tier` kısmı yalnız free tier'da görünür. Bir plan geri gönderildiğinde, açık blocker'larla geçtiğinde ya da incelenmediğinde transcript'e bir satır yazılır:

    gemini-plan-review: plan sent back (round 1 of 2): plan reviewed · 1 blocker, 0 minor · 621 in, 1k out
    gemini-plan-review: plan reached you without a review: Gemini HTTP 503: This model is currently experiencing high demand. ...

## Komut

    /gemini-plan-review              açık mı kapalı mı, gemini-core'un tuttuğu model, thinking seviyesi ve tier, key var mı, son inceleme
    /gemini-plan-review on | off     kapalıyken planlar incelenmeden size ulaşır; gemini-core'da key yokken on reddedilir
    /gemini-plan-review reset        yeniden kapalı, varsayılan

İnceleme yüklendikten sonra kapalıdır. Key'i ayarlayıp incelemeyi açana kadar Gemini'ye hiçbir şey gönderilmez.

Key, tier, model (varsayılan `gemini-3.8-flash`) ve thinking seviyesi gemini-core'da tutulur:

    /gemini-core model plan-review gemini-3.5-flash
    /gemini-core thinking plan-review low
    /gemini-core paid

## Free tier mı, paid tier mı

Her inceleme planı ve konuşmayı gönderir: prompt'larınızı, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini. Free tier'da Google bu verileri kullanabilir ve insan denetçiler de okuyabilir. gemini-core README'si, Gemini API Additional Terms belgesinin ilgili kısmını aktarır. Google'a göstermek istemediğiniz bir projede billing'i açık bir key kullanın ve `/gemini-core paid` ayarını yapın.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-plan-review@kilimcininkoroglu-mods

Mod `gemini-core`'a bağlıdır ve `claude plugin install` onu da yükler. Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da, gemini-core'un [Kurulumdan sonra](../gemini-core/README.md#after-installing) bölümünde anlatıldığı gibi ayarlayın. Ardından Claude Code'u yeniden başlatın.
2. `/gemini-plan-review on` komutunu çalıştırın. Key yoksa komut `still off: gemini-core has no Gemini key` cevabını verir ve inceleme kapalı kalır.
3. `/gemini-plan-review` komutunu çalıştırın. İlk satır `on · <model> · thinking ... · <tier> tier · key set` olmalıdır.
4. Bir plan size `Gemini HTTP 429` ya da tekrar eden `Gemini HTTP 503` ile ulaşırsa `/gemini-core model plan-review` ile başka bir model seçin.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `2000000` | Gönderilen konuşmanın en fazla karakter sayısı, 10.000 ile 4.000.000 arası; plan her zaman tamamıyla gönderilir |

Aralık dışındaki ya da tam sayı olmayan bir değerin yerine varsayılan değer kullanılır.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-plan-review}, prompt.submit, prompt.attachment{type=plan_mode}, tool.call{tool=ExitPlanMode}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.fs.read (via planOf), $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via review, runCommand, storeEnabled), $.http.fetch (via askGemini), $.session.messages (via review), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.ui.log (via notReviewed, verdictOf), $.ui.toast (via verdictOf)

Reach L3: network'e erişir.

    1. Okur:         her ExitPlanMode çağrısında plan dosyasını; plan dosyasının path'i için plan modu notunu; her prompt'un kaynağını; konuşmayı (mesajlar, tool input'ları ve output'ları); kendi $.store dosyasını; gemini-core'dan key'i içeren isteği
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     planı ve konuşmayı, her ExitPlanMode çağrısı için bir istekle (bir 503 sonrasında en fazla dört, bir 429 ya da key hatası sonrasında her ek key için bir istek daha), gemini-core'un oluşturduğu URL'ye (generativelanguage.googleapis.com); key x-goog-api-key header'ında gönderilir, hiçbir zaman URL'de değil
    4. Saklar:       açık/kapalı ayarını $.store içinde; tur sayısı, plan dosyasının path'i ve son inceleme satırı bellekte tutulur
    5. Düşman girdi: bir plan ya da bir konuşma Gemini'nin bulgularını yönlendirebilir; bu yüzden zayıf bir plan geçebilir ya da sağlam bir plan geri gönderilebilir; model yanlış bir bulguyu planda cevaplayabilir ve 2 turdan sonra plan, Gemini ne derse desin size ulaşır

## Sınırlar

- Bir inceleme, bir modelin görüşüdür. Bir sorunu kaçırabilir ya da planın zaten çözdüğü bir sorunu bildirebilir.
- Her `$.http.fetch` çağrısı, tam bir cevap almadan 30 saniye geçince sona erer (2.1.278 üzerinde ölçüldü). Bu durumda yavaş bir model planı incelemeden geçirir.
- Bir subagent'ın ExitPlanMode çağrısı incelenmez, çünkü sizin onay pencerenizi açmaz.
- Plan modu notunun metni engine'e aittir. Bir build bu metni değiştirirse, yeni bir plan dosyasından sonraki ilk çağrı path içermez. Bu plan size `the call carries no plan text` ile ulaşır.
- Her inceleme bütün konuşmayı gönderir. Bu yüzden session uzadıkça her inceleme büyür ve yavaşlar. `$.session.messages()` en yeni 4096 mesajı döndürür.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
