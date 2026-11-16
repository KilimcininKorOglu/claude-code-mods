# output-flood

Model tek bir cevap için `pytest tests/ -v` ya da `find .` çalıştırır. Onlarca KB'lık çıktı context'e girer ve session sonuna kadar orada kalır. Sonraki her istek bu yükü taşır ve model bunun maliyetini bilmez. Bu mod her Bash komutunun context'ten ne kadar yer kapladığını ölçer. Bir komutun çıktısı bir boyut sınırını aşarsa modele bu çıktının maliyeti bildirilir. Aynı soruyu cevaplayacak daha dar bir komut da önerilir.

## Ne yapar

1. Her tool çağrısı grubu bittikten sonra ve bir sonraki model isteğinden önce, her Bash sonucunun boyutu modelin okuduğu hâliyle karakter olarak ölçülür. Ölçüm, sonucu yeniden yazan bütün modlardan sonra yapılır. Bu yüzden başka bir modun ([bash-diet](../bash-diet) gibi) küçülttüğü bir sonuç, plugin'lerin yüklenme sırasından bağımsız olarak küçülmüş boyutuyla sayılır. Subagent çağrıları da aynı şekilde ölçülür.
2. Sınırı (varsayılan 20 KB, yaklaşık 5000 token) aşan bir sonuç bir bulgudur. Model bir sonraki isteğinden önce şu notu okur:

       output-flood: "pytest tests/ -v" returned 30 KB of output, over the 20 KB limit, and all of it is now in the context. Next time run the one test or file this turn needs, and let the runner report only failures (pytest -x -q, go test -run, cargo test <name>, jest -t).

   Öneri komutun türüne göre değişir: test runner, `git log`/`diff`/`show`, dosya sistemi taraması (`find`, `ls`, `du`, `tree`), paket yüklemesi, dosya ya da JSON okuma, container log'ları. Bilinen bir türe girmeyen bir komut için, çıktıyı bir dosyaya yazması ve yalnız ihtiyaç duyduğu aralığı okuması önerilir.
3. Hiçbir öneri `tail` ya da `head`'e pipe içermez. Sonundan kesilen uzun bir çıktı, ekrandan akıp geçen hatayı gizler. Bu yüzden her öneri, komutun ürettiği çıktıyı daraltır.
4. Aynı anda transcript'e tek bir satır yazılır. Satır, modelin okuduğu talimatı içermez, yalnız bulguyu içerir:

       output-flood: 30 KB of output from "pytest tests/ -v", over 20 KB

5. [sidebar](../sidebar) açıksa bulgu transcript yerine sidebar'ın stream'ine bir kayıt olarak yazılır. İlk satırda boyut görünür: sınırın iki katının altındaysa sarı, iki katı ya da üstündeyse kırmızı renktedir ve `over N KB` soluk renktedir. Altındaki satırda öneri soluk renkte yazar. Transcript temiz kalır. Sidebar kapalıysa ya da yüklü değilse satır yukarıdaki gibi transcript'e yazılır.
6. Her komut her session'da yalnız bir kez bildirilir. Komut ilk 60 karakterinden tanınır. Boyutu yine de `/output-flood` komutunun gösterdiği toplama eklenir.

## Komut

    /output-flood            açık mı kapalı mı, sınır ve bu session'da sınırı aşan komutlar
    /output-flood on | off   varsayılan açık
    /output-flood limit 50   50 KB'ı aşan bir sonuç bildirilir; 1 ile 1000 arası, varsayılan 20, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install output-flood@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=output-flood}, classic.PostToolBatch
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get (via readLimit, readSettings), $.store.set (via runCommand, setLimit), $.ui.log (via toPerson)

Reach L1: session'ı okur.

    1. Okur:         her Bash komutunun metnini ve sonucunun modelin okuduğu hâliyle uzunluğunu; çıktının kendisini hiçbir zaman parse etmez
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     modelin bir sonraki isteğinden önce modele bir not; transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve sınırı $.store içinde
    5. Düşman girdi: yalnız çıktının uzunluğu ölçülür; komut metni nota 60 karaktere kesilerek girer ve hiçbir zaman çalıştırılmaz

## Sınırlar

- Not yazıldığında çıktı zaten context'tedir. Mod çıktıyı geri alamaz. Not, bir sonraki komut içindir.
- Başarısız bir komut (engine'in hata olarak bildirdiği sıfırdan farklı bir exit) hata metninden ölçülür, çünkü başarısız bir test çalıştırması genellikle en büyük çıktıyı üretir. Hata metni değiştirilmez. Claude Code bu metni 10.000 karakterde keser. Bu yüzden başarısız bir komut, ancak daha düşük bir sınır ayarlarsanız 20 KB sınırını aşar.
- Arka planda çalışan bir komut ölçülmez, çünkü sonucu çıktıyı değil bir task id'yi taşır.
- Öneri komut metnine göre seçilir. Bir script'in ya da bir `make` target'ının içinde çalışan komut için genel öneri verilir.
- Boyut token olarak değil karakter olarak sayılır. ASCII metinde bir token yaklaşık dört karakterdir. Diğer metinlerde bu sayı daha yüksektir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
