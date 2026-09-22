# error-poke

Bir API hatasının öldürdüğü turn'ü sürdüren bir Claude Code Mod'u. Engine bir turn'ü `API Error: Connection lost mid-response` ya da retry'ları tükenmiş başka bir hata ile bitirdiğinde session, iş yarım kalmışken boşa düşer. Mod, modelin devam etmesi için bir devam prompt'u gönderir; üst üste en fazla 99 kere, ya da `/error-poke limit <n>` ile belirlediğiniz kadar.

## Ne yapar

1. Mod main loop'un `turn.complete` olayını hook'lar. Bir subagent'ın turn'üne dokunulmaz.
2. Yalnız tek bir bitişe göre davranır: `reason: "error"`, yani engine'in API hatası yüzünden ölü raporladığı turn (retry'lar tükendi, context limiti). Sizin kestiğiniz turn `aborted`, modelin reddi `refusal` olur; hiçbiri prompt almaz.
3. Şu prompt'u gönderir, session boşa düşünce çalışır:

       The previous turn was cut off by an API error, not by me. Continue where you stopped; do not start over. If you cannot tell how far you got, say so and stop.

   Kesilen turn'ün kendi işi hâlâ transcript'tedir, yani prompt modelden tekrarlamasını değil, devam etmesini ister.
4. Aynı anda transcript'e bir satır yazılır, böylece session'ın neden kendi kendine ilerlediğini görürsünüz:

       error-poke: the turn died on an API error, continuing (1/99)

5. Bir hata serisi için en fazla 99 prompt çıkar, ya da `/error-poke limit <n>` kadar. Limitte mod bunu bir kere söyler ve durur:

       error-poke: stopped after 99 continue prompts; the API keeps failing. Send a prompt to reset the count.

6. Sizin kendi prompt'unuz (composer, bridge, SDK) sayacı sıfırlar, yani sonraki hata yine 1'den başlar.
7. [sidebar](../sidebar) açıkken bu satırlar oraya gider, stream'in içinde kayıtlar olarak; transcript temiz kalır. Sidebar kapalıyken ya da o mod kurulu değilken yukarıdaki transcript satırı yazılır.
8. Engine'in reddettiği bir prompt da (session meşgul, bekleyen bir durdurma var) raporlanır ve hiçbir sayı kaybolmaz.

Mod'un okuduğu şey engine'in kendi `reason` değeridir ve `/error-poke` son turn'ün nasıl bittiğini yazar. Gördüğünüz bir hata prompt almadıysa, o satır engine'in hangi değeri raporladığını söyler.

## Komut

    /error-poke            on ya da off, sayaç ve son turn'ün nasıl bittiği
    /error-poke on | off   varsayılan on
    /error-poke limit <n>  üst üste en fazla n devam prompt'u; 1 ile 999 arası, varsayılan 99, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install error-poke@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=error-poke}, prompt.submit, turn.complete
    ❯ ./register.ts calls: $.command.register, $.prompt.submit (via sendPoke), $.sidebar.set (via toPerson), $.store.get, $.store.set, $.ui.log (via toPerson)

Reach L2, Claude'u sürer.

    1. Okur:     her main-loop turn'ünün nasıl bittiğini ve her prompt'un origin'ini; dosya yok, komut yok
    2. Çalıştırır: hiçbir şey
    3. Gönderir: kendi session'ınıza sabit bir devam prompt'u ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve limiti; sayaç bir hata serisi boyunca bellekte yaşar
    5. Düşman girdi: prompt metni mod içinde sabittir; içine hiçbir transcript ya da API metni kopyalanmaz

## Sınırlar

- Mod engine'in `reason` değerini okur. Engine'in `error` dışında raporladığı bir hata prompt almaz; `/error-poke` değeri yazar, böylece görebilirsiniz.
- Hiç çıktı üretmeden başarısız olan bir turn de aynı şekilde sürdürülür. Model nereye kadar geldiğini bilemediğini söyleyebilir; prompt zaten bunu ister.
- Sayaç session başınadır ve bellekte yaşar. Yeniden başlatma 0'dan başlar.
- API seviyesinde hiçbir şey retry edilmez. Mod yeni bir turn başlatır, yani başarısız turn'ün token'ları harcanmıştır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
