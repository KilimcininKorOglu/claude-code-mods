# prompt-time

Transcript saat göstermez: uzun bir session'da geriye kaydırdığında bir mesajın ne zaman gönderildiğini ya da modelin onun üzerinde ne kadar çalıştığını anlayamazsın. Bu mod transcript'te senin her mesajının ve modelin cevaplarındaki her metin bloğunun altına soluk bir satırda saati çizer. Resume edilmiş bir session, transcript dosyası 4 MiB ya da daha küçükse eski mesajlarının saatlerini de gösterir.

## Ne gösterir

Bugün yazılmış bir mesaj ya da cevap bloğu yalnız saati gösterir. Daha eski olanı yerel saat diliminde tarihi de gösterir:

    ❯ Say one word, then run date, then say one more word.
    22:24
    ⏺ Start.
    22:24
    ⏺ Bash(date)
      ⎿  Fri Sep 18 22:24:28 +03 2026
    ⏺ Done.
    22:24

    ❯ Summarize the log.
    17.09.2026 21:58

Satır yalnız görüntüdür. Saklanan mesaj değişmez ve modele hiçbir şey ulaşmaz; yani mod token harcamaz ve prompt cache'e dokunmaz.

## Saati nereden bilir

- **Senin mesajın.** `prompt.submit` saati ve prompt'un metnini kaydeder. Aynı metni taşıyan sonraki yeni `UserMessage` satırı o saati alır. Başka bir hook'un düşürdüğü bir prompt hiç çizilmez, saati de hiçbir satıra geçmez.
- **Bir cevap bloğu.** Bir turn çalışırken (`turn.start` ile `turn.complete` arasında) ilk kez çizilen yeni bir `AssistantMessage` bloğu o çizimin saatini alır. Canlı bir denemede çizim, transcript'in blok için sakladığı timestamp'e 0,1 saniyeden yakındı.
- **Resume edilmiş bir session.** Başlangıçta, resume'da ve fork'ta `classic.SessionStart` session'ın transcript'ini okur ve her user ve assistant satırının `uuid`'sini `timestamp`'ine eşler. Engine'in bu satırlar için kullandığı `requestId` aynı `uuid`'dir (2.1.277 üzerinde ölçüldü). Okumadan önce çizilmiş satırlar `$.ui.invalidate` ile yeniden çizilir. 4 MiB'ı aşan bir transcript okunmaz, çünkü `$.fs.read` 4 MiB'ı aşan bir dosyayı reddeder ve aralık okuması yoktur; mod boyutu önce `$.fs.stat` ile kontrol eder ve debug log'a bir satır yazar. O session'ın satırları saatsiz kalır, bir turn onları yeniden çizdiğinde de (bir resize bütün satırları yeniden çizer); yeni mesajlar ise saatini her zamanki gibi alır. O session'ın bir turn sırasında ilk kez çizilen bir bloğu, fullscreen'de bir kaydırmanın çizdiği gibi, yine turn'ün saatini alır: bir bloğu turn'üne bağlayan hiçbir prop ve hiçbir `$.session.messages()` satırı yoktur.

`/clear` bilinen saatleri unutur, çünkü temizlenen mesajlar ekrandan gider.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-time@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Yerel bir checkout'tan tek session için yüklemek istersen:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/prompt-time

Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

Claude Code'u yeniden başlat. Mod transcript'i session başında okur; yani kurulum sırasında açık olan bir session, önceki mesajlarının altında saat göstermez.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: classic.SessionStart, prompt.submit, turn.start, turn.complete, ui.render{component=UserMessage}, ui.render{component=AssistantMessage}
    ❯ ./register.tsx calls: $.clock.now, $.fs.exists (via loadTranscript), $.fs.read (via loadTranscript), $.fs.stat (via loadTranscript), $.ui.invalidate (via loadTranscript), $.ui.log (via loadTranscript), $.ui.resolve (via stamped)

Reach L1: transcript'i okur.

    1. Okur:     session'ın kendi transcript dosyasının boyutunu, sonra 4 MiB ya da daha küçükse dosyayı başlangıçta, resume'da ve fork'ta bir kere ve yalnız satırlarının type, uuid ve timestamp değerlerini; gönderilen her prompt'un ve çizilen her user satırının metnini, ikisini eşlemek için; saati
    2. Çalıştırır: hiçbir şey; process yok, fork yok, timer yok
    3. Gönderir: hiçbir şey; network çağrısı yok ve modele hiçbir şey gitmez
    4. Saklar:   hiçbir şey; saatler bellekte durur ve session'la birlikte gider
    5. Düşman girdi: JSON olmayan bir transcript satırı sayılır ve atlanır, string uuid'si ya da parse edilebilir timestamp'i olmayan bir satır atlanır; çizilen etiket yalnız sayılardan kurulur

## Sınırlar

- Transcript'i 4 MiB'ı aşan resume edilmiş bir session, önceki mesajlarının altında saat göstermez. Transcript satırı timestamp'ini taşır, ama `$.fs.read` dosyanın tamamını reddeder, `$.session.messages()` da timestamp vermez. `~/.claude/projects`'te bakılan transcript'lerin 78'i 4 MiB'ı aşıyordu.
- Session ortasında yüklenen bir mod, ekranda zaten duran mesajların altında saat göstermez, çünkü transcript'i yalnız session başında okur.
- Bir user satırı prompt'un saatini metin eşleştirerek alır. Engine yeni bir prompt'u iki kez çizer, önce `placeholder` olarak, sonra saklanan id'siyle; bu yüzden prompt'un metnini taşıyan her yeni satır, sonraki prompt'a kadar o saati alır. Metni farklı olan bir notification satırı almaz.
- Bir cevap bloğu saatini bir turn sırasında ilk kez çizildiğinde alır. Engine bir turn'ün son bloğunu `turn.complete`'ten birkaç milisaniye sonra ilk kez çizebilir (2.1.277 üzerinde görüldü); bu yüzden metni turn'ün son metnine eşit olan ilk yeni blok, turn'ün bittiği saati alır. Turn'ü bittikten sonra ilk kez çizilen diğer her blok, session resume edilene kadar saat göstermez.
- Bir thinking bloğu saat göstermez. Claude Code 2.1.277'de thinking için bir `ui.render` yeri yoktur, yalnız bir cevabın metin blokları için vardır (`AssistantMessage`).
- Saat, Claude Code'u çalıştıran makinenin yerel saatidir.
- `claude plugin test`'in test engine'i `classic.SessionStart`'ı tetikleyemez. Transcript okuması `indexTranscript`'in unit test'leri ve canlı bir resume denemesiyle sınandı.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
