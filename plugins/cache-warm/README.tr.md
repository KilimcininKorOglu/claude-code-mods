# cache-warm

Claude Code konuşmanızı bir saat boyunca prompt cache'te tutar. Daha uzun bir süre ara verirseniz sonraki mesaj, bütün context'i cache write fiyatıyla yeniden yazar: Claude Fable 5.2'de bu, 200k token için $3,20'dir. Aynı token'ları sıcak bir cache'ten okumak ise $0,04'tür. Bu mod, cache'i seçtiğiniz bir süre boyunca sıcak tutar ve soğuk bir cache'in maliyetini gösterir.

Mod, Karan Bansal'ın cache-tax modunun (karanb192/claude-code-mods) davranışını izler, ancak onun mesaj gönderme kontrolünü içermez. Kod yeni yazıldı.

## Ne yapar

**Cache'i sıcak tutar.** `/cache-warm` altı saatlik bir süre başlatır. Bu süre içinde, ana loop'un son model isteğinden 50 dakika sonra mod, session'ın kendi transcript'i üzerinden tool'suz bir `$.model.fork` gönderir. Server bu çağrıyı cache'ten cevaplar ve bu, cache'in bir saatlik süresini yeniler. Her yeni istek ping'i ileri bir zamana taşır. Bu yüzden aktif olarak kullandığınız bir session hiç ping göndermez. Bir session'ın ilk isteği ve `/clear` ya da bir compaction'dan sonraki ilk istek de ping'i zamanlar. Böylece ilk turn içinde bir saati aşan bir tool çağrısı da ping'ini turn'ün ortasında alır (2.1.281 üzerinde ölçüldü: ping `sleep 110` çalışırken gönderildi ve turn normal şekilde bitti).

**`always` ile süresiz çalışır.** `/cache-warm always` bir süre başlatmaz: ping, session açık olduğu sürece her 50 dakikada bir gönderilir. Bunu yalnız `/cache-warm off` bitirir. Bu ayar, modun kendi `$.store` dosyasında tek bir global key'dir. Bu yüzden her projenin sonraki her session'ı aynı döngüyü session başında ve `/clear` sonrasında başlatır.

- Her turn'ün sonunda son isteğin zamanı, session'ın id'si altında `$.store` içine yazılır. Her ping de kendi okumasını oraya yazar. Bu yüzden çalışan bir konuşmaya sonradan yüklenen bir modül (`/reload-plugins`, bir güncelleme), bu iki zamandan daha geç olanına göre zamanında ping gönderir. Yalnız ping'lerle sıcak tutulan bir session'da son turn, cache'ten daha eskidir. İki zaman da bir saatten eskiyse cache silinmiştir. Bu durumda döngü, soğuk bir ping'in maliyetini ödemek yerine bir sonraki turn'ü bekler.
- Bunun için session'ın transcript'i kullanılmaz, çünkü `/reload-plugins` transcript'e kendi satırını yazar ve dosyanın son yazılma zamanı bir istek gibi görünürdü (ölçüldü: son turn'den 90 saniye sonra yapılan bir reload, ping'i 90 saniye geç zamanlardı). Yalnız henüz zaman kaydı olmayan bir session, yani eski bir sürümle çalışmış bir session, transcript'inin son yazılma zamanını (`~/.claude/projects/<dizin>/<session id>.jsonl`; `CLAUDE_CONFIG_DIR` tanımlıysa onun altında) bir kez okur. Transcript, session'ın başladığı dizine göre aranır, bir shell `cd` komutunun geçtiği dizine göre aranmaz. Bulunamayan bir transcript bir transcript satırında belirtilir.
- Cache'in silindiğini gören bir ping bu döngüyü bitirmez. Bu ping'in ödediği cache write yeni cache'tir: mod bunu bir transcript satırında bildirir, bu yazmayı session'ın sayacına ekler ve devam eder. Sıcak bir ping context'i cache read fiyatıyla okur: 200k token için yaklaşık $0,05. Bu yüzden boşta geçen bir günün ping'leri yaklaşık $1,40 tutar.

