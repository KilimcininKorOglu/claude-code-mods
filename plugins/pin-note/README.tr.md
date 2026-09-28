# pin-note

Modele baştan "her push'tan önce sor" dersin; bir compaction'dan sonra özet bu cümleyi atmış ya da daha zayıf bir şeye çevirmiştir, `/clear`'dan sonra ise tamamen gitmiştir. Bu mod `/pin-note` ile sabitlediğin notları session boyunca saklar ve her compaction'dan ve `/clear`'dan sonra modele kelimesi kelimesine yeniden gönderir.

## Ne yapar

1. `/pin-note <not>` bir notu sabitler. Model notu hemen, komutun cevabında okur:

       pin-note: pinned note 1, kept for this session and sent to you again after each compaction and /clear:
       ask before every push

2. Bir compaction'dan ve `/clear`'dan sonra notlar bir `SessionStart` hook'u ile modelin yeni context'ine numaralı tek bir liste olarak girer; her not yazdığın gibidir. Listenin üstündeki üç satır modele notların nereden geldiğini söyler: notları sen `/pin-note` ile kendin sabitledin, sonra konuşma compact edildi ya da `/clear` çalıştırdın, açtığın pin-note plugin'i de onları geri veriyor. Bu satırlar yokken model bazen bir notu enjekte edilmiş bir talimat sanıp uygulamadı. Sana tek bir satır bunu bildirir:

       pin-note: sent 1 pinned note(s) again after the compaction

3. Notlar session'a aittir. `$.store`'da session'ın id'si altında tutulur; böylece yeniden yüklenen bir modül ve resume edilen bir session onları yeniden bulur. `/clear` yeni bir session başlatır ve notlar onunla birlikte gider.
4. Session başında ve resume'da hiçbir şey gönderilmez, çünkü oradaki konuşma notları sabitlediğin hâliyle zaten taşır.

Claude Code 2.1.283 üzerinde `sonnet` modeliyle canlı session'larda ölçüldü: `/compact`'tan sonra not modelin context'ine ulaştı. `/clear`'dan sonra sabitlenmiş bir not olup olmadığı sorulan model, notu kelimesi kelimesine yazdı. Her cevabın sonuna bir kelime eklenmesini isteyen bir not sabitlendi, ardından `/clear` ve yeni bir soru geldi; bu her metin için 20 kez denendi. Önceki tek satırlık metinle model notu 4 kez enjekte edilmiş sayıp reddetti. Şimdiki metinle 20 denemenin hepsinde nota uydu.

## Komut

    /pin-note                  açık mı kapalı mı ve sabitlenmiş notlar, numaralı
    /pin-note on | off         varsayılan kapalı; kapalıyken notlar saklanır, hiçbiri gönderilmez
    /pin-note <not>            bir notu sabitler; metin yazıldığı gibi saklanır, birkaç satır da olabilir
    /pin-note drop <n>         n numaralı notu çıkarır

Mod kapalıyken `/pin-note <not>` ve `drop` reddedilir. Komut kelimeleri yalnız `on`, `off` ve `drop <n>`'dir; bu yüzden bir not, ardından tek başına bir sayı gelmediği sürece `drop` ile başlayabilir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install pin-note@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. `/pin-note on` çalıştır.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=pin-note}, classic.SessionStart
    ❯ ./register.ts calls: $.command.register, $.session.id, $.store.get (via loadPins, readSettings), $.store.set (via runCommand, savePins), $.ui.log

Reach L0: network yok, dosya yok, process yok.

    1. Okur:        sabitlediğin notları ve session'ın id'sini
    2. Çalıştırır:  hiçbir şey
    3. Gönderir:    makineden dışarı hiçbir şey; notlar modelin context'ine yazdığın gibi girer
    4. Saklar:      $.store içinde açık/kapalı ayarını ve her session'ın notlarını
    5. Düşman girdi: bir not senin kendi metnindir ve model onu senin talimatın olarak okur; başka hiçbir şey okunmaz

## Sınırlar

- Notlar yalnız compaction'da ve `/clear`'da yeniden gönderilir. Context'ten çıkmasını istediğin bir notu `drop` ile çıkarıp context'i compact etmen gerekir, çünkü modelin okuduğu bir not konuşmada kalır.
- Her session'ın notları `$.store`'da id'si altında kalır; eski bir session'ın notlarını hiçbir şey silmez.
- Not sayısı ve uzunluğu için bir sınır yoktur; her not her compaction'dan sonra context'e girer.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
