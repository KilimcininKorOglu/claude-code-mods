# subagent-ledger

Bir işi beş subagent'a dağıtırsın, sonunda `/cost` tek bir toplam verir: hangi agent'ın bütün repository'yi okuduğu, hangisinin dört dakika çalıştığı görünmez. Bu mod session'daki her subagent'ın ne harcadığını gösterir: turn sayısı, geçen gerçek süre ve token'ları; agent başına bir satır, en pahalısı önce.

## Ne yapar

1. Mod `agent.spawn`'ı hook'lar; bu olay subagent'ın ne olduğunu söyler: agent type'ı (`Explore`, `general-purpose`, bir plugin'in agent'ı, `fork`) ve görevinin tek satırlık açıklaması. Mod bunları, spawn'ın çözdüğü modelle birlikte, spawn'ın cevapladığı agent id'si altında tutar ve satırı hemen çalışıyor olarak çizer.
2. Her subagent loop'unun `turn.complete`'ini hook'lar. O turn subagent'ın cevabıdır, yani çalışmayı bitirir: turn bir cevapla bittiyse `done`, kesildiyse, reddedildiyse ya da bir API hatasıyla bittiyse `stopped`. Bu turn'lerin her biri deftere bir turn, kendi `durationMs`'ini ve token'larını ekler: engine'in o turn için bildirdiği input, output, cache okumaları ve cache yazmaları. Turn ayrıca onu cevaplayan modeli söyler; bu model spawn'ın modelinin yerine geçer ve vendor ön eki ile tam bir id'nin tarihi olmadan çizilir, yani `claude-haiku-4-5-20251001` `haiku-4-5` olarak okunur. Bir ana loop turn'ü sayılmaz.
3. Bir model isteği olan `turn.step`'i hook'lar. Cevap vermiş bir subagent'ın loop'u yeniden çalışırsa, örneğin SendMessage onu devam ettirirse, satır yeniden çalışıyor olarak çizilir. Bir ana loop adımı okunmaz.
4. [sidebar](../sidebar) açıkken defter session boyunca duran tek bir `subagents` section'ıdır; her spawn'da, her subagent turn'ünde ve bir subagent yeniden çalıştığında yeniden yazılır:

       subagents
       port the config loader to the new schem… · opus-5 · 7 turn · 4m 10s · T 260k · I 5k · O 9k · CR 210k · CW 36k · running
       find the parser · haiku-4-5 · 3 turn · 42s · T 81k · I 2k · O 1k · CR 70k · CW 8k · done
       read the tests · haiku-4-5 · 1 turn · 9s · T 30k · I 1k · O 500 · CR 24k · CW 5k · stopped
       2 more · 150k

   Bir satırın adı görevinin açıklamasıdır ve 40 karakterde kesilir; açıklama vermeyen bir spawn'ın satırında onun yerine agent type'ı yazar. Token'lar şöyle okunur: `T` toplam, `I` cache'in karşılamadığı input, `O` output, `CR` cache okumaları, `CW` cache yazmaları; son dördünün toplamı `T`'dir. Satır durum kelimesiyle biter: subagent çalışırken sarı `running`, cevap verince yeşil `done`, çalışması cevapsız bittiğinde soluk `stopped`. Model ailesine göre renklidir (opus kırmızı, fable sarı, sonnet yeşil, haiku soluk). `T` toplamı her durumda, sınırın (varsayılan 200k token) %80'inden itibaren sarı, subagent sınıra ulaşınca kırmızıdır. Ad, turn'ler, süre ve türe göre token'lar varsayılan renkte kalır. Üçüncüden sonraki satırlar, token'ları toplanmış soluk tek bir satırdır; yani yirmi agent'lık bir dağıtım da dört satır tutar.
5. Sidebar kapalıysa ya da kurulu değilse toplamlar status line'a gider:

       subagent-ledger: 4 subagent · 12 turn · 3m 10s · 210k

6. `/subagent-ledger`, sidebar ne gösterirse göstersin, toplamları ve session'ın her subagent'ını en pahalısı önce yazar.

## Komut

    /subagent-ledger             açık mı kapalı mı, sınır, toplamlar ve her subagent
    /subagent-ledger on | off    varsayılan açık
    /subagent-ledger limit 500   500k token'ı aşan bir subagent kırmızı çizilir; 1 ile 10000 arası, varsayılan 200, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install subagent-ledger@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Agent başına satırlar için [sidebar](../sidebar) mod'unu kur. O olmadan mod toplamları status line'da gösterir.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=subagent-ledger}, agent.spawn, turn.step, turn.complete
    ❯ ./register.ts calls: $.command.register, $.sidebar.clear (via clearShown), $.sidebar.set (via show), $.store.get (via readLimit, readSettings), $.store.set (via setEnabled, setLimit), $.ui.status (via clearShown, show)

Reach L0: çizer ve hatırlar.

    1. Okur:     her spawn'ın agent type'ını, açıklamasını ve çözülmüş modelini, her subagent turn'ünün id'sini, süresini, bitiş sebebini, modelini ve token sayılarını ve her model isteğinin agent id'sini. Hiçbir prompt, cevap, dosya ve tool sonucu okumaz.
    2. Çalıştırır: hiçbir şey
    3. Gönderir: modele hiçbir şey; satırlar ve status line yalnız kişi içindir
    4. Saklar:   $.store içinde on/off ayarını ve limiti; defterin kendisi bellekte durur ve session'la birlikte gider
    5. Düşman girdi: çizilen tek metin agent type'ı, spawn'ın kendi açıklaması (40 karaktere kesilmiş) ve engine'in bildirdiği model id'sidir

## Sınırlar

- Defter turn'leri bittikçe sayar. Hâlâ çalışan bir subagent satırlarda sarı olarak, o ana kadar harcadığıyla durur.
- Bir çalışma defterde yalnız subagent'ın `turn.complete`'iyle biter. Çalışması bu olay olmadan biten bir subagent sarı kalır. Her bitiş türünün (bir `TaskStop`, öldürülen bir background agent) bu olayı tetikleyip tetiklemediği ölçülmedi.
- Bu mod'un spawn'ını görmediği bir subagent (mod yüklenmeden önce başlamış biri) `agent` etiketiyle sayılır, çünkü type'ı yalnız spawn söyler. Turn'lerinden biri bir model söyleyene kadar modeli boştur; modelsiz bir satır o alan olmadan çizilir.
- Token'lar engine'in turn başına kendi sayımlarıdır. Cevap almamış bir turn hiçbir şey taşımaz ve sıfır ekler.
- Token dolar değildir. Bir cache okumasının bir subscription'ın limitlerinden ne kadar yediği belgelenmemiştir.
- Defter session başınadır. Yeniden başlatınca boş başlar, sayımlar diske yazılmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
