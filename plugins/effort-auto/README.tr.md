# effort-auto

Tek bir effort ayarı bir session'ın tamamına hiç uymaz: `max` bir "teşekkürler"e dakikalar ve token'lar harcar, `low` ise bir mimari sorusunu aceleye getirir. Bu mod her prompt'unun ne kadar zor olduğunu küçük bir modele puanlatır ve o turn'ü uygun effort'la çalıştırır. Sonraki turn yine session'ın kendi effort'undan başlar, yani hiçbir şeyi geri ayarlaman gerekmez.

## Ne yapar

1. Session boştayken yazdığın her prompt önce en düşük effort'taki haiku'ya tek bir soruyla gider: bu istek ne kadar düşünme gerektiriyor? Haiku tek kelimeyle cevap verir: `low`, `medium`, `high`, `xhigh` ya da `max`. Prompt'un ilk 4.000 karakterini okur. Ölçüldü: cevap yaklaşık 0,6 saniyede geliyor. Kendi seviyesini söyleyen bir prompt, dili ne olursa olsun ("solve this at medium effort", "mit niedrigem Aufwand (low effort)", "推論レベルは medium"), o seviyeyi alır; çünkü haiku'ya isteği puanlamak yerine o seviyeyle cevap vermesi söylenir. 2.1.283'te ölçüldü: Türkçe, Almanca, Japonca ve İngilizce dört böyle prompt, 12 denemenin 12'sinde söylenen seviyeyi aldı; `medium` kelimesini başka bir anlamda kullanan bir prompt da ("a medium sized image") `medium` okundu.
2. O turn'deki her ana loop model request'i, session'ın kendi effort'unun altında da olsa üstünde de olsa o seviyeyle gider. Bir subagent kendi effort'unu korur.
3. Session'ın ayarlarına hiçbir şey yazılmaz. Turn bitince, kendi prompt'u puanlanmadıkça bir sonraki turn yine session'ın effort'undan başlar.
4. Bir task bildirimi, bir plugin'in prompt'u ya da çalışan bir turn'ün üstüne yazdığın bir prompt puanlanmaz; onun turn'ü session'ın effort'uyla çalışır.
5. Haiku 8 saniye içinde cevap vermezse ya da seviye olmayan bir şey söylerse turn session'ın effort'uyla çalışır ve bunu söyleyen tek bir satır düşer.
6. Puanlanan her turn'ün seviyesini görürsün. [sidebar](../sidebar) açıksa bu, session boyunca duran bir section'dır. Seviye `low` için soluk, `medium` için yeşil, `high` için sarı, `xhigh` ve `max` için kırmızıdır; session-watch'ın effort'a verdiği renklerin aynısı. Bir turn çalışırken section o turn'ün effort'unu session'ınkinin yanında gösterir; turn'ler arasında da son biten turn'ün effort'unu:

       this turn high · session low
       last turn high · session low

   Puanlanmayan bir turn, session'ın effort'unu arkasında soluk bir `(session)` ile gösterir. `/effort-auto off` section'ı kaldırır. Sidebar kapalıysa puanlanan bir turn başlarken transcript'e tek bir satır yazar:

       effort-auto: this turn max · session low

## Yalnız prompt cache'in korunduğu yerde

Bir effort değişikliği bütün prompt cache'i yeniden yazdırabilir ve uzun bir konuşmayı yeniden yazmak turn'ün kazandırdığından pahalıya gelir. Bu yüzden mod effort'u yalnız effort değişikliğinde cache'i koruyan modellerde değiştirir: Opus 5.5 ve Fable 5.1. Diğer modellerde hiçbir şeyi değiştirmez; session'ın ilk request'i böyle bir modeli söyleyince de artık hiçbir prompt puanlanmaz.

Claude Code 2.1.283'te, aynı konuşma ve bir turn'den diğerine effort değişikliğiyle ölçüldü:

    Opus 5.5   high → low, low → max    cache read 58,408 each time, as at the same effort
    Sonnet 5   high → low, low → max    cache read 0, the whole conversation of about 73,700 tokens written again

Canlı denemede bir selamlaşma `low`, bir tasarım sorusu `max` puan aldı. `max` turn'ü `low` turn'ünün yazdığı cache'i okudu (74.079 token), yeniden `low`'a dönen sonraki turn de 91.755 okudu.

## Komut

    /effort-auto            açık mı kapalı mı
    /effort-auto on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install effort-auto@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=effort-auto}, prompt.submit, turn.step, turn.complete
    ❯ ./register.ts calls: $.command.register, $.model.complete (via rate), $.sidebar.clear (via dropLine), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via rate, toPerson)

Reach L3: prompt başına bir model request'i.

    1. Okur:     yazdığın her prompt'un metnini, her ana loop request'inin modelini ve effort'unu
    2. Çalıştırır: hiçbir şey
    3. Gönderir: yazdığın her prompt'un ilk 4.000 karakterini, Claude Code'un kendi API bağlantısı üzerinden haiku'ya
    4. Saklar:   $.store içinde açık/kapalı ayarını; turn'ün seviyesi turn bitene kadar bellekte durur
    5. Düşman girdi: prompt haiku'ya bir <request> bloğunun içinde ulaşır; cevaptan yalnız beş seviye kelimesinden biri alınır, yani başka bir şey söyleyen cevap hiçbir şeyi değiştirmez

## Sınırlar

- Puanlama prompt başına bir haiku request'ine mal olur ve turn'ü yaklaşık 0,6 saniye geciktirir. 2.1.283'te mod'un kendi çağrısıyla ölçüldü: kısa bir prompt 168 ile 236 input token ve 4 output token tuttu, 4.000 karakterde kesilen bir prompt 667 input token; hiç cache okunmadı ya da yazılmadı. Haiku 4.5'in milyon input token başına $1 ve milyon output token başına $5 fiyatıyla bu, kısa bir prompt için yaklaşık $0,0002, en fazla $0,0007 eder; yani 1.000 kısa prompt için yaklaşık $0,20. Claude aboneliğinde bu request bunun yerine kullanım limitlerinden düşer.
- Haiku yalnız prompt'a bakarak karar verir, konuşmaya değil; bu yüzden "devam et" gibi kısa bir cevap, zor bir işin ortasında da `low` alır.
- Bir `max` turn'ü çok daha uzun düşünür ve daha pahalıya gelir. Canlı denemede beş maddelik bir tasarım özeti 7 dakika ve 42.683 output token sürdü.
- Cache kontrolü yalnız model adına bakar. Amazon Bedrock'ta, Google Cloud'da, bir Claude apps gateway'inde ya da `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` ile, Claude Code belgeleri bir effort değişikliğinin her modelde cache'i hâlâ yeniden yazdırdığını söyler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
