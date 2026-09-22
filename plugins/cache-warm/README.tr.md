# cache-warm

Bir session'ın 1 saatlik prompt cache'ini sizin belirlediğiniz bir pencere boyunca sıcak tutan ve soğuk bir cache'in maliyetini gösteren bir Claude Code Mod'u. Cache düştükten sonra gönderilen bir mesaj tüm context'i cache-write fiyatından yeniden yazar; Claude Fable 5.1'de bu 200k token için 4,00 dolardır, aynı token'ları sıcak cache'ten okumanın 0,05 dolarına karşılık.

Davranış, Karan Bansal'ın cache-tax mod'unu (karanb192/claude-code-mods) izler, onun send guard'ı olmadan. Kod yenidir.

## Ne yapar

**Cache'i sıcak tutar.** `/cache-warm` altı saatlik bir pencere kurar. Pencere içinde, main loop'un son model isteğinden 50 dakika sonra mod, session'ın kendi transcript'i üzerinden tool'suz tek bir `$.model.fork` gönderir. Sunucu bunu cache'ten cevaplar, bu da saati tazeler. Her yeni istek ping'i ileri atar, yani aktif bir session hiç ping göndermez.

**`always` ile sonsuz çalışır.** `/cache-warm always` bir pencere değildir: ping, session yaşadığı sürece 50 dakikada bir çıkar ve bunu bitiren tek şey `/cache-warm off` komutudur. Anahtar, mod'un kendi `$.store` dosyasındaki tek bir global key'dir, yani her projenin her sonraki session'ı aynı döngüyü başlangıçta ve `/clear` sonrasında başlatır. Çalışan bir konuşmaya yüklenen modül (`/reload-plugins`, bir update) son isteğin zamanını session transcript'inin son yazılma zamanından okur (`~/.claude/projects/<dizin>/<session id>.jsonl`, `CLAUDE_CONFIG_DIR` ayarlıysa onun altından) ve ping'i zamanında atar; o yazma bir saatten eskiyse cache gitmiştir ve döngü soğuk bir ping ödemek yerine sonraki turn'ü bekler. Cache'i gitmiş bulan bir ping bu döngüyü bitirmez: o ping'in ödediği write yeni cache'tir, mod bunu bir transcript satırıyla söyler, write'ı session'ın sayacına ekler ve devam eder. Sıcak bir ping context'i read fiyatından okur, 200k token için yaklaşık 0,05 dolar, yani boş geçen bir günün ping'leri yaklaşık 1,40 dolar tutar.

