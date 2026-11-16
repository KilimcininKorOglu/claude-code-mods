# mcp-doctor

Bir MCP server bağlanamadığında ya da bağlantısı koptuğunda engine bunu yalnız modele bildirir. Bir tool'un neden çalışmadığını ancak model bu sorunla karşılaştığında fark edersiniz. Bu mod durumu size bildirir ve server'ı yeniden bağlayan bir buton gösterir. Server yeniden bağlandığında bu da size bildirilir.

## Ne yapar

1. Mod, bağlı olmayan server'ların listesini engine'den şu anlarda okur: session başında, her ana loop turn'ünün sonunda, deferred tool'larla ilgili her engine notundan sonra, `/mcp-doctor on` komutundan sonra ve bir yeniden bağlanmadan sonra. Liste, yerleşik `ToolSearch` tool'una sorularak alınır. Sonuç, başarısız her server'ı (`failed_mcp_servers`) ve hâlâ bağlanmaya çalışan her server'ı (`pending_mcp_servers`) listeler. Engine bu listeyi yalnız hiçbir tool ile eşleşmeyen bir cevaba ekler. Bu yüzden sorgu, var olamayacak bir tool'u seçer. Bu çağrı modelin context'inde hiçbir şey bırakmaz.
2. Engine'in modele gönderdiği `deferred_tools_delta` notu da okunur. Notun "configured but failed to connect" bloğu başarısız server'ları listeler. "available again (MCP server reconnected)" satırı da yeniden gelen tool prefix'lerini listeler. Not modele değiştirilmeden ulaşır.
3. Bağlı olmayan bir server için [sidebar](../sidebar)'da session boyunca kalan bir section gösterilir. Section, engine'in verdiği nedeni ve bir reconnect butonunu içerir. `not connected` kırmızı, neden soluk renktedir:

       flaky: not connected (CONNECTION_CLOSED: Connection closed)
       [ reconnect flaky ]

   Sidebar kapalıyken transcript'e aynı bilgiyi ve komutu içeren tek bir satır yazılır: `flaky: not connected (disconnected); /mcp-doctor reconnect flaky`. Section, sidebar açıldıktan sonraki ilk ölçümde çizilir.
4. Buton `/mcp-doctor reconnect <server>` komutunu çalıştırır. Bu komut engine'den `/mcp reconnect <server>` komutunu çalıştırmasını ister ve listeyi yeniden okur. Ardından hâlâ bağlanamayan bir server için engine'in cevabını içeren tek bir satır yazılır.
5. Yeniden bağlanan bir server'ın section'ı kaldırılır ve `connected again` kısmı yeşil olan tek bir satır yazılır: `flaky: connected again`. Hâlâ bağlanmaya çalışan bir server'a dokunulmaz.
6. Aynı hata yalnız bir kez yazılır. Aynı server'ı yine başarısız bulan sonraki bir turn hiçbir şey yazmaz.

claude.ai connector'ları (`claude.ai <ad>` adlı server'lar) bu kapsamın dışındadır, çünkü bu server'lar bu bilgisayarın config'ine değil hesaba aittir. Bu mod modele not göndermez, çünkü engine durumu modele zaten bildirir.

## Komut

    /mcp-doctor                    ayar ve bağlı olmayan her server
    /mcp-doctor reconnect <server> engine'den tek bir server'ı yeniden bağlamasını ister
    /mcp-doctor on | off           varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install mcp-doctor@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Section ve buton için [sidebar](../sidebar) modunu yükleyin. Sidebar yüklü değilse mod her server için transcript'e tek bir satır yazar.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=mcp-doctor}, turn.complete, prompt.attachment{type=deferred_tools_delta}
    ❯ ./register.ts calls: $.clock.after (via later, runCommand), $.command.register, $.command.run (via reconnect), $.sidebar.clear (via showBack), $.sidebar.set (via placeFailed, showBack), $.store.get (via readSettings), $.store.set (via setEnabled), $.tool.call (via measure), $.ui.log (via addFailures, later, measure, reconnect, showBack)

Reach L2: Claude'u yönlendirir, çünkü `/mcp reconnect` komutunu çalıştırır.

    1. Okur:         engine'in başarısız ve bağlanmaya çalışan MCP server listesini (bir ToolSearch sonucu) ve engine'in deferred_tools_delta notunu; hiçbir dosyayı, prompt'u ya da cevabı okumaz
    2. Çalıştırır:   ToolSearch'ü her session başında, her turn sonunda ve her deferred_tools_delta notunda bir kez; /mcp reconnect <server> komutunu butona her basışta bir kez
    3. Gönderir:     modele ve network'e hiçbir şey
    4. Saklar:       açık/kapalı ayarını $.store içinde
    5. Düşman girdi: server adları ve hata metinleri engine'den ve server config'inden gelir; metin olarak çizilir, hiçbir zaman çalıştırılmaz ve reconnect komutu adı yalnız argüman olarak alır

## Sınırlar

- Yeniden bağlama yalnız interaktif bir session'da çalışır. Headless bir session (`claude -p`) `Reconnect, enable, and disable aren't available in this session.` cevabını verir ve mod bu cevabı yazar.
- Engine, session sırasında bağlantısı kopan bir server için hata metni vermez. Bu yüzden o server'ın satırında `disconnected` yazar.
- `ToolSearch`'ün cevap vermediği bir build'de (tool search kapalıyken) durum yalnız engine'in notlarından okunur. Mod bunu bir kez bildirir.
- Engine'in notu yeniden bağlanan bir server'ı tool prefix'iyle adlandırır. Aynı prefix'e karşılık gelen iki server adı (`a.b` ve `a_b`) birlikte kapatılır.
- Bir subagent'ın turn'ü ölçüm başlatmaz. Ölçümü yalnız ana loop'un turn sonu başlatır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
