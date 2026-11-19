# limit-watch

Bir Claude aboneliğinin 5 saatlik bir limiti, 7 günlük bir limiti ve Fable gibi modellerin haftalık limitleri vardır. Bir Claude gateway'i de bir spend limit ekleyebilir. Claude Code bu limitleri yalnız bir limit dolmak üzereyken bir bildirimle gösterir. Bu yüzden limitlerin durumunu ancak iş işten geçtiğinde öğrenirsiniz. Bu mod limitleri session boyunca ekranda tutar ve her reset'e kalan süreyi gösterir. Ayrıca şu anki hızla bir limitin ne zaman dolacağını hesaplar, modele limitleri okuyan bir tool verir ve bir limit %80 ile %95'i geçtiğinde bir uyarı yazar. `/limit-watch off` bunların hepsini durdurur. `/limit-watch on` hepsini yeniden başlatır.

## Ne gösterir

**Prompt'un altında bir status line.** Status line her turn'den sonra ve her 60 saniyede bir güncellenir:

    limit-watch: 5h 9%, reset in 2h 36m · 7d 15%, reset in 5d 10h · measuring the pace

Son kısım şunlardan biridir:

- `5h hits 100% in ~1h 40m`: şu anki hızla bu limit, reset'inden önce dolar. Birden çok limit doluyorsa ilk dolan limit yazılır.
- `no limit fills before its reset`: şu anki hızla her limit dolmadan önce reset olur ya da hızı sıfırdır.
- `measuring the pace`: hiçbir limitin örnekleri henüz yeterince uzun bir aralığa yayılmadı.
- `5h limit reached`: bir limit %100'de.

Modele özel haftalık limit, 7 günlük limitten sonra modelin adıyla yazılır: `7d Fable 25%, reset in 6d 9h`. Hızı, 7 günlük limitin hızı gibi hesaplanır.

Bir API key ile açılan session hiçbir limit bildirmez. Bu durumda status line `no usage limits reported yet` gösterir. Yeni bir session da Claude ilk cevabını verene kadar bu metni gösterir.

**[sidebar](../sidebar) içinde bir section.** Sidebar açıkken bu section status line'ın yerine geçer. Section aynı bilgileri, her limit için bir satırda gösterir. Yalnız yüzde renklidir: %80'in altında yeşil, %80'den itibaren sarı, %95'ten itibaren kırmızı. Bu eşikler pane'deki bar'ın eşikleriyle aynıdır. Reset'e kalan süre soluk renktedir. Limit satırlarının altında hız satırı bulunur: `limit reached` kırmızı, `hits 100% in` ifadesinin `~<süre>` kısmı sarı renktedir. Hiçbir limit dolmuyorsa satırın tamamı yeşil, hız hâlâ ölçülüyorsa soluk renktedir. Bu sırada status line temizlenir. Sidebar kapalıysa ya da yüklü değilse status line yukarıdaki gibi kalır.

**`/limit-watch` ile açılıp kapanan bir pane.** Pane her limit için bir blok gösterir:

    5-hour limit · 9% used
    ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    resets 22:40, in 2h 36m
    pace +4.2%/h over the last 38m

Bar, pane'in genişliğini doldurur. Bar %80'in altında yeşil, %80'den itibaren sarı, %95'ten itibaren kırmızıdır. Hız ölçülürken hız satırı, ne kadar daha örnek gerektiğini gösterir.

**`/limit-watch on` ve `/limit-watch off`.** Bu komutlar modun bütün izleme işini başlatır ve durdurur. Mod kapalıyken hiçbir örnek alınmaz: status line, sidebar section'ı, pane ve uyarı gösterilmez. Açık bir pane ve sidebar section'ı kaldırılır. Ayar, bütün pencerelerin ortak kullandığı store'da saklanır. Bu yüzden bir pencerede çalıştırılan `off`, diğer pencereleri de ayarı okuyan bir sonraki hook'ta durdurur. Ayar, Claude Code yeniden başlatıldığında da korunur. Mod kapalıyken argümansız `/limit-watch` komutu pane açmaz ve `off.` cevabını verir.

**Modelin okuduğu bir tool: `mcp__limit-watch__limits`.** Tool, session başından itibaren ToolSearch ile yüklenmesi gerekmeden listelenir. Yalnız okuma yaptığı için onay istemeden çalışır. Her çağrı limitleri yeniden okur. Böylece model limitlerin o anki durumunu alır. Cevap her limit için bir satırdır:

    Usage limits at 20:04 local time:
    - 5-hour limit: 41% used, resets 22:40 (in 2h 36m), pace +4.2%/h over the last 38m, reaches 100% at 10:05 (in ~14h) at this pace

Tool'un açıklaması, modelden tool'u uzun ya da maliyetli bir işten önce ya da siz limitleri sorduğunuzda çağırmasını ister. Mod kapalıyken tool hiçbir şey okumaz ve bunu bildirir.

**Transcript'te bir uyarı.** Bir limit %80'i geçtiğinde ve ardından %95'i geçtiğinde bir uyarı yazılır:

    limit-watch: 5-hour limit passed 80% (now 82%), resets 22:40 (in 1h 5m)

