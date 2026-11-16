# shot-inline

Model bir screenshot alır ya da bir resmi okur ve bundan bir sonuç çıkarır. Siz ise yalnız bir dosya path'i görürsünüz. Modelin neye baktığını kontrol etmek için dosyayı kendiniz açmanız gerekir. Bu mod, modelin kaydettiği ya da okuduğu her PNG ve JPG dosyasını tool satırının altına çizer. Böylece modelin baktığı screenshot'u dosyayı açmadan görürsünüz.

## Ne yapar

1. Mod üç tür tool çağrısını izler ve her birinden resmin path'ini alır:
   - Playwright `browser_take_screenshot` çağrısı: sonucun link verdiği dosya. Göreli bir link, session'ın başladığı dizine göre okunur, çünkü Playwright server'ı dosyayı oraya yazar. Bu kural bir Bash `cd` komutundan sonra da geçerlidir.
   - Bir `.png`, `.jpg` ya da `.jpeg` dosyasını okuyan `Read` çağrısı.
   - Böyle bir dosyayı adlandıran ve dosya komuttan sonra var olan bir Bash komutu. Komutta birden çok dosya varsa en son adlandırılan dosya önce gelir.
2. Bir PNG'nin boyutu header'ından okunur. 4 MiB'ı aşan bir PNG'nin ve her JPG'nin boyutu `sips` ile ölçülür.
3. Bir JPG, `sips -s format png` ile bir kez `$TMPDIR/shot-inline/<hash>.png` yoluna kopyalanır, çünkü terminal yalnız PNG çizer. Hash, path'ten ve değişiklik zamanından hesaplanır.
4. Tool satırı resmi, resmin kendi oranını koruyarak altına çizer. Resim en fazla 80 sütun genişliğinde ve 24 satır yüksekliğindedir. Terminal daha darsa genişlik de azalır. Küçük bir resimde her 8 pixel için bir sütun kullanılır, böylece resim gerilmez. Dosyayı terminal kendisi okur. Hiçbir pixel engine'den geçmez.
5. kitty grafik protokolünü destekleyen bir terminal (kitty, Ghostty; `TERM`, `TERM_PROGRAM` ve `KITTY_WINDOW_ID` değişkenlerinden anlaşılır) pixel'lerin kendisini çizer. Diğer bütün terminaller aynı kutuyu blok hücrelerle çizer. Bunun için `sips`, hücrelerin taşıdığı pixel'lerden oluşan bir BMP yazar ve mod bu BMP'nin satırlarını okur. Varsayılan olarak her hücre, ikiye iki pixel'lik bir quadrant karakteridir (`▘`, `▞`, `▐`, `▙` ve diğerleri). Hücrenin pixel'leri, en geniş dağılımı olan renk kanalının ortasından ikiye ayrılır. Parlak taraf kendi ortalama rengiyle çizilir, koyu taraf background olur. Bu yöntem yatayda half-block'un iki katı pixel verir. Bunun bedeli, dört pixel için yalnız iki renk kullanılmasıdır. `/shot-inline glyphs half` half-block'a (`▀`) geri döner: her hücre iki pixel taşır ve her pixel kendi rengindedir. BMP her resim ve pixel boyutu için bir kez üretilir. Her resmin hücreleri, resmin çizildiği en yeni kutu için tutulur. Bu yüzden bir resize hücreleri yeniler. Resim en yeni 200 resmin dışında kaldığında hücreleri de silinir.

iTerm2'nin kendi inline image protokolü vardır, ancak engine bu protokolü kullanmaz. Bu yüzden iTerm2'de de blok hücre yolu kullanılır. Protokol engine'in `Image` element'i içinde seçilir ve hiçbir mod bunu değiştiremez. Resmi yalnız terminal arayüzü çizer.

Daha ince sextant (2'ye 3) ve octant (2'ye 4) karakterleri kullanılamaz. Bu karakterler Basic Multilingual Plane dışındadır ve `Raster` onları reddeder (2.1.283 üzerinde ölçüldü: `cell 42 holds code point 118089, beyond the Basic Multilingual Plane; the engine drew its own`).

