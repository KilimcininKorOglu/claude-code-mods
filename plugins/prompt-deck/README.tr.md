# prompt-deck

Bu projede sık gönderdiğiniz kısa prompt'ları öğrenen ve onları, elle sabitlediklerinizle birlikte, prompt'un üstündeki bantta çizen bir Claude Code Mod'u. Bir rakam tuşu birini anında gönderir.

## Ne yapar

1. Yazdığınız ya da Remote Control üzerinden gönderdiğiniz her prompt sayılır: trim edilmiş, tek satır, 1 ile 80 karakter arası, bir slash komutu değil. Bir notification, bir peer mesajı, bir schedule ya da başka bir plugin'in prompt'u sayılmaz.
2. `/prompt-deck add <text>` bir prompt'u elle sabitler. Sabitlenmiş bir prompt ilk sırada, eklendiği düzende çizilir ve sayımlar onu banttan itemez. Uzunluk limiti yoktur ve sayımlar gibi proje başına tutulur. En fazla 5 prompt sabitlenir, çünkü bant 5 tane tutar. `/prompt-deck remove <n>` birini çözer.
3. Bir prompt 3 kullanımdan sonra banda ulaşır. Bant en çok kullanılan 5 tanesini çizer, eşitlikte en yenisi önce, `1: commitle  2: devam et ...` biçiminde, her etiket genişlikten payına kesilir.
4. Prompt kutusu boşken bir rakam tuşu o prompt'u anında gönderir. Bir tıklama ya da ctrl+x tab ve Enter da gönderir. Bir basış bir kullanım daha sayılır.
5. Bir anket bandı tutarken, bir tur çalışırken ya da bir agent'ın transcript'i görüntüdeyken bant çizilmez.
6. Sayımlar ve sabitlenmiş prompt'lar plugin store'da yaşar, proje başına bir deck, o projenin her session'ı tarafından paylaşılır. Proje, session'ın git top level'ıdır; yoksa çalışma dizini. Deck bu tam path ile key'lenir, yani `app` adlı iki checkout iki ayrı deck tutar; status projeyi path'inin son parçasıyla adlandırır. Proje başına en fazla 200 prompt tutulur; en az kullanılan ve en eski olan önce gider.
7. 0.2.0 öncesi bir sürümün deck'i her projeyi tek bir yerde sayıyordu. 0.2.0'ı yükleyen ilk proje o sayımları bir kere alır ve bunu bir satırda söyler; diğer her proje boş başlar.
8. 0.5.0 öncesi bir sürümün deck'i yalnız proje adıyla key'leniyordu. 0.5.0'ı yükleyen o addaki ilk checkout onu bir kere kendi path'inin key'ine taşır ve bunu bir satırda söyler; aynı addaki başka bir checkout boş başlar.

Bir basış mod'un kendi markdown komutunu, `/prompt-deck:send <prompt>` komutunu çalıştırır; bu komutun gövdesi yalnız argümanlarıdır. Transcript o komut satırını gösterir ve model prompt'u yazıldığı gibi, yazılmış bir slash komutu gibi okur (2.1.282 üzerinde ölçüldü). `&& /<name>` içeren bir prompt orada bir komut zinciri olarak okunurdu, bu yüzden bir plugin prompt'u olarak gider. Engine'in komutunu reddettiği bir basış da öyle gider ve bunu söyleyen bir satır yazılır. Model bir plugin prompt'unu `The prompt-deck plugin sent a message:` çerçevesi içinde okur.

Canlı kontrolde sabitlenmiş bir `Yalnız tamam kelimesini yaz.` `1: Yalnız tamam kelimesini yaz.` olarak göründü, `1` tuşu onu `/prompt-deck:send Yalnız tamam kelimesini yaz.` olarak gönderdi ve model prompt'u çerçevesiz okuyup `tamam` cevabını verdi.

## Komut

    /prompt-deck                on ya da off, proje ve kullanımlarıyla prompt'ları
    /prompt-deck list           aynısı
    /prompt-deck add <text>     kendi prompt'unuzu sabitler, sayılanlardan önce çizilir
    /prompt-deck remove <n>     listenin n. sırasındaki prompt'u unutur, sabitlenmiş ya da sayılan
    /prompt-deck clear          her prompt'u unutur
    /prompt-deck on | off       varsayılan on; off sayımları korur
    /prompt-deck:send <prompt>  bir basışın çalıştırdığı komut; yazılırsa prompt'u yazıldığı gibi gönderir

`/prompt-deck:send` mod'un ikinci komutudur ve mod başına tek komut kuralının istisnasıdır, çünkü model'e plugin çerçevesi olmadan prompt veren tek yol bir markdown komutudur.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-deck@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.282 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=prompt-deck}, prompt.submit, ui.render{component=AbovePrompt}
    ❯ ./register.tsx calls: $.clock.after (via sendPrompt), $.clock.now (via countUse), $.command.register, $.command.run (via sendPrompt), $.process.run (via resolveRoot), $.prompt.submit (via submitPrompt), $.session.cwd (via resolveRoot), $.store.delete (via adoptLegacy, adoptNamed), $.store.get (via adoptLegacy, adoptNamed, countUse, loadDeck), $.store.set (via saveCounts, savePins, setEnabled), $.ui.invalidate, $.ui.log (via adoptLegacy, adoptNamed, sendPrompt, submitPrompt), $.ui.resolve

Reach L2, git çalıştırır ve Claude'u sürer: bir basış bir prompt gönderir.

    1. Okur:     gönderilen her prompt'un metnini ve origin'ini; session'ın çalışma dizinini
    2. Çalıştırır: git rev-parse --show-toplevel, session başına bir kere, projenin kökünü bulmak için
    3. Gönderir: saklanmış bir prompt'u /prompt-deck:send ile user turn olarak, yalnız kişinin basışıyla; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde, proje başına, kullanım sayıları ve son kullanım zamanıyla en fazla 200 kısa prompt, en fazla 5 sabitlenmiş prompt ve on/off ayarı
    5. Düşman girdi: yalnız composer ya da Remote Control'den gelen prompt'lar sayılır ve yalnız yazılmış bir /prompt-deck add bir prompt'u sabitler; yani bir notification, bir peer ya da bir plugin banda prompt koyamaz

## Sınırlar

- 80 karakterden uzun ya da birkaç satırlı bir prompt hiçbir zaman sayılmaz. `/prompt-deck add` tek satırda her uzunluğu alır.
- Bant yalnız terminal'de çizilir, çünkü engine `AbovePrompt` olayını yalnız orada raise eder.
- Yalnız büyük küçük harf ya da noktalama ile ayrılan iki prompt ayrı sayılır.
- On/off ayarı her proje için tek bir ayardır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
