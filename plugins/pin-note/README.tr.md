# pin-note

Session'ın başında modele "her push'tan önce sor" dediğinizi düşünün. Bir compaction'dan sonra özet bu cümleyi atar ya da daha zayıf bir ifadeye çevirir. `/clear`'dan sonra ise cümle tamamen kaybolur. Bu mod, `/pin-note` ile sabitlediğiniz notları session boyunca saklar. Her compaction'dan ve her `/clear`'dan sonra notlar modele kelimesi kelimesine yeniden gönderilir.

## Ne yapar

1. `/pin-note <not>` bir notu sabitler. Model notu hemen, komutun cevabında okur:

       pin-note: pinned note 1, kept for this session and sent to you again after each compaction and /clear:
       ask before every push

2. Bir compaction'dan ya da `/clear`'dan sonra notlar bir `SessionStart` hook'u ile modelin yeni context'ine eklenir. Notlar tek bir numaralı liste hâlinde, yazdığınız gibi gider. Listenin üstündeki üç satır modele notların kaynağını açıklar: notları siz `/pin-note` ile sabitlediniz, ardından konuşma compact edildi ya da `/clear` çalıştırıldı ve açtığınız pin-note plugin'i notları geri veriyor. Bu satırlar olmadığında model zaman zaman bir notu dışarıdan eklenmiş bir talimat sanıp uygulamadı. Size tek bir satırla bilgi verilir:

       pin-note: sent 1 pinned note(s) again after the compaction

3. Notlar session'a aittir ve `$.store` içinde session'ın id'si altında tutulur. Bu sayede yeniden yüklenen bir modül ve resume edilen bir session notları yeniden bulur. `/clear` yeni bir session başlatır ve notlar yeni session'a taşınır.
4. Session başında ve resume sırasında hiçbir şey gönderilmez, çünkü konuşma bu noktada notları sabitlediğiniz hâliyle zaten içerir.

Claude Code 2.1.283 üzerinde, `sonnet` modeliyle canlı session'larda ölçüldü. `/compact`'tan sonra not modelin context'ine ulaştı. `/clear`'dan sonra sabitlenmiş bir not olup olmadığı sorulduğunda model notu kelimesi kelimesine yazdı. Her cevabın sonuna bir kelime eklenmesini isteyen bir not sabitlendi. Ardından `/clear` çalıştırıldı ve yeni bir soru soruldu. Bu deneme iki metin için 20'şer kez yapıldı. Önceki tek satırlık metinde model notu 4 kez dışarıdan eklenmiş sayıp reddetti. Şimdiki metinde model 20 denemenin hepsinde nota uydu.

## Komut

    /pin-note                  açık mı kapalı mı ve sabitlenmiş notlar, numaralı
    /pin-note on | off         varsayılan kapalı; kapalıyken notlar saklanır ama hiçbiri gönderilmez
    /pin-note <not>            bir notu sabitler; metin yazıldığı gibi saklanır, birkaç satır olabilir
    /pin-note drop <n>         n numaralı notu çıkarır

Mod kapalıyken `/pin-note <not>` ve `drop` reddedilir. Komut kelimeleri yalnız `on`, `off` ve `drop <n>`'dir. Bu yüzden `drop` ile başlayan bir not, ardından tek başına bir sayı gelmediği sürece not olarak kabul edilir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install pin-note@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. `/pin-note on` komutunu çalıştırın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=pin-note}, classic.SessionStart
    ❯ ./register.ts calls: $.command.register, $.session.id, $.store.get (via loadPins, readSettings), $.store.set (via runCommand, savePins), $.ui.log

Reach L0: network, dosya ve process kullanmaz.

    1. Okur:         sabitlediğiniz notları ve session'ın id'sini
    2. Çalıştırır:   hiçbir şey
    3. Gönderir:     makineden dışarı hiçbir şey; notlar modelin context'ine yazdığınız gibi girer
    4. Saklar:       açık/kapalı ayarını ve her session'ın notlarını $.store içinde
    5. Düşman girdi: bir not sizin kendi metninizdir ve model onu sizin talimatınız olarak okur; başka hiçbir şey okunmaz

## Sınırlar

- Notlar yalnız compaction'da ve `/clear`'da yeniden gönderilir. Bir notun context'ten çıkması için önce `drop` ile çıkarılması, ardından context'in compact edilmesi gerekir. Modelin okuduğu bir not konuşmada kalır.
- Her session'ın notları `$.store` içinde session'ın id'si altında kalır. Eski session'ların notları hiçbir zaman silinmez.
- Not sayısı ve not uzunluğu için bir sınır yoktur. Her not her compaction'dan sonra context'e girer.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
