# edit-loop

Bir düzeltme işe yaramadığında model aynı dosyayı tekrar tekrar düzenlemeye başlar ve her seferinde biraz farklı bir tahmin dener. Bir turn'de aynı dosyanın beş kez düzenlenmesi, modelin sorunu anlamadan tahmin yürüttüğünü gösterir. Bu mod bu anı tespit eder. Modele durmasını, kodu yeniden okumasını ve bir sonraki düzenlemeden önce kök nedeni yazmasını hatırlatır. Mod hiçbir işlemi durdurmaz.

## Ne yapar

1. Mod Edit, Write ve NotebookEdit tool'larını izler. Başarılı her çağrı, ilgili dosyanın bir düzenlemesi olarak sayılır. Reddedilen ya da başarısız olan çağrılar sayılmaz.
2. Sayılar her loop ve her dosya için ayrı tutulur: ana loop ve her subagent kendi sayısını tutar. Her yeni turn bütün sayıları sıfırlar.
3. Bir turn'de aynı dosyanın üçüncü düzenlemesinde yalnız size bir uyarı gelir:

       edit-loop: 3rd edit of hooks/a.ts in this turn

   Model bu aşamada hiçbir şey okumaz.
4. Bir turn'de aynı dosyanın beşinci düzenlemesinde, düzenlemenin sonucunun hemen ardından modele şu not gönderilir:

       edit-loop: this turn edited hooks/a.ts 5 times. Stop editing it, re-read the code path and state the root cause before the next edit.

   Dosya, session'ın başladığı git repository'sinin içindeyse path o repository'nin köküne göre yazılır. Örneğin `plugins/a` içinde açılmış bir session, `plugins/b` altındaki bir dosyayı `plugins/b/x.ts` olarak gösterir. Git repository'sinin dışında path, session'ın başladığı dizine göre yazılır. Bu kök dizin session başında bir kez okunur, çünkü Bash'te çalışan bir `cd` session'ın dizinini değiştirir. Not her dosya ve her turn için bir kez gönderilir. Altıncı ve sonraki düzenlemelerde not gönderilmez.
5. Aynı anda transcript'e tek bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır yalnız bulguyu içerir, talimatı içermez:

       edit-loop: 5th edit of hooks/a.ts in this turn

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz.
6. [sidebar](../sidebar) açıksa iki satır da transcript yerine sidebar'ın stream'ine yazılır ve transcript temiz kalır. Sidebar'da renk sıra sayısındadır (`3rd`, `5th`): üçüncü düzenlemede sarı, beşincide kırmızı. Path varsayılan renkte kalır, `in this turn` soluk renktedir. Kayıt, yeni kayıtlar onu pane'den çıkarana kadar görünür. Sidebar yoksa satırlar yukarıdaki gibi transcript'e yazılır.

Canlı denemede model bir turn'de aynı dosyayı altı kez düzenledi. Beşinci düzenlemeden sonra notu okudu ve dosyayı yeniden okudu. Ardından düzenlemelerin neden bilerek yapıldığını açıkladı ve notu kelimesi kelimesine aktardı. Diğer beş düzenlemede not gönderilmedi.

## Komut

    /edit-loop            açık mı kapalı mı
    /edit-loop on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install edit-loop@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=edit-loop}, turn.start, tool.call{tool=Edit}, tool.call{tool=Write}, tool.call{tool=NotebookEdit}
    ❯ ./register.ts calls: $.command.register, $.process.run (via shownRootOf), $.session.cwd (via afterEdit, shownRootOf), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2: bir process çalıştırır.

    1. Okur:         her Edit, Write ve NotebookEdit çağrısının dosya path'ini; session'ın dizinini ve git repository kökünü
    2. Çalıştırır:   path'leri repository köküne göre göstermek için session başında bir kez `git rev-parse --show-toplevel`
    3. Gönderir:     bir turn'de aynı dosyanın beşinci düzenlemesinden sonra modele bir not; üçüncü ve beşinci düzenlemede transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını $.store içinde; sayılar bir turn boyunca bellekte durur
    5. Düşman girdi: path yalnız karşılaştırılır ve notta yazılır, hiçbir zaman açılmaz

## Sınırlar

- Bash ile yapılan düzenlemeler (`sed -i`, heredoc, bir script) sayılmaz.
- Aynı dosyanın beş kez düzenlenmesi bilerek yapılmış olabilir, örneğin parça parça yazılan uzun bir dosya. Not yalnız bir neden ister ve hiçbir işlemi durdurmaz.
- Sayım, path'i tool çağrısının yazdığı biçimde izler. İki farklı biçimde yazılan tek bir dosya (bir link ya da `..` içeren bir path) iki ayrı dosya olarak sayılır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
