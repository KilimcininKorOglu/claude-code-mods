# prompt-offload

Uzun bir yapıştırılmış prompt'u bir dosyaya yazan ve modele ilk satırlarını path ile gönderen bir Claude Code Mod'u, böylece tek bir yapıştırma context'i doldurmaz.

## Ne yapar

1. Yazdığınız ya da Remote Control üzerinden gönderdiğiniz her prompt ölçülür. Bir notification, bir peer mesajı, bir schedule ya da başka bir plugin'in prompt'u dokunulmadan bırakılır.
2. Limitten (varsayılan 2000 karakter) uzun bir prompt `$TMPDIR/prompt-offload/<hash>.txt` dosyasına, bütün ve değiştirilmeden yazılır. Hash, metni ve gönderildiği zamanı kapsar.
3. Model prompt'un ilk 200 karakterini okur, baş kısım bir satır sonu taşıyorsa orada kesilir; sonra dosyayı, karakter sayısını ve satır sayısını adlandıran ve cevap vermeden önce dosyayı okumasını söyleyen bir satır.
4. Transcript bir satır alır: dosyaya kaç karakter gittiği ve nereye.
5. Başarısız bir yazma kaybolmuş bir prompt değildir: bütün prompt modele olduğu gibi ulaşır ve sebep bir kere log'lanır.

Canlı kontrolde 2980 karakterlik bir prompt dosyaya yazıldı, model dosyayı `Read` ile okudu ve yalnız prompt'un son kısmında olan soruyu cevapladı.

## Komut

    /prompt-offload              on ya da off, ve limit
    /prompt-offload on | off     varsayılan on
    /prompt-offload limit <n>    en az 500 karakter; session'lar arasında tutulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-offload@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. `$TMPDIR/prompt-offload` okumasına izin verin ya da bir dosyanın ilk `Read` işleminin sorduğu izin sorusunu cevaplayın.
2. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=prompt-offload}, prompt.submit
    ❯ ./register.ts calls: $.clock.now (via offload), $.command.register, $.env.get (via tempDir), $.fs.write (via offload), $.process.run (via tempDir), $.store.get, $.store.set (via setEnabled, setLimit), $.ui.log (via offload, report)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: TMPDIR

Reach L2, dosya yazar ve bir process çalıştırır.

    1. Okur:     gönderilen her prompt'un metnini ve origin'ini, ve TMPDIR
    2. Çalıştırır: mkdir -p, argv ile
    3. Gönderir: prompt'un ilk 200 karakterini ve path'i modele; makineden hiçbir şey çıkmaz
    4. Saklar:   bütün prompt'u $TMPDIR/prompt-offload altında, on/off ayarını ve limiti $.store içinde
    5. Düşman girdi: yalnız composer ya da Remote Control'den gelen bir prompt yazılır, dosya adı mod'un kurduğu bir hash'tir ve path hiçbir zaman bir shell'e ulaşmaz

## Sınırlar

- Dosya mod tarafından silinmez; temp dizinini sistem temizler.
- Prompt'taki bir attachment, bir görsel ya da bir dosya referansı sayılmaz ve taşınmaz: mod yalnız metni ölçer.
- Model bütün prompt'u görmek için bir `Read` çağrısına ihtiyaç duyar, yani hemen cevaplayacağı bir prompt bir tool çağrısına mal olur.
- 500 karakterin altındaki bir limit reddedilir, çünkü 200 karakterlik bir baş kısım prompt'tan çok az şey bırakır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
