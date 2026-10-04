# cache-warm

Claude Code konuşmanızı bir saat boyunca prompt cache'te tutar. Daha uzun bir süre uzaklaşırsanız sonraki mesaj, bütün context'i cache-write oranıyla yeniden yazar: Claude Fable 5.1'de bu, 200k token için $4.00 demektir; aynı token'ları sıcak bir cache'ten okumak $0.05. Bu mod cache'i, seçeceğiniz bir window boyunca sıcak tutar ve soğuk bir cache'in ne tutacağını gösterir.

cache-tax modunun (karanb192/claude-code-mods, Karan Bansal) davranışını izler, onun send guard'ı olmadan. Kod yenidir.

## Ne yapar

**Cache'i sıcak tutar.** `/cache-warm` altı saatlik bir window kurar. Window içinde, main loop'un son model isteğinden 50 dakika sonra mod, session'ın kendi transcript'i üzerinden tool'suz bir `$.model.fork` gönderir. Server bu çağrıyı cache'ten cevaplar ve bu da saati tazeler. Her yeni istek ping'i öteye iter; o yüzden aktif kullandığınız bir session hiç ping göndermez. Bir session'ın ilk isteği ve `/clear` ya da bir compaction'dan sonraki ilk istek de ping'i kurar; böylece ilk turn içinde saati aşan bir tool çağrısı bile ping'ini turn'in ortasında alır (2.1.281'de ölçüldü: ping, `sleep 110` sürerken gitti ve turn normal bitti).

**`always` altında sonu olmadan çalışır.** `/cache-warm always` bir window değildir: ping, session yaşadığı sürece her 50 dakikada bir gider ve onu yalnız `/cache-warm off` bitirir. Anahtar, modun kendi `$.store`'unda tek bir global key'dir; böylece her projenin sonraki her session'ı aynı döngüyü başında ve `/clear` sonrasında başlatır.

- Her turn'ün sonu, son isteğin saatini session'ın id'si altında `$.store`'a yazar; her ping de kendi okumasını oraya yazar. Bu yüzden çalışan bir konuşmaya sonradan yüklenen bir modül (`/reload-plugins`, bir güncelleme) ikisinin geç olanına göre zamanında ping atar; yalnız ping'lerle sıcak tutulan bir session'da son turn, cache'inden daha eskidir. İkisi de bir saatten eski olduğunda cache gitmiştir ve döngü, soğuk bir ping'in bedelini ödemek yerine bir sonraki turn'i bekler.
- Session'ın transcript'i bunun için kullanılmaz; çünkü `/reload-plugins` oraya kendi satırını yazar ve dosyanın son yazımı bir istek gibi görünürdü (ölçüldü: son turn'den 90 saniye sonraki bir reload, ping'i 90 saniye geç kuracaktı). Henüz saati tutmamış, yani eski bir sürümle koşmuş bir session, transcript'inin son yazımını (`~/.claude/projects/<directory>/<session id>.jsonl`; `CLAUDE_CONFIG_DIR` kuruluysa onun altında) bir kez okur. Transcript, session'ın başladığı dizin altında aranır; bir shell `cd`sinin geçtiği dizinde değil ve bulunamayan bir transcript bir satırda adlandırılır.
- Cache'in gittiğini gören bir ping bu döngüyü bitirmez. O ping'in ödediği yazım yeni cache'tir: mod bunu bir transcript satırında söyler, yazımı session'ın sayacına ekler ve devam eder. Sıcak bir ping context'i okuma oranıyla okur; 200k token için yaklaşık $0.05, yani boş bir günün ping'leri yaklaşık $1.40 eder.

**Cache gittiğinde durur.** Bu, sonu olan bir window için geçerlidir; `always` için değil. Sıcak bir ping context'i okur ve yalnız kendi birkaç token'ını yazar. Bir ping hiçbir şey okumadığında ya da okuduğunun onda biri kadar ve üstünde yazdığında, cache çoktan gitmiş demektir ve yazımı ping'in kendisi ödemiştir; mod durur ve nedenini gösterir. Ayrıca API, fork'u bir hatayla cevapladığında (satır status'unu ve türünü adlandırır) ve fork cevap vermeden kesildiğinde de durur. Engine'in fork'lanacak bir şeyi olmadığında, örneğin ilk cevabından önceki bir resume edilmiş process'te, window durmaz: sonraki cevabı bekler; o cevabın turn'ü ping'i yeniden kurar ve satır, cache'in ne zamana dek duracağını söyler. Metinsiz bir cevap yine de cache'i okumuştur; o yüzden ping sayılır. `always` altında böyle bir başarısızlık döngüyü yalnız o turn için durdurur: sonraki turn yeniden başlatır; böylece session, hiçbir şey çalışmazken anahtarı elinde tutmaz.

**Ödenmiş bir soğuk yazımdan sonra kendini kurar.** Bir turn, 20k tokenı aşan bir context'in en az yarısını yeniden yazdığında mod o soğuk yazımı sayar ve altı saatlik bir window kurar; daha uzun bir window zaten kurulu değilse. `always` altında altı saatlik bir window kurulmaz; çünkü sonsuz döngü o cache'i zaten tutar.

**Durumu gösterir.** `/cache-status` modeli, sıcak mı soğuk mu olduğunu, context boyutunu, soğuk fiyatı, window'u, break-even'i ve bu session'ın soğuk yazımlarını basar.

Soğuk bir cache'e gönderdiğiniz bir mesaj hiçbir zaman durdurulmaz ya da gecikmez. Cache'i geçmiş bir resume edilmiş session, ilk mesajının bedelini söyleyen tek bir satır alır. Claude Code cache'i transcript'in son cevabından tarihler; bir ping oraya hiç yazmaz; bu yüzden modun session için tuttuğu son ping, saat içinde cache'i okumuşken o satır basılmaz.

**Resume'dan sonra bir keep-warm mesajı gönderir.** Resume edilmiş bir process kendi ilk cevabından önce fork edemez: `$.model.fork` `nothing-to-fork` cevabı verir (headless bir `claude --resume` ile ölçüldü). Böylece hiçbir ping çıkamaz ve 30 dakika sonra yeniden açtığınız bir session, siz bir şey yazmazsanız saat dolunca cache'ini kaybeder. Bir window ya da `always` sürerken interactive bir session resume edildiğinde, context'i 50k token ve üstünde ve cache'i hâlâ duruyorsa mod bu yüzden resume'dan üç saniye sonra tek bir mesaj gönderir; kendi `/cache-warm:send` komutu üzerinden:

    /cache-warm:send This message was sent by the cache-warm plugin, not by the person. The session was resumed, and a resumed session can keep its prompt cache warm only after a reply. Do not run a tool or continue a task. Reply with the single word: warm

Burası gerçek bir turn'dür: cache'i okur, model tek kelimeyle cevap verir, bu çift konuşmada kalır ve sonu ping'i yeniden kurar. Cache çoktan gitmişse (sonraki mesajınız zaten aynı yazımı ödeyecek), bir `-p` koşusunda ya da o üç saniye içinde siz bir mesaj gönderdiyseniz hiçbir şey gönderilmez. Öteki modlar onu her turn gibi görür: task'lar açıkken `task-poke` arkasından continue prompt'unu gönderebilir, `desk-notify` turn sonu bildirimini gösterir. 2.1.283'te, 116k tokenlık resume edilmiş interactive bir session'da ölçüldü: mesaj resume'da gitti, model `warm` diye cevap verdi ve sonraki ping fork edip 117k token okudu. Bir resume, prefix'in bir kısmını kendi başına da bozabilir (o session 116k'nın 42k'sını yeniden yazdı; son pinginden 40 dakika sonra resume edilen bir başkası 4k); keep-warm turn o yazımı, sizin ilk mesajınız yerine resume'da öder. Üç saniye, iki başlangıç hook'undan geç olanından sayılır; `classic.SessionStart` ve `session.start` belirsiz bir sırada oturur: marketplace'in bütün modları yüklüyken `session.start`, `classic.SessionStart`'tan dört saniye sonra oturdu (2.1.285'te ölçüldü) ve yalnız ilkinin kurduğu bir bekleme, henüz başlamamış bir session buldu ve hiçbir şey göndermedi.

## Komutlar

    /cache-warm               altı saat sıcak tutar
    /cache-warm 90m           kendi seçtiğiniz bir window boyunca sıcak tutar (2h30m de olur)
    /cache-warm always        cache'i her projenin her session'ında, sonu olmadan sıcak tutar
    /cache-warm 6h every 2m   iki dakikada bir ping atar; bir test ayarı, taban 1m, bu window'dan sonra unutulur
    /cache-warm status        status line metni
    /cache-warm off           durdurur, window'u unutur ve always'ı kapatır
    /cache-status             kart
    /cache-warm:send <text>   modun resume sonrası gönderdiği keep-warm mesajı; gövdesi metnin kendisidir

## Ne gösterir

**Prompt'un altında bir status line**, window kuruluysa ya da bir duruş sonrasında:

    cache-warm: 5h 10m left · ping in 37m · last ping read 200k $0.05 (05:42)
    cache-warm: stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone

`last` kısmı, cache'i okuyan son isteği adlandırır; bir ping ya da main-loop turn'ü, hangisi geç geldiyse: `last ping read 200k $0.05` ya da `last turn read 250k $0.07`, ikisi birden asla. Bir turn'ün rakamları bütün turn'ü kapsar; her isteğin toplamı. Parantezdeki saat, o cevabın geldiği an, local time'dır; önceki bir günden gelen biri günü ve ayı da taşır, örneğin `(22 Sep 23:10)`. Kayıt `$.store`'da session'ın id'si altında tutulur; bu yüzden `/reload-plugins` ya da bir güncelleme onu hemen yeniden gösterir.

Window sürerken interactive bir session satırı her dakika yeniden çizer; böylece kalan süre ve sonraki ping'e kalan süre, turn'ler ve ping'ler arasında sayar ve `last` kısmı satırda kalır. Ping'den önceki son dakika `ping now` okur; çünkü dakikalar yuvarlanır ve satır dakikada bir çizilir. Ping'in fork'u dışarıdayken `pinging…` okur. Engine'in fork'lanacak bir şeyi olmadığında satır geri saymak yerine bunu söyler:

    cache-warm: always · no ping before the next reply · cache holds until 19:16

**Sidebar açıkken her ping denemesi için bir stream kaydı.** Ayrıca sidebar'ın log dosyasında da tutulur (`~/.claude/sidebar/<project>-<date>.log`); böylece sonradan geriye dönüp bir ping'in çıkıp çıkmadığına ve ne yaptığına bakabilirsiniz. Sidebar kapalıyken aynı metin bir transcript satırıdır:

    ping sent · read 901k · wrote 0 · $0.45
    ping found the cache gone · read 0 · wrote 180k · $3.60
    ping not sent: the conversation has no reply to fork yet; the ping waits for the next reply, and the cache holds until 19:16
    ping failed: the ping failed, the API answered 529 (overloaded)
    keep-warm message sent: the session was resumed and its cache holds until 19:16; a resumed session pings only after a reply

[sidebar](../sidebar) açıkken status line oraya, session boyunca kalan ve her değişimde yeniden yazılan bir `cache window` section'ı olarak taşınır ve status line boş kalır. Yalnız kalan süre (ya da `always`) renklidir: window bir ping periyodundan önce bitmek üzereyse sarı, dururken yeşil, ilk turn'i beklerken soluk. Ardındaki ping ayrıntıları soluktur; durmuş bir window `stopped:` başını kırmızıyla, sebebini varsayılan renkle gösterir. Sidebar yoksa status line yukarıdaki gibi çizilir.

Duruş sebebi bir turn boyunca kalır. Sonraki turn'de section, idle satırını gösterir: ödenmiş bir `N cold writes paid $X` sarı olmak koşuluyla, soluk. Böylece pane, bitmiş bir window'un son cümlesini değil, şimdinin ölçümünü gösterir. Sebep transcript'te kalır ve hiçbir window çalışmıyorken status line boştur:

    cache window
    off · 2 cold writes paid $6.30 · context 315k tokens

Süresi dolan bir window, sonraki mesajınız tarafından yeniden kurulur; bitenle aynı ping periyoduyla, biten bir window var olduğu sürece. Beklerken idle satırı bunu söyler:

    cache window
    off · 6h again at your next message · 1 cold write paid $4.01 · context 201k tokens

    cache-warm: the 6h window ran out; this message arms another one. /cache-warm off stops it.

Yalnız süresi dolan bir window geri gelir. Bir ping'in durdurduğu geri gelmez: orada cache çoktan gitmiştir ve sonraki mesajınızın soğuk yazımı kendi 6 saatlik window'unu kurar. `/cache-warm off`, geri gelmeyi bekleyen bir window'u unutur.

Window'un altında section ikinci, soluk bir satır taşır: son transcript satırı, kısaltılmış; soğuk yazımın bedeli sarıyla. Window satırı cache'in ne kadar tutulduğunu söyler; ikinci satır modun son ne yaptığını:

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

**Bir transcript satırı**, modele gönderilmez; soğuk bir yazım window'u kurduğunda ya da bir resume soğuk başladığında. İzleyici kapalıyken (window yok, `always` kapalı) satır sidebar'ın stream'ine gider ve transcript'e hiçbir şey yazmaz; kapalı bir sidebar onu düşürür. Çalışan bir izleyicinin yazdığı satır değişmez.

## Fiyatlar

`hooks/pricing.ts`'deki tablo, Anthropic fiyat sayfasındaki her modelin cache-read, 1 saatlik cache-write ve output oranlarını taşır; Eylül 2026'da okundu. Bir model id, içindeki ilk aileyi alır; bu yüzden `claude-opus-4-1` Opus 4.1 fiyatıyla ($1.50 / $30 / $75) ve `claude-opus-4-8` Opus 4.8 fiyatıyla ($0.50 / $10 / $25) fiyatlanır. `claude-opus-5-5` ayrıca `opus-5` içerir; o yüzden kendi satırı önce gelir: Opus 5.5 $0.20 / $8 / $20, Opus 5'ten ucuz. Sonnet 5.5'in kendi satırı Sonnet 5 oranlarındadır: $0.20 / $4 / $10. Bir ping tam fiyatlanır: cache okuması, kendi cache yazımı, cache'siz girdisi taban orandan (1 saatlik yazım oranının yarısı) ve çıktısı. Bilinmeyen bir model `n/a` gösterir.

Fast mode, Opus 5.5'i, Opus 5'i ve Opus 4.8'i kendi taban oranlarıyla faturalandırır ($8 ve $10 input) ve üzerine cache çarpanlarını uygular. Mod, `/fast`'in yazdığı `fastMode` ayarı açıkken Opus 5.5'i $0.40 / $16 / $40 ile, Opus 5 ve 4.8'i $1 / $20 / $50 ile fiyatlar. Ayarı session'ın başında ve her main-loop turn'ünün sonunda okur; böylece bir `/fast` sonraki turn'den itibaren sayılır. `fastModePerSessionOptIn` `true` kuruluyken her session fast mode kapalı başlar; standart oranlar geçerlidir. Başka her model standart oranlarını taşır ve kart, fast mode'u yalnız oranlar değişmişken anar:

    claude-opus-5-5 · fast mode rates (the fastMode setting)

Abonelikte dolarlar bir ölçüdür, sizin faturanız değil. Bir cache okumasının 5 saatlik ve haftalık limitlere nasıl sayıldığı belgelenmemiştir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install cache-warm@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

Tek bir session için local checkout'tan yüklemek:

    claude --plugin-dir plugins/cache-warm

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Diğer bütün keep-warm mod'ları kapatın, örneğin `claude plugin disable cache-tax@claude-code-mods`. Aynı session'daki iki keep-warm modu, her boşta kalışta iki ping gönderir.
3. Bir kez, bir ping'in cache'inizi okuduğunu kontrol edin; aşağıdaki "Kendi session'ınızda kanıtlayın" bölümünde anlatıldığı gibi.
4. Cache'i sonu olmadan sıcak tutmak için bir kez `/cache-warm always` çalıştırın. Anahtar globaldir: her projenin sonraki her session'ı döngüyü kendi başına başlatır ve `/cache-warm off` onu kalıcı olarak bitirir. Olmadan bir window yalnız `/cache-warm` ile ya da ödenmiş bir soğuk yazımdan sonra kurulur.

## Nereye uzanır

Claude Code 2.1.288 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, prompt.submit, command.run{command=cache-warm}, command.run{command=cache-status}, turn.step, turn.complete, session.compact
    ❯ ./register.ts calls: $.clock.after (via arm, scheduleKeepWarm), $.clock.every, $.clock.now, $.command.register (via registerCommands), $.command.run (via keepWarmAfterResume), $.env.get (via seedFromTranscript), $.fs.exists (via seedFromTranscript), $.fs.stat (via seedFromTranscript), $.model.fork (via forkPing), $.prompt.submit (via keepWarmAfterResume), $.session.id, $.session.model, $.session.root (via seedFromTranscript), $.session.usage, $.settings.read (via readFast), $.sidebar.set (via logEvent, toSidebar, toStream), $.store.delete (via prune, pruneRequests, startEndless, startWindow, stop), $.store.get, $.store.keys (via prune, pruneRequests), $.store.set (via afterTurn, keepLastRead, startWindow, warmCommand), $.ui.log (via logEvent, seedFromTranscript, toStream), $.ui.status (via showStatusAt)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2: Claude'u sürer.

    1. Okur:     her main-loop model isteğinin saatini; her turn'ün ve her ping'in token sayılarını ve model id'sini; canlı context boyutunu; bir window'u yeniden kurmak için her mesajın kaynağını; Claude Code'un settings hook'ları için hesapladığı resume alanlarını; session id'sini ve modelini; session'ın kendi transcript dosyasının son yazım saatini, modül çalışan bir konuşmaya yüklenirken bir kez; fastMode ve fastModePerSessionOptIn ayarlarını, session'ın başında ve her turn'ün sonunda; kendi $.store'unu. Bir prompt'un metnini, bir dosyanın içeriğini ya da bir tool sonucunu asla okumaz
    2. Çalıştırır: bir window ya da always döngüsü sürerken her boşta kalışta bir $.model.fork; son istekten 50 dakika sonra, test ayarı kullanılmıyorsa (taban 1 dakika); kapalıyken asla; cache'in gittiğini gören bir ping, sonu olan bir window'u bitirir, always altında döngü devam eder; cache'i hâlâ duran interactive bir session'ın resume'undan sonra /cache-warm:send üzerinden bir keep-warm mesajı (engine komutu reddederse bir plugin prompt'u); bu gerçek bir turn'dür
    3. Gönderir: fork'u; session'ın kendi transcript'i üzerinden sabit tek satırlık bir prompt'la bir API isteği; resume'dan sonra sabit keep-warm mesajını konuşmanın bir turn'ü olarak
    4. Saklar:   $.store içinde window'un bitişini, ping periyodunu, son main-loop isteğinin saatini ve son ping ya da turn okumasını (token, bedel, saat) bu session'ın id'si altında ve sonsuz döngünün yanına ayrıca window key'i gerektirmeyen global always anahtarını; bu session'ın bitmiş window'u stop'ta ve bir sonraki başlangıcında silinir, başka bir session'ın window'u bittikten bir hafta sonra, başka bir session'ın istek saati ve son okuması bir saatlik yaşlarını aşınca; soğuk yazım sayacı bellekte yaşar ve session'la biter
    5. Düşman girdi: ayıkladığı tek metin /cache-warm'ın argument'ıdır; bir süre deseniyle ve üç kelimeyle eşleşir; fork'un prompt'u bir sabittir; o yüzden hiçbir kurgulanmış şey ona ulaşamaz

