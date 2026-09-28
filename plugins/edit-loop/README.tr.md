# edit-loop

Bir düzeltme işe yaramayınca model aynı dosyayı tekrar tekrar düzenlemeye başlar, her seferinde biraz farklı bir tahminle. Bir turn'de aynı dosyanın beş kez düzenlenmesi çoğu zaman modelin anlamak yerine tahmin yürüttüğünü gösterir. Bu mod o anı fark eder ve modele durmasını, kodu yeniden okumasını ve bir sonraki edit'ten önce kök nedeni söylemesini hatırlatır. Hiçbir şeyi durdurmaz.

## Ne yapar

1. Edit, Write ve NotebookEdit tool'larını izler. Başarılı her çağrı dosyasının bir edit'i sayılır; reddedilen ya da başarısız olan çağrı sayılmaz.
2. Sayılar loop ve dosya başına ayrı tutulur: ana loop ve her subagent kendi sayısını tutar. Yeni bir turn her sayıyı sıfırlar.
3. Bir turn'de aynı dosyanın üçüncü edit'i yalnız seni uyarır:

       edit-loop: 3rd edit of hooks/a.ts in this turn

   Model bu sayıda hiçbir şey okumaz.
4. Bir turn'de aynı dosyanın beşinci edit'i, sonucunun hemen ardından şu notu alır:

       edit-loop: this turn edited hooks/a.ts 5 times. Stop editing it, re-read the code path and state the root cause before the next edit.

   Dosya, session'ın başladığı git repository'sinin içindeyse yol o repository'ye göre yazılır; yani `plugins/a` içinde açılmış bir session, `plugins/b`'deki bir dosyayı `plugins/b/x.ts` olarak gösterir. Git repository'si dışında yol, session'ın başladığı dizine göredir. Bu kök session başlarken bir kez okunur, çünkü Bash'teki bir `cd` session'ın dizinini değiştirir. Not her dosya ve turn için bir kez gelir; altıncı ve sonraki edit'ler not almaz.
5. Aynı anda transcript'e tek bir satır düşer, böylece modele ne söylendiğini görürsün. Satırda talimat yoktur, yalnız bulgu vardır:

       edit-loop: 5th edit of hooks/a.ts in this turn

   Not ile satır ayrı kanallardır: model satırı, sen de notu hiç okumazsın.
6. [sidebar](../sidebar) açıksa iki satır da transcript yerine onun stream'ine gider, transcript temiz kalır. Orada rengi sıra sayısı (`3rd`, `5th`) taşır: üçüncü edit'te sarı, beşincide kırmızı; yol varsayılan renkte kalır, `in this turn` soluktur. Kayıt, yenileri onu pane'den itene kadar durur. Sidebar yoksa satırlar yukarıdaki gibi transcript'e düşer.

Canlı denemede model bir turn'de aynı dosyayı altı kez düzenledi. Beşinci edit'ten sonra notu okudu, dosyayı yeniden okudu, edit'lerin neden bilerek yapıldığını açıkladı ve notu kelimesi kelimesine aktardı. Diğer beş edit not almadı.

## Komut

    /edit-loop            açık mı kapalı mı
    /edit-loop on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install edit-loop@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=edit-loop}, turn.start, tool.call{tool=Edit}, tool.call{tool=Write}, tool.call{tool=NotebookEdit}
    ❯ ./register.ts calls: $.command.register, $.process.run (via shownRootOf), $.session.cwd (via afterEdit, shownRootOf), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2: bir process çalıştırır.

    1. Okur:     her Edit, Write ve NotebookEdit çağrısının dosya yolunu; session'ın dizinini ve git repository kökünü
    2. Çalıştırır: yolları repository köküne göre göstermek için session başında bir kez `git rev-parse --show-toplevel`
    3. Gönderir: bir turn'de aynı dosyanın beşinci edit'inden sonra modele bir not, üçüncü ve beşinci edit'te transcript'e bir satır; makineden dışarı bir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını; sayılar bir turn boyunca bellekte durur
    5. Düşman girdi: yol yalnız karşılaştırılır ve notta yazılır, hiçbir zaman açılmaz

## Sınırlar

- Bash üzerinden yapılan bir düzenleme (`sed -i`, bir heredoc, bir script) sayılmaz.
- Aynı dosyanın beş edit'i bilerek yapılmış olabilir, örneğin parça parça yazılan uzun bir dosya. Not bir neden ister, hiçbir şeyi durdurmaz.
- Sayı, yolu tool çağrısının yazdığı biçimde izler; iki farklı yazılışla (bir link, `..`) anılan tek bir dosya iki kez sayılır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
