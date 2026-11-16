# ask-autopick

Uzun bir işi başlatıp bilgisayarın başından ayrıldığınızı düşünün. Bir saat sonra döndüğünüzde session'ın, modelin ilk dakikada sorduğu bir soruda beklediğini görürsünüz. Bu mod bu durumu önler. Bir soru belirlediğiniz süre boyunca cevapsız kalırsa mod, modelin kendi önerdiği seçeneği seçer ve iş devam eder. Mod, siz açana kadar kapalıdır.

## Ne yapar

1. Mod açıkken her `AskUserQuestion` çağrısını izler. Soru her zamanki gibi ekrana gelir ve cevabınızı bekler.
2. Bekleme süresi (varsayılan 10 dakika) bitmeden cevap verirseniz cevabınız olduğu gibi işlenir. Mod hiçbir şey yapmaz.
3. Süre içinde cevap gelmezse mod her soruyu, o sorunun önerilen seçeneğiyle sizin yerinize cevaplar. Engine soruyu kapatır. Transcript bu cevabı, sizin verdiğiniz bir cevap gibi gösterir.

   Tool, modelden önerdiği seçeneği en başa koymasını ve etiketini `(Recommended)` ile bitirmesini ister. Soru başka bir dilde yazıldıysa model bu kelimeyi o dilde yazar. Mod ilk seçeneği yalnız şu durumda seçer: seçeneğin etiketi parantez içinde bu kelimeyle biter ve başka hiçbir seçenek bu işareti taşımaz. Mod bu kelimeyi İngilizce, Türkçe, Almanca, İspanyolca, Portekizce, Fransızca, İtalyanca, Felemenkçe, Lehçe, Rusça, Çince, Japonca ve Korece olarak tanır. Tam genişlikli parantezler de kabul edilir.
4. Cevapla birlikte modele tek bir not gönderilir. Not, süre içinde cevap vermediğinizi, bu yüzden seçimin sizin kararınız değil varsayılan bir seçim olduğunu ve modelin bunu bir sonraki cevabında belirtmesi gerektiğini söyler. Canlı denemede model, seçimi sizin yapmadığınızı gerçekten belirtti.
5. Hangi seçeneğin seçildiğini gösteren tek bir kayıt yazılır. [sidebar](../sidebar) açıksa kayıt sidebar'ın stream'ine, kapalıysa transcript'e bir satır olarak yazılır. Sidebar'da seçilen cevap sarı, soru ve diğer kısımlar soluk renktedir:

       ask-autopick: no answer in 10 min, picked the recommended option: Renk? → Mavi (Önerilen)

6. Üç tür soruda hiçbir seçenek seçilmez: ilk seçeneği işaretsiz olan sorular, ikinci bir seçeneğin de işaretli olduğu sorular ve birden çok cevap alan (`multiSelect`) sorular. Bu sorular sizi beklemeye devam eder. Durumu bildiren sarı bir kayıt yazılır.

2.1.282 üzerindeki canlı denemede açık bırakılan bir soru, hem 1. hem de 5. dakikada `Mavi (Önerilen)` cevabını aldı. Model işe bu cevapla devam etti.

## Komut

    /ask-autopick             açık mı kapalı mı ve bekleme süresi
    /ask-autopick on | off    varsayılan kapalı; session'lar arasında korunur
    /ask-autopick 20          20 dakika bekler; 1 ile 120 arası, varsayılan 10, session'lar arasında korunur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ask-autopick@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Modu `/ask-autopick on` ile açın. Mod açılana kadar hiçbir soruyu cevaplamaz.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=ask-autopick}, tool.call{tool=/"^AskUserQuestion$"/}
    ❯ ./register.ts calls: $.clock.after (via answerOrPick), $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2: Claude'u yönlendirir, çünkü yapılan bir seçim bir soruyu sizin yerinize cevaplar.

    1. Okur:         her AskUserQuestion çağrısının sorularını ve seçenek etiketlerini
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     önerilen etiketleri çağrının cevabı olarak ve modele tek bir not; yalnız süre dolduktan sonra ve yalnız mod açıkken
    4. Saklar:       açık/kapalı ayarını ve bekleme süresini $.store içinde
    5. Düşman girdi: bir etiket yalnız modelin yazdığı öneri işaretini taşıyorsa seçilir; mod cevaba kendisi hiçbir metin eklemez

## Sınırlar

- Mod, modelin işaretine güvenir. Önerilen seçenek ne yapıyorsa yapsın seçilir.
- Öneri kelimesi listede olmayan bir dilde sorulan soru sizi beklemeye devam eder.
- 10 dakika ve daha uzun bekleme süreleri canlı olarak ölçülmedi. 1 ve 5 dakikalık süreler ölçüldü.
- Bekleme sırasında modu başka bir pencereden kapatırsanız soru sizi beklemeye devam eder.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
