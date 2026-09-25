# ask-autopick

Belirli bir süre cevapsız bekleyen bir sorunun önerilen seçeneğini seçen bir Claude Code Mod'u. Bıraktığınız bir session o soruda durup kalmaz. Siz açana kadar kapalıdır.

## Ne yapar

1. Açıkken mod her `AskUserQuestion` çağrısını hook'lar. Soru her zamanki gibi görünür ve sizi bekler.
2. Bekleme süresi içinde (varsayılan 10 dakika) cevap verirseniz çağrının cevabı sizinkidir ve mod hiçbir şey yapmaz.
3. Süre içinde cevap gelmezse mod sizin yerinize her sorunun önerilen seçeneğiyle cevap verir. Engine soruyu kapatır ve transcript cevabı sizinkini gösterdiği gibi gösterir.

   Tool, model'e önerdiği seçeneği ilk sıraya koymasını ve etiketini `(Recommended)` ile bitirmesini söyler. Başka bir dilde yazılan bir soruda model bu kelimeyi o dilde yazar. Bu yüzden önerilen seçenek ilk seçenektir: etiketi bu dillerden birinde o kelimeyle, parantez içinde bitiyorsa ve başka hiçbir seçenek bu işareti taşımıyorsa. Diller: İngilizce, Türkçe, Almanca, İspanyolca, Portekizce, Fransızca, İtalyanca, Hollandaca, Lehçe, Rusça, Çince, Japonca ve Korece. Tam genişlikli parantezler de sayılır.
4. Model cevapla birlikte bir not alır: süre içinde cevap vermediniz, yani seçim bir varsayılandır, sizin kararınız değildir, ve sonraki cevabı bunu söyler. Canlı kontrolde model bunu sizin seçmediğinizi yazdı.
5. Neyin seçildiğini bir kayıt söyler, [sidebar](../sidebar) açıkken onun stream'inde, değilse bir transcript satırı olarak. Sidebar'da seçilen cevap sarı, soru ve geri kalanı soluk çizilir:

       ask-autopick: no answer in 10 min, picked the recommended option: Renk? → Mavi (Önerilen)

6. İlk seçeneği işaretli olmayan, ikinci bir işaretli seçeneği olan ya da birden çok cevap alan (`multiSelect`) bir soru hiçbir zaman seçilmez. Sizi bekler ve sarı bir kayıt bunu söyler.

2.1.282 üzerindeki canlı kontrolde açık bırakılan bir soru 1 dakika ve 5 dakika sonra `Mavi (Önerilen)` aldı ve model onunla devam etti.

## Komut

    /ask-autopick             on ya da off, ve bekleme süresi
    /ask-autopick on | off    varsayılan off, session'lar arasında saklanır
    /ask-autopick 20          20 dakika bekler; 1 ile 120 arası, varsayılan 10, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ask-autopick@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Mod'u `/ask-autopick on` ile açın. O zamana kadar hiçbir şeyi cevaplamaz.

## Nereye uzanır

Claude Code 2.1.282 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=ask-autopick}, tool.call{tool=/"^AskUserQuestion$"/}
    ❯ ./register.ts calls: $.clock.after (via answerOrPick), $.command.register, $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2, Claude'u sürer: bir seçim sizin yerinize bir soruyu cevaplar.

    1. Okur:     her AskUserQuestion çağrısının sorularını ve seçenek etiketlerini
    2. Çalıştırır: hiçbir şey
    3. Gönderir: önerilen etiketleri çağrının cevabı olarak, model'e bir not ile, yalnız süre dolduktan sonra ve yalnız açıkken
    4. Saklar:   $.store içinde on/off ayarını ve bekleme süresini
    5. Düşman girdi: bir etiket yalnız modelin yazdığı bir öneri işaretini taşıyorsa seçilir; mod cevaba kendi metnini eklemez

## Sınırlar

- Mod modelin işaretine güvenir: önerilen işaretli bir seçenek, ne yaparsa yapsın seçilir.
- Kelimesi listede olmayan bir dildeki soru sizi bekler.
- 10 dakika ve üstü bir bekleme canlı ölçülmedi; 1 ve 5 dakika ölçüldü.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
