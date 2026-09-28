# error-poke

Modeli çalışır bırakıyorsun, döndüğünde session `API Error: Connection lost mid-response` hatasıyla boşta bekliyor ve iş yarıda kalmış. Engine denemelerini tüketip vazgeçmiş, modele devam etmesini söyleyen de olmamış. Bu mod bunu yapar: bir API hatası bir turn'ü öldürünce modelin devam etmesi için tek bir devam prompt'u gönderir; art arda en fazla 99 kez, ya da `/error-poke limit <n>` ile belirlediğin kadar.

## Ne yapar

1. Ana loop'un `turn.complete`'ini izler. Bir subagent'ın turn'üne dokunmaz.
2. Yalnız tek bir bitiş türüne tepki verir: `reason: "error"`, yani engine'in bir API hatası yüzünden öldü dediği turn (denemeler tükenmiş, context sınırı). Senin yarıda kestiğin bir turn `aborted`, modelin reddi `refusal` olur; ikisi de prompt almaz.
3. Session boşa çıkınca çalışan şu prompt'u gönderir:

       The previous turn was cut off by an API error, not by me. Continue where you stopped; do not start over. If you cannot tell how far you got, say so and stop.

   Yarıda kalan turn'ün işi transcript'te durduğu için prompt, modelden onu tekrarlamak yerine kaldığı yerden devam etmesini ister.
4. Prompt gitmeden önce bekler; art arda gelen her hatadan sonra biraz daha uzun: 5 sn, 15 sn, 45 sn, 135 sn, sonra her seferinde 5 dakika. Aşırı yüklenmiş bir API genellikle saniyeler içinde düzelir; her denemede aynı şekilde başarısız olan bir hata (context sınırı) da sınırın tamamını arka arkaya harcamaz. Bekleme sırasında senin bir prompt'un ya da `/error-poke off`, bekleyen prompt'u iptal eder.

   Bir kullanım limitine takılan turn ise o limiti bekler. Bir limit %100 veya üstündeyse ya da son asistan metni Claude Code'un kendi `You've hit your ... limit` metniyse, tek devam prompt'u o limit sıfırlandıktan bir dakika sonra gider (birkaç limit doluysa en son sıfırlanan); çünkü ondan önceki her prompt aynı şekilde başarısız olurdu:

       error-poke: the turn hit the 5h usage limit, continuing at 14:01 (in 2 h 1 min) (1/99)

   Her prompt transcript'e de tek bir satır yazar, böylece session'ın neden kendiliğinden kıpırdayacağını bilirsin:

       error-poke: the turn died on an API error, continuing in 5 s (1/99)

5. Bir hata dizisi için en fazla 99 prompt gider, ya da `/error-poke limit <n>` ne diyorsa o kadar. Sınıra gelince mod bunu bir kez söyler ve durur:

       error-poke: stopped after 99 continue prompts; the API keeps failing. Send a prompt to reset the count.

6. Senin kendi prompt'un (composer'dan, bridge'den ya da SDK'dan) sayacı sıfırlar; böylece sonraki hata yine 1'den başlar.
7. [sidebar](../sidebar) açıksa bu satırlar transcript yerine onun stream'ine gider, transcript temiz kalır. Orada `API error` ve kullanım limitinin adı kırmızı, sayı soluktur (sınırın %10 yakınına gelince sarı); durma satırı da kırmızıdır. Sidebar yoksa satırlar yukarıdaki gibi transcript'e düşer.
8. Prompt, gövdesi yalnız argümanlarından oluşan kendi markdown komutu `/error-poke:send <prompt>` ile gider. Transcript o komut satırını gösterir ve model prompt'u, yazılmış bir slash komutunu okuduğu gibi, olduğu gibi okur; bir `$.prompt.submit` metni ise ona `The error-poke plugin sent a message:` çerçevesi içinde ulaşırdı. Engine komutu reddederse bunu tek bir satır söyler ve prompt o çerçeveyle, plugin prompt'u olarak gider.
9. Engine'in reddettiği bir plugin prompt'u da (session meşgul, bekleyen bir durdurma var) bildirilir; hiçbir sayı kaybolmaz.

Mod'un okuduğu şey engine'in kendi `reason` değeridir; `/error-poke` da son turn'ün nasıl bittiğini yazar. Gördüğün bir hata prompt almadıysa, o satır engine'in hangi değeri bildirdiğini söyler.

## Komut

    /error-poke            açık mı kapalı mı, sayı ve son turn'ün nasıl bittiği
    /error-poke on | off   varsayılan açık
    /error-poke limit <n>  art arda en fazla n devam prompt'u; 1 ile 999 arası, varsayılan 99, session'lar arasında korunur
    /error-poke:send <prompt>  bir devam prompt'unun çalıştırdığı komut; elle yazılınca prompt'u yazıldığı gibi gönderir

`/error-poke:send` mod'un ikinci komutudur ve mod başına tek komut kuralının istisnasıdır, çünkü modele plugin çerçevesi olmadan prompt verebilen tek şey bir markdown komutudur.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install error-poke@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=error-poke}, prompt.submit, turn.complete
    ❯ ./register.ts calls: $.clock.after (via afterTurn), $.clock.now (via afterTurn), $.command.register, $.command.run (via sendPoke), $.prompt.submit (via submitPoke), $.session.messages (via readLimitWait), $.session.usage (via readLimitWait), $.sidebar.set (via toPerson), $.store.get (via readLimit, readSettings), $.store.set, $.ui.log (via toPerson)

Reach L2: Claude'u yönlendirir.

    1. Okur:     her ana loop turn'ünün nasıl bittiğini ve her prompt'un kaynağını; bir API hatasıyla biten turn'den sonra session'ın kullanım limitlerini ve son asistan metnini; hiçbir dosyayı, hiçbir komutu okumaz
    2. Çalıştırır: hiçbir şey
    3. Gönderir: kendi session'ına sabit tek bir devam prompt'u, transcript'e bir satır; makineden dışarı bir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını ve sınırı; sayı bir hata dizisi boyunca bellekte durur
    5. Düşman girdi: prompt metni mod'un içinde sabittir; ona hiçbir transcript ya da API metni kopyalanmaz

## Sınırlar

- Mod engine'in `reason`'ına bakar. Engine'in `error` dışında bir şey olarak bildirdiği hata prompt almaz; `/error-poke` değeri yazar, böylece anlayabilirsin.
- Hiç çıktı üretmeden başarısız olan bir turn de aynı şekilde devam ettirilir. Model ne kadar ilerlediğini bilemediğini söyleyebilir; prompt da zaten bunu ister.
- Sayı session başınadır ve bellekte durur, yani yeniden başlatınca 0'dan başlar.
- API seviyesinde hiçbir şey yeniden denenmez. Mod yeni bir turn başlatır; başarısız turn'ün harcadığı token'lar harcanmış kalır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
