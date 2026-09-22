# gemini-plan-review

Her planı size ulaşmadan önce Gemini'ye inceleten bir Claude Code Mod'u. Model ExitPlanMode çağırdığında, onay penceresi açılmadan önce Gemini planı ve konuşmayı okur. Engelleyici bulgusu olan bir plan modele geri döner, en fazla iki kere; siz planı geçtikten sonra görürsünüz.

## Ne yapar

1. Mod ExitPlanMode tool'unu hook'lar. Bir `tool.call` hook'u izin sorusundan önce çalışır, yani geri gönderilen bir plan onay penceresini hiç açmaz.
2. Planı diskteki dosyadan okur; pencerenin gösterdiği metin odur. Dosya, çağrının `planFilePath` değeridir; yoksa engine'in plan modu notunun adlandırdığı dosyadır (`## Plan File Info: ... create your plan at /.../x.md`). Çağrının kendi `plan` alanı yalnız hiçbir path bilinmediğinde kullanılır, çünkü 2.1.278'de yeni bir plan dosyasından sonraki ilk çağrı ne `plan` ne de `planFilePath` taşıdı ve sonraki bir çağrı planı modelin son edit'inden önceki hâliyle taşıdı (ölçüldü).
3. Planı ve konuşmayı tek bir `generateContent` isteğinde bir schema ile gönderir: bulguların listesi, her biri `blocker` ya da `minor`, bir mesajla. İsteği gemini-core kurar: `gemini-plan-review` için tuttuğu key, model ve thinking seviyesi ile; cevabı da o okur.
4. `blocker`, hedefin gerektirdiği ama planın atladığı bir adım, konuşmanın ya da içinde gösterilen kodun çeliştiği bir varsayım, ulaşıldığını kontrol etmenin yolu olmayan bir hedef, ya da sizin istediğinize aykırı bir karar demektir. Diğer her şey `minor`'dır.
5. Karar:
   - 1. ya da 2. turda bir blocker: plan geri döner. Model her blocker'ı ve minor notları okur; talimat, planı düzeltmesi ya da yanlış bir bulguyu plan dosyasında `## Gemini plan review` başlığı altında cevaplamasıdır. Gemini sonraki turda o bölümü okur ve konuşmanın desteklediği bir cevabı kabul etmesi söylenir;
   - 2 turdan sonra hâlâ blocker varsa: plan size ulaşır. Bir transcript satırı açık blocker'ları listeler ve model sizin cevabınızdan sonra onları okur;
   - yalnız minor bulgular ya da hiç bulgu yoksa: plan size ulaşır ve model, sizin cevabınızdan sonra notları ya da incelemenin hiçbir şey bulmadığını söyleyen tek satırı okur.
6. Gönderdiğiniz bir prompt sonraki plana 2 turunu geri verir; onay penceresine ulaşan bir plan da öyle. Bir arka plan bildirimi ya da bir peer mesajı vermez.
7. İnceleme cevap veremediğinde (key yok, bir HTTP hatası, bozuk bir cevap, okunamayan bir plan dosyası) plan size ulaşır, bir transcript satırı sebebini söyler ve model sebebi okur.
8. 503 sonrasında gemini-core, mod'a 1 sn, 2 sn ve 3 sn sonra tekrar sordurur, en fazla dört kere, ve 50 saniye geçtikten sonra yeni deneme başlamaz.

2.1.278 üzerinde `gemini-3.5-flash` ile yapılan canlı testte istek, unit test'i olan bir `--json` flag'iydi ve plan `1. Add a --json flag to /task-poke. 2. Done.` idi. 1. tur planı `The plan does not include the requested unit test for the --json flag` ile geri gönderdi. Model test adımını ekledi ve ikinci çağrı onay penceresini açtı. Free bir key'de `gemini-3.8-flash` ile aynı inceleme yalnız 503 cevapları aldı ve plan sebebiyle birlikte pencereye ulaştı.

## Ne gösterir

Her incelemeden sonra bir toast ve `/gemini-plan-review` içinde sonuncusu:

    gemini-plan-review: plan reviewed · 1 blocker, 0 minor · 621 in, 1k out · sent to Gemini free tier

Bir plan geri döndüğünde, açık blocker'larla geçtiğinde ya da incelenmediğinde bir transcript satırı:

    gemini-plan-review: plan sent back (round 1 of 2): plan reviewed · 1 blocker, 0 minor · 621 in, 1k out
    gemini-plan-review: plan reached you without a review: Gemini HTTP 503: This model is currently experiencing high demand. ...

