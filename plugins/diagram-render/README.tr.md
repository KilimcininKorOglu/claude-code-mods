# diagram-render

Model bir akışı ya da bir mimariyi anlatırken çoğu zaman bir mermaid diyagramı yazar; terminalde ise yalnız o diyagramın kaynak kodunu görürsün. Bu mod her mermaid bloğunu kurulu `mmdc` ile çizer ve resmi cevabının altına yerleştirir. Blok cevapta metin olarak kalır, resim de onun altına gelir.

## Ne yapar

1. Bir cevap çizilirken içindeki kapanmış her ` ```mermaid ` bloğu sıraya alınır; her turn'ün son metni de turn sonunda sıraya girer. Hâlâ akmakta olan bir bloğun kapanış işareti yoktur, bu yüzden bekler.
2. Turn bitince sıradaki bloklar arka planda teker teker çizilir: argv ile `mmdc -i <hash>.mmd -o <hash>.png -b transparent -t dark -q`, her biri en fazla 60 saniye. Dosyalar `$TMPDIR/diagram-render` altında, bloğun hash'iyle adlandırılmış olarak durur; böylece bir blok session başına bir kez çizilir.
3. Resim hazır olunca cevap, altında resimle yeniden çizilir: en fazla 100 sütun genişliğinde ve 30 satır yüksekliğinde, resmin oranı korunarak.
4. mmdc'nin reddettiği bir blok (bir syntax hatası) bir kez `a diagram was not rendered: Error: Parse error ...` log'unu yazar ve metin olarak kalır.
5. PATH'te `mmdc` yoksa mod session başına bir kez `mmdc is not installed, so mermaid blocks stay text: npm i -g @mermaid-js/mermaid-cli` yazar ve başka bir şey çalıştırmaz.

Resim, kitty grafik protokolünü destekleyen bir terminalde (kitty, Ghostty) görünür. Diğer terminaller onun yerine `mermaid diagram 1` gösterir. Resmi yalnız terminal yüzeyi çizer.

mmdc olmadan yapılan canlı denemede kurulum satırı cevaptan sonra bir kez geldi. PATH'te mmdc varken üç düğümlü bir flowchart 1,1 saniyede çizildi ve tmux'ta cevabın altında `mermaid diagram 1` belirdi; debug log'da reddedilmiş bir ağaç yoktu.

## Komut

    /diagram-render            açık mı kapalı mı, mmdc bulundu mu ve bu session'ın sayıları
    /diagram-render on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install diagram-render@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Mermaid CLI'ı kur: `npm i -g @mermaid-js/mermaid-cli`. Çizimi puppeteer üzerinden yapar. npm, puppeteer'ın browser indirmesini atlarsa `PUPPETEER_EXECUTABLE_PATH`'i kurulu bir Chrome'a ayarla, örneğin `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
2. Resimleri görmek için resim gösterebilen bir terminal (kitty, Ghostty) kullan.
3. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.288 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=diagram-render}, turn.complete, ui.render{component=AssistantMessage}
    ❯ ./register.tsx calls: $.clock.after, $.command.register, $.env.get (via workDir), $.fs.read (via renderOne), $.fs.write (via renderOne), $.process.run (via mmdcReady, renderOne), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.invalidate (via drain, readSettings, runCommand), $.ui.log (via drain, mmdcReady), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: TMPDIR

Reach L2: process çalıştırır ve dosya yazar.

    1. Okur:     modelin cevaplarının metnini ve çizilen her PNG'nin başlığını
    2. Çalıştırır: bir kez mmdc --version, her yeni blok için de argv ile mmdc
    3. Gönderir: modele hiçbir şey; makineden dışarı bir şey çıkmaz
    4. Saklar:   $TMPDIR/diagram-render altında bloğun kaynağını ve PNG'sini, $.store içinde açık/kapalı ayarını
    5. Düşman girdi: blok kaynağı modelden gelir ve mmdc'ye yalnız onun parse ettiği bir dosya olarak ulaşır; mermaid onu headless bir browser'da çalıştırır, yani düşmanca bir blok o browser'ın içinde çalışır

## Sınırlar

- Resimler bellekte durur: resume edilen bir session, eski cevaplarını bir sonraki turn bitene kadar resimsiz çizer.
- Tema, şeffaf zemin üzerinde koyudur; açık renkli bir terminalde çizgiler zor görünür.
- Mod `$TMPDIR/diagram-render` altındaki dosyaları silmez; geçici dizini sistem temizler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
