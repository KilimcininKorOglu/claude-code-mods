# shot-inline

Model bir screenshot alır ya da bir resmi okur, ondan bir sonuç çıkarır; sen ise yalnız bir dosya path'i görürsün. Neye baktığını kontrol etmek için dosyayı kendin açman gerekir. Bu mod modelin kaydettiği ya da okuduğu her PNG ve JPG'yi tool satırının altına çizer; böylece modelin baktığı screenshot'u dosyayı açmadan görürsün.

## Ne yapar

1. Mod üç tür tool çağrısını izler ve her birinden görsel path'ini alır:
   - bir Playwright `browser_take_screenshot`: sonucunun link verdiği dosya; göreli bir link, Playwright server'ının onu yazdığı yer olan session'ın başladığı dizine göre okunur, bir Bash `cd`'sinden sonra da;
   - bir `.png`, `.jpg` ya da `.jpeg` dosyasının `Read` çağrısı;
   - böyle bir dosyayı adlandıran bir Bash komutu, dosya komuttan sonra varsa (en son adlandırılan önce).
2. Bir PNG'nin boyutu header'ından okunur. 4 MiB üstündeki bir PNG ve bir JPG `sips` ile ölçülür.
3. Bir JPG bir kere `$TMPDIR/shot-inline/<hash>.png` yoluna `sips -s format png` ile kopyalanır, çünkü terminal yalnız PNG çizer. Hash, path'i ve değişiklik zamanını kapsar.
4. Tool satırı resmi kendi oranında altına çizer: en fazla 80 kolon genişlik (terminal daha darsa daha az; küçük bir resimde 8 pixel başına bir kolon, böylece resim gerilmez) ve 24 satır yükseklik. Dosyayı terminal kendisi okur; hiçbir pixel engine'den geçmez.
5. kitty graphics protokolü olan bir terminal (kitty, Ghostty; `TERM`, `TERM_PROGRAM` ve `KITTY_WINDOW_ID` üzerinden okunur) pixel'lerin kendisini çizer. Diğer her terminal aynı kutuyu blok hücreler olarak çizer: `sips` tam olarak hücrelerin taşıdığı pixel'lerden bir BMP yazar ve mod satırlarını okur. Varsayılan olarak bir hücre iki pixel'e iki pixel'lik bir quadrant karakteridir (`▘`, `▞`, `▐`, `▙` ve diğerleri): hücrenin pixel'leri en geniş yayılan renk kanalının ortasından ikiye bölünür, parlak taraf kendi ortalama rengiyle çizilir, koyu taraf background olur. Bu, yatayda half-block'un iki katı pixel demektir; bedeli dört pixel başına iki renktir. `/shot-inline glyphs half` half-block'a (`▀`) döner: hücre başına iki pixel, her biri kendi renginde. BMP resim ve pixel boyutu başına bir kere üretilir. Her resmin hücreleri, çizildiği en yeni kutu için tutulur; bu yüzden bir resize onları değiştirir. Resim en yeni 200 resmin dışında kalınca hücreleri de onunla birlikte gider.

iTerm2'nin kendi inline image protokolü vardır ve engine onu kullanmaz, bu yüzden iTerm2 de blok hücre yolunu alır. Protokol engine'in `Image` element'i içinde seçilir, bu yüzden hiçbir mod onu değiştiremez. Bir resmi yalnız terminal surface'i çizer.

Daha ince sextant (2'ye 3) ve octant (2'ye 4) karakterleri kullanılamaz: Basic Multilingual Plane dışında kalırlar ve `Raster` onları reddeder (2.1.283 üzerinde ölçüldü: `cell 42 holds code point 118089, beyond the Basic Multilingual Plane; the engine drew its own`).

