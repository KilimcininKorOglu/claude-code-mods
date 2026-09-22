# prompt-time

Transcript'te sizin her mesajınızın ve modelin cevaplarının her metin bloğunun altına soluk bir satırda bir saat çizen bir Claude Code Mod'u. Resume edilmiş bir session, transcript dosyası 4 MiB ya da daha küçükse eski mesajlarının saatlerini de gösterir.

## Ne gösterir

Bugünkü bir mesaj ya da cevap bloğu yalnız saati gösterir. Daha eski olanı tarihi de gösterir, yerel time zone'da:

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

Satır yalnız görüntüdür. Saklanan mesaj değişmez ve modele hiçbir şey ulaşmaz, yani mod hiçbir token'a mal olmaz ve prompt cache'e dokunmaz.

## Saati nasıl bilir

- **Sizin mesajınız.** `prompt.submit` saati ve prompt'un metnini kaydeder. Aynı metinli sonraki yeni `UserMessage` satırı o saati alır.
- **Bir cevap bloğu.** Bir tur çalışırken (`turn.start` ile `turn.complete` arasında) ilk kere çizilen yeni bir `AssistantMessage` bloğu o çizimin saatini alır. Canlı bir kontrolde çizim, transcript'in blok için sakladığı timestamp'ten 0,1 saniye içinde geldi.
- **Resume edilmiş bir session.** Başlangıçta, resume'da ve fork'ta `classic.SessionStart` session transcript'ini okur ve her user ve assistant satırının `uuid` değerini `timestamp` değerine eşler. Engine'in bu satırlar için kullandığı `requestId` aynı `uuid` değeridir (2.1.277 üzerinde ölçüldü). Okumadan önce çizilmiş satırlar `$.ui.invalidate` ile yeniden çizilir. 4 MiB üstündeki bir transcript okunmaz, çünkü `$.fs.read` 4 MiB üstündeki bir dosyayı reddeder ve aralıklı okuması yoktur; mod boyutu önce `$.fs.stat` ile kontrol eder ve debug log'a bir satır yazar. O session'ın satırları saat taşımaz, yeni mesajlar saatini her zamanki gibi alır.

`/clear` bilinen saatleri unutur, çünkü temizlenen mesajlar ekrandan gider.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-time@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Tek bir session için yerel bir checkout'tan yükleyin:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/prompt-time

Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

Claude Code'u yeniden başlatın. Mod transcript'i session başlangıcında okur, yani kurulum sırasında açık olan bir session daha önceki mesajlarının altında saat göstermez.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: classic.SessionStart, prompt.submit, turn.start, turn.complete, ui.render{component=UserMessage}, ui.render{component=AssistantMessage}
    ❯ ./register.tsx calls: $.clock.now, $.fs.exists (via loadTranscript), $.fs.read (via loadTranscript), $.fs.stat (via loadTranscript), $.ui.invalidate (via loadTranscript), $.ui.log (via loadTranscript), $.ui.resolve (via stamped)

Reach L1, transcript'i okur.

    1. Okur:     session'ın kendi transcript dosyasının boyutunu, sonra 4 MiB ya da daha küçükse dosyayı başlangıçta, resume'da ve fork'ta bir kere, ve yalnız satırlarının type, uuid ve timestamp değerlerini; gönderilen her prompt'un ve çizilen her user satırının metnini, ikisini eşlemek için; saati
    2. Çalıştırır: hiçbir şey; process yok, fork yok, timer yok
    3. Gönderir: hiçbir şey; network çağrısı yok ve modele hiçbir şey gitmez
    4. Saklar:   hiçbir şey; saatler bellekte yaşar ve session ile biter
    5. Düşman girdi: JSON olmayan bir transcript satırı sayılır ve atlanır, string uuid'si ya da parse edilebilir timestamp'i olmayan bir satır atlanır; çizilen etiket yalnız sayılardan kurulur

## Sınırlar

- Transcript'i 4 MiB üstünde olan resume edilmiş bir session, daha önceki mesajlarının altında saat göstermez. Bir transcript satırı timestamp'ini taşır, ama `$.fs.read` bütün dosyayı reddeder ve `$.session.messages()` timestamp cevaplamaz. `~/.claude/projects` içinde kontrol edilen transcript'lerin 78 tanesi 4 MiB üstündeydi.
- Session ortasında yüklenen bir mod, ekranda zaten olan mesajların altında saat göstermez, çünkü transcript'i yalnız session başlangıcında okur.
- Bir user satırı prompt'un saatini metin eşleştirerek alır. Engine yeni bir prompt'u iki kere çizer, önce `placeholder` olarak ve sonra saklanan id'si altında, bu yüzden prompt'un metnini taşıyan her yeni satır sonraki prompt'a kadar saati alır. Farklı metinli bir notification satırı almaz.
- Bir cevap bloğu saatini bir tur sırasında ilk çizildiğinde alır. Engine bir turun son bloğunu ilk kere `turn.complete` olayından birkaç milisaniye sonra çizebilir (2.1.277 üzerinde görüldü), bu yüzden metni turun son metnine eşit olan ilk yeni blok, turun bittiği saati alır. Turu bittikten sonra ilk kere çizilen diğer her blok, session resume edilene kadar saat göstermez.
- Bir thinking bloğu saat göstermez. Claude Code 2.1.277'de thinking için bir `ui.render` yeri yoktur, yalnız bir cevabın metin blokları için vardır (`AssistantMessage`).
- Saat, Claude Code'u çalıştıran makinenin yerel saatidir.
- `claude plugin test` test engine'i `classic.SessionStart` olayını raise edemez. Transcript okuması `indexTranscript` unit test'leri ve canlı bir resume kontrolü ile kapsanır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
