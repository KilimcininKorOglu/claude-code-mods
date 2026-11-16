# prompt-time

Transcript saat göstermez. Uzun bir session'da geriye kaydırdığınızda bir mesajın ne zaman gönderildiğini ya da modelin onun üzerinde ne kadar çalıştığını göremezsiniz. Bu mod, transcript'te her mesajınızın ve modelin cevaplarındaki her metin bloğunun altına soluk bir satırla saati yazar. Resume edilen bir session'da, transcript dosyası 4 MiB ya da daha küçükse eski mesajların saatleri de gösterilir.

## Ne gösterir

Bugün yazılmış bir mesajda ya da cevap bloğunda yalnız saat gösterilir. Daha eski olanlarda yerel saat dilimine göre tarih de gösterilir:

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

Satır yalnız ekranda gösterilir. Saklanan mesaj değişmez ve modele hiçbir şey gönderilmez. Bu yüzden mod token harcamaz ve prompt cache'i etkilemez.

## Saati nereden alır

- **Sizin mesajınız.** `prompt.submit` saati ve prompt'un metnini kaydeder. Aynı metni taşıyan bir sonraki yeni `UserMessage` satırı bu saati alır. Başka bir hook'un iptal ettiği bir prompt hiçbir zaman çizilmez, bu yüzden saati hiçbir satıra verilmez.
- **Bir cevap bloğu.** Bir turn çalışırken (`turn.start` ile `turn.complete` arasında) ilk kez çizilen yeni bir `AssistantMessage` bloğu, çizildiği andaki saati alır. Canlı bir denemede çizim zamanı ile transcript'in blok için sakladığı timestamp arasındaki fark 0,1 saniyeden azdı.
- **Resume edilen bir session.** Başlangıçta, resume'da ve fork'ta `classic.SessionStart` session'ın transcript'ini okur. Her user ve assistant satırının `uuid` değeri kendi `timestamp` değeriyle eşleştirilir. Engine'in bu satırlar için kullandığı `requestId`, aynı `uuid` değeridir (2.1.277 üzerinde ölçüldü). Okumadan önce çizilmiş satırlar `$.ui.invalidate` ile yeniden çizilir. 4 MiB'ı aşan bir transcript okunmaz, çünkü `$.fs.read` 4 MiB'ı aşan bir dosyayı reddeder ve aralık okuması desteklenmez. Mod boyutu önce `$.fs.stat` ile kontrol eder ve debug log'a bir satır yazar. Bu session'ın eski satırları saatsiz kalır. Bir turn bu satırları yeniden çizdiğinde de (örneğin bir resize bütün satırları yeniden çizer) saat gösterilmez. Yeni mesajlar ise saatlerini normal şekilde alır. Bu session'ın bir turn sırasında ilk kez çizilen eski bir bloğu (örneğin fullscreen'de kaydırınca çizilen bir blok) yine turn'ün saatini alır. Bunun nedeni, bir bloğu kendi turn'üne bağlayan bir prop'un ya da `$.session.messages()` satırının olmamasıdır.

`/clear` bilinen saatleri siler, çünkü temizlenen mesajlar ekrandan kalkar.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-time@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

Modu yerel bir checkout'tan tek bir session için yüklemek için:

    claude --plugin-dir plugins/prompt-time

## Kurulumdan sonra

Claude Code'u yeniden başlatın. Mod transcript'i session başında okur. Bu yüzden kurulum sırasında açık olan bir session'da önceki mesajların altında saat gösterilmez.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: classic.SessionStart, prompt.submit, turn.start, turn.complete, ui.render{component=UserMessage}, ui.render{component=AssistantMessage}
    ❯ ./register.tsx calls: $.clock.now, $.fs.exists (via loadTranscript), $.fs.read (via loadTranscript), $.fs.stat (via loadTranscript), $.ui.invalidate (via loadTranscript), $.ui.log (via loadTranscript), $.ui.resolve (via stamped)

Reach L1: transcript'i okur.

    1. Okur:         session'ın kendi transcript dosyasının boyutunu; dosya 4 MiB ya da daha küçükse başlangıçta, resume'da ve fork'ta dosyayı bir kez, yalnız satırların type, uuid ve timestamp değerlerini; ikisini eşleştirmek için gönderilen her prompt'un ve çizilen her user satırının metnini; saati
    2. Çalıştırır:   hiçbir şey; process, fork ya da timer yoktur
    3. Gönderir:     hiçbir şey; network çağrısı yapmaz ve modele hiçbir şey göndermez
    4. Saklar:       hiçbir şey; saatler bellekte tutulur ve session ile birlikte silinir
    5. Düşman girdi: JSON olmayan bir transcript satırı sayılır ve atlanır; string bir uuid'si ya da parse edilebilir bir timestamp'i olmayan satır atlanır; ekrana yazılan etiket yalnız sayılardan oluşturulur

## Sınırlar

- Transcript'i 4 MiB'ı aşan resume edilmiş bir session'da önceki mesajların altında saat gösterilmez. Transcript satırı timestamp'ini içerir, ancak `$.fs.read` dosyanın tamamını reddeder ve `$.session.messages()` timestamp döndürmez. `~/.claude/projects` altında kontrol edilen transcript'lerin 78'i 4 MiB'ı aşıyordu.
- Session ortasında yüklenen bir mod, ekranda zaten bulunan mesajların altında saat göstermez, çünkü transcript'i yalnız session başında okur.
- Bir user satırı prompt'un saatini metin eşleştirmesiyle alır. Engine yeni bir prompt'u iki kez çizer: önce `placeholder` olarak, ardından saklanan id'siyle. Bu yüzden prompt'un metnini taşıyan her yeni satır, bir sonraki prompt'a kadar bu saati alır. Metni farklı olan bir notification satırı bu saati almaz.
- Bir cevap bloğu saatini, bir turn sırasında ilk kez çizildiğinde alır. Engine bir turn'ün son bloğunu `turn.complete` olayından birkaç milisaniye sonra ilk kez çizebilir (2.1.277 üzerinde görüldü). Bu yüzden metni turn'ün son metniyle aynı olan ilk yeni blok, turn'ün bittiği saati alır. Turn bittikten sonra ilk kez çizilen diğer bloklarda, session resume edilene kadar saat gösterilmez.
- Thinking bloklarında saat gösterilmez. Claude Code 2.1.277'de thinking için bir `ui.render` noktası yoktur. Bu nokta yalnız bir cevabın metin blokları (`AssistantMessage`) için vardır.
- Saat, Claude Code'u çalıştıran bilgisayarın yerel saatidir.
- `claude plugin test` test engine'i `classic.SessionStart` olayını tetikleyemez. Transcript okuması `indexTranscript` unit test'leri ve canlı bir resume denemesiyle test edildi.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
