# effort-auto

Bu Claude Code Mod'u, yazdığınız her prompt'un zorluğunu küçük bir modele puanlatır ve o turn'ü uygun effort seviyesiyle çalıştırır. Sonraki turn yine session'ın kendi effort'uyla başlar, bu yüzden hiçbir şeyi geri almak gerekmez.

## Ne yapar

1. Session boştayken yazdığınız her prompt önce en düşük effort'la haiku'ya gider. Haiku'ya tek bir soru sorulur: bu istek ne kadar düşünme gerektiriyor? Haiku tek kelimeyle cevap verir: `low`, `medium`, `high`, `xhigh` ya da `max`. Prompt'un ilk 4.000 karakterini okur. Ölçülen cevap süresi yaklaşık 0,6 saniye. Kendi seviyesini söyleyen bir prompt, dili ne olursa olsun ("bunu effort seviyesi medium ile çöz", "mit niedrigem Aufwand (low effort)", "推論レベルは medium"), o seviyeyi alır: haiku'ya isteği puanlamak yerine o seviyeyi döndürmesi söylenir. 2.1.283 üzerinde ölçüldü: Türkçe, Almanca, Japonca ve İngilizce dört böyle prompt 12 çalışmanın 12'sinde istenen seviyeyi aldı; `medium` kelimesini başka bir anlamda kullanan bir prompt ("medium boyutlu bir resim") da `medium` okundu.
2. O turn'deki ana döngünün her model isteği bu seviyeyle gider. Seviye session'ın kendi effort'unun altında da olabilir, üstünde de. Subagent'lar kendi effort'larını korur.
3. Session ayarlarına hiçbir şey yazılmaz. Turn bitince sonraki turn yine session'ın effort'uyla başlar, kendi prompt'u puanlanırsa o seviyeyi alır.
4. Task notification'ları, plugin'lerin gönderdiği prompt'lar ve çalışan bir turn'ün üstüne yazdığınız prompt'lar puanlanmaz. Bu turn'ler session'ın effort'uyla çalışır.
5. Haiku cevap vermezse ya da seviye olmayan bir şey söylerse turn session'ın effort'uyla çalışır ve bunu bir satır bildirir.
6. Puanlanan her turn'ün seviyesini görürsünüz. [sidebar](../sidebar) açıksa seviye kalıcı bir bölümde durur: `low` soluk, `medium` yeşil, `high` sarı, `xhigh` ve `max` kırmızı; session-watch'ın effort'a verdiği renklerle aynı. Bölüm session boyunca durur. Bir turn çalışırken o turn'ün effort'unu session'ın kendi effort'unun yanında gösterir; turn'ler arasında biten son turn'ün effort'unu gösterir:

       this turn high · session low
       last turn high · session low

   Puanlanmayan bir turn session'ın effort'unu, ardından soluk bir `(session)` ile gösterir. `/effort-auto off` bölümü kaldırır. Sidebar kapalıysa puanlanan her turn başında transcript'e bir satır yazar:

       effort-auto: this turn max · session low

## Yalnız prompt cache'in korunduğu yerde

Bir effort değişikliği prompt cache'in tamamını yeniden yazdırabilir. Uzun bir konuşmada bu yeniden yazımın maliyeti, turn'ün kazandırdığından fazla olur. Mod effort'u yalnız effort değişince cache'i koruyan modellerde değiştirir: Opus 5.5 ve Fable 5.1. Diğer modellerde hiçbir şeyi değiştirmez. Session'ın ilk isteği modeli belli ettikten sonra hiçbir prompt puanlanmaz.

Claude Code 2.1.283 üzerinde, aynı konuşmada, bir turn'den diğerine effort değiştirilerek ölçüldü:

    Opus 5.5   high → low, low → max    her seferinde cache read 58.408, aynı effort'taki gibi
    Sonnet 5   high → low, low → max    cache read 0, yaklaşık 73.700 token'lık konuşmanın tamamı yeniden yazıldı

Canlı kontrolde bir selamlaşma `low`, bir tasarım sorusu `max` puan aldı. `max` turn'ü, `low` turn'ünün yazdığı cache'i okudu (74.079 token). Yeniden `low` seviyesinde çalışan sonraki turn 91.755 token okudu.

## Komut

    /effort-auto            açık ya da kapalı
    /effort-auto on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install effort-auto@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına şunu ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=effort-auto}, prompt.submit, turn.step, turn.complete
    ❯ ./register.ts calls: $.command.register, $.model.complete (via rate), $.sidebar.clear (via dropLine), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via rate, toPerson)

Reach L3, her prompt için bir model isteği.

    1. Okur:        yazdığınız her prompt'un metnini, ana döngünün her isteğinin modelini ve effort'unu
    2. Çalıştırır:  hiçbir şey
    3. Gönderir:    yazdığınız her prompt'un ilk 4.000 karakterini, Claude Code'un kendi API bağlantısıyla haiku'ya
    4. Saklar:      $.store içinde açık/kapalı ayarını; turn'ün seviyesi turn bitene kadar bellekte durur
    5. Düşman girdi: prompt haiku'ya bir <request> bloğu içinde gider; cevaptan yalnız beş seviye kelimesinden biri alınır, başka bir şey söyleyen cevap hiçbir şeyi değiştirmez

## Sınırlar

- Puanlama her prompt için bir haiku isteğine mal olur ve turn'ü yaklaşık 0,6 saniye geciktirir. 2.1.283 üzerinde mod'un kendi çağrısıyla ölçüldü: kısa bir prompt 168 ile 236 arası input token ve 4 output token harcadı, 4.000 karakterde kesilen bir prompt 667 input token. Cache okunmadı ve yazılmadı. Haiku 4.5'in milyon input token başına 1 dolar, milyon output token başına 5 dolar fiyatıyla bu, kısa bir prompt için yaklaşık 0,0002 dolar, en fazla 0,0007 dolar eder. 1.000 kısa prompt yaklaşık 0,20 dolar tutar. Claude aboneliğinde bu istek bunun yerine kullanım limitinden düşer.
- Haiku yalnız prompt'a bakar, konuşmaya bakmaz. Bu yüzden zor bir işin ortasında yazılan "devam et" gibi kısa bir prompt `low` puan alır.
- Bir `max` turn'ü çok daha uzun düşünür ve daha pahalıdır. Canlı kontrolde beş maddelik bir tasarım özeti 7 dakika ve 42.683 output token sürdü.
- Cache kontrolü yalnız model adına bakar. Claude Code dokümanına göre Amazon Bedrock, Google Cloud, bir Claude apps gateway ya da `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` ile effort değişikliği her modelde cache'i yeniden yazdırır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, üstünde build başarısız olur
    make typecheck   # /plugin-types çıktısı .claude/types/ gerekir
    make validate
    make test        # claude plugin test
