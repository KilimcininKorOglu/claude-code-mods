# pin-note

Bu Claude Code Mod'u, `/pin-note` ile sabitlediğiniz notları session boyunca saklar ve her compaction ile `/clear` sonrasında modele kelimesi kelimesine yeniden gönderir. Bir compaction özeti, başta verdiğiniz bir talimatı atabilir ya da başka sözlerle yazabilir; sabitlenmiş bir not ise yazdığınız gibi geri gelir.

## Ne yapar

1. `/pin-note <not>` bir notu sabitler. Model notu hemen, komutun cevabında okur:

       pin-note: pinned note 1, kept for this session and sent to you again after each compaction and /clear:
       ask before every push

2. Bir compaction'dan ve `/clear`'dan sonra notlar, bir `SessionStart` hook'u ile modelin yeni context'ine numaralı tek bir liste olarak girer. Her not yazdığınız gibidir. Bir satır size bunu bildirir:

       pin-note: sent 1 pinned note(s) again after the compaction

3. Notlar session'a aittir. `$.store` içinde session'ın id'si altında tutulur, böylece reload edilen bir modül ve resume edilen bir session onları yeniden bulur. `/clear` yeni bir session başlatır ve notlar onunla birlikte gider.
4. Session başında ve resume'da hiçbir şey gönderilmez, çünkü oradaki konuşma notları sabitlediğiniz haliyle zaten tutar.

Claude Code 2.1.283 üzerinde canlı bir session'da ölçüldü: `/compact` sonrasında not modelin context'ine ulaştı. `/clear` sonrasında sabitlenmiş bir not olup olmadığı sorulan model, notu kelimesi kelimesine yazdı ve nota uydu.

## Komut

    /pin-note                  açık ya da kapalı, ve sabitlenmiş notlar, numaralı
    /pin-note on | off         varsayılan kapalı; kapalıyken notlar saklanır, hiçbiri gönderilmez
    /pin-note <not>            bir notu sabitler; metin yazıldığı gibi saklanır, birkaç satır da olabilir
    /pin-note drop <n>         n numaralı notu çıkarır

Mod kapalıyken `/pin-note <not>` ve `drop` reddedilir. Komut kelimeleri yalnız `on`, `off` ve `drop <n>`'dir; bu yüzden ardından tek başına bir sayı gelmeyen bir not `drop` ile başlayabilir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install pin-note@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına şunu ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. `/pin-note on` çalıştırın.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=pin-note}, classic.SessionStart
    ❯ ./register.ts calls: $.command.register, $.session.id, $.store.get, $.store.set (via runCommand, savePins), $.ui.log

Reach L0; ağ yok, dosya yok, süreç yok.

    1. Okur:        sabitlediğiniz notları ve session'ın id'sini
    2. Çalıştırır:  hiçbir şey
    3. Gönderir:    makineden dışarı hiçbir şey; notlar modelin context'ine yazdığınız gibi girer
    4. Saklar:      $.store içinde açık/kapalı ayarını ve her session'ın notlarını
    5. Düşman girdi: bir not sizin kendi metninizdir ve model onu sizin talimatınız olarak okur; başka hiçbir şey okunmaz

## Sınırlar

- Notlar yalnız compaction'da ve `/clear`'da yeniden gönderilir. Context'ten çıkmasını istediğiniz bir not `drop` ile çıkarılmalı ve context compact edilmelidir, çünkü modelin okuduğu bir not konuşmada kalır.
- Her session'ın notları `$.store` içinde id'si altında kalır; eski bir session'ın notlarını hiçbir şey silmez.
- Not sayısı ve uzunluğu için sınır yoktur; her not her compaction sonrasında context'e girer.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, üstünde build başarısız olur
    make typecheck   # /plugin-types çıktısı .claude/types/ gerekir
    make validate
    make test        # claude plugin test
