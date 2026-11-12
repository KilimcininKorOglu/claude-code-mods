# plan-split

Ana loop'u plan modunda bir modelde, öbür bütün modlarda başka bir modelde çalıştırır. Geçişi kendisi yapar, `/plan-split` ile ayarlanır ve `/plan-split on` denene kadar kapalıdır.

Planı daha derin düşünen bir modelle yap, kodu başka bir modelle yaz: varsayılan olarak plan modu Fable'da, öbür bütün modlar Opus'ta çalışır. Plan moduna girerken ya da çıkarken modeli elle seçmezsin. Mod, ana loop'un her isteğinin modelini o an içinde bulunduğu modun tarafına göre değiştirir.

## Ne yapar

- **Plan modu** (`plan`): ana loop'un her isteği plan modeline gider.
- **Öbür bütün modlar** (`default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`): ana loop'un her isteği kod modeline gider.
- **Mod bilinmiyorsa**: istek session'ın modelinde kalır. Session modunu ilk prompt'la öğrenir.
- **Subagent** kendi modelinde kalır. Mod yalnız ana loop isteklerini değiştirir.

Mod bilgisi moda üç yerden gelir:

1. Bir turn'ü başlatan prompt, turn'ün başladığı modu taşır. İki prompt arasındaki Shift+Tab bir sonraki prompt'ta geçerli olur.
2. Her tool çağrısı kendisinden sonraki modu taşır. Turn sırasındaki Shift+Tab bir sonraki tool çağrısından sonra geçerli olur.
3. Kabul edilen bir `EnterPlanMode` ya da `ExitPlanMode` tarafı hemen değiştirir. Bir planı onayladığında aynı turn'ün sonraki isteği zaten kod modelinde çalışır. Reddedilen bir `ExitPlanMode` plan modunu korur.

Her model değişimi [sidebar](../sidebar) içindeki `plan-split` section'ında görünür (`plan · claude-fable-5-1[1m]` ve altında iki ayar). Sidebar kapalıysa ya da kurulu değilse her değişim transcript'e bir satır yazar:

    plan-split: plan mode: the main loop runs on claude-fable-5-1[1m]

## Modeller

Bir ayar, Claude Code'un bir alias'ı (`fable`, `opus`, `sonnet`, `haiku`) ya da bir model id'sidir (`claude-fable-5-2`). Alias, Claude Code'un okuduğu gibi okunur: `ANTHROPIC_DEFAULT_FABLE_MODEL` (ve `OPUS`, `SONNET`, `HAIKU` değişkenleri) tanımlıysa alias o id'yi gösterir, `[1m]` son eki de dahil. Değişken yoksa alias engine'e yazıldığı gibi gider ve o ailenin en yeni modelinde cevap alır (2.1.322'de ölçüldü: `sonnet`, `claude-sonnet-5-5` olarak cevap verdi). Yani alias yeni model sürümlerini izler, model id'si sabit kalır.

## Bir geçişin maliyeti

Bir model yalnız kendi prompt cache'ini okur. 2.1.322'de ölçüldü: bir geçişten sonraki ilk istek bütün konuşmayı yeni modelin cache'ine yazdı (yaklaşık 94.000 token, okuma yok), sonraki istek cache'i normal okudu. Session'da daha önce çalışmış bir modele geri dönüş, cache'i hâlâ sıcaksa o modelin eski cache'ini okudu. Yani plandan koda her geçiş, kod modelinde bir tam cache yazımına mal olur. Uzun bir plan konuşması bu yazımı büyütür.

## Komut

    /plan-split               durum: açık ya da kapalı, iki model, ana loop'un şu anki modu
    /plan-split on            sonraki istekten itibaren moda göre yönlendir
    /plan-split off           her istek yeniden session'ın modelinde kalır
    /plan-split plan <model>  plan modunun modeli, varsayılan fable
    /plan-split code <model>  öbür bütün modların modeli, varsayılan opus

Ayarlar her pencerenin paylaştığı store'da tutulur ve her prompt'ta okunur. Bir penceredeki değişiklik öbür pencerelerde bir sonraki prompt'ta geçerli olur.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install plan-split@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. `/plan-split on` çalıştır. Mod kurulumdan sonra kapalıdır ve o zamana kadar hiçbir şeyi değiştirmez.
3. Başka modeller için `/plan-split plan <model>` ve `/plan-split code <model>` çalıştır.

## Nereye uzanır

Claude Code 2.1.322 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=plan-split}, prompt.submit, classic.UserPromptSubmit, classic.PostToolUse, tool.call{tool=/"^(EnterPlanMode|ExitPlanMode)$"/}, turn.step
    ❯ ./register.ts calls: $.command.register, $.env.get (via aliasEnv), $.sidebar.clear (via dropSection), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via setModel, switchTo), $.ui.log (via toPerson)

Reach L2: Claude'un kendi isteklerinin modelini değiştirir.

    1. Okur:     her prompt'un ve tool çağrısının permission mode'unu, EnterPlanMode ve ExitPlanMode sonucunu, ana loop'un her isteğinin modelini ve dört ANTHROPIC_DEFAULT_*_MODEL değişkenini
    2. Çalıştırır: hiçbir şey
    3. Gönderir: kendisi hiçbir şey göndermez; ana loop'un her isteğinin hangi modele gideceğini Claude Code'un kendi API bağlantısı üzerinden belirler
    4. Saklar:   $.store içinde on/off ayarını ve iki model ayarını
    5. Düşman girdi: bir model ayarı bir alias ya da model id'si olmalıdır (harf, rakam, `.`, `-`, `[`, `]`); başka her metin reddedilir

## Sınırlar

- Her geçiş bütün konuşmayı yeni modelin cache'ine bir kere yazar ("Bir geçişin maliyeti" bölümüne bak).
- Bir taraf için seçilen model hesabının kullanabildiği bir model olmalıdır. API'nin reddettiği bir model, o isteği yanlış bir modelin yapacağı gibi başarısız yapar.
- Context window'u konuşmadan küçük olan bir plan modeli isteği başarısız yapar. Session 1M window ile çalışıyorsa iki tarafta da `[1m]` son ekini koru.
- Turn sırasındaki Shift+Tab yalnız bir sonraki tool çağrısından sonra geçerli olur, çünkü hiçbir hook modu bundan önce bildirmez.
- [effort-auto](../effort-auto) aynı isteklerin effort'unu değiştirir. İkisi birlikte çalışır; effort, plan-split hangi modeli seçtiyse ona uygulanır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
