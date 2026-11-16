# plan-split

Ana loop'u plan modunda bir modelle, diğer bütün modlarda başka bir modelle çalıştırır. Geçiş otomatik yapılır. Ayarlar `/plan-split` ile değiştirilir. Mod, `/plan-split on` çalıştırılana kadar kapalıdır.

Planı daha derin düşünen bir modelle, kodu başka bir modelle yazabilirsiniz. Varsayılan olarak plan modu Fable ile, diğer bütün modlar Opus ile çalışır. Plan moduna girerken ya da plan modundan çıkarken modeli elle seçmeniz gerekmez. Mod, ana loop'un her isteğinin modelini o anki permission mode'a göre değiştirir.

## Ne yapar

- **Plan modu** (`plan`): ana loop'un her isteği plan modeline gider.
- **Diğer bütün modlar** (`default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`): ana loop'un her isteği kod modeline gider.
- **Mod bilinmiyorsa**: istek session'ın modelinde kalır. Session modunu ilk prompt'la öğrenir.
- **Subagent'lar** kendi modellerinde kalır. Mod yalnız ana loop'un isteklerini değiştirir.

Permission mode bilgisi moda üç kaynaktan gelir:

1. Bir turn'ü başlatan prompt, turn'ün hangi modda başladığını taşır. Bu yüzden iki prompt arasında basılan Shift+Tab bir sonraki prompt'ta geçerli olur.
2. Her tool çağrısı, çağrıdan sonraki modu taşır. Bu yüzden turn sırasında basılan Shift+Tab bir sonraki tool çağrısından sonra geçerli olur.
3. Kabul edilen bir `EnterPlanMode` ya da `ExitPlanMode` çağrısı modeli hemen değiştirir. Bir planı onayladığınızda aynı turn'ün sonraki isteği kod modelinde çalışır. Reddedilen bir `ExitPlanMode` plan modunu korur.

Her model değişikliği [sidebar](../sidebar) içindeki `plan-split` section'ında görünür (`plan · claude-fable-5-1[1m]` ve altında iki ayar). Sidebar kapalıysa ya da yüklü değilse her değişiklik transcript'e bir satır yazar:

    plan-split: plan mode: the main loop runs on claude-fable-5-1[1m]

## Modeller

Bir ayar, Claude Code'un bir alias'ı (`fable`, `opus`, `sonnet`, `haiku`) ya da bir model id'sidir (`claude-fable-5-2`). Alias, Claude Code'un okuduğu şekilde okunur. `ANTHROPIC_DEFAULT_FABLE_MODEL` (ve `OPUS`, `SONNET`, `HAIKU` değişkenleri) tanımlıysa alias bu değişkendeki id'ye karşılık gelir, `[1m]` son eki de dahil. Değişken tanımlı değilse alias engine'e yazıldığı gibi gönderilir ve o ailenin en yeni modeli cevap verir (2.1.322 üzerinde ölçüldü: `sonnet`, `claude-sonnet-5-5` olarak cevap verdi). Bu yüzden alias yeni model sürümlerini takip eder, model id'si ise sabit kalır.

## Bir geçişin maliyeti

Her model yalnız kendi prompt cache'ini okur. 2.1.322 üzerinde ölçüldü: bir geçişten sonraki ilk istek bütün konuşmayı yeni modelin cache'ine yazdı (yaklaşık 94.000 token, cache'ten okuma yok). Sonraki istek cache'i normal şekilde okudu. Session'da daha önce kullanılmış bir modele geri dönüldüğünde, cache hâlâ geçerliyse o modelin eski cache'i okundu. Bu yüzden plandan koda her geçiş, kod modelinde bir tam cache yazımına mal olur. Plan konuşması uzadıkça bu yazım da büyür.

## Komut

    /plan-split               durum: açık ya da kapalı, iki model ve ana loop'un şu anki modu
    /plan-split on            sonraki istekten itibaren modele moda göre yönlendirir
    /plan-split off           her istek yeniden session'ın modelinde kalır
    /plan-split plan <model>  plan modunun modeli, varsayılan fable
    /plan-split code <model>  diğer bütün modların modeli, varsayılan opus

Ayarlar bütün pencerelerin ortak kullandığı store'da tutulur ve her prompt'ta okunur. Bir pencerede yapılan değişiklik, diğer pencerelerde bir sonraki prompt'ta geçerli olur.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install plan-split@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. `/plan-split on` komutunu çalıştırın. Mod yüklendikten sonra kapalıdır ve açılana kadar hiçbir şeyi değiştirmez.
3. Başka modeller kullanmak için `/plan-split plan <model>` ve `/plan-split code <model>` komutlarını çalıştırın.

## Nelere erişir

Claude Code 2.1.322 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=plan-split}, prompt.submit, classic.UserPromptSubmit, classic.PostToolUse, tool.call{tool=/"^(EnterPlanMode|ExitPlanMode)$"/}, turn.step
    ❯ ./register.ts calls: $.command.register, $.env.get (via aliasEnv), $.sidebar.clear (via dropSection), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via setModel, switchTo), $.ui.log (via toPerson)

Reach L2: Claude'un kendi isteklerinin modelini değiştirir.

    1. Okur:         her prompt'un ve tool çağrısının permission mode'unu, EnterPlanMode ve ExitPlanMode sonucunu, ana loop'un her isteğinin modelini ve dört ANTHROPIC_DEFAULT_*_MODEL değişkenini
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     kendisi hiçbir şey göndermez; ana loop'un her isteğinin hangi modele gideceğini Claude Code'un kendi API bağlantısı üzerinden belirler
    4. Saklar:       açık/kapalı ayarını ve iki model ayarını $.store içinde
    5. Düşman girdi: bir model ayarı bir alias ya da model id'si olmalıdır (harf, rakam, `.`, `-`, `[`, `]`); başka her metin reddedilir

## Sınırlar

- Her geçiş bütün konuşmayı yeni modelin cache'ine bir kez yazar ("Bir geçişin maliyeti" bölümüne bakın).
- Bir taraf için seçilen model, hesabınızın kullanabildiği bir model olmalıdır. API'nin reddettiği bir model, o isteğin başarısız olmasına neden olur.
- Context window'u konuşmadan küçük olan bir plan modeli isteğin başarısız olmasına neden olur. Session 1M window ile çalışıyorsa iki tarafta da `[1m]` son ekini koruyun.
- Turn sırasında basılan Shift+Tab yalnız bir sonraki tool çağrısından sonra geçerli olur, çünkü bundan önce modu bildiren bir hook yoktur.
- [effort-auto](../effort-auto) aynı isteklerin effort değerini değiştirir. İki mod birlikte çalışır. Effort, plan-split hangi modeli seçtiyse o modele uygulanır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