Canlı denemede bir PNG'yi ve bir JPG'yi okuyan `Read` çağrılarının her biri resmi kendi satırının altına çizdi. JPG bir `sips` kopyası üzerinden çizildi ve debug log'da reddedilmiş bir render tree yoktu. kitty protokolü olmayan tmux'ta aynı `Read` çağrısı, 23 foreground ve 18 background rengiyle 24 satır half-block hücre çizdi. 2.1.283 üzerinde 320'ye 200 pixel'lik bir test resmi tmux'ta 40'a 13 quadrant hücre olarak çizildi ve reddedilmiş bir render tree olmadı.

## Komut

    /shot-inline                      açık mı kapalı mı, bu session'ın resimleri ve kullanılan hücre türü
    /shot-inline on | off             varsayılan açık
    /shot-inline glyphs half | quadrant   kitty protokolü olmayan terminallerde kullanılan hücre türü; varsayılan quadrant

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install shot-inline@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Resmin kendisini görmek için kitty ya da Ghostty kullanın. iTerm2, VS Code terminali, Terminal.app, Windows Terminal ve conhost blok hücreleri gösterir, çünkü engine yalnız kitty protokolünü gönderir.
2. `sips` macOS ile birlikte gelir ve hem JPG kopyası hem de blok hücreler için gereklidir. Diğer işletim sistemlerinde 4 MiB'a kadar bir PNG kitty ve Ghostty'de yine çizilir. Diğer bütün yollar log'a bir kez `a picture was not drawn: ...` yazar.
3. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=shot-inline}, tool.call{tool=Read}, tool.call{tool=Bash}, tool.call{tool=/"^mcp__(plugin_playwright_)?playwright__browser_take_screenshot$"/}, ui.render{component=ToolUse}
    ❯ ./register.tsx calls: $.command.register, $.env.get, $.fs.exists (via bmpCopy, pngCopy, prepare), $.fs.read (via gridFor, measure), $.fs.stat (via prepare), $.process.run (via sips, tempDir), $.session.cwd, $.store.get (via readSettings), $.store.set (via runCommand, setGlyphs), $.ui.invalidate (via readSettings, remember, runCommand, setGlyphs), $.ui.log (via report), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: KITTY_WINDOW_ID, TERM, TERM_PROGRAM, TMPDIR

Reach L2: process çalıştırır ve dosya yazar.

    1. Okur:         Read ve Bash çağrılarının input'unu, Playwright screenshot sonucunu, adı geçen her resim dosyasının header'ını, kendi yazdığı BMP'nin pixel'lerini; TERM, TERM_PROGRAM, KITTY_WINDOW_ID ve TMPDIR değişkenlerini
    2. Çalıştırır:   argv ile sips (boyut ölçme, JPG'den PNG'ye çevirme, hücrelerin BMP'si) ve mkdir -p
    3. Gönderir:     modele hiçbir şey; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       JPG'lerin PNG kopyalarını ve çizilen kutuların BMP'lerini $TMPDIR/shot-inline altında; açık/kapalı ve glyphs ayarlarını $.store içinde
    5. Düşman girdi: bir path modelin komut metninden gelir; sips'e tek bir argv öğesi olarak verilir, hiçbir zaman bir shell'den geçmez ve yalnız dosyanın var olduğu doğrulandıktan sonra kullanılır

## Sınırlar

- Resimler bellekte tutulur. Resume edilen bir session'ın eski satırları resimsiz çizilir.
- Resim dosyasının adını çalışma anında oluşturan (bir değişken ya da glob kullanan) bir Bash komutu fark edilmez.
- `~` ile başlayan bir path genişletilmez.
- `$TMPDIR/shot-inline` altındaki kopyaları mod silmez. Temp dizinini işletim sistemi temizler.
- Bir quadrant hücresi iki renkte dört pixel taşır. Bu yüzden 80'e 24 hücrelik bir kutu 160'a 48 pixel'dir. Bir half-block hücresi kendi renklerinde iki pixel taşır, yani aynı kutu 80'e 48 pixel'dir. Resim tanınabilir, ancak keskin değildir.
- Terminalin renk derinliğini engine seçer. tmux'ta engine 24 bit değil, 256 renk kodları yazdı.
- Blok hücre yolu `sips` gerektirir, bu yüzden yalnız macOS'ta çalışır. kitty yolu bir PNG için hiçbir process gerektirmez.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