## Kendi session'ınızda kanıtlayın

Mock-clock testleri zamanlayıcıyı ve puanlamayı kanıtlar; bir fork'un main cache'i okuduğunu değil. Bunu tek bir ping kanıtlar. Sıcak bir session'da:

    > Reply with one word: ready
    > /cache-warm 1h every 1m

Bir dakika sonra status line `last ping read <context'inize yakın> $...` okumalı. Bir `stopped: the ping read ...` satırı, fork'un cache'i paylaşmadığı ve modun çoktan durduğu anlamına gelir. `/cache-warm off` testi bitirir.

## Sınırlar

- 50 dakikalık ping, main konuşmanın kullandığı 1 saatlik cache kademesini varsayar.
- Sıcak bir ping yalnız cache'in o anda sıcak olduğunu kanıtlar. Bir model ya da effort değişimi, düzenlenmiş bir CLAUDE.md ya da değişmiş bir tool listesi, süreden bağımsız prefix'i bozar ve sonraki mesajınız öder.
- Bir ping'in çıktısına sınır konamaz; yüksek effort'taki bir model cevap vermeden önce düşünebilir. Status line, ping'in gerçekten faturalandırdığını fiyatlar.
- Resume mantığı, resume alanlarıyla `classic.SessionStart` kaldıran hook testleriyle ve tmux'ta resume edilmiş interactive bir session'ın canlı kontrolüyle kaplıdır. Bir resume'un bütün prefix'i koruyup korumadığı modun elinde değildir: ölçülen bir session'da 116k'nın 42k'sını yeniden yazdı, bir başkasında 4k.
- Soğuk yazım sayacı session başınadır ve bellekte yaşar. `/clear` onu boşaltır.
- Fast mode `fastMode` ayarından, yani kayıtlı tercih okunur; istekten değil. Mod, Claude Code'un bir session içinde standart hıza dönüşünü görmez (bir fast mode rate-limit cooldown'u, bitmiş usage kredileri, fast mode'u kapatan bir organizasyon). O turn'ler standart oranlarla faturalanırken mod onları fast olarak fiyatlar.
- Bir ping'in, yani bir `$.model.fork`'un session fast hızdayken fast hızda koşup koşmadığı ölçülmedi; mod onu session'ın oranlarıyla fiyatlar.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
