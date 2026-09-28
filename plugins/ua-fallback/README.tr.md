# ua-fallback

Bazı siteler `curl` ve `wget` isteklerini sırf bot gibi göründükleri için geri çevirir. Model de bu durumda gayet sağlam bir URL'den vazgeçip başka yol aramaya başlar. Bu mod tam o anı yakalar: istek bir bot filtresine takılınca modele bir kez browser User-Agent ile tekrar denemesini söyler, hangi iki durumda bunu yapmaması gerektiğini de hatırlatır.

## Ne yapar

1. Bash tool'unu izler. Her `curl` ya da `wget` çağrısından sonra iki çıktı stream'ine de bakar ve bot filtrelerinin döndüğü `403` ya da `429` status'unu arar. Bu araçların status'u yazdığı biçimlerin hepsini tanır: `HTTP/2 403`, `403 Forbidden`, `curl: (22) ... error: 403`, `status: 403`, `429 Too Many Requests`, `Rate limit`.
2. Komut User-Agent'ı zaten kendisi veriyorsa (`-A`, `--user-agent`, `-U` ya da bir `User-Agent` header'ı) sesini çıkarmaz. O öneri zaten denenmiş demektir.
3. Model tool'un sonucunun hemen ardından şu notu okur:

       ua-fallback: example.com answered 403, which is an automated-client filter, not a broken URL. Retry the same request once with a browser User-Agent: -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'. If that is refused too, one of OpenAI File Downloader, XaiImageApiFetch/1.0, Claude-User may pass. Do not do this while testing an application, an API, an auth flow or a client of your own: a changed User-Agent hides the access-control or compatibility problem you are measuring. A reply you get with another User-Agent is not proof the resource works for ordinary clients, and it is never a way around authentication or a permission.

   Son iki cümle her notta bilerek var. Tekrar deneme yalnız herkese açık içerik için. Kendi uygulamanı test ediyorsan istek gerçek client'ıyla gitmeli; ödünç bir User-Agent'la gelen başarılı cevap, sıradan client'ların ne gördüğü hakkında hiçbir şey söylemez.
4. Aynı anda transcript'e tek bir satır düşer. Talimat yoktur, yalnız bulgu:

       ua-fallback: example.com answered 403; a browser User-Agent may pass

5. [sidebar](../sidebar) açıksa bulgu onun stream'ine gider, transcript temiz kalır. İlk satırda host ve status görünür (`429` sarı, `403` kırmızı, tekrar deneme ipucu soluk). Altındaki soluk satırda `not while testing your own app, auth flow or client` yazar. Sidebar yoksa satır yukarıdaki gibi transcript'e düşer.
6. Her host bir session'da yalnız bir kez konuşur. Aynı host'tan ikinci ret sessizce geçer, böylece üst üste denemeler context'i şişirmez.

## Komut

    /ua-fallback            açık mı kapalı mı ve bu session'da reddeden host'lar
    /ua-fallback on | off   açar ya da kapatır; kurulumdan sonra açıktır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ua-fallback@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=ua-fallback}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L1: yalnız session'ı okur.

    1. Okur:     her Bash komutunun metnini ve iki çıktı stream'ini; içlerinde bir URL ve bir status arar
    2. Çalıştırır: hiçbir şey; kendisi istek atmaz, sunucu iki değil tek istek görür
    3. Gönderir: tool'un sonucundan sonra modele bir not, transcript'e bir satır; makineden dışarı bir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını
    5. Düşman girdi: çıktı sabit status desenleriyle karşılaştırılır ve nota çıktıdan hiçbir şey kopyalanmaz; yalnız URL'nin host'u kopyalanır, User-Agent metinleri mod'un içinde sabittir

## Sınırlar

- Status, komutun ekrana yazdığından okunur. Yalnız body basan sessiz bir `curl -s` okunacak bir şey bırakmaz, not da gelmez.
- Kendi metninde "403" geçen bir sayfa da filtrelenmiş istek gibi görünür. Not bir öneridir; response kodunu ölçmez.
- Mod komutu hiç değiştirmez, kendisi de istek atmaz. Çıktıda iz bırakmayan bir filtre bu yüzden gözden kaçar.
- Başarısız bir çağrı (`curl --fail` ve `wget` 403'te sıfırdan farklı exit kodu döner) hata metninden okunur; bulgu hem sana hem modele gider. Not, modelin gördüğü hata metninin arkasına eklenir; hata metni olduğu gibi kalır.
- Browser User-Agent'ı `hooks/fetch.ts` içinde sabit duruyor ve zamanla eskiyor. Güncel bir browser sürümü isteyen site onu yine de reddedebilir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
