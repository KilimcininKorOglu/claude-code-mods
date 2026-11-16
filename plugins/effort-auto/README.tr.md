# effort-auto

Tek bir effort ayarı bir session'ın tamamına uymaz: `max` bir "teşekkürler" için dakikalar ve token'lar harcar, `low` ise bir mimari sorusunu aceleye getirir. Bu mod, her prompt'unuzun ne kadar zor olduğunu küçük bir modele puanlatır. Ardından o turn'ü ve turn'ün başlattığı subagent'ları uygun effort ile çalıştırır. Puanlanan bir turn'ün kullanabileceği seviyeleri sınırlayabilirsiniz. Sonraki turn yine session'ın kendi effort'u ile başlar. Bu yüzden hiçbir ayarı geri almanız gerekmez.

## Ne yapar

1. Session boştayken yazdığınız her prompt önce en düşük effort'taki haiku'ya tek bir soruyla gönderilir: bu istek ne kadar düşünme gerektirir? Haiku tek kelimeyle cevap verir: `low`, `medium`, `high`, `xhigh` ya da `max`. Haiku prompt'un ilk 4.000 karakterini okur. 2.1.284 üzerinde ölçüldü: cevap yaklaşık 0,6 saniyede gelir.
2. Bir seviyeyi o seviyenin kendi kelimesiyle isteyen bir prompt, puan yerine o seviyeyi alır. Cümlenin geri kalanının dili fark etmez: "bunu max ile çöz", "use high effort", "effort: low". Bir seviyeyi yalnız beş seviye kelimesi adlandırır. İşi zor ya da kolay olarak tanımlayan, dikkatli düşünmeyi isteyen ya da "yüksek effort" veya "maximum effort" diyen bir prompt puanlanır. Haiku `named` ve seviyeyi döndürür. Mod bu cevabı yalnız prompt o seviyenin kelimesini içeriyorsa kabul eder, çünkü haiku yalnız işi zor olarak tanımlayan prompt'lara da `named` cevabını verdi. 2.1.284 üzerinde her prompt için üç denemeyle ölçüldü: bir seviye adlandıran sekiz prompt, 24 denemenin 24'ünde o seviyeyi aldı. İşi zor ya da kolay olarak tanımlayan ya da bir seviye kelimesini başka bir anlamda kullanan sekiz prompt ("a medium sized image", "the max value of the counter") 24 denemenin 24'ünde puanlandı. Haiku "yüksek effort" ve "maximum effort" için 6 denemenin 6'sında `named` cevabını verdi. Kelime kontrolü bu cevapları puan olarak okudu.
3. `/effort-auto levels low medium max`, puanlanan bir turn'ün kullanabileceği seviyeleri sınırlar. Bu seviyelerin dışındaki bir puan en yakın izinli seviyeye taşınır. Eşit uzaklıkta iki seviye varsa üstteki seçilir: `low medium max` ile `high` puanı `medium`, `xhigh` puanı `max` ile çalışır. Prompt'un adlandırdığı bir seviye, izinli olmasa da kullanılır. Haiku yine bütün skalayı puanlar ve izinli seviyeleri bilmez. Haiku'ya yalnız `low` ve `medium` bildirildiğinde, "the max value of the counter overflows at high load; find why" için 3 denemenin 3'ünde `named max` cevabını verdi. Bütün skala ile aynı prompt'u 6 denemenin 6'sında puanladı. `/effort-auto levels all` sınırı kaldırır. Varsayılan ayar budur.
4. O turn'deki her ana loop model isteği, session'ın kendi effort'unun altında ya da üstünde olsa da o seviyeyle gönderilir.
5. Puanlanan bir turn'ün başlattığı subagent, bütün çalışması boyunca turn'ün seviyesiyle çalışır. Turn bittikten sonra arka planda devam etse de bu geçerlidir. Bu subagent'ın başlattığı subagent da aynı seviyeyle çalışır. 2.1.284 üzerinde ölçüldü: yalnız ana loop'un istekleri değiştirildiğinde bir subagent'ın istekleri hâlâ session'ın effort'unu taşıdı. İlk isteği session'ınkinden farklı bir effort taşıyan bir subagent'ın tanımında kendi effort'u vardır. Bu subagent kendi effort'unu korur.
6. Session'ın ayarlarına hiçbir şey yazılmaz. Turn bittiğinde, kendi prompt'u puanlanmadıkça bir sonraki turn yine session'ın effort'u ile başlar.
7. Bir task bildirimi, bir plugin'in prompt'u ya da çalışan bir turn sırasında yazdığınız bir prompt puanlanmaz. Bu prompt'un turn'ü ve subagent'ları session'ın effort'u ile çalışır.
8. Haiku 8 saniye içinde cevap vermezse ya da seviye olmayan bir cevap verirse turn session'ın effort'u ile çalışır ve bunu tek bir satır bildirir.
9. Puanlanan her turn'ün seviyesini ve izinli seviyeleri görürsünüz. [sidebar](../sidebar) açıksa bu bilgi, session boyunca kalan iki satırlık bir section'da gösterilir. Seviye `low` için soluk, `medium` için yeşil, `high` için sarı, `xhigh` ve `max` için kırmızı renktedir. Bu renkler session-watch'ın effort için kullandığı renklerle aynıdır. Bir turn çalışırken ilk satır, o turn'ün effort'unu session'ın effort'unun yanında gösterir. Turn'ler arasında ise son biten turn'ün effort'unu gösterir. İkinci satır izinli seviyeleri gösterir:

       this turn high · session low
       allowed low · medium · high · xhigh · max

       last turn max (named) · session low
       allowed low · medium

   Prompt'un adlandırdığı seviyenin arkasında soluk bir `(named)` yazar. Puanlanmayan bir turn, session'ın effort'unu arkasında soluk bir `(session)` ile gösterir. `/effort-auto off` section'ı kaldırır. Sidebar kapalıysa puanlanan bir turn, başlangıcında transcript'e tek bir satır yazar:

       effort-auto: this turn max (named) · session low