**Cache silindiğinde durur.** Bu, sonu olan bir süre için geçerlidir, `always` için geçerli değildir. Sıcak bir ping context'i okur ve yalnız kendi birkaç token'ını yazar. Bir ping hiçbir şey okumazsa ya da okuduğunun onda biri kadar veya daha fazlasını yazarsa cache zaten silinmiştir ve cache write'ı ping'in kendisi ödemiştir. Bu durumda mod durur ve nedenini gösterir. Mod ayrıca API fork'u bir hatayla cevapladığında (satır hatanın status'unu ve türünü belirtir) ve fork cevap vermeden kesildiğinde de durur. Engine'in fork'layacak bir şeyi olmadığında, örneğin ilk cevabından önceki resume edilmiş bir process'te, süre durmaz: mod bir sonraki cevabı bekler. Bu cevabın turn'ü ping'i yeniden zamanlar ve satır cache'in ne zamana kadar korunduğunu gösterir. Metin içermeyen bir cevap da cache'i okumuştur. Bu yüzden bir ping olarak sayılır. `always` ile böyle bir hata döngüyü yalnız o turn için durdurur: bir sonraki turn döngüyü yeniden başlatır. Böylece session, hiçbir şey çalışmazken açık bir ayar tutmaz.

**Ödenmiş bir soğuk cache write'tan sonra kendiliğinden başlar.** Bir turn, 20k token'ı aşan bir context'in en az yarısını yeniden yazdığında mod bu soğuk yazmayı sayar ve altı saatlik bir süre başlatır. Daha uzun bir süre zaten başlatılmışsa yeni süre başlatılmaz. `always` ile altı saatlik bir süre başlatılmaz, çünkü süresiz döngü bu cache'i zaten sıcak tutar.

**Durumu gösterir.** `/cache-status` modeli, cache'in sıcak mı soğuk mu olduğunu, context boyutunu, soğuk maliyeti, süreyi, başa baş noktasını ve bu session'ın soğuk yazmalarını gösterir.

Soğuk bir cache'e gönderdiğiniz bir mesaj hiçbir zaman durdurulmaz ya da geciktirilmez. Cache'i süresi dolmuş, resume edilen bir session, ilk mesajının maliyetini bildiren tek bir satır alır. Claude Code cache'in yaşını transcript'teki son cevaptan hesaplar. Bir ping ise transcript'e hiçbir şey yazmaz. Bu yüzden modun bu session için kaydettiği son ping cache'i bir saat içinde okuduysa bu satır yazılmaz.

**Resume'dan sonra bir keep-warm mesajı gönderir.** Resume edilen bir process, kendi ilk cevabından önce fork yapamaz: `$.model.fork` `nothing-to-fork` cevabını verir (headless bir `claude --resume` ile ölçüldü). Bu yüzden hiçbir ping gönderilemez. Kapatıp 30 dakika sonra yeniden açtığınız bir session, siz bir şey yazmazsanız bir saat dolduğunda cache'ini kaybeder. Bu yüzden bir süre ya da `always` çalışırken interaktif bir session resume edildiğinde, context'i 50k token ya da daha büyükse ve cache'i hâlâ korunuyorsa mod, resume'dan üç saniye sonra kendi `/cache-warm:send` komutuyla tek bir mesaj gönderir:

    /cache-warm:send This message was sent by the cache-warm plugin, not by the person. The session was resumed, and a resumed session can keep its prompt cache warm only after a reply. Do not run a tool or continue a task. Reply with the single word: warm

Bu gerçek bir turn'dür: cache'i okur, model tek bir kelimeyle cevap verir, bu mesaj ve cevap konuşmada kalır ve turn'ün sonu ping'i yeniden zamanlar. Şu durumlarda hiçbir şey gönderilmez: cache zaten silinmişse (bir sonraki mesajınız aynı cache write'ı zaten öder), bir `-p` çalıştırmasında ya da siz bu üç saniye içinde bir mesaj gönderdiyseniz. Diğer modlar bu turn'ü diğer turn'ler gibi görür: task'lar açıksa `task-poke` bu turn'den sonra devam prompt'unu gönderebilir ve `desk-notify` turn sonu bildirimini gösterir. 2.1.283 üzerinde, resume edilen 116k token'lık interaktif bir session'da ölçüldü: mesaj resume sırasında gönderildi, model `warm` cevabını verdi ve sonraki ping fork yapıp 117k token okudu. Bir resume, prefix'in bir kısmını kendiliğinden bozabilir (o session 116k token'ın 42k'sını yeniden yazdı; son ping'inden 40 dakika sonra resume edilen başka bir session 4k token yazdı). Keep-warm turn'ü bu cache write'ı sizin ilk mesajınız yerine resume sırasında öder. Üç saniye, iki başlangıç hook'undan daha geç olanından itibaren sayılır: `classic.SessionStart` ve `session.start` belirli bir sırayla tamamlanmaz. Marketplace'in bütün modları yüklüyken `session.start`, `classic.SessionStart`'tan dört saniye sonra tamamlandı (2.1.285 üzerinde ölçüldü). Yalnız ilk hook'un başlattığı bir bekleme, henüz başlamamış bir session buldu ve hiçbir şey göndermedi.

