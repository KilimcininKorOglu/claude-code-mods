# cache-warm

Claude Code konuşmanı bir saatliğine prompt cache'te tutar. Daha uzun süre uzaklaşırsan bir sonraki mesaj bütün context'i cache-write fiyatından yeniden yazar: Claude Fable 5.1'de 200k token için bu $4,00 eder, aynı token'ları sıcak cache'ten okumak ise $0,05. Bu mod cache'i senin seçtiğin bir süre boyunca sıcak tutar ve soğuk bir cache'in sana neye mal olacağını gösterir.

Davranışı Karan Bansal'ın cache-tax mod'unu (karanb192/claude-code-mods) izler, ama onun gönderim kilidi yoktur. Kod baştan yazılmıştır.

## Ne yapar

**Cache'i sıcak tutar.** `/cache-warm` altı saatlik bir pencere açar. Pencere içinde, ana loop'un son model request'inden 50 dakika sonra mod, session'ın kendi transcript'i üzerinden tool'suz bir `$.model.fork` gönderir. Sunucu bunu cache'ten cevaplar ve bu da cache'in süresini bir saat uzatır. Her yeni request ping'i ileri kaydırır, yani aktif kullandığın bir session hiç ping göndermez. Session'ın ilk request'i ile `/clear` ya da compaction'dan sonraki ilk request de ping'i kurar. Böylece ilk turn içinde bir saati aşan bir tool çağrısı bile ping'ini turn'ün ortasında alır (2.1.281'de ölçüldü: ping `sleep 110` çalışırken gitti ve turn normal bitti).

**`always` ile sonsuza dek çalışır.** `/cache-warm always` bir pencere değildir: ping session yaşadığı sürece her 50 dakikada bir gider ve onu yalnız `/cache-warm off` bitirir. Ayar, mod'un kendi `$.store`'unda tek bir global key'dir; bu yüzden her projenin sonraki her session'ı aynı döngüyü başlangıçta ve `/clear`'dan sonra kendisi başlatır.

- Her turn'ün sonu son request'in zamanını session'ın id'siyle `$.store`'a yazar, her ping de kendi okumasını oraya kaydeder. Bu sayede çalışan bir konuşmaya yüklenen modül (`/reload-plugins`, bir güncelleme) ikisinden hangisi daha yeniyse ona göre zamanında ping atar; yalnız ping'lerle sıcak tutulan bir session'ın son turn'ü cache'inden eskidir. İkisi de bir saatten eskiyse cache gitmiştir ve döngü soğuk bir ping'e para ödemek yerine bir sonraki turn'ü bekler.
- Bunun için session'ın transcript'i okunmaz, çünkü `/reload-plugins` oraya kendi satırını yazar ve dosyanın son yazılma zamanı bir request gibi görünürdü (ölçüldü: son turn'den 90 saniye sonraki bir reload ping'i 90 saniye geciktirirdi). Transcript'in son yazılma zamanını yalnız henüz hiç zaman kaydı olmayan, eski bir sürümle çalışmış session bir kez okur (`~/.claude/projects/<dizin>/<session id>.jsonl`, `CLAUDE_CONFIG_DIR` ayarlıysa onun altında). Transcript, session'ın başladığı dizine göre aranır, bir shell `cd`'sinin götürdüğü dizine göre değil; bulunamazsa bir transcript satırı bunu söyler.
- Cache'i gitmiş bulan bir ping bu döngüyü bitirmez. O ping'in ödediği yazma yeni cache olur: mod bunu bir transcript satırıyla söyler, yazmayı session'ın sayacına ekler ve devam eder. Sıcak bir ping context'i okuma fiyatından okur, 200k token için yaklaşık $0,05; yani boşta geçen bir günün ping'leri yaklaşık $1,40 tutar.

