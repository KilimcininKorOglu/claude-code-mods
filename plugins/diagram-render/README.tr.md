# diagram-render

Model bir akışı ya da bir mimariyi anlatırken çoğu zaman bir mermaid diyagramı yazar. Terminalde ise yalnız diyagramın kaynak kodu görünür. Bu mod her mermaid bloğunu bilgisayarınızda yüklü `mmdc` ile resme çevirir ve resmi cevabın altına yerleştirir. Blok cevapta metin olarak kalır, resim bloğun altında gösterilir.

## Ne yapar

1. Bir cevap ekrana çizilirken içindeki her kapanmış ` ```mermaid ` bloğu sıraya alınır. Her turn'ün son metni de turn sonunda sıraya alınır. Hâlâ akmakta olan bir bloğun kapanış işareti henüz yoktur, bu yüzden blok sırasını bekler.
2. Turn bitince sıradaki bloklar arka planda tek tek çizilir: `mmdc -i <hash>.mmd -o <hash>.png -b transparent -t dark -q`, argv ile ve her biri için en fazla 60 saniye. Dosyalar `$TMPDIR/diagram-render` altında durur ve bloğun hash'iyle adlandırılır. Bu sayede bir blok her session'da yalnız bir kez çizilir.
3. Resim hazır olunca cevap, altında resimle birlikte yeniden çizilir. Resim en fazla 100 sütun genişliğinde ve 30 satır yüksekliğindedir. Resmin en-boy oranı korunur.
4. `mmdc`'nin reddettiği bir blok (örneğin syntax hatası olan bir blok) için bir kez `a diagram was not rendered: Error: Parse error ...` log'u yazılır. Blok metin olarak kalır.
5. PATH'te `mmdc` yoksa mod her session'da bir kez `mmdc is not installed, so mermaid blocks stay text: npm i -g @mermaid-js/mermaid-cli` yazar ve başka hiçbir şey çalıştırmaz.

Resim yalnız kitty grafik protokolünü destekleyen terminallerde (kitty, Ghostty) görünür. Diğer terminallerde resmin yerinde `mermaid diagram 1` yazısı görünür. Resmi yalnız terminal arayüzü çizer.

`mmdc` yüklü değilken yapılan canlı denemede kurulum satırı cevaptan sonra bir kez geldi. PATH'te `mmdc` varken üç düğümlü bir flowchart 1,1 saniyede çizildi. tmux'ta cevabın altında `mermaid diagram 1` göründü ve debug log'da reddedilmiş bir ağaç yoktu.

## Komut

    /diagram-render            açık mı kapalı mı, mmdc bulundu mu ve bu session'daki sayılar
    /diagram-render on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install diagram-render@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Mermaid CLI'ı yükleyin: `npm i -g @mermaid-js/mermaid-cli`. CLI çizimi puppeteer ile yapar. npm, puppeteer'ın browser indirmesini atlarsa `PUPPETEER_EXECUTABLE_PATH` değişkenini yüklü bir Chrome'a ayarlayın. Örnek: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
2. Resimleri görmek için resim gösterebilen bir terminal (kitty, Ghostty) kullanın.
3. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.288 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=diagram-render}, turn.complete, ui.render{component=AssistantMessage}
    ❯ ./register.tsx calls: $.clock.after, $.command.register, $.env.get (via workDir), $.fs.read (via renderOne), $.fs.write (via renderOne), $.process.run (via mmdcReady, renderOne), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.invalidate (via drain, readSettings, runCommand), $.ui.log (via drain, mmdcReady), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: TMPDIR

Reach L2: process çalıştırır ve dosya yazar.

    1. Okur:         modelin cevaplarının metnini ve çizilen her PNG'nin başlığını
    2. Çalıştırır:   bir kez mmdc --version; her yeni blok için argv ile mmdc
    3. Gönderir:     modele hiçbir şey; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       bloğun kaynağını ve PNG'sini $TMPDIR/diagram-render altında; açık/kapalı ayarını $.store içinde
    5. Düşman girdi: blok kaynağı modelden gelir ve mmdc'ye yalnız mmdc'nin parse ettiği bir dosya olarak ulaşır; mermaid bloğu headless bir browser'da çalıştırır, bu yüzden düşmanca bir blok o browser'ın içinde çalışır

## Sınırlar

- Resimler bellekte tutulur. Resume edilen bir session'ın eski cevapları, bir sonraki turn bitene kadar resimsiz çizilir.
- Tema şeffaf zemin üzerinde koyu renktir. Açık renkli bir terminalde çizgiler zor görünür.
- Mod `$TMPDIR/diagram-render` altındaki dosyaları silmez. Geçici dizini işletim sistemi temizler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