## Komutlar

    /cache-warm               altı saat sıcak tutar
    /cache-warm 90m           seçtiğiniz bir süre boyunca sıcak tutar (2h30m de olur)
    /cache-warm always        cache'i her projenin her session'ında süresiz sıcak tutar
    /cache-warm 6h every 2m   iki dakikada bir ping gönderir; bir test ayarı, en az 1m, bu süreden sonra unutulur
    /cache-warm status        status line metni
    /cache-warm off           durdurur, süreyi unutur ve always'i kapatır
    /cache-status             kart
    /cache-warm:send <metin>  modun resume sonrasında gönderdiği keep-warm mesajı; gövdesi yalnız metnin kendisidir

## Ne gösterir

**Prompt'un altında bir status line.** Bir süre çalışırken ya da bir durmadan sonra gösterilir:

    cache-warm: 5h 10m left · ping in 37m · last ping read 200k $0.05 (05:42)
    cache-warm: stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone

`last` kısmı, cache'i okuyan son isteği gösterir: bir ping ya da bir ana loop turn'ü, hangisi daha geç geldiyse. Örneğin `last ping read 200k $0.05` ya da `last turn read 250k $0.07`, hiçbir zaman ikisi birlikte değil. Bir turn'ün değerleri bütün turn'ü kapsar: her isteğin toplamı. Parantez içindeki saat, cevabın geldiği andır ve yerel saattir. Önceki bir günden gelen bir cevap günü ve ayı da gösterir, örneğin `(22 Sep 23:10)`. Kayıt `$.store` içinde session'ın id'si altında saklanır. Bu yüzden `/reload-plugins` ya da bir güncelleme kaydı hemen yeniden gösterir.

Bir süre çalışırken interaktif bir session satırı her dakika yeniden çizer. Böylece kalan süre ve sonraki ping'e kalan süre, turn'ler ve ping'ler arasında geri sayar ve `last` kısmı satırda kalır. Ping'den önceki son dakikada satır `ping now` gösterir, çünkü dakikalar yuvarlanır ve satır dakikada bir çizilir. Ping'in fork'u çalışırken satır `pinging…` gösterir. Engine'in fork'layacak bir şeyi olmadığında satır geri saymak yerine bunu bildirir:

    cache-warm: always · no ping before the next reply · cache holds until 19:16

**Sidebar açıkken her ping denemesi için bir stream kaydı.** Kayıt ayrıca sidebar'ın log dosyasında da saklanır (`~/.claude/sidebar/<project>-<date>.log`). Böylece bir ping'in gönderilip gönderilmediğini ve ne yaptığını sonradan okuyabilirsiniz. Sidebar kapalıysa aynı metin bir transcript satırı olarak yazılır:

    ping sent · read 901k · wrote 0 · $0.45
    ping found the cache gone · read 0 · wrote 180k · $3.60
    ping not sent: the conversation has no reply to fork yet; the ping waits for the next reply, and the cache holds until 19:16
    ping failed: the ping failed, the API answered 529 (overloaded)
    keep-warm message sent: the session was resumed and its cache holds until 19:16; a resumed session pings only after a reply