**Cache gittiğinde durur.** Bu, sonu olan bir pencere için geçerlidir, `always` için değil. Sıcak bir ping context'i okur ve yalnız kendi birkaç token'ını yazar. Bir ping hiçbir şey okumadığında ya da okuduğunun onda biri kadar veya daha fazlasını yazdığında, cache zaten gitmiştir ve write'ı ping'in kendisi ödemiştir. Mod o zaman durur ve sebebini gösterir. Engine'in henüz fork edeceği bir şey olmadığında, API fork'a bir hatayla cevap verdiğinde (satır onun status'unu ve türünü adlandırır) ve fork cevabından önce kesildiğinde de durur. Metin taşımayan bir cevap yine de cache'i okumuştur, bu yüzden bir ping sayılır. `always` altında böyle bir hata döngüyü yalnız o turn için durdurur: sonraki turn onu yeniden başlatır, yani session switch'i tutarken hiçbir şey çalıştırmaz duruma düşmez.

**Ödenmiş soğuk bir write'tan sonra kendini kurar.** Bir turn, 20k token'dan büyük bir context'in en az yarısını yeniden yazdığında mod o soğuk write'ı sayar ve altı saatlik bir pencere kurar, daha uzun bir pencere zaten kurulu değilse. `always` altında hiç altı saatlik pencere kurulmaz, çünkü sonsuz döngü o cache'i zaten tutar.

**Durumu gösterir.** `/cache-status`; modeli, sıcak ya da soğuk olduğunu, context boyutunu, soğuk fiyatı, pencereyi, başa baş noktasını ve bu session'ın soğuk write'larını yazar.

Soğuk bir cache'e giden mesaj durdurulmaz ve geciktirilmez. Cache'i düşmüş, resume edilen bir session ilk mesajının fiyatını tek satırda alır.

## Komutlar

    /cache-warm               altı saat sıcak tut
    /cache-warm 90m           kendi pencereniz kadar sıcak tut (2h30m de olur)
    /cache-warm always        cache'i sonsuza kadar sıcak tut, her projenin her session'ında
    /cache-warm 6h every 2m   iki dakikada bir ping; test ayarı, taban 1m, bu pencereden sonra unutulur
    /cache-warm status        status line metni
    /cache-warm off           durdur, pencereyi unut ve always'i kapat
    /cache-status             kart

## Ne gösterir

**Prompt'un altında bir status line**, bir pencere kuruluyken ya da bir duruştan sonra:

    cache-warm: 5h 10m left · ping in 37m · last ping read 200k $0.05
    cache-warm: stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone

[sidebar](../sidebar) açıkken bu satır oraya gider, session boyunca duran ve her değişimde yeniden yazılan bir `cache window` section'ı olarak; status line temiz kalır. Orada satır renklidir: durmuş pencere kırmızı, sonu bir ping periyodundan yakın olan pencere sarı, tutan pencere yeşil, ilk turn beklenirken soluk. Sidebar kapalıyken ya da o mod kurulu değilken status line yukarıdaki gibi çizilir.

Duruş sebebi bir turn boyunca durur. Sonraki turn'de section onun yerine soluk idle satırını taşır, böylece pane biten pencerenin bir cümlesini değil, şimdinin ölçümünü tutar. Sebep transcript'te kalır ve pencere çalışmıyorken status line boştur:

    cache window
    off · 2 cold writes paid $6.30 · context 315k tokens

Süresi dolan bir pencere sonraki mesajınızla tekrar kurulur, biten pencere kadar ve aynı ping periyoduyla; idle satırı beklerken bunu söyler:

    cache window
    off · 6h again at your next message · 1 cold write paid $4.01 · context 201k tokens

    cache-warm: the 6h window ran out; this message arms another one. /cache-warm off stops it.

Yalnız süresi dolan pencere geri gelir. Bir ping'in durdurduğu pencere gelmez: orada cache zaten gitmiştir ve sonraki mesajınızın soğuk write'ı kendi 6h penceresini kurar. `/cache-warm off` geri gelmeyi bekleyen bir pencereyi unutur.

Section pencerenin altında ikinci, soluk bir satır tutar: son transcript satırı, kısaltılmış. Pencere satırı cache'in ne kadar tutulacağını söyler, ikinci satır mod'un en son ne yaptığını:

    cache window
    6h left · ping in 50m
    cold write 201k tokens paid ($4.01)

**`/cache-status` kartı**:

    claude-fable-5-1
    state       warm, 42m left
    context     200,502 tokens
    cold cost   $4.01 to re-write it (warm turn $0.05)
    keep warm   on, 5h 10m left · ping in 37m · last ping read 200k $0.05
    break-even  up to 80 pings at the read rate cost one cold write, about 2d 18h of idle at one ping per 50m
    session     1 cold write paid, $4.01

**Transcript'te bir satır**, modele gitmez: soğuk bir write pencereyi kurduğunda ya da bir resume soğuk başladığında.

## Fiyatlar

`hooks/pricing.ts` içindeki tablo, Anthropic fiyat sayfasındaki her modelin cache-read, 1 saatlik cache-write ve output fiyatlarını tutar, Eylül 2026'da okundu. Bir model id'si, içerdiği ilk aileyi alır; yani `claude-opus-4-1` Opus 4.1 olarak fiyatlanır (1,50 / 30 / 75 dolar), `claude-opus-4-8` ise Opus 4.8 olarak (0,50 / 10 / 25 dolar). `claude-opus-5-5` de `opus-5` içerir, bu yüzden kendi satırı önce gelir: Opus 5.5, Opus 5'in altında 0,20 / 8 / 20 dolardır. Bir ping tam fiyatlanır: cache read'i, kendi cache write'ı, base fiyattan cache'siz input'u (1 saatlik write fiyatının yarısı) ve output'u. Bilinmeyen model `n/a` gösterir.

Fast mode, Opus 5.5, Opus 5 ve Opus 4.8'i kendi base fiyatlarından faturalar (8 ve 10 dolar input), cache çarpanları da bunların üstüne uygulanır. `/fast` komutunun yazdığı `fastMode` setting'i açıkken mod Opus 5.5'i 0,40 / 16 / 40 dolardan, Opus 5 ve 4.8'i 1 / 20 / 50 dolardan fiyatlar. Setting'leri session başında ve her main-loop turn'ün sonunda okur, yani bir `/fast` sonraki turn'den itibaren sayılır. `true` değerli bir `fastModePerSessionOptIn` her session'ı fast mode kapalı başlatır, o durumda standart fiyatlar kalır. Diğer her model standart fiyatını korur ve kart fast mode'u yalnız fiyatlar değiştiğinde adlandırır:

    claude-opus-5-5 · fast mode rates (the fastMode setting)

Abonelikte dolarlar fatura değil, bir ölçü birimidir. Bir cache read'in 5 saatlik ve haftalık limitlere nasıl sayıldığı dokümante değildir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install cache-warm@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Tek bir session için local checkout'tan yükleyin:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/cache-warm

Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Diğer her keep-warm mod'unu kapatın, örneğin `claude plugin disable cache-tax@claude-code-mods`. Tek session'da iki keep-warm mod'u, boş geçen her aralıkta iki ping gönderir.
3. Bir ping'in cache'inizi okuduğunu bir kere doğrulayın, aşağıdaki "Kendi session'ınızda kanıtlayın" bölümündeki gibi.
4. Cache'i sonsuza kadar sıcak tutmak için `/cache-warm always` komutunu bir kere çalıştırın. Anahtar global'dir: her projenin her sonraki session'ı döngüyü kendisi başlatır ve `/cache-warm off` onu temelli bitirir. Bu olmadan pencere yalnız `/cache-warm` ile ya da ödenmiş bir soğuk write'tan sonra kurulur.

## Nereye uzanır

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, prompt.submit, command.run{command=cache-warm}, command.run{command=cache-status}, turn.step, turn.complete, session.compact
    ❯ ./register.ts calls: $.clock.after (via arm), $.clock.now, $.command.register (via registerCommands), $.env.get (via seedFromTranscript), $.fs.exists (via seedFromTranscript), $.fs.stat (via seedFromTranscript), $.model.fork (via ping), $.session.id, $.session.model, $.session.usage, $.settings.read (via readFast), $.sidebar.set (via toSidebar), $.store.delete (via prune, startEndless, startWindow, stop), $.store.get (via prune, restore), $.store.keys (via prune), $.store.set (via startWindow, warmCommand), $.ui.log (via logEvent, seedFromTranscript), $.ui.status (via showStatusAt)
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2, Claude'u sürer.

    1. Okur:     her main-loop model isteğinin zamanını; her turn'ün ve her ping'in token sayılarını ve model id'sini; canlı context boyutunu; pencereyi tekrar kurmak için her mesajın origin'ini; Claude Code'un settings hook'ları için hesapladığı resume alanlarını; session id'sini ve modelini; modül çalışan bir konuşmaya yüklendiğinde bir kere, session'ın kendi transcript dosyasının son yazılma zamanını; fastMode ve fastModePerSessionOptIn setting'lerini, session başında ve her turn sonunda; kendi $.store dosyasını. Bir prompt'un metnini, bir dosyanın içeriğini ya da bir tool sonucunu hiç okumaz.
    2. Çalıştırır: bir pencere ya da always döngüsü çalışırken boş geçen her aralıkta bir $.model.fork, son istekten 50 dakika sonra (test ayarı kullanılmadıkça; taban 1 dakika); kapalıyken asla; cache'i gitmiş bulan bir ping sonu olan pencereyi bitirir, always altında döngü devam eder
    3. Gönderir: yalnız fork'u, yani session'ın kendi transcript'i üzerinden sabit tek satırlık prompt taşıyan bir API isteği
    4. Saklar:   $.store içinde pencere sonunu ve ping periyodunu bu session'ın id'si altında, ve global always anahtarını (sonsuz döngünün yanında pencere key'ine ihtiyacı yoktur); bu session'ın biten penceresi duruşta ve bir sonraki başlangıçta silinir, başka bir session'ın penceresi bittikten bir hafta sonra; soğuk write sayacı bellekte yaşar ve session ile biter
    5. Düşman girdi: parse ettiği tek metin /cache-warm argümanıdır, bir süre kalıbına ve üç kelimeye karşı eşleştirilir; fork'un prompt'u sabittir, yani kurgulanmış hiçbir şey ona ulaşamaz

## Kendi session'ınızda kanıtlayın

Mock clock testleri zamanlayıcıyı ve puanlamayı kanıtlar, bir fork'un ana cache'i okuduğunu değil. Bunu tek bir ping kanıtlar. Sıcak bir session'da:

    > Reply with one word: ready
    > /cache-warm 1h every 1m

Bir dakika sonra status line `last ping read <context'inize yakın bir değer> $...` demelidir. `stopped: the ping read ...` satırı fork'un cache'i paylaşmadığını söyler ve mod çoktan durmuştur. `/cache-warm off` testi bitirir.

## Sınırlar

- 50 dakikalık ping, ana konuşmanın kullandığı 1 saatlik cache tier'ını varsayar.
- Sıcak bir ping cache'in o anda sıcak olduğunu kanıtlar. Model ya da effort değişimi, düzenlenmiş bir CLAUDE.md ya da değişen bir tool listesi prefix'i zamandan bağımsız bozar ve sonraki mesaj öder.
- Bir ping'in output'u sınırlanamaz; yüksek effort'taki bir model cevaptan önce düşünebilir. Status line, ping'in gerçekten faturaladığını fiyatlar.
- `claude plugin test` test engine'i `classic.SessionStart` olayını üretemez. Resume ve `/clear` mantığı saf fonksiyonların unit testleriyle ve canlı bir session kontrolüyle karşılanır.
- Soğuk write sayacı session başınadır ve bellektedir. `/clear` onu sıfırlar.
- Fast mode, istekten değil, kaydedilmiş tercih olan `fastMode` setting'inden okunur. Mod, Claude Code'un bir session içinde standart hıza düşmesini görmez: fast mode rate limit cooldown'u, biten usage credits ya da fast mode'u kapatan bir organizasyon. O turn'ler standart fiyattan faturalanır, mod ise onları fast fiyatlar.
- Session fast çalışırken bir ping'in, yani bir `$.model.fork`'un, fast hızda çalışıp çalışmadığı ölçülmedi; mod onu session'ın fiyatlarıyla fiyatlar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
