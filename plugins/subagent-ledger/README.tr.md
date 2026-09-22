# subagent-ledger

Session'ın her subagent'ının ne harcadığını gösteren bir Claude Code Mod'u: turları, duvar saati süresi ve token'ları, agent başına bir satır, en pahalısı önce.

## Ne yapar

1. Mod `agent.spawn` olayını hook'lar; bu olay subagent'ın ne olduğunu adlandırır: agent type'ı (`Explore`, `general-purpose`, bir plugin'in agent'ı, `fork`) ve görevinin tek satırlık açıklaması. Bunu spawn'ın cevapladığı agent id'sine karşı tutar.
2. Her subagent döngüsünün `turn.complete` olayını hook'lar. O turların her biri bir tur, `durationMs` değeri ve token'ları ekler: engine'in o tur için bildirdiği input, output, cache okuması ve cache yazması. Tur ayrıca onu cevaplayan modeli adlandırır; model vendor prefix'i olmadan ve tam bir id'nin tarihi olmadan çizilir, yani `claude-haiku-4-5-20251001` `haiku-4-5` olarak okunur. Bir ana döngü turu sayılmaz.
3. [sidebar](../sidebar) açıkken defter, session boyunca duran ve her subagent turunda yeniden yazılan tek bir `subagents` section'ıdır:

       subagents
       Explore: find the parser · haiku-4-5 · 3 turn · 42s · 81k
       general-purpose: port t… · opus-5 · 7 turn · 4m 10s · 260k
       2 more · 150k

   Bir satır, subagent'ı limitin altındayken yeşil, limiti geçince kırmızıdır (varsayılan 200k token). Beşinciden sonraki satırlar token'ları toplanmış tek bir soluk satırdır, yani yirmi agent'lık bir dağılım yine altı satır tutar.
4. Sidebar kapalıyken ya da o mod kurulu değilken toplamlar status line'a gider:

       subagent-ledger: 4 subagent · 12 turn · 3m 10s · 210k

5. `/subagent-ledger`, sidebar ne gösterirse göstersin, toplamları ve session'ın her subagent'ını en pahalısı önce yazar.

## Komut

    /subagent-ledger             on ya da off, limit, toplamlar ve her subagent
    /subagent-ledger on | off    varsayılan on
    /subagent-ledger limit 500   500k token üstündeki bir subagent kırmızı çizilir; 1 ile 10000 arası, varsayılan 200, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install subagent-ledger@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Agent başına satırlar için [sidebar](../sidebar) mod'unu kurun. O olmadan mod toplamları status line'da gösterir.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=subagent-ledger}, agent.spawn, turn.complete
    ❯ ./register.ts calls: $.command.register, $.sidebar.clear (via clearShown), $.sidebar.set (via show), $.store.get, $.store.set (via setEnabled, setLimit), $.ui.status (via clearShown, show)

Reach L0, çizer ve hatırlar.

    1. Okur:     her spawn'ın agent type'ını, açıklamasını ve çözülmüş modelini, ve her subagent turunun id'sini, süresini, modelini ve token sayılarını. Hiçbir prompt, cevap, dosya ve tool sonucu okumaz.
    2. Çalıştırır: hiçbir şey
    3. Gönderir: modele hiçbir şey; satırlar ve status line yalnız kişi içindir
    4. Saklar:   $.store içinde on/off ayarını ve limiti; defterin kendisi bellekte yaşar ve session ile biter
    5. Düşman girdi: çizilen tek metin agent type'ı, spawn'ın kendi açıklaması (28 karaktere kesilmiş) ve engine'in bildirdiği model id'sidir

## Sınırlar

- Defter turları bittikçe sayar. Hâlâ çalışan bir subagent satırlarda o ana kadar harcadığıyla bulunur.
- Spawn'ını bu mod'un görmediği bir subagent (o yüklenmeden önce başlamış biri) `agent` etiketi altında sayılır, çünkü type'ı yalnız spawn adlandırır. Turlarından biri bir model adlandırana kadar modeli boştur ve modelsiz bir satır o alan olmadan çizilir.
- Token'lar engine'in kendi tur başına sayımlarıdır. Cevap almamış bir tur hiçbir şey taşımaz ve sıfır ekler.
- Token dolar değildir. Bir cache okumasının bir subscription'ın limitlerine ne kadara mal olduğu belgelenmemiştir.
- Defter session başınadır. Bir restart boş başlar ve sayımlar diske yazılmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
