# effort-auto

Tek bir effort ayarı bir session'ın tamamına hiç uymaz: `max` bir "teşekkürler"e dakikalar ve token'lar harcar, `low` ise bir mimari sorusunu aceleye getirir. Bu mod her prompt'unun ne kadar zor olduğunu küçük bir modele puanlatır ve o turn'ü, başlattığı subagent'larla birlikte, uygun effort'la çalıştırır. Puanlanan bir turn'ün çalışabileceği seviyeleri sınırlayabilirsin. Sonraki turn yine session'ın kendi effort'undan başlar, yani hiçbir şeyi geri ayarlaman gerekmez.

## Ne yapar

1. Session boştayken yazdığın her prompt önce en düşük effort'taki haiku'ya tek bir soruyla gider: bu istek ne kadar düşünme gerektiriyor? Haiku tek kelimeyle cevap verir: `low`, `medium`, `high`, `xhigh` ya da `max`. Prompt'un ilk 4.000 karakterini okur. 2.1.284'te ölçüldü: cevap yaklaşık 0,6 saniyede geliyor.
2. Bir seviyeyi o seviyenin kendi kelimesiyle isteyen prompt, puan yerine o seviyeyi alır; cümlenin geri kalanı hangi dilde olursa olsun: "bunu max ile çöz", "use high effort", "effort: low". Bir seviyeyi yalnız beş seviye kelimesi adlandırır. İşi zor ya da kolay diye anlatan, dikkatli düşünmeyi isteyen ya da "yüksek effort" veya "maximum effort" diyen bir prompt puanlanır. Haiku `named` ve seviyeyi söyler; mod bu cevabı yalnız prompt o seviyenin kelimesini taşıyorsa kabul eder, çünkü haiku yalnız işi zor diye anlatan prompt'lara da `named` dedi. 2.1.284'te her prompt için üç denemeyle ölçüldü: seviye adlandıran sekiz prompt 24 denemenin 24'ünde o seviyeyi aldı; işi zor ya da kolay diye anlatan ya da bir seviye kelimesini başka anlamda kullanan sekiz prompt ("a medium sized image", "the max value of the counter") 24 denemenin 24'ünde puanlandı. Haiku "yüksek effort" ve "maximum effort" için 6 denemenin 6'sında `named` dedi; kelime denetimi bu cevapları puan olarak okudu.
3. `/effort-auto levels low medium max`, puanlanan bir turn'ün çalışabileceği seviyeleri sınırlar. Bunların dışındaki bir puan en yakın izinli seviyeye taşınır, eşit uzaklıktaki iki seviyeden üsttekine: `low medium max` ile `high` puanı `medium`, `xhigh` puanı `max` ile çalışır. Prompt'un adlandırdığı seviye izinli olmasa da çalışır. Haiku yine bütün skalayı puanlar ve izinli seviyeleri bilmez: yalnız `low` ve `medium` söylendiğinde "the max value of the counter overflows at high load; find why" için 3 denemenin 3'ünde `named max` dedi, bütün skalayla aynı prompt'u 6 denemenin 6'sında puanladı. `/effort-auto levels all` sınırı kaldırır; varsayılan budur.
4. O turn'deki her ana loop model request'i, session'ın kendi effort'unun altında da olsa üstünde de olsa o seviyeyle gider.
5. Puanlanan bir turn'ün başlattığı subagent, turn bittikten sonra arka planda sürse de bütün çalışması boyunca turn'ün seviyesiyle çalışır; onun başlattığı subagent da öyle. 2.1.284'te ölçüldü: yalnız ana loop'un request'leri değiştirildiğinde bir subagent'ın request'leri hâlâ session'ın effort'unu taşıdı. İlk request'i session'ınkinden başka bir effort taşıyan subagent'ın tanımında kendi effort'u vardır; o subagent kendi effort'unu korur.
6. Session'ın ayarlarına hiçbir şey yazılmaz. Turn bitince, kendi prompt'u puanlanmadıkça bir sonraki turn yine session'ın effort'undan başlar.
7. Bir task bildirimi, bir plugin'in prompt'u ya da çalışan bir turn'ün üstüne yazdığın bir prompt puanlanmaz; onun turn'ü ve subagent'ları session'ın effort'uyla çalışır.
8. Haiku 8 saniye içinde cevap vermezse ya da seviye olmayan bir şey söylerse turn session'ın effort'uyla çalışır ve bunu söyleyen tek bir satır düşer.
9. Puanlanan her turn'ün seviyesini ve izinli seviyeleri görürsün. [sidebar](../sidebar) açıksa bu, session boyunca duran iki satırlık bir section'dır. Seviye `low` için soluk, `medium` için yeşil, `high` için sarı, `xhigh` ve `max` için kırmızıdır; session-watch'ın effort'a verdiği renklerin aynısı. Bir turn çalışırken ilk satır o turn'ün effort'unu session'ınkinin yanında gösterir; turn'ler arasında da son biten turn'ün effort'unu. İkinci satır izinli seviyeleri gösterir:

       this turn high · session low
       allowed low · medium · high · xhigh · max

       last turn max (named) · session low
       allowed low · medium

   Prompt'un adlandırdığı seviyenin arkasında soluk bir `(named)` durur; puanlanmayan bir turn session'ın effort'unu arkasında soluk bir `(session)` ile gösterir. `/effort-auto off` section'ı kaldırır. Sidebar kapalıysa puanlanan bir turn başlarken transcript'e tek bir satır yazar:

       effort-auto: this turn max (named) · session low

