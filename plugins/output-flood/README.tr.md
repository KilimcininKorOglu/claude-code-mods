# output-flood

Her Bash komutunun context'inizden ne kadar harcadığını ölçen bir Claude Code Mod'u. Bir komutun çıktısı bir boyut limitini geçtiğinde mod, modele bunun ne kadara mal olduğunu ve aynı soruya hangi daha dar komutun cevap vereceğini söyler.

## Ne yapar

1. Mod Bash tool'unu hook'lar. Başarılı bir çağrıdan sonra `stdout` ve `stderr` karakterlerini, yani modelin okuduğu iki stream'i toplar.
2. Limitin üstündeki bir sonuç (varsayılan 20 KB, yaklaşık 5000 token) bir bulgudur. Model bu notu tool'un sonucundan sonra okur:

       output-flood: "pytest tests/ -v" returned 30 KB of output, over the 20 KB limit, and all of it is now in the context. Next time run the one test or file this turn needs, and let the runner report only failures (pytest -x -q, go test -run, cargo test <name>, jest -t).

   Tavsiye komutun türünü izler: bir test runner, `git log`/`diff`/`show`, bir filesystem taraması (`find`, `ls`, `du`, `tree`), bir package install, bir dosya ya da JSON okuması, container log'ları. Bilinen bir türde olmayan bir komuta, çıktısını bir dosyaya göndermesi ve ihtiyacı olan aralığı okuması söylenir.
3. Hiçbir tavsiye `tail` ya da `head` içine pipe önermez. Çıktısı sonundan kesilen uzun bir koşu, ekrandan geçmiş hatayı gizler; her öneri bunun yerine komutun ürettiğini daraltır.
4. Aynı anda transcript'e bir satır yazılır, yalnız bulgu, modelin okuduğu talimat olmadan:

       output-flood: 30 KB of output from "pytest tests/ -v", over 20 KB

5. [sidebar](../sidebar) açıkken bu bulgu oraya gider, ilk satırda boyut ve altında soluk tavsiye ile, stream'inde bir entry halinde, ve transcript temiz kalır. Sidebar kapalıyken ya da o mod kurulu değilken transcript satırı yukarıdaki gibi yazılır.
6. Bir komut metni session başına bir kere bildirilir. Boyutu yine de `/output-flood` çıktısındaki toplama sayılır.

## Komut

    /output-flood            on ya da off, limit ve bu session'da neyin taştığı
    /output-flood on | off   varsayılan on
    /output-flood limit 50   50 KB üstündeki bir sonuç bildirilir; 1 ile 1000 arası, varsayılan 20, session'lar arasında saklanır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install output-flood@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=output-flood}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setLimit), $.ui.log (via toPerson)

Reach L1, session'ı okur.

    1. Okur:     her Bash komutunun metnini ve iki çıktı stream'inin uzunluğunu; çıktının kendisini hiçbir zaman parse etmez
    2. Çalıştırır: hiçbir şey
    3. Gönderir: tool'un sonucundan sonra modele bir not ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve limiti
    5. Düşman girdi: yalnız çıktının uzunluğu ölçülür; komut metni nota 60 karaktere kesilerek ulaşır ve hiçbir zaman çalıştırılmaz

## Sınırlar

- Not yazıldığında çıktı zaten context'tedir. Mod onu geri alamaz; not sonraki komut içindir.
- Başarısız bir komut (engine'in hata olarak bildirdiği sıfır olmayan bir exit) dokunulmadan bırakılır, çünkü çıktısı modelin olduğu gibi okuması gereken hatadır.
- Arka plana alınmış bir komut ölçülmez: sonucu çıktıyı değil bir task id taşır.
- Tavsiye komut metnine göre eşleştirilir. Bir script ya da bir `make` target'ı arkasına gizlenmiş bir komut genel tavsiyeyi alır.
- Boyut karakter olarak sayılır, token olarak değil. Bir ASCII satırı token başına yaklaşık dört karakterdir, diğer metinler daha fazla.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