Sonnet 5.5 üzerindeki canlı denemede `levels low medium` ayarlıydı ve session `low` effort'taydı. İşi zor olarak tanımlayan ve bir Explore subagent'ı isteyen bir prompt `medium` ile çalıştı. Subagent'ın istekleri de `medium` ile gönderildi. Bir general-purpose subagent'ı isteyen "bunu max ile çöz" prompt'u `max` ile çalıştı. Subagent'ın istekleri de `max` ile gönderildi.

## Yalnız prompt cache'in korunduğu modellerde

Bir effort değişikliği bütün prompt cache'in yeniden yazılmasına neden olabilir. Uzun bir konuşmayı yeniden yazmanın maliyeti, turn'ün kazandırdığından fazladır. Bu yüzden mod effort'u yalnız effort değişikliğinde cache'i koruyan modellerde değiştirir: Opus 5.5, Sonnet 5.5, Fable 5.1, Fable 5.2 ve Haiku 5.5. Diğer modellerde hiçbir şeyi değiştirmez. Session'ın ilk isteği böyle bir model içeriyorsa artık hiçbir prompt puanlanmaz. Bir subagent'ın isteği de kendi modeline göre aynı şekilde kontrol edilir. Sonnet 5 üzerindeki bir canlı denemede, subagent'ınkiler de dahil, her istek session'ın effort'u ile gönderildi.

Claude Code 2.1.283 üzerinde, aynı konuşmada bir turn'den sonrakine effort değiştirilerek ölçüldü:

    Opus 5.5   high → low, low → max    cache read 58,408 each time, as at the same effort
    Sonnet 5   high → low, low → max    cache read 0, the whole conversation of about 73,700 tokens written again

Claude Code 2.1.284 üzerinde aynı yöntemle, kontrol olarak önce aynı effort'ta bir turn çalıştırılarak ölçüldü:

    Sonnet 5.5  medium → high, high → low   cache read 58,417 each time and about 5,500 written, as at the same effort
    Sonnet 5    medium → high               cache read 0, about 73,700 tokens written again

Claude Code 2.1.325 üzerinde aynı konuşmanın headless turn'leriyle, kontrol olarak önce iki low turn çalıştırılarak ölçüldü:

    Fable 5.2   low → high, high → low   cache read 35,127 to 35,155 and 14 written each time, as at the same effort
    Haiku 5.5   low → high, high → low   cache read 34,522 to 34,598 and 63 written each time, as at the same effort

