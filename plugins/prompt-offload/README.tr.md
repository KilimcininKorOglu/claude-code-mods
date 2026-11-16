# prompt-offload

Prompt'a uzun bir log, bir stack trace ya da bütün bir dosya yapıştırdığınızda metnin tamamı session sonuna kadar context'te kalır. Model bu metnin yalnız bir kısmına ihtiyaç duysa bile durum değişmez. Bu mod uzun bir prompt'u bir dosyaya yazar ve modele yalnız ilk satırlarını, dosyanın path'iyle birlikte gönderir. Böylece tek bir yapıştırma context'i doldurmaz.

## Ne yapar

1. Yazdığınız ya da Remote Control ile gönderdiğiniz her prompt'un uzunluğu ölçülür. Notification, peer mesajı, schedule ve başka plugin'lerin prompt'ları olduğu gibi bırakılır.
2. Sınırı (varsayılan 2000 karakter) aşan bir prompt, tamamı ve değiştirilmeden `$TMPDIR/prompt-offload/<hash>.txt` dosyasına yazılır. Hash, metinden ve gönderildiği zamandan hesaplanır.
3. Model prompt'un ilk 200 karakterini okur. Ardından tek bir satır gelir: bu satır dosyanın adını, karakter ve satır sayısını verir ve modelden cevap vermeden önce dosyayı okumasını ister. Bu 200 karakterin ikinci yarısında bir satır sonu varsa baş kısım son satır sonunda kesilir.
4. Transcript'e tek bir satır yazılır: dosyaya kaç karakter gittiği ve dosyanın yeri.
5. Dosyaya yazma başarısız olursa prompt kaybolmaz. Prompt'un tamamı modele olduğu gibi gider. Hatanın nedeni bir kez yazılır ve farklı bir hata gelene kadar tekrarlanmaz.

Canlı denemede 2980 karakterlik bir prompt dosyaya yazıldı. Model dosyayı `Read` ile okudu ve yalnız prompt'un son kısmında duran soruyu cevapladı.

## Komut

    /prompt-offload              açık mı kapalı mı ve sınır
    /prompt-offload on | off     varsayılan açık
    /prompt-offload limit <n>    en az 500 karakter; session'lar arasında korunur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-offload@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. `$TMPDIR/prompt-offload` dizinini okuma izni verin. Ya da bir dosyanın ilk `Read` çağrısında gelen izin sorusunu cevaplayın.
2. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=prompt-offload}, prompt.submit
    ❯ ./register.ts calls: $.clock.now (via offload), $.command.register, $.env.get (via tempDir), $.fs.write (via offload), $.process.run (via tempDir), $.store.get (via readSettings), $.store.set (via setEnabled, setLimit), $.ui.log (via offload, report)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: TMPDIR

Reach L2: dosya yazar ve bir process çalıştırır.

    1. Okur:         gönderilen her prompt'un metnini ve kaynağını, TMPDIR'ı
    2. Çalıştırır:   mkdir -p, argv ile
    3. Gönderir:     prompt'un ilk 200 karakterini ve path'i modele; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       prompt'un tamamını $TMPDIR/prompt-offload altında; açık/kapalı ayarını ve sınırı $.store içinde
    5. Düşman girdi: yalnız composer'dan ya da Remote Control'den gelen prompt yazılır; dosya adı modun hesapladığı bir hash'tir ve path hiçbir zaman bir shell'e verilmez

## Sınırlar

- Mod dosyayı silmez. Temp dizinini işletim sistemi temizler.
- Prompt'taki attachment, görsel ya da dosya referansı sayılmaz ve dosyaya taşınmaz. Mod yalnız metni ölçer.
- Modelin prompt'un tamamını görmesi için bir `Read` çağrısı gerekir. Bu yüzden hemen cevaplanabilecek bir prompt bir tool çağrısına mal olur.
- 500 karakterin altındaki bir sınır reddedilir, çünkü 200 karakterlik baş kısımdan sonra prompt'un çok azı geride kalır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