Her uyarı, limitin her döngüsünde yalnız bir kez yazılır. Aynı döngüdeki yeni bir session uyarıyı tekrarlamaz. Aynı anda açık olan ikinci bir session da tekrarlamaz: mod her örnekte, uyarmadan önce uyarılmış seviyeleri store'dan yeniden okur. Ancak tam aynı anda örnek alan iki session'ın ikisi de uyarı yazabilir. Limit reset olduktan sonra uyarılar yeniden yazılır.

**Modele bir not.** Bir limit %80, %90 ve %95'i geçtiğinde modele bir not gider. Böylece model durumu işinin ortasında öğrenir:

    limit-watch: the account's 5-hour limit passed 90% (now 91%), resets 22:40 (in 1h 5m). Tell the user, and read the limits with mcp__limit-watch__limits before you start new long or costly work.

Not, ana loop'un bir sonraki tool sonucuyla gelir. Önce hiçbir tool çalışmazsa not bir sonraki prompt ile gelir. Limit birden fazla seviyeyi birden geçerse yalnız en yüksek seviye bildirilir. Her seviye, her session'da limitin her döngüsünde bir kez bildirilir, çünkü her session'ın modeli kendi notuna ihtiyaç duyar. Başka bir session'ın store'a yazdığı uyarı bu notu engellemez. Bir subagent'ın tool sonucu notu almaz. Not modeli bilgilendirir, hiçbir işi durdurmaz.

## Sayılar nasıl hesaplanır

- `$.session.usage()` her limiti `{ kind, percentUsed, resetsAt }` olarak verir. Bu değerler son API cevabından okunur. limit-watch bu değerleri session başında, her ana loop turn'ünden sonra, interaktif bir session'da her 60 saniyede bir ve `/limit-watch` pane'i açtığında okur. Session başında ya da timer'da başarısız olan bir okuma, log'a bir kez `cannot read the usage limits: <error>` olarak yazılır. 60 saniyelik timer çalışmaya devam eder.
- `$.session.usage()` modele özel haftalık limitleri bildirmez. limit-watch bu limitleri hesabın usage endpoint'inden okur: `GET https://api.anthropic.com/api/oauth/usage`. Cevaptaki `limits[]` dizisinde türü `weekly_scoped` olan ve bir model adı içeren her kayıt bir limittir. Mod `$.session.authorize()`'dan bir handle alır ve bu handle'ı `$.http.fetch`'e verir. Credential header'ını engine ekler. Bu yüzden mod token'ı hiçbir zaman görmez. Hesap, bütün session'ları birlikte, endpoint'i en fazla 5 dakikada bir okur. Son okumanın zamanı ve sonucu `$.store` içinde tutulur. Bu yüzden bu 5 dakika içindeki ikinci bir session, bir reload ya da bir tool çağrısı saklanan okumayı gösterir ve istek göndermez. Okuma session başında, her ana loop turn'ünden sonra, `/limit-watch` pane'i açtığında ve bir tool çağrısında yapılır. 60 saniyelik timer endpoint'i hiç okumaz. Bu yüzden boşta duran bir session hiçbir istek göndermez. First-party girişi olmayan bir session (bir API key, bir gateway ya da üçüncü taraf bir provider) hiç istek göndermez. Bir HTTP 429 cevabı son okumayı korur ve endpoint'in `Retry-After` ile istediği bekleme süresini store'a yazar. Endpoint bir süre bildirmezse bekleme 15 dakikadır. Bekleme en az 1 dakika, en fazla 6 saattir. Bekleme bitmeden hiçbir session yeniden okumaz. Bu durum log'a bir kez yazılır, örnek: `cannot read the per-model limits: HTTP 429; the reading of 21:10 stays, and the next read is at 21:40`. Tool'un cevabı da korunan okumanın zamanını belirtir. Başka bir nedenle başarısız olan okuma log'a bir kez `cannot read the per-model limits: <error>` olarak yazılır ve modele özel limitler kaldırılır. Böylece eski bir okuma güncelmiş gibi gösterilmez. Diğer limitler kalır.
- Her okuma bir örnektir (`{ at, percent }`) ve `$.store` içinde saklanır. Böylece Claude Code yeniden başlatıldığında hız bilgisi korunur.
- 5 saatlik limit ve spend limit, hızı örneklerinden hesaplar: yakın bir aralıktaki bütün örneklerden en küçük kareler yöntemiyle geçirilen doğrunun eğimi, saat başına yüzde olarak. Her örnek hesaba katılır. Bu yüzden aralığın iki ucundan birindeki tek bir tam sayı adımı hızı tek başına belirlemez. Aralık, 5 saatlik limit için son bir saat, spend limit için son 24 saattir. Böylece hız, şu anki çalışma temponuzu izler. Hız yalnız örnekler en az 10 dakikaya (5 saatlik limit) ya da 2 saate (spend limit) yayıldığında gösterilir. Daha kısa bir aralık, yüzdedeki tek bir adımın iki katına çıkarabileceği bir hız verir.
- 7 günlük limit ve modele özel her haftalık limit, hızı döngünün şimdiye kadarki ortalaması olarak hesaplar: yüzde, döngünün başından beri geçen süreye bölünür (`resetsAt` eksi 7 gün). Geceler, boş saatler ve hiçbir session'ın çalışmadığı süre de bu süreye dahildir. Bu yüzden bu hız için örnek gerekmez. Hız, döngünün ikinci gününden itibaren gösterilir. Bu kural eklenmeden önce ölçüldü: 2,4 yoğun saatten sonra %4 kullanım, `7d hits 100% in ~2d 8h` olarak okundu, çünkü o saatlerin hızı iki güne aralıksız yayıldı. Aynı okumanın döngü ortalaması limiti yaklaşık 6 günde doldurur.
- Status line'ın son kısmı, %100'e kalan süreyi `(100 - percent) / pace` ile hesaplar. Bu süreden önce reset olan bir limit dolan limit sayılmaz.
- `resetsAt` 5 dakikadan fazla kayarsa yeni bir döngü başlar. `resetsAt` değeri olmayan bir limitte yüzde yarım puandan fazla düşerse yeni bir döngü başlar. Yeni bir döngü, o limitin örneklerini ve uyarılarını temizler.
- Bilinmeyen biçimde saklanmış bir değer tek bir log satırıyla bildirilir ve örnekler baştan başlar.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install limit-watch@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

