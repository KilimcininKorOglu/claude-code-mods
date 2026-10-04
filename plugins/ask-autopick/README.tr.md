# ask-autopick

Uzun bir işi başlatıp çıktığınızı, bir saat sonra geri döndüğünüzde session'ı, modelin ilk dakikada sorduğu bir soruya cevap beklerken durmuş bulursunuz. Bu mod bunu önler: bir soru, belirlediğiniz süre boyunca cevapsız kalırsa mod, modelin önerdiği seçeneği sizin yerinize seçer ve işi devam ettirir. Siz açana kadar kapalıdır.

## Ne yapar

1. Mod açıkken her `AskUserQuestion` çağrısını izler. Soru her zamanki gibi ekrana gelir ve sizi bekler.
2. Bekleme süresi (varsayılan 10 dakika) dolmadan cevap verirseniz cevabınız geçer; mod hiçbir şey yapmaz.
3. Süre dolar ve cevap gelmezse mod, her soruyu önerilen seçeneğiyle sizin yerinize cevaplar. Engine soruyu kapatır; transcript de cevabı, sizin cevabınızmış gibi gösterir.

   Tool, modele önerdiği seçeneği en başa koymasını ve etiketini `(Recommended)` ile bitirmesini söyler. Soru başka bir dilde yazılmışsa model bu kelimeyi o dilde yazar. Mod ise yalnızca şu koşulla seçer: ilk seçeneğin etiketi parantez içinde bu kelimeyle biter ve başka hiçbir seçenekte bu işaret yoktur. Kelimeyi İngilizce, Türkçe, Almanca, İspanyolca, Portekizce, Fransızca, İtalyanca, Felemenkçe, Lehçe, Rusça, Çince, Japonca ve Korece tanır; tam genişlikli parantezler de sayılır.
4. Cevapla birlikte modele tek bir not gider. Notta şu üç şey yazar: sizin süre içinde cevap vermediğiniz, yapılan seçimin sizin kararınız değil varsayılan olduğu ve modelin bunu bir sonraki cevabında belirtmesi gerektiği. Canlı denemede model, seçimi sizin yapmadığınızı gerçekten de söyledi.
5. Ne seçildiğini söyleyen tek bir kayıt görürsünüz: [sidebar](../sidebar) açıksa onun stream'inde, kapalıysa transcript'te bir satır olarak. Sidebar'da seçilen cevap sarıdır; soru ve gerisi soluktur:

       ask-autopick: no answer in 10 min, picked the recommended option: Renk? → Mavi (Önerilen)

6. Mod üç tür soruya hiç cevap vermez: ilk seçeneği işaretsiz olan, işaretli ikinci bir seçeneği olan ve birden çok cevap alan (`multiSelect`) sorular. Bunlar sizi bekler; durumu söyleyen sarı bir kayıt düşer.

2.1.282'deki canlı denemede açık bırakılan bir soru, hem 1 hem 5 dakika sonra `Mavi (Önerilen)` cevabını aldı ve model işe bu cevapla devam etti.

## Komut

    /ask-autopick             açık mı kapalı mı ve bekleme süresi
    /ask-autopick on | off    varsayılan kapalı; session'lar arasında korunur
    /ask-autopick 20          20 dakika bekler; 1 ile 120 arası, varsayılan 10, session'lar arasında korunur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ask-autopick@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Mod'u `/ask-autopick on` ile açın. O zamana kadar hiçbir soruyu cevaplamaz.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=ask-autopick}, tool.call{tool=/"^AskUserQuestion$"/}
    ❯ ./register.ts calls: $.clock.after (via answerOrPick), $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2: Claude'u yönlendirir; çünkü soruyu, sizin yerinize verilen bir seçimle cevaplar.

    1. Okur:     her AskUserQuestion çağrısının sorularını ve seçenek etiketlerini
    2. Çalıştırır: hiçbir şey
    3. Gönderir: önerilen etiketleri çağrının cevabı olarak, yanında modele tek bir not; yalnız süre dolduktan sonra ve yalnız mod açıkken
    4. Saklar:   $.store içinde açık/kapalı ayarını ve bekleme süresini
    5. Düşman girdi: bir etiket, yalnız modelin yazdığı öneri işaretini taşıyorsa seçilir; mod cevaba kendinden hiçbir metin eklemez

## Sınırlar

- Mod, modelin işaretine güvenir: önerilen seçenek ne yazarsa yazsın seçilir.
- Kelimesi listede olmayan bir dilde sorulan soru sizi bekler.
- 10 dakika ve üzeri bekleme süreleri canlı olarak ölçülmedi; 1 ve 5 dakika ölçüldü.
- Bekleme sırasında mod'u başka bir pencerede kapatırsanız soru, sizi beklemeye devam eder.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
