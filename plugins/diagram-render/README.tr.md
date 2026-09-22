# diagram-render

Modelin cevaplarındaki mermaid block'larını kurulu bir `mmdc` ile render eden ve her resmi kendi cevabının altına çizen bir Claude Code Mod'u. Block cevapta metin olarak kalır; resim onun altına gelir.

## Ne yapar

1. Bir cevap çizildiğinde içindeki kapanmış her ` ```mermaid ` block'u kuyruğa girer. Her turn'ün son metni turn sonunda da kuyruğa girer. Hâlâ akan bir block'un kapanış fence'i yoktur ve bekler.
2. Turn bittikten sonra kuyruktaki block'lar arka planda teker teker render edilir: `mmdc -i <hash>.mmd -o <hash>.png -b transparent -t dark -q`, argv ile, her biri en fazla 60 saniye. Dosyalar `$TMPDIR/diagram-render` altında yaşar ve block'un hash'i ile adlandırılır, yani bir block session başına bir kere render edilir.
3. Bir resim hazır olduğunda cevap yeniden çizilir ve resim altına gelir: en fazla 100 sütun genişliğinde ve 30 satır yüksekliğinde, resmin kendi oranında.
4. mmdc'nin reddettiği bir block (syntax hatası) bir kere `a diagram was not rendered: Error: Parse error ...` satırını yazar ve metin olarak kalır.
5. PATH'te `mmdc` yokken mod session başına bir kere `mmdc is not installed, so mermaid blocks stay text: npm i -g @mermaid-js/mermaid-cli` satırını yazar ve başka hiçbir şey çalıştırmaz.

Resim, kitty graphics protokolü olan bir terminalde görünür (kitty, Ghostty). Başka bir terminal onun yerine `mermaid diagram 1` gösterir. Yalnız terminal surface'i çizer.

Canlı testte mmdc olmadan kurulum satırı cevaptan sonra bir kere geldi. PATH'te mmdc varken üç düğümlü bir flowchart 1,1 saniyede render edildi ve tmux'ta cevabın altına `mermaid diagram 1` geldi; debug log'da reddedilen ağaç yoktu.

## Komut

    /diagram-render            on ya da off, mmdc bulundu mu ve bu session'ın sayıları
    /diagram-render on | off   varsayılan on

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install diagram-render@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. mermaid CLI'yi kurun: `npm i -g @mermaid-js/mermaid-cli`. Render'ı puppeteer üzerinden yapar. npm puppeteer'ın browser indirmesini atlarsa `PUPPETEER_EXECUTABLE_PATH` değişkenini kurulu bir Chrome'a ayarlayın, örneğin `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
2. Resimleri görmek için resim gösteren bir terminal kullanın (kitty, Ghostty).
3. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=diagram-render}, turn.complete, ui.render{component=AssistantMessage}
    ❯ ./register.tsx calls: $.command.register, $.env.get (via workDir), $.fs.read (via renderOne), $.fs.write (via renderOne), $.process.run (via mmdcReady, renderOne), $.store.get, $.store.set (via runCommand), $.ui.invalidate (via drain, runCommand), $.ui.log (via drain, mmdcReady), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: TMPDIR

Reach L2, process çalıştırır ve dosya yazar.

    1. Okur:     modelin cevaplarının metnini ve render edilen her PNG'nin header'ını
    2. Çalıştırır: bir kere mmdc --version, ve yeni block başına mmdc, argv ile
    3. Gönderir: modele hiçbir şey; makineden hiçbir şey çıkmaz
    4. Saklar:   block kaynağını ve PNG'sini $TMPDIR/diagram-render altında, on/off ayarını $.store içinde
    5. Düşman girdi: block kaynağı modelden gelir ve mmdc'ye yalnız mmdc'nin parse ettiği bir dosya olarak ulaşır; mermaid onu headless bir browser'da çalıştırır, yani düşman bir block o browser'ın içinde çalışır

## Sınırlar

- Resimler bellekte yaşar: resume edilen bir session eski cevaplarını, bir sonraki turn bitene kadar resimsiz çizer.
- Tema, şeffaf zemin üzerinde koyudur; açık renkli bir terminalde çizgileri görmek zordur.
- `$TMPDIR/diagram-render` altındaki dosyaları mod silmez; temp dizinini sistem temizler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
