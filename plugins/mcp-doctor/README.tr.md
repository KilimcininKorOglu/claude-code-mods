# mcp-doctor

Bir MCP server bağlanamadığında ya da bağlantısı koptuğunda engine bunu yalnız modele söyler; sen bir tool'un neden çalışmadığını ancak model sorun çıkarınca fark edersin. Bu mod bunu sana söyler, server'ı yeniden bağlayan bir tuş verir ve server geri geldiğinde bunu da söyler.

## Ne yapar

1. Mod session başında, her ana loop turn'ünün sonunda, deferred tool'larla ilgili her engine notundan sonra, `/mcp-doctor on`'dan sonra ve bir yeniden bağlamadan sonra engine'in bağlı olmayan server listesini okur. Bunun için yerleşik `ToolSearch` tool'una sorar; sonuç başarısız her server'ı (`failed_mcp_servers`) ve hâlâ bağlanmakta olan her server'ı (`pending_mcp_servers`) sayar. Engine bu listeyi yalnız hiçbir şeyle eşleşmeyen bir cevaba ekler, bu yüzden sorgu var olamayacak bir tool'u seçer. Çağrı modelin context'inde hiçbir şey bırakmaz.
2. Engine'in modele gönderdiği `deferred_tools_delta` notu da okunur: "configured but failed to connect" bloğu başarısız server'ları, "available again (MCP server reconnected)" satırı geri gelen tool prefix'lerini sayar. Not modele değişmeden ulaşır.
3. Bağlı olmayan bir server [sidebar](../sidebar)'da session boyunca duran bir section alır. Section engine'in verdiği nedeni ve bir reconnect tuşunu taşır. `not connected` kırmızı, neden soluk çizilir:

       flaky: not connected (CONNECTION_CLOSED: Connection closed)
       [ reconnect flaky ]

   Sidebar kapalıyken tek bir transcript satırı aynı şeyi söyler ve komutu verir: `flaky: not connected (disconnected); /mcp-doctor reconnect flaky`. Section, sidebar açıldıktan sonraki ilk ölçümde çizilir.
4. Tuş `/mcp-doctor reconnect <server>`'ı çalıştırır. Bu komut engine'in `/mcp reconnect <server>` komutunu çalıştırır ve listeyi yeniden okur. Ardından hâlâ bağlanamayan bir server, engine'in cevabını taşıyan tek bir satır alır.
5. Geri gelen bir server'ın section'ı kalkar ve `connected again` kısmı yeşil olan tek bir satır gelir: `flaky: connected again`. Hâlâ bağlanmakta olan bir server'a dokunulmaz.
6. Aynı hata bir kez yazılır. Aynı server'ı yine başarısız bulan sonraki bir turn hiçbir şey yazmaz.

claude.ai connector'ları (`claude.ai <ad>` adlı server'lar) dışarıda kalır, çünkü onlar bu makinenin config'ine değil hesaba aittir. Model bu mod'dan not almaz, çünkü engine ona zaten söyler.

## Komut

    /mcp-doctor                    ayar ve bağlı olmayan her server
    /mcp-doctor reconnect <server> engine'den tek bir server'ı yeniden bağlamasını ister
    /mcp-doctor on | off           varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install mcp-doctor@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Section ve tuşu için [sidebar](../sidebar) mod'unu kur. O olmadan mod her server için tek bir transcript satırı yazar.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=mcp-doctor}, turn.complete, prompt.attachment{type=deferred_tools_delta}
    ❯ ./register.ts calls: $.clock.after (via later, runCommand), $.command.register, $.command.run (via reconnect), $.sidebar.clear (via showBack), $.sidebar.set (via placeFailed, showBack), $.store.get (via readSettings), $.store.set (via setEnabled), $.tool.call (via measure), $.ui.log (via addFailures, later, measure, reconnect, showBack)

Reach L2: Claude'u yönlendirir, `/mcp reconnect` komutunu çalıştırır.

    1. Okur:     engine'in başarısız ve bağlanan MCP server listesini (bir ToolSearch sonucu) ve engine'in deferred_tools_delta notunu. Hiçbir dosyayı, prompt'u ya da cevabı okumaz.
    2. Çalıştırır: ToolSearch'ü her session başında, her turn sonunda ve her deferred_tools_delta notunda bir kere; /mcp reconnect <server> komutunu tuşa her basışta bir kere
    3. Gönderir: modele ve network'e hiçbir şey
    4. Saklar:   $.store içinde on/off ayarını
    5. Düşman girdi: server adları ve hata metinleri engine'den ve server config'inden gelir; metin olarak çizilir, hiç çalıştırılmaz ve reconnect komutu adı yalnız argüman olarak alır

## Sınırlar

- Yeniden bağlama yalnız interaktif bir session'da çalışır. Headless bir session (`claude -p`) `Reconnect, enable, and disable aren't available in this session.` cevabını verir, mod da bu cevabı yazar.
- Engine session sırasında kopan bir server için hata vermez, bu yüzden onun satırında `disconnected` yazar.
- `ToolSearch`'ün cevap vermediği bir build (tool search kapalı) yalnız engine'in notlarından okunur; mod bunu bir kez söyler.
- Engine'in notu geri gelen bir server'ı tool prefix'iyle adlandırır. Aynı prefix'e düşen iki server adı (`a.b` ve `a_b`) birlikte kapanır.
- Bir subagent'ın turn'ü ölçüm başlatmaz; yalnız ana loop'un sonu başlatır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