**Cache gidince durur.** Bu, sonu olan bir pencere için geçerlidir, `always` için değil. Sıcak bir ping context'i okur ve yalnız kendi birkaç token'ını yazar. Bir ping hiçbir şey okumazsa ya da okuduğunun onda biri kadar veya daha fazla yazarsa cache zaten gitmiş ve yazmayı ping'in kendisi ödemiştir; mod durur ve nedenini gösterir. API fork'a hata dönerse (satır status'u ve türünü söyler) ve fork cevap vermeden kesilirse de durur. Engine'in fork'layacak bir şeyi yoksa, örneğin resume edilmiş bir process ilk cevabını henüz vermemişse, pencere durmaz: bir sonraki cevabı bekler, o turn ping'i yeniden kurar ve satır cache'in ne zamana kadar tuttuğunu söyler. Metinsiz bir cevap da cache'i okumuştur, bu yüzden ping sayılır. `always` altında böyle bir hata döngüyü yalnız o turn için durdurur: bir sonraki turn onu yeniden başlatır, böylece session hiçbir şey çalışmıyorken ayarı açık tutmaz.

**Pahalı bir soğuk yazmadan sonra kendiliğinden açılır.** Bir turn 20k token'dan büyük bir context'in en az yarısını yeniden yazarsa mod bu soğuk yazmayı sayar ve altı saatlik bir pencere açar; daha uzun bir pencere zaten açıksa açmaz. `always` altında altı saatlik pencere hiç açılmaz, çünkü sonsuz döngü o cache'i zaten tutuyordur.

**Durumu gösterir.** `/cache-status` modeli, cache'in sıcak mı soğuk mu olduğunu, context boyutunu, soğuk fiyatı, pencereyi, başa baş noktasını ve bu session'daki soğuk yazmaları yazar.

Soğuk bir cache'e gönderdiğin mesaj asla durdurulmaz ya da geciktirilmez. Cache'i dolmuş bir session resume edilince, ilk mesajının fiyatını söyleyen tek bir satır görür. Claude Code cache'in yaşını transcript'teki son cevaba göre hesaplar ve ping hiçbir zaman oraya yazmaz. Bu yüzden mod'un bu session için kaydettiği son ping cache'i son bir saat içinde okuduysa o satır gösterilmez.

**Resume'dan sonra sıcak tutma mesajı gönderir.** Resume edilmiş bir process kendi ilk cevabından önce fork yapamaz: `$.model.fork` `nothing-to-fork` döner (headless bir `claude --resume` ile ölçüldü). Yani ping gidemez; kapatıp 30 dakika sonra yeniden açtığın bir session, sen bir şey yazmadıkça saatin sonunda cache'ini kaybederdi. Bu yüzden bir pencere ya da `always` çalışırken, context'i 50k token veya daha büyük ve cache'i hâlâ tutan interaktif bir session resume edilince mod, resume'dan üç saniye sonra kendi `/cache-warm:send` komutuyla tek bir mesaj gönderir:

    /cache-warm:send This message was sent by the cache-warm plugin, not by the person. The session was resumed, and a resumed session can keep its prompt cache warm only after a reply. Do not run a tool or continue a task. Reply with the single word: warm

Bu gerçek bir turn'dür: cache'i okur, model tek kelimeyle cevap verir, bu ikisi konuşmada kalır ve turn'ün sonu ping'i yeniden kurar. Cache zaten gitmişse (bir sonraki mesajın aynı yazmayı nasılsa öder), bir `-p` koşusunda ya da o üç saniye içinde sen bir mesaj gönderdiysen hiçbir şey gönderilmez. Diğer mod'lar bunu sıradan bir turn gibi görür: açık görevler varken `task-poke` arkasından devam prompt'unu gönderebilir, `desk-notify` de turn sonu bildirimini gösterir. 2.1.283'te 116k token'lık, resume edilmiş interaktif bir session'da ölçüldü: mesaj resume anında gitti, model `warm` diye cevap verdi ve bir sonraki ping fork yapıp 117k token okudu. Resume prefix'in bir kısmını kendi başına bozabilir (o session 116k'nın 42k'sını yeniden yazdı; son ping'inden 40 dakika sonra resume edilen bir başkası 4k); sıcak tutma turn'ü bu yazmayı senin ilk mesajın yerine resume anında öder.

## Komutlar

    /cache-warm               altı saat sıcak tutar
    /cache-warm 90m           kendi seçtiğin bir süre boyunca sıcak tutar (2h30m de olur)
    /cache-warm always        cache'i sonsuza dek, her projenin her session'ında sıcak tutar
    /cache-warm 6h every 2m   iki dakikada bir ping atar; test ayarıdır, en az 1m, bu pencereden sonra unutulur
    /cache-warm status        status line metni
    /cache-warm off           durdurur, pencereyi unutur ve always'i kapatır
    /cache-status             kart
    /cache-warm:send <metin>  mod'un resume'dan sonra gönderdiği sıcak tutma mesajı; gövdesi yalnız metindir

## Ne gösterir

**Prompt'un altında bir status line**, pencere açıkken ya da bir duruştan sonra:

    cache-warm: 5h 10m left · ping in 37m · last ping read 200k $0.05 (05:42)
    cache-warm: stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone

`last` kısmı cache'i en son okuyan request'i gösterir; ping mi ana loop turn'ü mü, hangisi daha yeniyse: `last ping read 200k $0.05` ya da `last turn read 250k $0.07`, hiçbir zaman ikisi birden değil. Turn'ün sayıları bütün turn'ü kapsar, içindeki her request toplanır. Parantezdeki saat o cevabın geldiği yerel saattir; önceki bir güne aitse gün ve ayı da taşır, `(22 Sep 23:10)` gibi. Kayıt session'ın id'siyle `$.store`'da tutulur, bu yüzden `/reload-plugins` ya da bir güncelleme onu hemen yeniden gösterir.

Pencere açıkken interaktif bir session satırı her dakika yeniden çizer; böylece kalan süre ve bir sonraki ping'e kalan süre turn'ler ve ping'ler arasında geri sayar, `last` kısmı da satırda kalır. Ping'den önceki son dakikada satırda `ping now` yazar, çünkü dakikalar yuvarlanır ve satır dakikada bir çizilir; ping'in fork'u yoldayken `pinging…` yazar. Engine'in fork'layacak bir şeyi yoksa satır geri saymak yerine bunu söyler:

    cache-warm: always · no ping before the next reply · cache holds until 19:16

**Her ping denemesi için bir stream kaydı**, sidebar açıkken. Kayıt sidebar'ın log dosyasında da tutulur (`~/.claude/sidebar/<proje>-<tarih>.log`), böylece bir ping'in gidip gitmediğini ve ne yaptığını sonradan okuyabilirsin; sidebar kapalıysa aynı metin bir transcript satırıdır:

    ping sent · read 901k · wrote 0 · $0.45
    ping found the cache gone · read 0 · wrote 180k · $3.60
    ping not sent: the conversation has no reply to fork yet; the ping waits for the next reply, and the cache holds until 19:16
    ping failed: the ping failed, the API answered 529 (overloaded)
    keep-warm message sent: the session was resumed and its cache holds until 19:16; a resumed session pings only after a reply

[sidebar](../sidebar) açıksa status line oraya taşınır: session boyunca duran ve her değişiklikte yeniden yazılan bir `cache window` section'ı olur, status line da boş kalır. Yalnız kalan süre (ya da `always`) renklidir: pencere bir ping süresinden daha yakında bitecekse sarı, sürüyorsa yeşil, ilk turn'ü beklerken soluk. Arkasından gelen ping ayrıntıları soluktur; durmuş bir pencere ise `stopped:` başını kırmızı, nedenini varsayılan renkte gösterir. Sidebar yoksa status line yukarıdaki gibi çizilir.

Duruş nedeni bir turn boyunca kalır. Bir sonraki turn'de section onun yerine boşta satırını gösterir: soluktur, yalnız ödenmiş `N cold writes paid $X` kısmı sarıdır. Böylece pane, biten bir pencerenin son cümlesini değil, şimdiki ölçümü gösterir. Neden transcript'te kalır; hiçbir pencere çalışmıyorken status line boştur:

    cache window
    off · 2 cold writes paid $6.30 · context 315k tokens

Süresi dolan bir pencere bir sonraki mesajınla yeniden açılır; biten pencere kadar uzun ve aynı ping süresiyle. Boşta satırı beklerken bunu söyler:

    cache window
    off · 6h again at your next message · 1 cold write paid $4.01 · context 201k tokens

    cache-warm: the 6h window ran out; this message arms another one. /cache-warm off stops it.

Yalnız süresi dolan pencere geri gelir. Bir ping'in durdurduğu pencere gelmez: orada cache zaten gitmiştir ve bir sonraki mesajının soğuk yazması kendi 6 saatlik penceresini açar. `/cache-warm off` geri gelmeyi bekleyen bir pencereyi de unutur.

Section pencerenin altında ikinci, soluk bir satır tutar: son transcript satırının kısaltılmışı, içinde soğuk yazmanın maliyeti sarı. Pencere satırı cache'in ne kadar tutulacağını, ikinci satır mod'un en son ne yaptığını söyler:

    cache window
    6h left · ping in 50m
    cold write 201k tokens paid ($4.01)

`/cache-status`'un **kartı**:

    claude-fable-5-1
    state       warm, 42m left
    context     200,502 tokens
    cold cost   $4.01 to re-write it (warm turn $0.05)
    keep warm   on, 5h 10m left · ping in 37m · last ping read 200k $0.05 (05:42)
    break-even  up to 80 pings at the read rate cost one cold write, about 2d 18h of idle at one ping per 50m
    session     1 cold write paid, $4.01

**Transcript'te bir satır**, modele gönderilmez: bir soğuk yazma pencereyi açtığında ya da bir resume soğuk başladığında.

## Fiyatlar

`hooks/pricing.ts` içindeki tablo, Anthropic fiyat sayfasındaki her modelin cache okuma, 1 saatlik cache yazma ve output fiyatlarını tutar; Eylül 2026'da okundu. Bir model id'si, içinde geçen ilk aileyi alır: `claude-opus-4-1` Opus 4.1 olarak ($1,50 / $30 / $75), `claude-opus-4-8` Opus 4.8 olarak ($0,50 / $10 / $25) fiyatlanır. `claude-opus-5-5` içinde `opus-5` de geçtiği için kendi satırı önce gelir: Opus 5.5, Opus 5'ten ucuzdur, $0,20 / $8 / $20. Bir ping'in tamamı fiyatlanır: cache okuma, kendi cache yazması, taban fiyattan (1 saatlik yazma fiyatının yarısı) cache'lenmemiş input'u ve output'u. Bilinmeyen bir model `n/a` gösterir.

Fast mode Opus 5.5, Opus 5 ve Opus 4.8'i kendi taban fiyatlarından ($8 ve $10 input) faturalar, cache çarpanları bunun üstüne uygulanır. `/fast`'in yazdığı `fastMode` ayarı açıkken mod Opus 5.5'i $0,40 / $16 / $40, Opus 5 ve 4.8'i $1 / $20 / $50 olarak fiyatlar. Ayarları session başında ve her ana loop turn'ünün sonunda okur, yani bir `/fast` bir sonraki turn'den itibaren sayılır. `fastModePerSessionOptIn` `true` ise her session fast mode kapalı başlar ve standart fiyatlar geçerli olur. Diğer modeller standart fiyatlarında kalır; kart da fast mode'dan yalnız fiyatlar değiştiğinde söz eder:

    claude-opus-5-5 · fast mode rates (the fastMode setting)

Abonelikteysen dolarlar bir ölçü birimidir, faturan değil. Bir cache okumasının 5 saatlik ve haftalık limitlerden nasıl düştüğü belgelenmemiştir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install cache-warm@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Bir session için yerel bir checkout'tan yüklemek istersen:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/cache-warm

Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Cache'i sıcak tutan başka bir mod varsa kapat, örneğin `claude plugin disable cache-tax@claude-code-mods`. Bir session'da iki böyle mod, her boşta kalma süresinde iki ping gönderir.
3. Aşağıdaki "Kendi session'ında kanıtla" bölümündeki gibi, bir ping'in cache'ini gerçekten okuduğunu bir kez kontrol et.
4. Cache'i sonsuza dek sıcak tutmak istersen bir kez `/cache-warm always` çalıştır. Ayar globaldir: her projenin sonraki her session'ı döngüyü kendi başlatır, `/cache-warm off` da onu kalıcı olarak bitirir. Bu ayar olmadan pencere yalnız `/cache-warm` ile ya da ödenmiş bir soğuk yazmadan sonra açılır.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, prompt.submit, command.run{command=cache-warm}, command.run{command=cache-status}, turn.step, turn.complete, session.compact
    ❯ ./register.ts calls: $.clock.after, $.clock.every, $.clock.now, $.command.register (via registerCommands), $.command.run (via keepWarmAfterResume), $.env.get (via seedFromTranscript), $.fs.exists (via seedFromTranscript), $.fs.stat (via seedFromTranscript), $.model.fork (via forkPing), $.prompt.submit (via keepWarmAfterResume), $.session.id, $.session.model, $.session.root (via seedFromTranscript), $.session.usage, $.settings.read (via readFast), $.sidebar.set (via toSidebar, toStream), $.store.delete (via prune, pruneRequests, startEndless, startWindow, stop), $.store.get, $.store.keys (via prune, pruneRequests), $.store.set (via afterTurn, keepLastRead, startWindow, warmCommand), $.ui.log (via logEvent, seedFromTranscript, toStream), $.ui.status (via showStatusAt)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2: Claude'u yönlendirir.

    1. Okur:     her ana loop model request'inin zamanını; her turn'ün ve her ping'in token sayılarını ve model id'sini; güncel context boyutunu; pencereyi yeniden açmak için her mesajın kaynağını; Claude Code'un settings hook'ları için hesapladığı resume alanlarını; session id'sini ve modelini; modül çalışan bir konuşmaya yüklendiğinde bir kez, session'ın kendi transcript dosyasının son yazılma zamanını; session başında ve her turn sonunda fastMode ve fastModePerSessionOptIn ayarlarını; kendi $.store'unu. Hiçbir prompt'un metnini, dosya içeriğini ya da tool sonucunu okumaz.
    2. Çalıştırır: bir pencere ya da always döngüsü çalışırken her boşta kalma süresinde bir $.model.fork; test ayarı kullanılmıyorsa son request'ten 50 dakika sonra (en az 1 dakika); kapalıyken hiç; cache'i gitmiş bulan bir ping sonu olan bir pencereyi bitirir, always altında döngü sürer; cache'i hâlâ tutan interaktif bir session resume edilince /cache-warm:send ile bir sıcak tutma mesajı (engine komutu reddederse plugin prompt'u olarak), bu gerçek bir turn'dür
    3. Gönderir: fork'u, yani session'ın kendi transcript'i üzerinden sabit tek satırlık prompt'la bir API request'ini; resume'dan sonra da sabit sıcak tutma mesajını konuşmanın bir turn'ü olarak
    4. Saklar:   $.store içinde bu session'ın id'siyle pencerenin bitişini, ping süresini, son ana loop request'inin zamanını ve son ping ya da turn okumasını (token, maliyet, zaman), bir de sonsuz döngünün yanında pencere key'i gerektirmeyen global always ayarını; bu session'ın biten penceresi duruşta ve bir sonraki başlangıçta, başka bir session'ın penceresi bittikten bir hafta sonra, başka bir session'ın request zamanı ve son okuması bir saati geçince silinir; soğuk yazma sayacı bellekte durur ve session'la biter
    5. Düşman girdi: ayrıştırdığı tek metin /cache-warm'un argümanıdır ve bir süre deseniyle üç kelimeye karşı kontrol edilir; fork'un prompt'u sabittir, bu yüzden özel hazırlanmış bir metin ona ulaşamaz

## Kendi session'ında kanıtla

Sahte saatli testler zamanlayıcıyı ve puanlamayı kanıtlar, fork'un ana cache'i okuduğunu değil. Bunu tek bir ping kanıtlar. Sıcak bir session'da:

    > Reply with one word: ready
    > /cache-warm 1h every 1m

Bir dakika sonra status line `last ping read <context'ine yakın bir sayı> $...` göstermeli. `stopped: the ping read ...` satırı, fork'un cache'i paylaşmadığı ve mod'un zaten durduğu anlamına gelir. `/cache-warm off` testi bitirir.

## Sınırlar

- 50 dakikalık ping, ana konuşmanın kullandığı 1 saatlik cache katmanını varsayar.
- Sıcak bir ping yalnız o anda cache'in sıcak olduğunu kanıtlar. Model ya da effort değişikliği, düzenlenmiş bir CLAUDE.md ya da değişen tool listesi, zamandan bağımsız olarak prefix'i bozar ve bedelini bir sonraki mesajın öder.
- Bir ping'in output'u sınırlanamaz; yüksek effort'taki bir model cevaplamadan önce düşünebilir. Status line ping'in gerçekte ne kadar faturalandığını gösterir.
- Resume mantığı, `classic.SessionStart`'ı resume alanlarıyla tetikleyen hook testleriyle ve tmux'ta resume edilmiş interaktif bir session'ın canlı denemesiyle kontrol ediliyor. Bir resume'un prefix'in tamamını koruyup korumadığı mod'un elinde değildir: ölçülen bir session'da 116k token'ın 42k'sını, bir başkasında 4k'sını yeniden yazdı.
- Soğuk yazma sayacı session başınadır ve bellekte durur. `/clear` onu sıfırlar.
- Fast mode, request'ten değil, kayıtlı tercih olan `fastMode` ayarından okunur. Mod, Claude Code'un bir session içinde standart hıza geri düştüğünü görmez (fast mode rate limit bekleme süresi, tükenen kullanım kredisi, fast mode'u kapatan bir organizasyon). Bu turn'ler standart fiyattan faturalanır ama mod onları fast fiyatlarla hesaplar.
- Session fast çalışırken bir ping'in, yani bir `$.model.fork`'un da fast hızda çalışıp çalışmadığı ölçülmedi; mod onu session'ın fiyatlarıyla hesaplar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