Canlı denemede bir selamlaşma `low`, bir tasarım sorusu `max` puanı aldı. `max` turn'ü, `low` turn'ünün yazdığı cache'i okudu (74.079 token). Yeniden `low` effort'a dönen sonraki turn de 91.755 token okudu.

## Komut

    /effort-auto                      açık mı kapalı mı ve izinli seviyeler
    /effort-auto on | off             varsayılan açık
    /effort-auto levels               izinli seviyeler
    /effort-auto levels <level ...>   yalnız bunlara izin verir, sıra fark etmez: levels low medium max
    /effort-auto levels all           her seviyeye izin verir; varsayılan

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install effort-auto@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=effort-auto}, prompt.submit, turn.step, agent.spawn, turn.complete
    ❯ ./register.ts calls: $.command.register, $.model.complete (via rate), $.sidebar.clear (via dropLine), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via setLevels, switchTo), $.ui.log (via rate, toPerson)

Reach L3: her prompt için bir model isteği gönderir.

    1. Okur:         yazdığınız her prompt'un metnini; subagent'larınkiler de dahil her model isteğinin modelini ve effort'unu
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     yazdığınız her prompt'un ilk 4.000 karakterini, Claude Code'un kendi API bağlantısı üzerinden haiku'ya
    4. Saklar:       açık/kapalı ayarını ve izinli seviyeleri $.store içinde; turn'ün ve her subagent'ın seviyesi, turn ya da subagent bitene kadar bellekte tutulur
    5. Düşman girdi: prompt haiku'ya bir <request> bloğunun içinde gönderilir; cevaptan yalnız beş seviye kelimesinden biri alınır; bir "named" cevabı yalnız prompt o kelimeyi içeriyorsa kabul edilir; bu yüzden başka bir şey söyleyen bir cevap hiçbir şeyi değiştirmez

## Sınırlar

- Puanlama her prompt için bir haiku isteği gerektirir ve turn'ü yaklaşık 0,6 saniye geciktirir. 2.1.284 üzerinde modun kendi çağrısıyla, dokuz çağrıda ölçüldü: 0,59 ile 0,92 saniye. Kısa bir prompt 378 input token ve 4 output token kullandı. Tek harfli kelimelerden oluşan ve 4.000 karakterde kesilen 6.000 karakterlik bir prompt 2.382 input token kullandı. Hiç cache okunmadı ya da yazılmadı. Haiku 4.5'in milyon input token başına $1 ve milyon output token başına $5 fiyatıyla bu, kısa bir prompt için yaklaşık $0,0004, yani 1.000 kısa prompt için yaklaşık $0,40 eder. Kesilen prompt için maliyet yaklaşık $0,0024'tür. Bir Claude aboneliğinde bu istek bunun yerine kullanım limitlerinizden düşer.
- Haiku yalnız prompt'a göre karar verir, konuşmaya göre değil. Bu yüzden "devam et" gibi kısa bir cevap, zor bir işin ortasında da `low` puanı alır.
- Başka bir kelimeyle adlandırılan bir seviye ("yüksek", "maximum", "extra high") diğer prompt'lar gibi puanlanır. İzinli seviyelerin dışındaki bir puan da bu seviyelerin içine taşınır.
- Kelime kontrolü, başka bir anlamda kullanılan bir seviye kelimesini adlandırılmış bir seviyeden ayıramaz. Bu kararı haiku verir. Bütün skala ile haiku böyle iki prompt'u 6 denemenin 6'sında puanladı.
- Kendi effort'u session'ınkine eşit olan bir subagent, kendi effort'u olmayan bir subagent'tan ayırt edilemez. Bu yüzden bu subagent turn'ün seviyesiyle çalışır.
- Bir `max` turn'ü çok daha uzun düşünür ve maliyeti daha yüksektir. Canlı denemede beş maddelik bir tasarım özeti 7 dakika ve 42.683 output token sürdü.
- Cache kontrolü yalnız model adına bakar. Claude Code belgelerine göre Amazon Bedrock'ta, Google Cloud'da, bir Claude apps gateway'inde ya da `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` ile bir effort değişikliği her modelde cache'in yeniden yazılmasına neden olur.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