[sidebar](../sidebar) açıkken status line sidebar'a taşınır: session boyunca kalan ve her değişiklikte yeniden yazılan bir `cache window` section'ı. Bu sırada status line boş kalır. Yalnız kalan süre (ya da `always`) renklidir: süre bir ping periyodundan önce bitecekse sarı, süre devam ederken yeşil, ilk turn beklenirken soluk. Ardından gelen ping ayrıntıları soluk renktedir. Durmuş bir süre `stopped:` kısmını kırmızı, nedenini varsayılan renkte gösterir. Sidebar yoksa status line yukarıdaki gibi çizilir.

Durma nedeni bir turn boyunca gösterilir. Bir sonraki turn'de section bunun yerine boşta satırını gösterir. Bu satır soluk renktedir. Yalnız ödenmiş bir `N cold writes paid $X` kısmı sarı renktedir. Böylece pane, biten bir sürenin son cümlesini değil, şu anki ölçümü gösterir. Neden transcript'te kalır. Hiçbir süre çalışmıyorken status line boştur:

    cache window
    off · 2 cold writes paid $6.30 · context 315k tokens

Süresi dolan bir süre, bir sonraki mesajınızla yeniden başlatılır: biten süreyle aynı uzunlukta ve aynı ping periyoduyla. Beklerken boşta satırı bunu bildirir:

    cache window
    off · 6h again at your next message · 1 cold write paid $4.01 · context 201k tokens

    cache-warm: the 6h window ran out; this message arms another one. /cache-warm off stops it.

Yalnız süresi dolan bir süre yeniden başlatılır. Bir ping'in durdurduğu süre yeniden başlatılmaz: bu durumda cache zaten silinmiştir ve bir sonraki mesajınızın soğuk cache write'ı kendi 6 saatlik süresini başlatır. `/cache-warm off`, yeniden başlatılmayı bekleyen bir süreyi unutur.

Süre satırının altında section soluk renkte ikinci bir satır içerir: son transcript satırının kısaltılmış hâli. Soğuk bir cache write'ın maliyeti sarı renktedir. Süre satırı cache'in ne kadar süre tutulacağını, ikinci satır modun son olarak ne yaptığını gösterir:

    cache window
    6h left · ping in 50m
    cold write 201k tokens paid ($4.01)

**`/cache-status` kartı:**

    claude-fable-5-1
    state       warm, 42m left
    context     200,502 tokens
    cold cost   $4.01 to re-write it (warm turn $0.05)
    keep warm   on, 5h 10m left · ping in 37m · last ping read 200k $0.05 (05:42)
    break-even  up to 80 pings at the read rate cost one cold write, about 2d 18h of idle at one ping per 50m
    session     1 cold write paid, $4.01

**Bir transcript satırı.** Soğuk bir cache write bir süre başlattığında ya da bir resume soğuk başladığında yazılır. Bu satır modele gönderilmez. Mod çalışmıyorken (süre yok, `always` kapalı) satır sidebar'ın stream'ine yazılır ve transcript'e hiçbir şey yazılmaz. Kapalı bir sidebar bu satırı göstermez. Çalışan bir modun yazdığı satır değişmez.

## Fiyatlar

`hooks/pricing.ts` dosyasındaki tablo, Anthropic fiyat sayfasındaki her modelin cache read, 1 saatlik cache write ve output fiyatlarını içerir. Fiyatlar Kasım 2026'da okundu. Bir model id'si, içerdiği ilk model ailesinin fiyatını alır. Bu yüzden `claude-opus-4-1` Opus 4.1 fiyatıyla ($1,50 / $30 / $75), `claude-opus-4-8` Opus 4.8 fiyatıyla ($0,50 / $10 / $25) fiyatlanır. `claude-opus-5-5` ayrıca `opus-5` içerir. Bu yüzden kendi satırı önce gelir: Opus 5.5 $0,20 / $8 / $20 fiyatındadır ve Opus 5'ten ucuzdur. Fable 5.2 $0,20 / $16 / $40, Sonnet 5.5 $0,10 / $4 / $10 fiyatındadır. Haiku 5.5 $0,01 / $0,20 / $0,50 fiyatındadır. Prompt'u (input, cache read ve cache write) 100.000 token'ı aşan bir istek, bunların tamamı için $0,05 / $1 / $2,50 öder. Mod bunu context'e, yani tek bir isteğin prompt'una göre belirler. Bir turn'ün istekleri boyunca toplanan kullanıma göre belirlemez. Bir ping tam olarak fiyatlanır: cache read, kendi cache write'ı, cache'lenmemiş input'u taban fiyattan (1 saatlik cache write fiyatının yarısı) ve output'u. Bilinmeyen bir model `n/a` gösterir.