## Komut

    /gemini-plan-review              on ya da off, gemini-core'un tuttuğu model, thinking seviyesi ve tier, key var mı, son inceleme
    /gemini-plan-review on | off     off: planlar incelenmeden size ulaşır; gemini-core'da key yokken on reddedilir
    /gemini-plan-review reset        tekrar off, varsayılan

İnceleme kurulumdan sonra kapalıdır, yani siz bir key ayarlayıp açana kadar Gemini'ye hiçbir şey gönderilmez.

Key, tier, model (varsayılan `gemini-3.8-flash`) ve thinking seviyesi gemini-core'a aittir:

    /gemini-core model plan-review gemini-3.5-flash
    /gemini-core thinking plan-review low
    /gemini-core paid

## Free tier ya da paid tier

Her inceleme planı ve konuşmayı gönderir: prompt'larınızı, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini. Free tier'da Google bunları kullanabilir ve insan denetçiler okuyabilir; gemini-core README'si Gemini API Additional Terms'ten alıntılar. Google'a göstermeyeceğiniz bir projede billing açık bir key kullanın ve `/gemini-core paid` ayarlayın.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-plan-review@kilimcininkoroglu-mods

`gemini-core`'a bağlıdır; `claude plugin install` onu da ekler. Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da ayarlayın, onun [After installing](../gemini-core/README.md#after-installing) bölümünde yazdığı gibi, sonra Claude Code'u yeniden başlatın.
2. `/gemini-plan-review on` çalıştırın. Key olmadan `still off: gemini-core has no Gemini key` cevabını verir ve kapalı kalır.
3. `/gemini-plan-review` çalıştırın. İlk satır `on · <model> · thinking ... · <tier> tier · key set` demelidir.
4. Bir plan size `Gemini HTTP 429` ya da tekrar eden `Gemini HTTP 503` ile ulaşıyorsa `/gemini-core model plan-review` ile başka bir model seçin.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `2000000` | En fazla kaç karakter konuşma gönderilir |

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-plan-review}, prompt.submit, prompt.attachment{type=plan_mode}, tool.call{tool=ExitPlanMode}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.fs.read (via planOf), $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via review, runCommand, storeEnabled), $.http.fetch (via askGemini), $.session.messages (via review), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.ui.log (via notReviewed, verdictOf), $.ui.toast (via verdictOf)

Reach L3, network'e çıkar.

    1. Okur:     her ExitPlanMode çağrısında plan dosyasını; plan dosyasının path'i için plan modu notunu; her prompt'un origin'ini; konuşmayı (mesajlar, tool input'ları ve output'ları); kendi $.store dosyasını; gemini-core'dan key'i taşıyan isteği
    2. Çalıştırır: hiçbir şey
    3. Gönderir: planı ve konuşmayı, ExitPlanMode çağrısı başına bir istek (503 sonrası en fazla dört, 429 ya da key hatası sonrası ek key başına bir tane daha), gemini-core'un kurduğu URL'ye (generativelanguage.googleapis.com), key x-goog-api-key header'ında, hiçbir zaman URL'de değil
    4. Saklar:   $.store içinde on/off ayarını; tur sayısı, plan dosyası path'i ve son inceleme satırı bellekte yaşar
    5. Düşman girdi: bir plan ya da bir konuşma Gemini'nin bulgularını yönlendirebilir, yani zayıf bir plan geçebilir ya da sağlam bir plan geri dönebilir; model yanlış bir bulguyu planda cevaplayabilir ve 2 turdan sonra Gemini ne derse desin plan size ulaşır

## Sınırlar

- Bir inceleme bir modelin görüşüdür. Bir sorunu kaçırabilir ve planın zaten çözdüğü bir sorunu raporlayabilir.
- Her `$.http.fetch`, tam bir cevap gelmeden 30 saniye sonra biter (2.1.278 üzerinde ölçüldü). Yavaş bir model o zaman planı incelemeden geçirir.
- Bir subagent'ın ExitPlanMode çağrısı incelenmez, çünkü sizin onay pencerenizi açmaz.
- Plan modu notunun ifadesi engine'e aittir. Bir build onu değiştirdiğinde yeni bir plan dosyasından sonraki ilk çağrı path taşımaz ve o plan size `the call carries no plan text` ile ulaşır.
- Her inceleme tüm konuşmayı gönderir, yani uzun bir session her incelemeyi daha büyük ve daha yavaş yapar. `$.session.messages()` en yeni 4096 mesajı cevaplar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