Modu yerel bir checkout'tan tek bir session için yüklemek için:

    claude --plugin-dir plugins/limit-watch

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Bir Claude aboneliğiyle giriş yapın (`/login`). Bir API key ile açılan session hiçbir limit bildirmez ve status line `no usage limits reported yet` olarak kalır.
3. Bir prompt gönderin. Limitler son API cevabından alınır. Bu yüzden status line ilk cevaptan sonra dolar. Pane'i `/limit-watch` ile açın.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, turn.complete, tool.describe{tool=/"^mcp__limit-watch__limits$"/}, tool.check{tool=/"^mcp__limit-watch__limits$"/}, tool.call{tool=/"^mcp__limit-watch__limits$"/}, tool.call, prompt.submit, command.run{command=limit-watch}, ui.render{component=Pane} (default matcher key: plugin)
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.http.fetch (via fetchScoped), $.session.authorize (via fetchScoped), $.session.usage (via sample), $.sidebar.clear (via clearDrawings), $.sidebar.set (via toSidebar), $.store.get, $.store.set (via runCommand, sample), $.tool.register, $.ui.close (via clearDrawings, runCommand), $.ui.invalidate (via sample), $.ui.log, $.ui.open (via runCommand), $.ui.panes (via clearDrawings, runCommand), $.ui.resolve, $.ui.status (via clearDrawings, sample)

Reach L3: network'e erişir.

    1. Okur:         $.session.usage'ın rate-limit window'larını (tür, kullanılan yüzde, reset zamanı); hesabın usage endpoint'indeki modele özel haftalık limitleri; dokuz hook'unun event payload'larını
    2. Çalıştırır:   hiçbir şey; interaktif bir session'da 60 saniyelik bir timer
    3. Gönderir:     bir session çalışırken hesabın bütün session'ları için en fazla 5 dakikada bir, 429 beklemesi sırasında hiç, https://api.anthropic.com/api/oauth/usage adresine bir GET; session'ın credential'ını engine ekler ve mod onu hiçbir zaman görmez; model mcp__limit-watch__limits çağırdığında okuma modelin context'ine girer; geçilen seviyeyi bildiren not da ana loop'un bir sonraki tool sonucuyla ya da prompt'uyla context'e girer
    4. Saklar:       her limitin örneklerini ve uyarılmış seviyelerini $.store içinde, her limit için en fazla 1500 örnek; usage endpoint'inin son okumasını, zamanını ve varsa 429 beklemesini; saklanan açık/kapalı ayarını
    5. Düşman girdi: kullanım değerleri ve endpoint'in JSON'u; bilinmeyen biçimde bir cevap ve bilinmeyen biçimde saklanmış bir değer bildirilir, hiçbir zaman güvenilir kabul edilmez

## Sınırlar

- Yeni bir session, Claude ilk cevabını verene kadar hiçbir okuma göstermez, çünkü değerler son API cevabından alınır.
- 7 günlük limit, döngüsünün ilk 24 saatinde hız göstermez.
- 7 günlük hız hesabı, döngünün `resetsAt` değerinden tam 7 gün önce başladığını kabul eder.
- Usage endpoint'i belgelenmiş bir API değildir. Cevabının biçimi değişirse modele özel limitler tek bir log satırıyla kaldırılır. Diğer limitler kalır.
- Boşta duran bir session, yeniden çalışana kadar modele özel limitin son okumasını gösterir.
- Bir spend limit %100'ü geçebilir. Bar dolu konumda durur, ancak yüzde artmaya devam eder.
- `/limit-watch` tek bir pane'i açar ve kapatır. İkinci çalıştırma pane'i kapatır. Mod kapalıyken argümansız komut hiçbir şey açmaz. `/limit-watch on` örneklemeyi yeniden başlatır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