Sonnet 5.5 üzerindeki canlı denemede `levels low medium` ayarlıyken ve session `low` iken, işi zor diye anlatıp bir Explore subagent'ı isteyen prompt `medium` ile çalıştı; subagent'ın request'leri de öyle. Bir general-purpose subagent'ı isteyen "bunu max ile çöz" `max` ile çalıştı; subagent'ın request'leri de öyle.

## Yalnız prompt cache'in korunduğu yerde

Bir effort değişikliği bütün prompt cache'i yeniden yazdırabilir ve uzun bir konuşmayı yeniden yazmak turn'ün kazandırdığından pahalıya gelir. Bu yüzden mod effort'u yalnız effort değişikliğinde cache'i koruyan modellerde değiştirir: Opus 5.5, Sonnet 5.5 ve Fable 5.1. Diğer modellerde hiçbir şeyi değiştirmez; session'ın ilk request'i böyle bir modeli söyleyince de artık hiçbir prompt puanlanmaz. Bir subagent'ın request'i de kendi modeline göre aynı yolla denetlenir. Sonnet 5 üzerindeki bir canlı denemede, subagent'ınkiler de dahil, her request session'ın effort'uyla gitti.

Claude Code 2.1.283'te, aynı konuşma ve bir turn'den diğerine effort değişikliğiyle ölçüldü:

    Opus 5.5   high → low, low → max    cache read 58,408 each time, as at the same effort
    Sonnet 5   high → low, low → max    cache read 0, the whole conversation of about 73,700 tokens written again

Claude Code 2.1.284'te aynı yolla, kontrol olarak önce aynı effort'ta bir turn ile ölçüldü:

    Sonnet 5.5  medium → high, high → low   cache read 58,417 each time and about 5,500 written, as at the same effort
    Sonnet 5    medium → high               cache read 0, about 73,700 tokens written again

Canlı denemede bir selamlaşma `low`, bir tasarım sorusu `max` puan aldı. `max` turn'ü `low` turn'ünün yazdığı cache'i okudu (74.079 token), yeniden `low`'a dönen sonraki turn de 91.755 okudu.

## Komut

    /effort-auto                      açık mı kapalı mı ve izinli seviyeler
    /effort-auto on | off             varsayılan açık
    /effort-auto levels               izinli seviyeler
    /effort-auto levels <level ...>   yalnız bunlara izin ver, sıra fark etmez: levels low medium max
    /effort-auto levels all           her seviyeye izin ver; varsayılan budur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install effort-auto@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=effort-auto}, prompt.submit, turn.step, agent.spawn, turn.complete
    ❯ ./register.ts calls: $.command.register, $.model.complete (via rate), $.sidebar.clear (via dropLine), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via setLevels, switchTo), $.ui.log (via rate, toPerson)

Reach L3: prompt başına bir model request'i.

    1. Okur:     yazdığın her prompt'un metnini, subagent'larınki de dahil her model request'inin modelini ve effort'unu
    2. Çalıştırır: hiçbir şey
    3. Gönderir: yazdığın her prompt'un ilk 4.000 karakterini, Claude Code'un kendi API bağlantısı üzerinden haiku'ya
    4. Saklar:   $.store içinde açık/kapalı ayarını ve izinli seviyeleri; turn'ün ve her subagent'ın seviyesi turn ya da subagent bitene kadar bellekte durur
    5. Düşman girdi: prompt haiku'ya bir <request> bloğunun içinde ulaşır; cevaptan yalnız beş seviye kelimesinden biri alınır, bir "named" cevabı da yalnız prompt o kelimeyi taşıyorsa kabul edilir; yani başka bir şey söyleyen cevap hiçbir şeyi değiştirmez

## Sınırlar

- Puanlama prompt başına bir haiku request'ine mal olur ve turn'ü yaklaşık 0,6 saniye geciktirir. 2.1.284'te mod'un kendi çağrısıyla, dokuz çağrıda ölçüldü: 0,59 ile 0,92 saniye; kısa bir prompt 378 input token ve 4 output token tuttu, tek harfli kelimelerden oluşan ve 4.000 karakterde kesilen 6.000 karakterlik bir prompt 2.382 input token; hiç cache okunmadı ya da yazılmadı. Haiku 4.5'in milyon input token başına $1 ve milyon output token başına $5 fiyatıyla bu, kısa bir prompt için yaklaşık $0,0004 eder, yani 1.000 kısa prompt için yaklaşık $0,40; o kesilen prompt için de yaklaşık $0,0024. Claude aboneliğinde bu request bunun yerine kullanım limitlerinden düşer.
- Haiku yalnız prompt'a bakarak karar verir, konuşmaya değil; bu yüzden "devam et" gibi kısa bir cevap, zor bir işin ortasında da `low` alır.
- Başka bir kelimeyle adlandırılan seviye ("yüksek", "maximum", "extra high") her prompt gibi puanlanır; izinli seviyelerin dışındaki bir puan da onların içine taşınır.
- Kelime denetimi, başka anlamda kullanılan bir seviye kelimesini adlandırılmış bir seviyeden ayıramaz; bu kararı haiku verir. Bütün skalayla haiku böyle iki prompt'u 6 denemenin 6'sında puanladı.
- Kendi effort'u session'ınkine eşit olan bir subagent, kendi effort'u olmayan bir subagent'tan ayırt edilemez; bu yüzden turn'ün seviyesiyle çalışır.
- Bir `max` turn'ü çok daha uzun düşünür ve daha pahalıya gelir. Canlı denemede beş maddelik bir tasarım özeti 7 dakika ve 42.683 output token sürdü.
- Cache kontrolü yalnız model adına bakar. Amazon Bedrock'ta, Google Cloud'da, bir Claude apps gateway'inde ya da `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` ile, Claude Code belgeleri bir effort değişikliğinin her modelde cache'i hâlâ yeniden yazdırdığını söyler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
