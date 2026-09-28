# prompt-offload

Prompt'a uzun bir log, bir stack trace ya da koca bir dosya yapıştırırsın; modelin işine yalnız bir kısmı yarasa da hepsi session'ın geri kalanında context'te kalır. Bu mod uzun bir yapıştırılmış prompt'u bir dosyaya yazar ve modele ilk satırlarını path ile birlikte gönderir; böylece tek bir yapıştırma context'i doldurmaz.

## Ne yapar

1. Yazdığın ya da Remote Control üzerinden gönderdiğin her prompt ölçülür. Bir notification, bir peer mesajı, bir schedule ya da başka bir plugin'in prompt'u olduğu gibi bırakılır.
2. Sınırdan (varsayılan 2000 karakter) uzun bir prompt `$TMPDIR/prompt-offload/<hash>.txt`'ye bütün ve değişmeden yazılır. Hash metni ve gönderildiği zamanı kapsar.
3. Model prompt'un ilk 200 karakterini okur; ardından dosyayı, karakter sayısını ve satır sayısını söyleyen ve cevap vermeden önce dosyayı okumasını isteyen tek bir satır gelir. Bu 200 karakterin ortasından sonra bir satır sonu varsa baş kısım sonuncusunda kesilir.
4. Transcript'e tek bir satır düşer: dosyaya kaç karakter gittiği ve nereye.
5. Başarısız bir yazma prompt'u kaybettirmez: prompt'un tamamı modele olduğu gibi ulaşır, neden de farklı bir hata gelene kadar bir kez yazılır.

Canlı denemede 2980 karakterlik bir prompt dosyaya yazıldı; model dosyayı `Read` ile okudu ve yalnız prompt'un son kısmında duran soruyu cevapladı.

## Komut

    /prompt-offload              açık mı kapalı mı ve sınır
    /prompt-offload on | off     varsayılan açık
    /prompt-offload limit <n>    en az 500 karakter; session'lar arasında korunur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-offload@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. `$TMPDIR/prompt-offload`'u okumaya izin ver, ya da bir dosyanın ilk `Read`'inin sorduğu izin sorusunu cevapla.
2. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=prompt-offload}, prompt.submit
    ❯ ./register.ts calls: $.clock.now (via offload), $.command.register, $.env.get (via tempDir), $.fs.write (via offload), $.process.run (via tempDir), $.store.get (via readSettings), $.store.set (via setEnabled, setLimit), $.ui.log (via offload, report)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: TMPDIR

Reach L2: dosya yazar ve bir process çalıştırır.

    1. Okur:     gönderilen her prompt'un metnini ve origin'ini, TMPDIR'ı
    2. Çalıştırır: mkdir -p, argv ile
    3. Gönderir: prompt'un ilk 200 karakterini ve path'i modele; makineden hiçbir şey çıkmaz
    4. Saklar:   bütün prompt'u $TMPDIR/prompt-offload altında, on/off ayarını ve limiti $.store içinde
    5. Düşman girdi: yalnız composer ya da Remote Control'den gelen bir prompt yazılır, dosya adı mod'un kurduğu bir hash'tir ve path hiçbir zaman bir shell'e ulaşmaz

## Sınırlar

- Mod dosyayı silmez; temp dizinini sistem temizler.
- Prompt'taki bir attachment, bir görsel ya da bir dosya referansı sayılmaz ve taşınmaz: mod yalnız metni ölçer.
- Model prompt'un tamamını görmek için bir `Read` yapmak zorundadır; yani hemen cevaplayacağı bir prompt bir tool çağrısına mal olur.
- 500 karakterin altındaki bir sınır reddedilir, çünkü 200 karakterlik bir baş kısım prompt'un çok azını geride bırakır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
