# prompt-deck

"devam et", "commitle", "testleri çalıştır" gibi kısa prompt'ları her gün tekrar tekrar yazarsınız. Bu mod, bu projede sık gönderdiğiniz kısa prompt'ları öğrenir. Bu prompt'lar, elle sabitlediğiniz prompt'larla birlikte prompt kutusunun üstündeki bantta gösterilir. Bir rakam tuşu ilgili prompt'u hemen gönderir.

## Ne yapar

1. Yazdığınız ya da Remote Control ile gönderdiğiniz her prompt sayılır. Sayılan prompt'un baştaki ve sondaki boşlukları atılır. Prompt tek satır olmalı, 1 ile 80 karakter arasında olmalı ve slash komutu olmamalıdır. Notification, peer mesajı, schedule ve başka plugin'lerin prompt'ları sayılmaz.
2. `/prompt-deck add <metin>` bir prompt'u elle sabitler. Sabitlenen prompt'lar bantta ilk sırada ve eklendikleri sırayla gösterilir. Sayılan prompt'lar sabitlenen bir prompt'u banttan çıkaramaz. Sabitlenen prompt'lar için uzunluk sınırı yoktur ve sayımlar gibi her proje için ayrı tutulur. Bant 5 prompt alır, bu yüzden en fazla 5 prompt sabitlenebilir. `/prompt-deck remove <n>` bir prompt'un sabitlemesini kaldırır.
3. Bir prompt 3 kullanımdan sonra bantta görünür. Bant en çok kullanılan 5 prompt'u gösterir. Kullanım sayısı eşit olan prompt'lardan en son kullanılan önce gelir. Bant `1: commitle  2: devam et ...` biçimindedir ve her etiket bant genişliğindeki payına göre kesilir.
4. Prompt kutusu boşken bir rakam tuşu ilgili prompt'u hemen gönderir. Bir tıklama ya da ctrl+x tab ve Enter da prompt'u gönderir. Her basış bir kullanım daha sayılır.
5. Bant alanında bir anket gösterilirken, bir turn çalışırken ya da bir agent'ın transcript'i ekrandayken bant çizilmez.
6. Sayımlar ve sabitlenen prompt'lar plugin store'da tutulur. Her proje için bir deck vardır ve projenin bütün session'ları bu deck'i ortak kullanır. Proje, session'ın git top level dizinidir. Git repository'si yoksa proje çalışma dizinidir. Deck'in store'daki key'i bu tam path'tir. Bu yüzden `app` adlı iki ayrı checkout iki ayrı deck tutar. Durum çıktısı projeyi path'inin son parçasıyla adlandırır. Her proje için en fazla 200 prompt tutulur. Sınır aşıldığında en az kullanılan ve en eski prompt önce silinir.

Bir basış, modun kendi markdown komutunu çalıştırır: `/prompt-deck:send <prompt>`. Bu komutun gövdesi yalnız argümanlarından oluşur. Transcript bu komut satırını gösterir. Model prompt'u, elle yazılmış bir slash komutunu okuduğu gibi, yazıldığı hâliyle okur (2.1.282 üzerinde ölçüldü). `&& /<ad>` içeren bir prompt bu yolla bir komut zinciri olarak okunurdu. Bu yüzden böyle bir prompt plugin prompt'u olarak gönderilir. Engine'in komutu reddettiği bir basış da plugin prompt'u olarak gönderilir ve bunu bildiren bir satır yazılır. Model bir plugin prompt'unu `The prompt-deck plugin sent a message:` çerçevesi içinde okur.

Canlı denemede sabitlenen `Yalnız tamam kelimesini yaz.` prompt'u bantta `1: Yalnız tamam kelimesini yaz.` olarak göründü. `1` tuşu prompt'u `/prompt-deck:send Yalnız tamam kelimesini yaz.` olarak gönderdi. Model prompt'u çerçevesiz okudu ve `tamam` cevabını verdi.

## Komut

    /prompt-deck                açık mı kapalı mı, proje ve kullanım sayılarıyla prompt'lar
    /prompt-deck list           aynısı
    /prompt-deck add <metin>    kendi prompt'unuzu sabitler; sayılan prompt'lardan önce gösterilir
    /prompt-deck remove <n>     listenin n. sırasındaki prompt'u siler, sabitlenmiş ya da sayılmış
    /prompt-deck clear          bütün prompt'ları siler
    /prompt-deck on | off       varsayılan açık; kapalıyken sayımlar korunur
    /prompt-deck:send <prompt>  bir basışın çalıştırdığı komut; elle yazılırsa prompt'u yazıldığı gibi gönderir

`/prompt-deck:send` modun ikinci komutudur ve "her mod için tek komut" kuralının istisnasıdır. Bunun nedeni, modele plugin çerçevesi olmadan prompt vermenin tek yolunun bir markdown komutu olmasıdır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-deck@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=prompt-deck}, prompt.submit, ui.render{component=AbovePrompt} (default matcher key: plugin)
    ❯ ./register.tsx calls: $.clock.after (via sendPrompt), $.clock.now (via countUse), $.command.register, $.command.run (via sendPrompt), $.process.run (via resolveRoot), $.prompt.submit (via submitPrompt), $.session.cwd (via resolveRoot), $.store.get (via countUse, loadDeck), $.store.set (via saveCounts, savePins, setEnabled), $.ui.invalidate, $.ui.log (via sendPrompt, submitPrompt), $.ui.resolve

Reach L2: git çalıştırır ve Claude'u yönlendirir, çünkü bir basış bir prompt gönderir.

    1. Okur:         gönderilen her prompt'un metnini ve kaynağını; session'ın çalışma dizinini
    2. Çalıştırır:   projenin kökünü bulmak için her session'da bir kez git rev-parse --show-toplevel
    3. Gönderir:     saklanan bir prompt'u /prompt-deck:send ile kullanıcı turn'ü olarak, yalnız siz bastığınızda; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       $.store içinde, her proje için kullanım sayıları ve son kullanım zamanlarıyla en fazla 200 kısa prompt, en fazla 5 sabitlenmiş prompt; açık/kapalı ayarı
    5. Düşman girdi: yalnız composer'dan ya da Remote Control'den gelen prompt'lar sayılır ve bir prompt'u yalnız elle yazılmış bir /prompt-deck add sabitler; bu yüzden bir notification, bir peer ya da bir plugin banda prompt ekleyemez

## Sınırlar

- 80 karakterden uzun ya da birden çok satırlı bir prompt hiçbir zaman sayılmaz. `/prompt-deck add` ise tek satırda her uzunluktaki prompt'u kabul eder.
- Bant yalnız terminalde çizilir, çünkü engine `AbovePrompt` olayını yalnız terminalde tetikler.
- Yalnız büyük-küçük harf ya da noktalama farkı olan iki prompt ayrı ayrı sayılır.
- Açık/kapalı ayarı bütün projeler için ortak tek bir ayardır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
