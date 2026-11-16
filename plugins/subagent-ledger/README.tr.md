# subagent-ledger

Bir işi beş subagent'a dağıttığınızda `/cost` sonunda tek bir toplam gösterir. Hangi agent'ın bütün repository'yi okuduğu ya da hangisinin dört dakika çalıştığı görünmez. Bu mod, session'daki her subagent'ın harcadığını gösterir: turn sayısı, geçen gerçek süre ve token'lar. Her agent için bir satır vardır ve en pahalı agent en üsttedir.

## Ne yapar

1. Mod `agent.spawn` olayını izler. Bu olay subagent'ın türünü bildirir: agent type'ı (`Explore`, `general-purpose`, bir plugin'in agent'ı, `fork`) ve görevinin tek satırlık açıklaması. Mod bu bilgileri, spawn'ın belirlediği modelle birlikte, spawn'ın döndürdüğü agent id'si altında tutar. Satır hemen "çalışıyor" durumuyla çizilir.
2. Mod her subagent loop'unun `turn.complete` olayını izler. Bu turn subagent'ın cevabıdır ve çalışmayı bitirir. Turn bir cevapla bittiyse durum `done` olur. Turn kesildiyse, reddedildiyse ya da bir API hatasıyla bittiyse durum `stopped` olur. Bu turn'lerin her biri deftere bir turn, kendi `durationMs` değerini ve token'larını ekler: engine'in o turn için bildirdiği input, output, cache okumaları ve cache yazmaları. Turn ayrıca cevabı veren modeli de bildirir. Bu model spawn'ın modelinin yerine geçer. Model adı vendor ön eki ve tam id'deki tarih olmadan gösterilir: `claude-haiku-4-5-20251001`, `haiku-4-5` olarak görünür. Ana loop'un turn'leri sayılmaz.
3. Mod bir model isteği olan `turn.step` olayını izler. Cevap vermiş bir subagent'ın loop'u yeniden çalışırsa (örneğin SendMessage onu devam ettirdiğinde) satır yeniden "çalışıyor" olarak çizilir. Ana loop'un adımları okunmaz.
4. [sidebar](../sidebar) açıkken defter, session boyunca kalan tek bir `subagents` section'ında gösterilir. Section her spawn'da, her subagent turn'ünde ve bir subagent yeniden çalıştığında yeniden yazılır:

       subagents
       port the config loader to the new schem… · opus-5 · 7 turn · 4m 10s · T 260k · I 5k · O 9k · CR 210k · CW 36k · running
       find the parser · haiku-4-5 · 3 turn · 42s · T 81k · I 2k · O 1k · CR 70k · CW 8k · done
       read the tests · haiku-4-5 · 1 turn · 9s · T 30k · I 1k · O 500 · CR 24k · CW 5k · stopped
       2 more · 150k

   Bir satırın adı görevinin açıklamasıdır ve 40 karakterde kesilir. Açıklama vermeyen bir spawn'ın satırında bunun yerine agent type'ı yazar. Token kısaltmaları şunlardır: `T` toplam, `I` cache'ten karşılanmayan input, `O` output, `CR` cache okumaları, `CW` cache yazmaları. Son dördünün toplamı `T`'ye eşittir. Satır bir durum kelimesiyle biter: subagent çalışırken sarı `running`, cevap verdiğinde yeşil `done`, çalışması cevapsız bittiğinde soluk `stopped`. Model adı aileye göre renklidir: opus kırmızı, fable sarı, sonnet yeşil, haiku soluk. `T` toplamı, durum ne olursa olsun, sınırın (varsayılan 200k token) %80'inden itibaren sarı, sınıra ulaşıldığında kırmızı renktedir. Ad, turn sayısı, süre ve türe göre token'lar varsayılan renkte kalır. Üçüncü satırdan sonraki agent'lar, token'ları toplanmış soluk tek bir satırda gösterilir. Bu yüzden yirmi agent'lık bir dağıtım da en fazla dört satır kaplar.
5. Sidebar kapalıysa ya da yüklü değilse toplamlar status line'da gösterilir:

       subagent-ledger: 4 subagent · 12 turn · 3m 10s · 210k

6. `/subagent-ledger`, sidebar'da ne gösterildiğinden bağımsız olarak, toplamları ve session'daki her subagent'ı en pahalısı başta olacak şekilde yazar.

## Komut

    /subagent-ledger             açık mı kapalı mı, sınır, toplamlar ve her subagent
    /subagent-ledger on | off    varsayılan açık
    /subagent-ledger limit 500   500k token'ı aşan bir subagent kırmızı çizilir; 1 ile 10000 arası, varsayılan 200, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install subagent-ledger@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Agent başına satırlar için [sidebar](../sidebar) modunu yükleyin. Sidebar yüklü değilse mod toplamları status line'da gösterir.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=subagent-ledger}, agent.spawn, turn.step, turn.complete
    ❯ ./register.ts calls: $.command.register, $.sidebar.clear (via clearShown), $.sidebar.set (via show), $.store.get (via readLimit, readSettings), $.store.set (via setEnabled, setLimit), $.ui.status (via clearShown, show)

Reach L0: yalnız ekrana çizer ve bellekte tutar.

    1. Okur:         her spawn'ın agent type'ını, açıklamasını ve belirlenen modelini; her subagent turn'ünün id'sini, süresini, bitiş nedenini, modelini ve token sayılarını; her model isteğinin agent id'sini; prompt, cevap, dosya ya da tool sonucu okumaz
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     modele hiçbir şey; satırlar ve status line yalnız sizin içindir
    4. Saklar:       açık/kapalı ayarını ve sınırı $.store içinde; defterin kendisi bellekte tutulur ve session ile birlikte silinir
    5. Düşman girdi: ekrana yazılan metinler yalnız agent type'ı, spawn'ın kendi açıklaması (40 karaktere kesilmiş) ve engine'in bildirdiği model id'sidir

## Sınırlar

- Defter turn'leri bittikçe sayar. Hâlâ çalışan bir subagent, o ana kadar harcadıklarıyla birlikte sarı renkte gösterilir.
- Bir çalışma defterde yalnız subagent'ın `turn.complete` olayıyla biter. Çalışması bu olay olmadan biten bir subagent sarı kalır. Her bitiş türünün (bir `TaskStop`, sonlandırılan bir background agent) bu olayı tetikleyip tetiklemediği ölçülmedi.
- Bu modun spawn'ını görmediği bir subagent (mod yüklenmeden önce başlamış bir subagent) `agent` etiketiyle sayılır, çünkü agent type'ını yalnız spawn bildirir. Turn'lerinden biri bir model bildirene kadar modeli boştur. Modeli olmayan bir satır bu alan olmadan çizilir.
- Token'lar engine'in turn başına kendi sayımlarıdır. Cevap almamış bir turn token taşımaz ve toplama sıfır ekler.
- Token dolar değildir. Bir cache okumasının bir aboneliğin limitlerinden ne kadar düştüğü belgelenmemiştir.
- Defter her session için ayrıdır. Yeniden başlatmadan sonra boş başlar ve sayımlar diske yazılmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
