# ua-fallback

Bir `curl` ya da `wget` isteği bot filtresine takıldığında devreye giren bir Claude Code Mod'u. Modele isteği bir kez browser User-Agent ile tekrarlamasını söyler ve bunu hangi iki durumda yapmaması gerektiğini de ekler.

## Ne yapar

1. Bash tool'unu hook'lar. Her `curl` ya da `wget` çağrısından sonra komutun iki çıktı stream'ini de okur ve bot filtrelerinin döndüğü bir status arar: `403` ya da `429`. Bu komutların status'u yazdığı biçimlerin hepsi tanınır: `HTTP/2 403`, `403 Forbidden`, `curl: (22) ... error: 403`, `status: 403`, `429 Too Many Requests`, `Rate limit`.
2. User-Agent'ı zaten kendisi veren bir komuta (`-A`, `--user-agent`, `-U` ya da bir `User-Agent` header'ı) dokunmaz, çünkü önerilecek şey denenmiştir.
3. Model tool'un sonucundan hemen sonra şu notu okur:

       ua-fallback: example.com answered 403, which is an automated-client filter, not a broken URL. Retry the same request once with a browser User-Agent: -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'. If that is refused too, one of OpenAI File Downloader, XaiImageApiFetch/1.0, Claude-User may pass. Do not do this while testing an application, an API, an auth flow or a client of your own: a changed User-Agent hides the access-control or compatibility problem you are measuring. A reply you get with another User-Agent is not proof the resource works for ordinary clients, and it is never a way around authentication or a permission.

   Son iki cümle her notta vardır, çünkü tekrar deneme yalnız herkese açık içerik içindir. Bir uygulamanın kendi davranışını ölçen istek gerçek client'ıyla gitmelidir. Başka bir User-Agent'la alınan başarılı cevap da sıradan client'ların durumu hakkında bir şey söylemez.
4. Aynı anda transcript'e tek bir satır düşer. Bu satırda talimat yoktur, yalnız bulgu vardır:

       ua-fallback: example.com answered 403; a browser User-Agent may pass

5. [sidebar](../sidebar) açıksa bulgu transcript yerine sidebar'ın stream'ine yazılır. İlk satırda host ve status durur; `429` sarı, `403` kırmızı, tekrar deneme ipucu soluktur. Altındaki soluk satır `not while testing your own app, auth flow or client` der. Sidebar kapalıysa ya da kurulu değilse satır yukarıdaki gibi transcript'e yazılır.
6. Her host bir session'da yalnız bir kez bildirilir. Aynı host'tan gelen ikinci ret sessiz geçer, böylece üst üste denemeler context'i doldurmaz.

## Komut

    /ua-fallback            açık mı kapalı mı, ve bu session'da reddeden host'lar
    /ua-fallback on | off   açar ya da kapatır; kurulumdan sonra açıktır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ua-fallback@kilimcininkoroglu-mods

Function hook'lar early access aşamasındadır ve flag olmadan hiçbir mod yüklenmez. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=ua-fallback}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L1: session'ı okur.

    1. Okur:     her Bash komutunun metnini ve iki çıktı stream'ini; içlerinde bir URL ve bir status arar
    2. Çalıştırır: hiçbir şey; kendisi istek göndermez, sunucu iki değil tek istek görür
    3. Gönderir: tool'un sonucundan sonra modele bir not, transcript'e bir satır; makineden dışarı bir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını
    5. Düşman girdi: çıktı sabit status desenleriyle karşılaştırılır ve nota çıktıdan hiçbir şey kopyalanmaz; yalnız URL'nin host'u kopyalanır, User-Agent metinleri mod'un içinde sabittir

## Sınırlar

- Status, komutun ekrana yazdığından okunur. Status yazmadan yalnız body basan sessiz bir `curl -s` için not düşülmez.
- Kendi metninde "403" geçen bir sayfa da filtrelenmiş istek gibi okunur. Not bir öneridir; response kodunu ölçmez.
- Mod komutu değiştirmez ve kendisi istek atmaz. Çıktıda iz bırakmayan bir filtre bu yüzden bildirilmez.
- Başarısız bir çağrı (`curl --fail` ve `wget` 403'te sıfırdan farklı exit kodu verir) hata metninden okunur ve bulgu hem kişiye hem modele gider. Not modelin gördüğü hata metninin arkasına eklenir, hata metni değişmez.
- Browser User-Agent'ı `hooks/fetch.ts` içinde sabittir ve zamanla eskir. Güncel sürüm arayan bir site onu reddedebilir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
