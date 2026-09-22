# edit-loop

Model bir turn içinde aynı dosyayı beş kere düzenlediğinde bunu modele söyleyen bir Claude Code Mod'u. Böylece model tekrar denemek yerine kök sebebi yeniden okur. Hiçbir şey durdurulmaz.

## Ne yapar

1. Mod Edit, Write ve NotebookEdit tool'larını hook'lar. Başarılı her çağrı, kendi dosyası için bir edit sayılır. Reddedilen ya da başarısız çağrı sayılmaz.
2. Sayaç loop ve dosya başına tutulur: main loop ve her subagent ayrı sayar. Yeni bir turn her sayacı sıfırlar.
3. Bir turn'de bir dosyanın üçüncü edit'i yalnız sizi uyarır, sarı renkte:

       edit-loop: 3rd edit of hooks/a.ts in this turn

   Model bu sayıda hiçbir şey okumaz.
4. Bir turn'de bir dosyanın beşinci edit'i, sonucundan sonra şu notu alır:

       edit-loop: this turn edited hooks/a.ts 5 times. Stop editing it, re-read the code path and state the root cause before the next edit.

   Dosya session'ın başladığı dizinin içindeyse path ona göre yazılır. O dizin session başlangıcında bir kere okunur, çünkü bir Bash `cd` session'ın kendi dizinini kaydırır. Not dosya ve turn başına bir kere gelir; altıncı ve sonraki edit'ler not almaz.
5. Aynı anda transcript'e bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır talimat cümlesi olmadan yalnız bulguyu taşır ve kırmızı çizilir:

       edit-loop: 5th edit of hooks/a.ts in this turn

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
6. [sidebar](../sidebar) açıkken iki satır da oraya gider, stream'in içinde kayıtlar olarak; transcript temiz kalır. Bir kayıt, yenileri onu pane'in dışına itene kadar durur. Sidebar kapalıyken ya da o mod kurulu değilken yukarıdaki transcript satırı yazılır.

Canlı testte model bir turn'de bir dosyayı altı kere düzenledi. Beşinci edit'ten sonra notu okudu, dosyayı yeniden okudu, edit'lerin neden kasıtlı olduğunu söyledi ve notu kelimesi kelimesine aktardı. Diğer beş edit not almadı.

## Komut

    /edit-loop            on ya da off
    /edit-loop on | off   varsayılan on

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install edit-loop@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=edit-loop}, turn.start, tool.call{tool=Edit}, tool.call{tool=Write}, tool.call{tool=NotebookEdit}
    ❯ ./register.ts calls: $.command.register, $.session.cwd, $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L0, hatırlar.

    1. Okur:     her Edit, Write ve NotebookEdit çağrısının dosya path'ini; session'ın dizinini
    2. Çalıştırır: hiçbir şey
    3. Gönderir: bir turn'de bir dosyanın beşinci edit'inden sonra modele bir not, üçüncü ve beşincide transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını; sayaçlar bir turn boyunca bellekte yaşar
    5. Düşman girdi: path yalnız karşılaştırılır ve notta yazılır, hiç açılmaz

## Sınırlar

- Bash üzerinden yapılan bir edit (`sed -i`, bir heredoc, bir script) sayılmaz.
- Bir dosyanın beş edit'i kasıtlı olabilir, örneğin parça parça yazılan uzun bir dosya. Not bir sebep ister, hiçbir şeyi durdurmaz.
- Sayaç, tool çağrısının adlandırdığı path'i izler, yani iki farklı yazımla (bir link, `..`) gelen tek dosya iki kere sayılır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
