# shot-inline

Modelin kaydettiği ya da okuduğu her PNG ve JPG dosyasını tool satırının altında çizen bir Claude Code Mod'u, böylece modelin baktığı screenshot'u dosyayı açmadan görürsünüz.

## Ne yapar

1. Mod üç tür tool çağrısını izler ve her birinden görsel path'ini alır:
   - bir Playwright `browser_take_screenshot`: sonucunun link verdiği dosya;
   - bir `.png`, `.jpg` ya da `.jpeg` dosyasının `Read` çağrısı;
   - böyle bir dosyayı adlandıran bir Bash komutu, dosya komuttan sonra varsa (en son adlandırılan önce).
2. Bir PNG header'ından ölçülür. 4 MiB üstündeki bir PNG ve bir JPG `sips` ile ölçülür.
3. Bir JPG bir kere `$TMPDIR/shot-inline/<hash>.png` yoluna `sips -s format png` ile kopyalanır, çünkü terminal yalnız PNG çizer. Hash, path'i ve değişiklik zamanını kapsar.
4. Tool satırı resmi altında çizer: en fazla 80 kolon genişlik ve 24 satır yükseklik, resmin kendi oranında. Dosyayı terminal kendisi okur; hiçbir pixel engine'den geçmez.
5. kitty graphics protokolü olan bir terminal (kitty, Ghostty; `TERM`, `TERM_PROGRAM` ve `KITTY_WINDOW_ID` üzerinden okunur) pixel'lerin kendisini çizer. Diğer her terminal aynı kutuyu half-block hücreler olarak çizer: `sips` tam olarak kutunun pixel'lerinden bir BMP yazar, mod satırlarını okur ve her hücre iki pixel taşır, üsttekini foreground, alttakini background olarak. BMP resim ve kutu başına bir kere üretilir. Her resmin hücreleri çizildiği en yeni kutu için tutulur, yani bir resize onları değiştirir, ve en yeni 200 resim onu dışarı ittiğinde resimle birlikte gider.

iTerm2'nin kendi inline image protokolü vardır ve engine onu kullanmaz, bu yüzden iTerm2 de half-block yolunu alır. Protokol engine'in `Image` element'i içinde seçilir, bu yüzden hiçbir mod onu değiştiremez. Bir resmi yalnız terminal surface'i çizer.

Canlı kontrolde bir PNG'nin ve bir JPG'nin `Read` çağrısı satırlarının altında çizdi, JPG bir `sips` kopyası üzerinden, ve debug log'da reddedilen bir tree yoktu. kitty protokolü olmayan tmux'ta aynı `Read` 24 satır half-block hücreyi 23 foreground ve 18 background renginde çizdi.

## Komut

    /shot-inline            on ya da off, ve bu session'ın resimleri
    /shot-inline on | off   varsayılan on

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install shot-inline@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Resmin kendisi için kitty ya da Ghostty kullanın. iTerm2, VS Code terminali, Terminal.app, Windows Terminal ve conhost half-block hücreleri alır, çünkü engine yalnız kitty protokolünü gönderir.
2. `sips` macOS'un parçasıdır ve hem JPG kopyası hem half-block hücreler onu ister. Başka bir yerde 4 MiB'a kadar bir PNG kitty ve Ghostty'de yine çizilir, diğer her yol bir kere `a picture was not drawn: ...` log'lar.
3. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=shot-inline}, tool.call{tool=Read}, tool.call{tool=Bash}, tool.call{tool=/^mcp__(plugin_playwright_)?playwright__browser_take_screenshot$/}, ui.render{component=ToolUse}
    ❯ ./register.tsx calls: $.command.register, $.env.get, $.fs.exists (via bmpCopy, pngCopy, prepare), $.fs.read (via gridFor, measure), $.fs.stat (via prepare), $.process.run (via sips, tempDir), $.session.cwd (via remember), $.store.get, $.store.set (via runCommand), $.ui.invalidate (via remember, runCommand), $.ui.log (via report), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: KITTY_WINDOW_ID, TERM, TERM_PROGRAM, TMPDIR

Reach L2, process çalıştırır ve dosya yazar.

    1. Okur:     Read ve Bash çağrılarının input'unu, Playwright screenshot sonucunu, adlandırılan her görsel dosyanın header'ını, kendi yazdığı BMP'nin pixel'lerini, ve TERM, TERM_PROGRAM, KITTY_WINDOW_ID ve TMPDIR
    2. Çalıştırır: sips (boyut, JPG'den PNG'ye, hücrelerin BMP'si) ve mkdir -p, argv ile
    3. Gönderir: modele hiçbir şey; makineden hiçbir şey çıkmaz
    4. Saklar:   JPG'lerin PNG kopyalarını ve çizilen kutuların BMP'lerini $TMPDIR/shot-inline altında, on/off ayarını $.store içinde
    5. Düşman girdi: bir path modelin komut metninden gelir; sips'e tek bir argv öğesi olarak ulaşır, hiçbir zaman bir shell üzerinden geçmez, ve yalnız dosyanın var olduğu görüldükten sonra

## Sınırlar

- Resimler bellekte yaşar: resume edilmiş bir session eski satırlarını onlarsız çizer.
- Çalışma anında kurduğu bir adla (bir değişken, bir glob) görsel yazan bir Bash komutu görülmez.
- `~` ile başlayan bir path genişletilmez.
- `$TMPDIR/shot-inline` altındaki kopyalar mod tarafından silinmez; temp dizinini sistem temizler.
- Bir half-block hücre iki pixel taşır, yani 80'e 24 bir kutu 160'a 48 pixel'dir. Resim tanınır, keskin değil.
- Terminalin renk derinliğini engine seçer: tmux'ta 256 renk kodları yazdı, 24 bit olanları değil.
- Half-block yolu `sips` ister, yani yalnız macOS'tadır. kitty yolu bir PNG için hiçbir process istemez.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