Fast mode; Fable 5.2, Opus 5.5, Opus 5 ve Opus 4.8'i kendi taban fiyatlarıyla ($16, $8 ve $10 input) faturalandırır ve cache çarpanlarını bunların üzerine uygular. `/fast` komutunun yazdığı `fastMode` ayarı açıkken mod, Fable 5.2'yi $0,40 / $32 / $80, Opus 5.5'i $0,40 / $16 / $40, Opus 5 ve 4.8'i $1 / $20 / $50 ile fiyatlar. Mod ayarları session başında ve her ana loop turn'ünün sonunda okur. Böylece bir `/fast` bir sonraki turn'den itibaren hesaba katılır. `fastModePerSessionOptIn` değeri `true` olduğunda her session fast mode kapalı başlar. Bu durumda standart fiyatlar geçerlidir. Diğer her model standart fiyatlarını korur. Kart, fast mode'u yalnız fiyatlar değiştiğinde belirtir:

    claude-opus-5-5 · fast mode rates (the fastMode setting)

Bir abonelikte dolar değerleri bir ölçüdür, faturanız değildir. Bir cache read'in 5 saatlik ve haftalık limitlerden nasıl düştüğü belgelenmemiştir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install cache-warm@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

Modu yerel bir checkout'tan tek bir session için yüklemek için:

    claude --plugin-dir plugins/cache-warm

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Diğer bütün keep-warm modlarını kapatın, örneğin `claude plugin disable cache-tax@claude-code-mods`. Aynı session'daki iki keep-warm modu, her boşta kalma süresinde iki ping gönderir.
3. Bir ping'in cache'inizi okuduğunu, aşağıdaki "Kendi session'ınızda doğrulayın" bölümünde anlatıldığı gibi bir kez kontrol edin.
4. Cache'i süresiz sıcak tutmak için bir kez `/cache-warm always` komutunu çalıştırın. Bu ayar globaldir: her projenin sonraki her session'ı döngüyü kendiliğinden başlatır ve `/cache-warm off` döngüyü kalıcı olarak bitirir. Bu ayar olmadan bir süre yalnız `/cache-warm` ile ya da ödenmiş bir soğuk cache write'tan sonra başlatılır.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, prompt.submit, command.run{command=cache-warm}, command.run{command=cache-status}, turn.step, turn.complete, session.compact
    ❯ ./register.ts calls: $.clock.after (via arm, scheduleKeepWarm), $.clock.every, $.clock.now, $.command.register (via registerCommands), $.command.run (via keepWarmAfterResume), $.env.get (via seedFromTranscript), $.fs.exists (via seedFromTranscript), $.fs.stat (via seedFromTranscript), $.model.fork (via forkPing), $.prompt.submit (via keepWarmAfterResume), $.session.id, $.session.model, $.session.root (via seedFromTranscript), $.session.usage, $.settings.read (via readFast), $.sidebar.set (via logEvent, toSidebar, toStream), $.store.delete (via prune, pruneRequests, startEndless, startWindow, stop), $.store.get, $.store.keys (via prune, pruneRequests)
    ❯ ./register.ts calls: $.store.set (via afterTurn, keepLastRead, startWindow, warmCommand), $.ui.log (via logEvent, seedFromTranscript, toStream), $.ui.status (via showStatusAt)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2: Claude'u yönlendirir.

    1. Okur:         her ana loop model isteğinin zamanını; her turn'ün ve her ping'in token sayılarını ve model id'sini; güncel context boyutunu; bir süreyi yeniden başlatmak için her mesajın kaynağını; Claude Code'un settings hook'ları için hesapladığı resume alanlarını; session id'sini ve modelini; modül çalışan bir konuşmaya yüklenirken bir kez, session'ın kendi transcript dosyasının son yazılma zamanını; session başında ve her turn sonunda fastMode ve fastModePerSessionOptIn ayarlarını; kendi $.store dosyasını. Bir prompt'un metnini, bir dosyanın içeriğini ya da bir tool sonucunu hiçbir zaman okumaz
    2. Çalıştırır:   bir süre ya da always döngüsü çalışırken her boşta kalma süresinde bir $.model.fork, test ayarı kullanılmıyorsa son istekten 50 dakika sonra (en az 1 dakika); mod kapalıyken hiçbir zaman; cache'in silindiğini gören bir ping sonu olan bir süreyi bitirir, always ile döngü devam eder; cache'i hâlâ korunan interaktif bir session resume edildikten sonra /cache-warm:send ile bir keep-warm mesajı (engine komutu reddederse bir plugin prompt'u); bu gerçek bir turn'dür
    3. Gönderir:     fork'u, yani session'ın kendi transcript'i üzerinden sabit tek satırlık bir prompt'la bir API isteğini; resume'dan sonra sabit keep-warm mesajını, konuşmanın bir turn'ü olarak
    4. Saklar:       $.store içinde bu session'ın id'si altında süre sonunu, ping periyodunu, son ana loop isteğinin zamanını ve son ping ya da turn okumasını (token, maliyet, saat); ayrıca süresiz döngünün yanında bir süre key'i gerektirmeyen global always ayarını. Bu session'ın biten süresi durdurulduğunda ve bir sonraki başlangıcında silinir; başka bir session'ın süresi bittikten bir hafta sonra silinir; başka bir session'ın istek zamanı ve son okuması bir saatten eski olduğunda silinir. Soğuk cache write sayacı bellekte tutulur ve session ile birlikte silinir
    5. Düşman girdi: modun parse ettiği tek metin /cache-warm komutunun argümanıdır ve bir süre kalıbı ile üç kelimeye karşı kontrol edilir; fork'un prompt'u sabittir; bu yüzden düşmanca oluşturulmuş hiçbir metin fork'a ulaşamaz

## Kendi session'ınızda doğrulayın

Sahte saatle çalışan testler timer'ı ve puanlamayı doğrular, ancak bir fork'un ana cache'i okuduğunu doğrulamaz. Bunu tek bir ping doğrular. Sıcak bir session'da:

    > Reply with one word: ready
    > /cache-warm 1h every 1m

Bir dakika sonra status line `last ping read <context'inize yakın bir değer> $...` göstermelidir. Bir `stopped: the ping read ...` satırı, fork'un cache'i paylaşmadığını ve modun zaten durduğunu gösterir. `/cache-warm off` testi bitirir.

## Sınırlar

- 50 dakikalık ping, ana konuşmanın kullandığı 1 saatlik cache seviyesine göre ayarlanmıştır.
- Sıcak bir ping yalnız cache'in o anda sıcak olduğunu kanıtlar. Bir model ya da effort değişikliği, düzenlenmiş bir CLAUDE.md ya da değişmiş bir tool listesi, süreden bağımsız olarak prefix'i bozar ve maliyeti bir sonraki mesajınız öder.
- Bir ping'in output'u sınırlanamaz. Yüksek effort'taki bir model cevap vermeden önce düşünebilir. Status line, ping'in gerçekten faturalandırdığı maliyeti gösterir.
- Resume mantığı, `classic.SessionStart` olayını resume alanlarıyla tetikleyen hook testleri ve tmux'ta resume edilen interaktif bir session'ın canlı kontrolü ile test edilir. Bir resume'un bütün prefix'i koruyup korumadığı modun kontrolünde değildir: ölçülen bir session'da 116k token'ın 42k'sı, başka bir session'da 4k'sı yeniden yazıldı.
- Soğuk cache write sayacı her session için ayrıdır ve bellekte tutulur. `/clear` sayacı sıfırlar.
- Fast mode, istekten değil, `fastMode` ayarından, yani kaydedilmiş tercihten okunur. Mod, Claude Code'un bir session içinde standart hıza dönmesini görmez (bir fast mode rate-limit bekleme süresi, biten kullanım kredileri, fast mode'u kapatan bir organizasyon). Bu turn'ler standart fiyatla faturalandırılırken mod onları fast mode fiyatıyla hesaplar.
- Session fast hızda çalışırken bir ping'in, yani bir `$.model.fork` çağrısının da fast hızda çalışıp çalışmadığı ölçülmedi. Mod ping'i session'ın fiyatlarıyla hesaplar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