Canlı kontrolde bir PNG'nin ve bir JPG'nin `Read` çağrısı resmi kendi satırının altına çizdi; JPG bir `sips` kopyası üzerinden çizildi ve debug log'da reddedilen bir tree yoktu. kitty protokolü olmayan tmux'ta aynı `Read` 24 satır half-block hücreyi 23 foreground ve 18 background renginde çizdi. 2.1.283 üzerinde 320'ye 200'lük bir test resmi tmux'ta 40'a 13 quadrant hücre olarak çizildi ve reddedilen bir tree olmadı.

## Komut

    /shot-inline                      on ya da off, bu session'ın resimleri ve kullanılan hücreler
    /shot-inline on | off             varsayılan on
    /shot-inline glyphs half | quadrant   kitty protokolü olmayan terminalin hücreleri; varsayılan quadrant

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install shot-inline@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Resmin kendisi için kitty ya da Ghostty kullan. iTerm2, VS Code terminali, Terminal.app, Windows Terminal ve conhost blok hücreleri alır, çünkü engine yalnız kitty protokolünü gönderir.
2. `sips` macOS'un parçasıdır ve hem JPG kopyası hem blok hücreler onu ister. Başka bir yerde 4 MiB'a kadar bir PNG kitty ve Ghostty'de yine çizilir, diğer her yol log'a bir kere `a picture was not drawn: ...` yazar.
3. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=shot-inline}, tool.call{tool=Read}, tool.call{tool=Bash}, tool.call{tool=/"^mcp__(plugin_playwright_)?playwright__browser_take_screenshot$"/}, ui.render{component=ToolUse}
    ❯ ./register.tsx calls: $.command.register, $.env.get, $.fs.exists (via bmpCopy, pngCopy, prepare), $.fs.read (via gridFor, measure), $.fs.stat (via prepare), $.process.run (via sips, tempDir), $.session.cwd, $.store.get (via readSettings), $.store.set (via runCommand, setGlyphs), $.ui.invalidate (via readSettings, remember, runCommand, setGlyphs), $.ui.log (via report), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: KITTY_WINDOW_ID, TERM, TERM_PROGRAM, TMPDIR

Reach L2: process çalıştırır ve dosya yazar.

    1. Okur:     Read ve Bash çağrılarının input'unu, Playwright screenshot sonucunu, adlandırılan her görsel dosyanın header'ını, kendi yazdığı BMP'nin pixel'lerini ve TERM, TERM_PROGRAM, KITTY_WINDOW_ID ve TMPDIR
    2. Çalıştırır: sips (boyut, JPG'den PNG'ye, hücrelerin BMP'si) ve mkdir -p, argv ile
    3. Gönderir: modele hiçbir şey; makineden hiçbir şey çıkmaz
    4. Saklar:   JPG'lerin PNG kopyalarını ve çizilen kutuların BMP'lerini $TMPDIR/shot-inline altında, on/off ve glyphs ayarlarını $.store içinde
    5. Düşman girdi: bir path modelin komut metninden gelir; sips'e tek bir argv öğesi olarak ulaşır, hiçbir zaman bir shell üzerinden geçmez ve oraya yalnız dosyanın var olduğu görüldükten sonra ulaşır

## Sınırlar

- Resimler bellekte durur: resume edilmiş bir session eski satırlarını onlarsız çizer.
- Çalışma anında kurduğu bir adla (bir değişken, bir glob) görsel yazan bir Bash komutu görülmez.
- `~` ile başlayan bir path genişletilmez.
- `$TMPDIR/shot-inline` altındaki kopyalar mod tarafından silinmez; temp dizinini sistem temizler.
- Bir quadrant hücre iki renkte dört pixel taşır, yani 80'e 24 bir kutu 160'a 48 pixel'dir; bir half-block hücre kendi renklerinde iki pixel taşır, 80'e 48. Resim tanınır, keskin değil.
- Terminalin renk derinliğini engine seçer: tmux'ta 256 renk kodları yazdı, 24 bit olanları değil.
- Blok hücre yolu `sips` ister, yani yalnız macOS'tadır. kitty yolu bir PNG için hiçbir process istemez.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
