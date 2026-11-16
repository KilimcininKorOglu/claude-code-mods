# ua-fallback

Bazı siteler `curl` ve `wget` isteklerini yalnız bot gibi göründükleri için reddeder. Bu durumda model çalışan bir URL'den vazgeçer ve başka bir yol arar. Bu mod bu anı tespit eder. İstek bir bot filtresine takıldığında modelden isteği bir kez browser User-Agent'ıyla tekrarlamasını ister. Ayrıca bunu yapmaması gereken iki durumu da modele bildirir.

## Ne yapar

1. Mod Bash tool'unu izler. Her `curl` ya da `wget` çağrısından sonra iki çıktı stream'ini de okur ve bot filtrelerinin döndürdüğü `403` ya da `429` status'unu arar. Bu araçların status'u yazdığı bütün biçimler tanınır: `HTTP/2 403`, `403 Forbidden`, `curl: (22) ... error: 403`, `status: 403`, `429 Too Many Requests`, `Rate limit`.
2. Komut kendi User-Agent'ını zaten belirliyorsa (`-A`, `--user-agent`, `-U` ya da bir `User-Agent` header'ı) mod hiçbir şey yazmaz. Bu durumda öneri zaten denenmiştir.
3. Model, tool'un sonucunun hemen ardından şu notu okur:

       ua-fallback: example.com answered 403, which is an automated-client filter, not a broken URL. Retry the same request once with a browser User-Agent: -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'. If that is refused too, one of OpenAI File Downloader, XaiImageApiFetch/1.0, Claude-User may pass. Do not do this while testing an application, an API, an auth flow or a client of your own: a changed User-Agent hides the access-control or compatibility problem you are measuring. A reply you get with another User-Agent is not proof the resource works for ordinary clients, and it is never a way around authentication or a permission.

   Son iki cümle her notta bilerek yer alır. Tekrar deneme yalnız herkese açık içerik içindir. Kendi uygulamanızı test ediyorsanız istek gerçek client'ıyla gönderilmelidir. Başka bir User-Agent'la alınan başarılı cevap, sıradan client'ların ne gördüğü hakkında hiçbir bilgi vermez.
4. Aynı anda transcript'e tek bir satır yazılır. Satır talimat içermez, yalnız bulguyu içerir:

       ua-fallback: example.com answered 403; a browser User-Agent may pass

5. [sidebar](../sidebar) açıksa bulgu transcript yerine sidebar'ın stream'ine yazılır ve transcript temiz kalır. İlk satırda host ve status görünür: `429` sarı, `403` kırmızı, tekrar deneme önerisi soluk renktedir. Altındaki soluk satırda `not while testing your own app, auth flow or client` yazar. Sidebar yoksa satır yukarıdaki gibi transcript'e yazılır.
6. Her host için bir session'da yalnız bir kez bildirim yapılır. Aynı host'tan gelen ikinci ret bildirilmez. Böylece arka arkaya yapılan denemeler context'i doldurmaz.

## Komut

    /ua-fallback            açık mı kapalı mı ve bu session'da reddeden host'lar
    /ua-fallback on | off   açar ya da kapatır; kurulumdan sonra açıktır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ua-fallback@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=ua-fallback}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L1: yalnız session'ı okur.

    1. Okur:         her Bash komutunun metnini ve iki çıktı stream'ini; içlerinde bir URL ve bir status arar
    2. Çalıştırır:   hiçbir şey; kendisi istek göndermez, bu yüzden sunucu iki değil tek bir istek görür
    3. Gönderir:     tool'un sonucundan sonra modele bir not; transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını $.store içinde
    5. Düşman girdi: çıktı sabit status desenleriyle karşılaştırılır ve çıktıdan nota hiçbir metin kopyalanmaz; yalnız URL'nin host'u kopyalanır ve User-Agent metinleri modun içinde sabittir

## Sınırlar

- Status, komutun ekrana yazdığı çıktıdan okunur. Yalnız body yazan sessiz bir `curl -s` komutunda okunacak bir status yoktur, bu yüzden not da gelmez.
- Kendi metninde "403" geçen bir sayfa da filtrelenmiş bir istek gibi görünür. Not yalnız bir öneridir ve response kodunu ölçmez.
- Mod komutu hiçbir zaman değiştirmez ve kendisi istek göndermez. Bu yüzden çıktıda iz bırakmayan bir filtre fark edilmez.
- Başarısız bir çağrı (`curl --fail` ve `wget` bir 403'te sıfırdan farklı exit kodu döndürür) hata metninden okunur. Bulgu hem size hem modele gönderilir. Not, modelin gördüğü hata metninin arkasına eklenir ve hata metni değiştirilmez.
- Browser User-Agent'ı `hooks/fetch.ts` içinde sabittir ve zamanla eskir. Güncel bir browser sürümü isteyen bir site bu User-Agent'ı yine de reddedebilir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
