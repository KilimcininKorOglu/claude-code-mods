# output-flood

Model tek bir cevap için `pytest tests/ -v` ya da `find .` çalıştırır; onlarca KB çıktı context'e düşer ve session'ın geri kalanında orada kalır. Sonraki istekler bu yükü taşır, model de bunun neye mal olduğunu bilmez. Bu mod her Bash komutunun context'inden ne kadar harcadığını ölçer. Bir komutun çıktısı bir boyut sınırını geçerse modele bunun neye mal olduğunu ve aynı soruyu hangi daha dar komutun cevaplayacağını söyler.

## Ne yapar

1. Her tool çağrısı grubu bittikten sonra ve bir sonraki model isteğinden önce mod her Bash sonucunu, modelin okuduğu hâliyle karakter olarak ölçer. Ölçüm, sonucu yeniden yazan bütün mod'lardan sonra yapılır; bu yüzden başka bir mod'un ([bash-diet](../bash-diet) gibi) küçülttüğü bir sonuç, plugin'ler hangi sırayla yüklenirse yüklensin küçülmüş boyutuyla sayılır. Subagent çağrıları da aynı şekilde ölçülür.
2. Sınırın üstündeki bir sonuç (varsayılan 20 KB, yaklaşık 5000 token) bir bulgudur. Model bir sonraki isteğinden önce şu notu okur:

       output-flood: "pytest tests/ -v" returned 30 KB of output, over the 20 KB limit, and all of it is now in the context. Next time run the one test or file this turn needs, and let the runner report only failures (pytest -x -q, go test -run, cargo test <name>, jest -t).

   Tavsiye komutun türüne göre değişir: bir test runner, `git log`/`diff`/`show`, bir dosya sistemi taraması (`find`, `ls`, `du`, `tree`), bir package install, bir dosya ya da JSON okuması, container log'ları. Bilinen bir türe girmeyen bir komuta, çıktısını bir dosyaya yazması ve ihtiyacı olan aralığı okuması söylenir.
3. Hiçbir tavsiye `tail` ya da `head`'e pipe önermez. Sonundan kesilen uzun bir çıktı, ekrandan akıp giden hatayı gizler; her öneri bunun yerine komutun ürettiğini daraltır.
4. Aynı anda transcript'e tek bir satır düşer; satırda modelin okuduğu talimat yoktur, yalnız bulgu vardır:

       output-flood: 30 KB of output from "pytest tests/ -v", over 20 KB

5. [sidebar](../sidebar) açıksa bulgu transcript yerine onun stream'ine bir kayıt olarak gider: ilk satırda boyut (sınırın iki katının altında sarı, iki katında ya da üstünde kırmızı, `over N KB` soluk), altında soluk tavsiye. Transcript temiz kalır. Sidebar kapalıysa ya da kurulu değilse satır yukarıdaki gibi transcript'e düşer.
6. Bir komut session başına bir kez bildirilir; komut ilk 60 karakterinden tanınır. Boyutu yine de `/output-flood`'un yazdığı toplama eklenir.

## Komut

    /output-flood            açık mı kapalı mı, sınır ve bu session'da neyin taştığı
    /output-flood on | off   varsayılan açık
    /output-flood limit 50   50 KB'ı aşan bir sonuç bildirilir; 1 ile 1000 arası, varsayılan 20, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install output-flood@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=output-flood}, classic.PostToolBatch
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get (via readLimit, readSettings), $.store.set (via runCommand, setLimit), $.ui.log (via toPerson)

Reach L1: session'ı okur.

    1. Okur:     her Bash komutunun metnini ve sonucunun modelin okuduğu haliyle uzunluğunu; çıktının kendisini hiçbir zaman parse etmez
    2. Çalıştırır: hiçbir şey
    3. Gönderir: modelin bir sonraki request'inden önce ona bir not ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve limiti
    5. Düşman girdi: yalnız çıktının uzunluğu ölçülür; komut metni nota 60 karaktere kesilerek ulaşır ve hiçbir zaman çalıştırılmaz

## Sınırlar

- Not yazıldığında çıktı zaten context'tedir. Mod onu geri alamaz; not sonraki komut içindir.
- Başarısız bir komut (engine'in hata olarak bildirdiği sıfırdan farklı bir exit) hata metninden ölçülür, çünkü başarısız bir test çalıştırması en büyük çıktıdır. Hata metni olduğu gibi kalır. Claude Code bu metni 10.000 karakterde keser; yani başarısız bir komut 20 KB sınırını ancak daha düşük bir sınır ayarlarsan geçer.
- Arka plana alınan bir komut ölçülmez: sonucu çıktıyı değil, bir task id taşır.
- Tavsiye komut metnine göre seçilir. Bir script'in ya da bir `make` target'ının arkasındaki komut genel tavsiyeyi alır.
- Boyut token olarak değil karakter olarak sayılır. Bir ASCII satırında token başına yaklaşık dört karakter vardır, başka metinlerde daha fazla.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
