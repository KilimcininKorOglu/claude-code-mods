# ask-autopick

Uzun bir işi başlatıp çıkarsınız; saatler sonra geri döndüğünüzde session'ın, modelin daha ilk dakikada sorduğu bir soruya cevap bekleyerek durakladığını görürsünüz. Bu mod bunu engeller: bir soru, belirlediğiniz süre boyunca cevapsız beklerse mod, modelin kendisinin önerdiği seçeneği sizin yerinize seçer ve iş yoluna devam eder. Siz açmadıkça kapalı kalır.

## Ne yapar

1. Mod açıkken her `AskUserQuestion` çağrısını izler. Soru ekrana her zamanki gibi gelir ve sizi bekler.
2. Bekleme süresi (varsayılan 10 dakika) bitmeden cevap verirseniz cevabınız aynen işler; mod hiçbir şey yapmaz.
3. Süre dolar, cevap gelmezse mod her soruyu, o sorunun önerilen seçeneğiyle sizin yerinize cevaplar. Engine soruyu kapatır; transcript de bu cevabı, sizin vermişsiniz gibi gösterir.

   Tool, modele önerdiği seçeneği en başa almasını ve etiketini `(Recommended)` ile bitirmesini söyler. Soru başka bir dilde yazılmışsa model bu kelimeyi o dilde yazar. Mod, ilk seçeneği ancak şu durumda seçer: etiketi parantez içinde bu kelimeyle biter ve bu işareti taşıyan başka bir seçenek yoktur. Kelimeyi İngilizce, Türkçe, Almanca, İspanyolca, Portekizce, Fransızca, İtalyanca, Felemenkçe, Lehçe, Rusça, Çince, Japonca ve Korece tanır; tam genişlikli parantezler de geçerlidir.
4. Cevapla birlikte modele tek bir not gider. Notta şu anlatılır: sizin süre içinde cevap vermediğiniz, bu yüzden yapılan seçimin bir kararınız değil varsayılan olduğu ve modelin bunu bir sonraki cevabında belirtmesi gerektiği. Canlı denemede model bunu gerçekten söyledi; seçimi sizin yapmadığınızı belirtti.
5. Ne seçildiğini gösteren tek bir kayıt görürsünüz: [sidebar](../sidebar) açıksa onun stream'inde, kapalıysa transcript'te bir satır olarak. Sidebar'da seçilen cevap sarıdır; soru ve gerisi soluktur:

       ask-autopick: no answer in 10 min, picked the recommended option: Renk? → Mavi (Önerilen)

6. Üç tür soruya hiç dokunulmaz: ilk seçeneği işaretsiz olan sorular, ikinci bir seçeneğin daha işaretli olduğu sorular ve birden çok cevap alan (`multiSelect`) sorular. Bunlar sizi bekler; durumu söyleyen sarı bir kayıt düşer.

2.1.282 üzerindeki canlı denemede açık kalan bir soru, hem 1. hem 5. dakikada `Mavi (Önerilen)` cevabını aldı ve model işe bu cevapla devam etti.

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
2. `/ask-autopick on` ile açın. Açana kadar hiçbir soruya karışmaz.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=ask-autopick}, tool.call{tool=/"^AskUserQuestion$"/}
    ❯ ./register.ts calls: $.clock.after (via answerOrPick), $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2: Claude'u yönlendirir; çünkü yapılan bir seçim, soruyu sizin yerinize cevaplamış olur.

    1. Okur:     her AskUserQuestion çağrısının sorularını ve seçenek etiketlerini
    2. Çalıştırır: hiçbir şey
    3. Gönderir: önerilen etiketleri çağrının cevabı olarak, yanında modele tek bir not; yalnızca süre dolduktan sonra ve yalnızca mod açıkken
    4. Saklar:   $.store içinde açık/kapalı ayarını ve bekleme süresini
    5. Düşman girdi: bir etiket, yalnızca modelin yazdığı öneri işaretini taşıyorsa seçilir; mod cevaba kendinden hiçbir metin eklemez

## Sınırlar

- Mod, modelin işaretine güvenir: önerilen seçenek ne olursa olsun seçilir.
- Kelimesi listede olmayan bir dilde sorulan soru sizi bekler.
- 10 dakika ve üzeri bekleme süreleri canlı olarak ölçülmedi; 1 ve 5 dakika ölçüldü.
- Bekleme sırasında mod'u başka bir pencereden kapatırsanız soru, sizi beklemeyi sürdürür.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
