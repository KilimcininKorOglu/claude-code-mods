# ask-autopick

Uzun bir işi başlatıp kalkıyorsun, bir saat sonra dönüyorsun ve session'ın modelin ilk dakikada sorduğu bir soruda takılıp kaldığını görüyorsun. Bu mod bunu önler: bir soru belirlenen süre boyunca cevapsız kalırsa modelin kendi önerdiği seçeneği seçer ve iş devam eder. Sen açana kadar kapalıdır.

## Ne yapar

1. Açıkken her `AskUserQuestion` çağrısını izler. Soru her zamanki gibi ekrana gelir ve seni bekler.
2. Bekleme süresi (varsayılan 10 dakika) dolmadan cevap verirsen cevabın geçer, mod hiçbir şey yapmaz.
3. Süre dolar da cevap gelmezse mod senin yerine her sorunun önerilen seçeneğiyle cevap verir. Engine soruyu kapatır, transcript de cevabı senin cevabın gibi gösterir.

   Tool, modele önerdiği seçeneği başa koymasını ve etiketini `(Recommended)` ile bitirmesini söyler. Başka dilde yazılmış bir soruda model bu kelimeyi o dilde yazar. Mod da ilk seçeneği, etiketi parantez içinde bu kelimeyle bitiyorsa ve başka hiçbir seçenekte bu işaret yoksa seçer. Kelimeyi İngilizce, Türkçe, Almanca, İspanyolca, Portekizce, Fransızca, İtalyanca, Felemenkçe, Lehçe, Rusça, Çince, Japonca ve Korece tanır; tam genişlikli parantezler de sayılır.
4. Cevapla birlikte modele tek bir not gider. Not, süre içinde cevap vermediğini, seçimin senin kararın değil varsayılan olduğunu ve modelin bunu bir sonraki cevabında söylemesi gerektiğini anlatır. Canlı denemede model gerçekten de seçimi senin yapmadığını belirtti.
5. Neyin seçildiğini söyleyen tek bir kayıt görürsün: [sidebar](../sidebar) açıksa onun stream'inde, değilse transcript'te bir satır olarak. Sidebar'da seçilen cevap sarı, soru ve geri kalanı soluktur:

       ask-autopick: no answer in 10 min, picked the recommended option: Renk? → Mavi (Önerilen)

6. Üç tür soruya mod hiç cevap vermez: ilk seçeneği işaretli olmayan, işaretli ikinci bir seçeneği olan ve birden çok cevap alan (`multiSelect`) sorular. Bunlar seni bekler ve bunu söyleyen sarı bir kayıt düşer.

2.1.282'deki canlı denemede açık bırakılan bir soru hem 1 hem 5 dakika sonra `Mavi (Önerilen)` cevabını aldı ve model işe onunla devam etti.

## Komut

    /ask-autopick             açık mı kapalı mı ve bekleme süresi
    /ask-autopick on | off    varsayılan kapalı; session'lar arasında korunur
    /ask-autopick 20          20 dakika bekler; 1 ile 120 arası, varsayılan 10, session'lar arasında korunur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ask-autopick@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Mod'u `/ask-autopick on` ile aç. O zamana kadar hiçbir soruyu cevaplamaz.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=ask-autopick}, tool.call{tool=/"^AskUserQuestion$"/}
    ❯ ./register.ts calls: $.clock.after (via answerOrPick), $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2: Claude'u yönlendirir, çünkü bir seçim senin yerine soruya cevap verir.

    1. Okur:     her AskUserQuestion çağrısının sorularını ve seçenek etiketlerini
    2. Çalıştırır: hiçbir şey
    3. Gönderir: önerilen etiketleri çağrının cevabı olarak, yanında modele tek bir not; yalnız süre dolduktan sonra ve yalnız mod açıkken
    4. Saklar:   $.store içinde açık/kapalı ayarını ve bekleme süresini
    5. Düşman girdi: bir etiket yalnız modelin yazdığı öneri işaretini taşıyorsa seçilir; mod cevaba kendinden hiçbir metin eklemez

## Sınırlar

- Mod modelin işaretine güvenir: önerilen seçenek ne yaparsa yapsın seçilir.
- Kelimesi listede olmayan bir dilde sorulan soru seni bekler.
- 10 dakika ve üstü bekleme süreleri canlı ölçülmedi; 1 ve 5 dakika ölçüldü.
- Bekleme sırasında mod'u başka bir pencerede kapatırsan soru seni beklemeye devam eder.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
