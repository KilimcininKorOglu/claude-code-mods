# ua-fallback

Retrieval fallback için bir Claude Code Mod'u: bir `curl` ya da `wget` çağrısı bir automated-client filtresi tarafından reddedildiğinde mod modele bir kere browser User-Agent ile tekrar denemesini söyler ve bunu yapmaması gereken iki durumu belirtir.

## Ne yapar

1. Mod Bash tool'unu hook'lar. Bir `curl` ya da `wget` çağrısından sonra komutun kendi çıktısını, iki stream'i de, bir automated-client filtresinin verdiği bir status için okur: `403` ya da `429`, bu komutların yazdığı her biçimde (`HTTP/2 403`, `403 Forbidden`, `curl: (22) ... error: 403`, `429 Too Many Requests`, `Rate limit`).
2. Zaten bir User-Agent ayarlayan bir komut (`-A`, `--user-agent`, `-U`, bir `User-Agent` header'ı) dokunulmadan bırakılır: tavsiye harcanmıştır.
3. Model bu notu tool'un sonucundan sonra okur:

       ua-fallback: example.com answered 403, which is an automated-client filter, not a broken URL. Retry the same request once with a browser User-Agent: -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'. If that is refused too, one of OpenAI File Downloader, XaiImageApiFetch/1.0, Claude-User may pass. Do not do this while testing an application, an API, an auth flow or a client of your own: a changed User-Agent hides the access-control or compatibility problem you are measuring. A reply you get with another User-Agent is not proof the resource works for ordinary clients, and it is never a way around authentication or a permission.

   Son iki cümle her notta yer alır, çünkü tekrar deneme yalnız public içerik içindir. Bir uygulamanın kendi davranışını ölçmek için gönderilen bir request gerçek client'ını korumak zorundadır ve başka bir User-Agent altındaki bir başarı sıradan client'lar hakkında hiçbir şey söylemez.
4. Aynı anda transcript'e bir satır yazılır, yalnız bulgu, talimat olmadan:

       ua-fallback: example.com answered 403; a browser User-Agent may pass

5. [sidebar](../sidebar) açıkken bu bulgu oraya gider, ilk satırda host ve status ve altında soluk `not while testing your own app, auth flow or client` ile, stream'inde bir entry halinde, ve transcript temiz kalır. Sidebar kapalıyken ya da o mod kurulu değilken transcript satırı yukarıdaki gibi yazılır.
6. Bir host session başına bir kere konuşur. Aynı host'tan gelen ikinci reddedilen request sessizdir, yani bir tekrar deneme döngüsü context'i doldurmaz.

## Komut

    /ua-fallback            on ya da off, ve bu session'ın reddedildiği host'lar
    /ua-fallback on | off   varsayılan on

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ua-fallback@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=ua-fallback}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L1, session'ı okur.

    1. Okur:     her Bash komutunun metnini ve iki çıktı stream'ini, bir URL ve bir status için
    2. Çalıştırır: hiçbir şey; kendi request'ini göndermez, yani server iki değil bir request görür
    3. Gönderir: tool'un sonucundan sonra modele bir not ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını
    5. Düşman girdi: çıktı sabit status pattern'leriyle eşleştirilir ve ondan hiçbir şey nota kopyalanmaz; yalnız URL'nin host'u kopyalanır ve User-Agent string'leri mod içinde sabittir

## Sınırlar

- Status, komutun yazdığından okunur. Status metni olmadan yalnız bir body yazan sessiz bir `curl -s` not almaz.
- Kendi düz metninde "403" yazan bir sayfa filtrelenmiş bir request olarak okunur. Not bir tavsiyedir, response kodunun bir ölçümü değil.
- Mod komutu yeniden yazmaz ve kendi request'ini göndermez, yani çıktıda göremediği bir filtre bildirilmeden kalır.
- Başarısız bir çağrı (`curl --fail` bir 403'te verdiği gibi sıfır olmayan bir exit) kişiye bildirilir ama modele bildirilmez, böylece modelin kendi hata metni olduğu gibi kalır.
- Browser User-Agent'ı `hooks/fetch.ts` içinde bir sabittir ve eskir. Güncel bir sürümü kontrol eden bir site onu reddedebilir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
