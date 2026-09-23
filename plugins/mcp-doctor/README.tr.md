# mcp-doctor

Bir MCP server bağlanamadığında ya da bağlantısı koptuğunda bunu size söyleyen, onu yeniden bağlayan bir tuş sunan ve server geri geldiğinde bunu da söyleyen bir Claude Code Mod'u. Engine başarısız bir server'ı yalnız modele bildirir; bu mod kişiye bildirir.

## Ne yapar

1. Session başında, her main-loop turn sonunda ve deferred tool'larla ilgili her engine notundan sonra mod, engine'in bağlı olmayan server listesini okur. Built-in `ToolSearch` tool'una sorar. Sonucu başarısız her server'ı (`failed_mcp_servers`) ve hâlâ bağlanan her server'ı (`pending_mcp_servers`) adlandırır. Engine bu listeyi yalnız eşleşmesi olmayan bir cevaba ekler, bu yüzden sorgu var olamayacak bir tool'u seçer. Çağrı modelin context'inde hiçbir şey bırakmaz.
2. Engine'in modele giden `deferred_tools_delta` notu da okunur: "configured but failed to connect" bloğu başarısız server'ları, "available again (MCP server reconnected)" satırı geri gelen tool prefix'lerini adlandırır. Not modele değişmeden ulaşır.
3. Bağlı olmayan bir server, [sidebar](../sidebar) içinde session boyunca duran bir kırmızı section alır. Section engine'in verdiği nedeni ve bir reconnect tuşunu taşır:

       flaky: not connected (CONNECTION_CLOSED: Connection closed)
       [ reconnect flaky ]

   Sidebar kapalıyken tek bir transcript satırı aynı şeyi söyler ve komutu adlandırır: `flaky: not connected (disconnected); /mcp-doctor reconnect flaky`. Sidebar açıldıktan sonraki ilk ölçümde section çizilir.
4. Tuş `/mcp-doctor reconnect <server>` komutunu çalıştırır. Bu komut engine'den `/mcp reconnect <server>` çalıştırmasını ister ve listeyi yeniden okur. Sonrasında hâlâ başarısız olan bir server, engine'in cevabını taşıyan tek bir satır alır.
5. Geri gelen bir server kırmızı section'ını kaybeder ve tek bir yeşil satır alır: `flaky: connected again`. Hâlâ bağlanan bir server olduğu gibi kalır.
6. Aynı hata bir kere yazılır. Aynı server'ı yine başarısız bulan sonraki bir turn hiçbir şey yazmaz.

claude.ai connector'ları (`claude.ai <ad>` adlı server'lar) dışarıda kalır, çünkü onlar bu makinenin config'ine değil hesaba aittir. Model bu mod'dan not almaz, çünkü engine ona zaten bildirir.

## Komut

    /mcp-doctor                    ayar ve bağlı olmayan her server
    /mcp-doctor reconnect <server> engine'den tek bir server'ı yeniden bağlamasını ister
    /mcp-doctor on | off           varsayılan on

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install mcp-doctor@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Kırmızı section ve tuşu için [sidebar](../sidebar) mod'unu kurun. O olmadan mod her server için tek bir transcript satırı yazar.

## Nereye uzanır

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=mcp-doctor}, turn.complete, prompt.attachment{type=deferred_tools_delta}
    ❯ ./register.ts calls: $.clock.after (via later, runCommand), $.command.register, $.command.run (via reconnect), $.sidebar.clear (via showBack), $.sidebar.set (via placeFailed, showBack), $.store.get, $.store.set (via setEnabled), $.tool.call (via measure), $.ui.log (via addFailures, later, measure, reconnect, showBack)

Reach L2, Claude'u yönlendirir: `/mcp reconnect` komutunu çalıştırır.

    1. Okur:     engine'in başarısız ve bağlanan MCP server listesini (bir ToolSearch sonucu) ve engine'in deferred_tools_delta notunu. Hiçbir dosyayı, prompt'u ya da cevabı okumaz.
    2. Çalıştırır: ToolSearch'ü her session başında, her turn sonunda ve her deferred_tools_delta notunda bir kere; /mcp reconnect <server> komutunu tuşa her basışta bir kere
    3. Gönderir: modele ve network'e hiçbir şey
    4. Saklar:   $.store içinde on/off ayarını
    5. Düşman girdi: server adları ve hata metinleri engine'den ve server config'inden gelir; metin olarak çizilir, hiç çalıştırılmaz, ve reconnect komutu adı yalnız argüman olarak alır

## Sınırlar

- Yeniden bağlama yalnız interaktif bir session'da çalışır. Headless bir session (`claude -p`) `Reconnect, enable, and disable aren't available in this session.` cevabını verir ve mod bu cevabı yazar.
- Engine session sırasında kopan bir server için hata vermez, bu yüzden satırı `disconnected` yazar.
- `ToolSearch`'ün cevap vermediği bir build (tool search kapalı) yalnız engine'in notlarıyla okunur ve mod bunu bir kere söyler.
- Engine'in notu geri gelen bir server'ı tool prefix'iyle adlandırır. Tek bir prefix'e düşen iki server adı (`a.b` ve `a_b`) birlikte kapanır.
- Bir subagent'ın turn'ü ölçüm başlatmaz; yalnız main loop'un sonu başlatır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
