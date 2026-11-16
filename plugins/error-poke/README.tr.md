# error-poke

Modeli çalışır hâlde bırakırsınız. Döndüğünüzde session `API Error: Connection lost mid-response` hatasıyla boşta bekler ve iş yarıda kalmıştır. Engine yeniden denemelerini bitirip vazgeçmiştir ve modele devam etmesini söyleyen bir şey yoktur. Bu mod bu işi yapar. Bir API hatası bir turn'ü sonlandırdığında, modelin devam etmesi için tek bir devam prompt'u gönderilir. Bu işlem art arda en fazla 99 kez ya da `/error-poke limit <n>` ile belirlediğiniz sayı kadar tekrarlanır.

## Ne yapar

1. Mod ana loop'un `turn.complete` olayını izler. Subagent'ların turn'lerine dokunmaz.
2. Mod yalnız tek bir bitiş türüne tepki verir: `reason: "error"`. Bu, engine'in bir API hatası yüzünden sonlandığını bildirdiği turn'dür (yeniden denemeler bitmiştir ya da context sınırına ulaşılmıştır). Sizin yarıda kestiğiniz bir turn `aborted`, modelin reddettiği bir turn `refusal` olarak bildirilir. Bu iki durumda prompt gönderilmez.
3. Mod, session boşa çıktığında çalışacak şu prompt'u gönderir:

       The previous turn was cut off by an API error, not by me. Continue where you stopped; do not start over. If you cannot tell how far you got, say so and stop.

   Yarıda kalan turn'ün işi transcript'te durur. Bu yüzden prompt, modelden işi tekrarlamasını değil, kaldığı yerden devam etmesini ister.
4. Prompt gönderilmeden önce bir süre beklenir. Art arda gelen her hatadan sonra bu süre uzar: 5 saniye, 15 saniye, 45 saniye, 135 saniye, ardından her seferinde 5 dakika. Aşırı yüklenmiş bir API genellikle saniyeler içinde düzelir. Her denemede aynı şekilde başarısız olan bir hata (context sınırı) da bu sayede sınırın tamamını arka arkaya harcamaz. Bekleme sırasında sizin göndereceğiniz bir prompt ya da `/error-poke off`, bekleyen prompt'u iptal eder.

   Bir kullanım limiti yüzünden duran turn ise o limitin sıfırlanmasını bekler. Bir limit %100 ya da üstündeyse veya son asistan metni Claude Code'un kendi `You've hit your ... limit` metniyse, tek devam prompt'u o limit sıfırlandıktan bir dakika sonra gönderilir. Birden çok limit doluysa en son sıfırlanacak limit beklenir. Bunun nedeni, daha önce gönderilecek her prompt'un aynı şekilde başarısız olacak olmasıdır:

       error-poke: the turn hit the 5h usage limit, continuing at 14:01 (in 2 h 1 min) (1/99)

   Her prompt ayrıca transcript'e tek bir satır yazar. Böylece session'ın neden kendiliğinden devam ettiğini bilirsiniz:

       error-poke: the turn died on an API error, continuing in 5 s (1/99)

5. Bir hata dizisi için en fazla 99 prompt ya da `/error-poke limit <n>` ile belirlenen sayı kadar prompt gönderilir. Sınıra ulaşıldığında mod bunu bir kez bildirir ve durur:

       error-poke: stopped after 99 continue prompts; the API keeps failing. Send a prompt to reset the count.

6. Sizin kendi prompt'unuz (composer'dan, bridge'den ya da SDK'dan) sayacı sıfırlar. Böylece bir sonraki hata yeniden 1'den başlar.
7. [sidebar](../sidebar) açıksa bu satırlar transcript yerine sidebar'ın stream'ine yazılır ve transcript temiz kalır. Sidebar'da `API error` ve kullanım limitinin adı kırmızı, sayı soluk renktedir. Sayı sınırın %10 yakınına geldiğinde sarıya döner. Durma satırı da kırmızıdır. Sidebar yoksa satırlar yukarıdaki gibi transcript'e yazılır.
8. Prompt, modun kendi markdown komutu `/error-poke:send <prompt>` ile gönderilir. Bu komutun gövdesi yalnız argümanlarından oluşur. Transcript bu komut satırını gösterir. Model prompt'u, elle yazılmış bir slash komutunu okuduğu gibi, yazıldığı hâliyle okur. Bir `$.prompt.submit` metni ise modele `The error-poke plugin sent a message:` çerçevesi içinde ulaşırdı. Engine komutu reddederse bu durum tek bir satırla bildirilir ve prompt bu çerçeveyle, plugin prompt'u olarak gönderilir.
9. Engine'in reddettiği bir plugin prompt'u da (session meşgulse ya da bekleyen bir durdurma varsa) bildirilir ve sayaçtan hiçbir sayı kaybolmaz.

Mod engine'in kendi `reason` değerini okur. `/error-poke` da son turn'ün nasıl bittiğini yazar. Gördüğünüz bir hata için prompt gönderilmediyse bu satır, engine'in hangi değeri bildirdiğini gösterir.

## Komut

    /error-poke            açık mı kapalı mı, sayı ve son turn'ün nasıl bittiği
    /error-poke on | off   varsayılan açık
    /error-poke limit <n>  art arda en fazla n devam prompt'u; 1 ile 999 arası, varsayılan 99, session'lar arasında korunur
    /error-poke:send <prompt>  bir devam prompt'unun çalıştırdığı komut; elle yazılırsa prompt'u yazıldığı gibi gönderir

`/error-poke:send` modun ikinci komutudur ve "her mod için tek komut" kuralının istisnasıdır. Bunun nedeni, modele plugin çerçevesi olmadan prompt vermenin tek yolunun bir markdown komutu olmasıdır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install error-poke@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=error-poke}, prompt.submit, turn.complete
    ❯ ./register.ts calls: $.clock.after (via afterTurn), $.clock.now (via afterTurn), $.command.register, $.command.run (via sendPoke), $.prompt.submit (via submitPoke), $.session.messages (via readLimitWait), $.session.usage (via readLimitWait), $.sidebar.set (via toPerson), $.store.get (via readLimit, readSettings), $.store.set, $.ui.log (via toPerson)

Reach L2: Claude'u yönlendirir.

    1. Okur:         her ana loop turn'ünün nasıl bittiğini ve her prompt'un kaynağını; bir API hatasıyla biten turn'den sonra session'ın kullanım limitlerini ve son asistan metnini; hiçbir dosyayı ve komutu okumaz
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     kendi session'ına sabit tek bir devam prompt'u; transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve sınırı $.store içinde; sayaç bir hata dizisi boyunca bellekte tutulur
    5. Düşman girdi: prompt metni modun içinde sabittir; prompt'a hiçbir transcript ya da API metni kopyalanmaz

## Sınırlar

- Mod engine'in `reason` değerine bakar. Engine'in `error` dışında bir değerle bildirdiği bir hata için prompt gönderilmez. `/error-poke` bu değeri yazar, böylece durumu görebilirsiniz.
- Hiç çıktı üretmeden başarısız olan bir turn de aynı şekilde devam ettirilir. Model ne kadar ilerlediğini bilmediğini söyleyebilir. Prompt da zaten bunu ister.
- Sayaç her session için ayrıdır ve bellekte tutulur. Bu yüzden yeniden başlatmadan sonra 0'dan başlar.
- API seviyesinde hiçbir şey yeniden denenmez. Mod yeni bir turn başlatır. Başarısız turn'ün harcadığı token'lar geri gelmez.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
