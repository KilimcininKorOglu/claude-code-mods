# memory-save

Memory'yi bir Stop hook'u tutarsa hook turn'ün bitmesini engeller. Model `MEMORY.md` dosyasını sizin önünüzde Read ve Edit ile değiştirir ve bu her seferinde fazladan bir turn gerektirir. Bu mod, her proje için bir `MEMORY.md` dosyasını turn'ün bitmesini engellemeden güncel tutar ve session'a yükler. Mod, her ana loop turn'ünden sonra session'ın tool'suz bir fork'una projenin neyi hatırlaması gerektiğini sorar ve cevabı kendisi yazar. Ana konuşma hiçbir zaman bir memory düzenlemesi görmez: engellenen bir turn sonu, `MEMORY.md` üzerinde bir Read ya da Edit ve fazladan bir turn olmaz.

## Ne yapar

### Memory'yi yükler

Session başında, resume sırasında, `/clear` ve compaction'da `classic.SessionStart` hook'u tek bir context bloğu ekler:

    [PROJECT MEMORY: <project>]
    Answer in the language of the user's own messages, in every reply and every progress line, also at the end of a long turn whose context (tool output, docs, this memory) is in another language. Keep technical terms and identifiers as they are.

    <bütün MEMORY.md>

    Topic files in ~/.cli-tweaks/memory/<project>: history.md

Dil satırı bloğa eklenir, çünkü context'i çoğunlukla İngilizce olan uzun turn'ler, başka bir dildeki prompt'lara İngilizce cevaplarla bitiyordu (ölçüldü). Topic satırı yalnız topic dosyaları varsa yazılır. `MEMORY.md` dosyası olmayan bir proje hiçbir blok almaz. Blok, dosyanın yazılması için bir talimat içermez, çünkü dosyayı mod yazar. Memory bu olaylar arasında tekrarlanmaz. Bu yüzden context her turn'de büyümez.

### Memory'yi kaydeder

Bir cevapla ya da bir kesintiyle biten ve fork'a okuyacak yeni bir şey veren her ana loop turn'ünden sonra (sonraki bölüme bakın):

1. Mod `~/.cli-tweaks/memory/<project>/MEMORY.md` dosyasını, varsa, okur.
2. Mod `$.model.fork`'a tek bir mesaj gönderir. Fork bütün session transcript'ini görür ve aynı prompt cache'i kullanır, ancak tool'u yoktur. Mesaj mevcut dosyayı, yazma kurallarını ve cevap biçimini içerir. Yazma kuralları, template ve MIGRATION, OFFLOAD ve BULLET SPLIT notları, klasik memory-save Stop hook'unun metinleriyle kelimesi kelimesine aynıdır. Yalnız turn'ü durdurmakla ilgili kısımlar çıkarılır, çünkü fork turn'ü durdurmaz. OFFLOAD notunda bir cümle fazladır: bu cümle fork'tan bir `## CRITICAL RULES` maddesini dosyanın dışına taşımamasını ister.
3. Fork JSON ile cevap verir: eklenecek, kaldırılacak ya da değiştirilecek maddeler ve `history.md` gibi topic dosyalarına eklenecek metin.
4. Mod cevabı uygular, sonucu kontrol eder ve dosyaları yazar.

Kayıt arka planda çalışır. Fork çalışırken bir sonraki prompt bekletilmez. Aynı anda yalnız bir kayıt çalışır. Bir kayıt sürerken biten bir turn, bu kayıttan sonra bir kayıt daha ister.

### Yeni bir şey olmayan turn'ü atlar

Son kayıttan sonra bir prompt gönderdiyseniz ya da turn'de bir ana loop tool'u çalıştıysa turn kaydedilir. Bir plugin prompt'unun (örneğin bir `task-poke` devam prompt'unun) ya da bir arka plan işinin bildiriminin başlattığı ve modelin yalnız sözle cevap verdiği bir turn kaydedilmez ve hiçbir şey göstermez. Bir subagent'ın tool'ları sayılmaz, çünkü ana loop yalnız beklerken bir arka plan agent'ı çalışmaya devam eder. Hiçbir şey kaybolmaz: fork bütün konuşmayı okur. Bu yüzden bir sonraki kayıt atlanan turn'ü de görür. Bu kuralın kapsamadığı tek durum, böyle bir turn'den hemen sonra kapanan bir session'dır.

Bu kontrol eklenmeden önce ölçüldü: iki arka plan agent'ını bekleyen bir session art arda üç devam prompt'u aldı ve her birine tek bir cümleyle cevap verdi. Her biri için bir kayıt çalıştı. Bu kayıtlardan biri MEMORY.md dosyasından beş maddeyi dışarı taşıdı.

Proje adı, bir git worktree içinde de birincil repository'nin adıdır. Bu yoksa git top level dizinidir, o da yoksa çalışma dizinidir.

## Ne gösterir

**Prompt'un altında bir status line.** Status line bir kayıt çalışırken ve kayıttan sonra gösterilir:

    memory-save: saving… · 14:31
    memory-save: +2 -1 · 14:32
    memory-save: +3 -1 ~3 topic: history · 14:32
    memory-save: no change · 14:32
    memory-save: +2 1 refused · 14:32
    memory-save: error: reply has no JSON object · 14:32

[sidebar](../sidebar) açıkken bu durum sidebar'a yazılır: session boyunca kalan ve her kayıtta yeniden yazılan bir `MEMORY.md` section'ı. Bu sırada status line boş kalır. Section'da satırın her kısmı ayrı renklidir: bir kaydın yazdığı kısım (`+2 -1 ~3 topic: …`) yeşil, her `N skipped`, `N refused` ve `N rule(s) retired` sarı, `error:` kısmı kırmızı ve mesaj varsayılan renkte, `saving…` ve `no change` soluk, saat de soluk renktedir. Sidebar kapalıysa ya da yüklü değilse status line yukarıdaki gibi, engine'in kendi renginde çizilir.

Section, durum satırının altında soluk renkte ikinci bir satır içerir: son transcript satırı, baştaki `MEMORY.md:` olmadan. Durum satırı kaydın hangi aşamada olduğunu, ikinci satır ise kaydın ne yaptığını gösterir:

    MEMORY.md
    topic: history · 14:32
    topic files only; appended to history.md

**Transcript'te bir satır.** Bir kayıt bir dosyayı değiştirdiğinde transcript'e bir satır yazılır. Bu satır modele gönderilmez:

    memory-save: MEMORY.md: 2 added, 1 removed; appended to history.md

## Dosya biçimi

`MEMORY.md` dosyası tam olarak şu section'ları, bu sırayla içerir: `## CRITICAL RULES`, `## Architecture & Config Facts`, `## Active Warnings`, `## Topic Files`. Yeni bir dosya bu iskeletle başlar.

Template hiçbir zaman bozulmaz. Her yüklemede (session başı, resume, `/clear`, compaction) ve her kayıttan önce, bu dört section'ı tam olarak bu sırayla içermeyen bir dosya, fork kullanılmadan, mod tarafından template'e yerleştirilir: section'lar sıraya konur, tekrarlanan bir section tek bir section'da birleştirilir, eksik bir section `- None yet.` olarak eklenir ve diğer her `## ` section'ı, `## Architecture & Config Facts` section'ının sonuna bir `### Unsorted: <heading>` satırı altında taşınır. Hiçbir satır silinmez. Sonraki kayıt, fork'tan sıralanmamış her maddeyi ait olduğu section'a ya da geçmişle ilgili bilgileri bir topic dosyasına taşımasını ister. Ayrıca `### Unsorted:` satırını, altı boşaldığında kaldırmasını ister. Eski dosya yanında `MEMORY.pre-migration.md` olarak saklanır (sonraki bir onarım bu kopyanın üzerine yazar). Transcript'te bir satır bunu bildirir:

    memory-save: MEMORY.md: put into the four sections (old copy: MEMORY.pre-migration.md)

Sonucu template'e uymayan bir kayıt hiçbir zaman yazılmaz.

## Yazmadan önce ne kontrol edilir

- Cevap tek bir JSON object'idir. Parser'ın okuyamadığı bir cevap bir sonraki turn'e bırakılır: hiçbir şey yazılmaz, cevap kanıt olarak saklanır ve bir transcript satırı bunu bildirir, status line değişmez. Başka biçimdeki bir op ya da topic tek başına reddedilir ve cevabın geri kalanı yazılır. Status line reddedilenleri sayar (`+2 1 refused`), transcript satırı onları adlandırır ve sonraki kayıt fork'a neyin reddedildiğini bildirir. Böylece tek bir bozuk op artık bütün kaydı kaybettirmez.
- Bir `add` op'u, dosyada zaten bulunan bir başlığı belirtir: dört section'dan biri ya da onun bir `### ` alt başlığı, büyük/küçük harf fark etmez. Madde, o başlığın kendi bloğunun sonuna eklenir. Bu yüzden bir section'a yapılan ekleme, section'ın ilk alt başlığından önce yer alır. Başlığı dosyada olmayan bir ekleme tek başına reddedilir.
- Kaldırılan ya da değiştirilen bir satır dosyada tam olarak bulunur ya da tek bir satırdan yalnız baştaki bir liste işaretiyle farklıdır. Fork her girdiyi bir madde olarak yazar, dosyada düz bir paragraf satırı olarak duran girdiyi de. Satırı dosyada olmayan bir remove ya da replace atlanır ve diğer op'lar yazılır. Status line atlananları sayar (`+1 1 skipped`), transcript satırı onları adlandırır ve sonraki kayıt fork'tan böyle bir satırı markup'ıyla birlikte tam olarak kopyalamasını ister. Daha önce yanlış alıntılanmış bir satır (örneğin fork bir satırın çevresine `**` eklemişse) bütün kaydı durduruyordu.
- Bir topic dosyasının adı küçük harflidir, `.md` ile biter, dizin kısmı içermez ve `memory.md` değildir.
- Sonuç dört section'ı sırayla içerir, 200 satırdan ve 50000 karakterden azdır. Zaten bir sınırda ya da sınırın üstünde olan bir dosya (örneğin bu kontroller eklenmeden önce yazılmış bir dosya) bu kuralın istisnasıdır: dosyayı iki ölçüde de küçülten bir kayıt yazılır. Böylece her kayıt başarısız olmak yerine dosya adım adım sınırların altına iner. Bir sınırı aşan bir sonuç da kaybolmaz: eklemeler ve topic append'leri çıkarılır, yalnız kaldırmalar yazılır ve çıkarılan kısım reddedilmiş sayılır. Başlığı ya da dört `## ` section satırından birini kaldıracak bir remove ya da replace tek başına reddedilir. Böylece template bozulamaz. Bir `### ` alt başlığı ise kaldırılabilir.
- Dosya 160 satıra ya da 42000 karaktere ulaştığında fork'a bu kaydın kaç satır ve karakter kaldırması gerektiği bildirilir. Bir sınırın üstünde not, kaydı yalnız küçültmeye yönelik bir kayda çevirir: yeni madde eklenmez, girdiler yalnız bir topic dosyasına taşınır.
- Bu not altında çalışan bir kayıt bir `## CRITICAL RULES` maddesini kaldırmaz. Böyle bir remove tek başına reddedilir ve fork'tan maddeyi bunun yerine bir replace op'u ile kısaltması istenir. 160 satırın ve 42000 karakterin altındaki bir kayıt bir CRITICAL RULES maddesini kaldırabilir, çünkü fork bu durumda maddeyi yalnız konuşma kuralın artık geçerli olmadığını gösterdiğinde kaldırır. Kaldırılan madde `history.md` dosyasına `## Retired CRITICAL RULES` başlığı altında yazılır. Transcript satırı maddeyi adlandırır (`retired from CRITICAL RULES, kept in history.md: ...`) ve status line sarıya döner (`1 rule(s) retired`). Böylece fork'un yanlışlıkla kaldırdığı bir kuralı geri koyabilirsiniz. Bu kontrol eklenmeden önce ölçüldü: 160 satırlık bir projede kullanıcının seçtiği bir kural kayboldu, çünkü OFFLOAD notu fork'a dışarı taşınacak maddeleri seçtirdi.
- Hiçbir yeni madde 600 karakterden uzun değildir. Maddesi daha uzun olan bir `add` ya da `replace` tek başına reddedilir: diğer op'lar yazılır, status line reddedileni sayar (`+1 1 refused`), transcript satırı onu adlandırır ve sonraki kayıt fork'tan böyle bir maddeyi bölmesini ya da ayrıntısını bir topic dosyasına taşımasını ister.
- Fork çalışırken `MEMORY.md` değişmedi.

Hiçbir şey yazmayan ve status line'da bir hata gösteren iki durum kalır: fork okunacak bir metin döndürmedi (henüz fork edilecek bir şey yok, status ve türüyle bir API hatası, metin içermeyen bir cevap ya da kesilen bir çağrı) ya da fork çalışırken `MEMORY.md` değişti.

Cevaptaki JSON object'i, son `}` işaretinden geriye doğru, adlandırılmış alanlardan oluşan bir object açan ve parse edilebilen ilk `{` işaretine kadar okunur. JSON'dan önce bir cümle yazan bir cevap da okunur. Cümlesi kendi süslü parantezlerini içeren bir cevap da okunur, örneğin bir `{ tool: 'Edit' }` matcher'ı.

Bu biçimde bir JSON object'i içermeyen bir cevap, memory dizinindeki `memory-save.failed-reply.txt` dosyasına yazılır. Bir transcript satırı nedeni ve output token sayısını bildirir:

    memory-save: MEMORY.md: this turn's reply was not read (reply is not valid JSON (JSON Parse error: Expected '}')); 1840 output tokens, kept in memory-save.failed-reply.txt

Böyle her cevap dosyanın üzerine yazılır. Bu yüzden dosya her zaman son cevabı içerir. Cevabın kesilip kesilmediğini ya da bozuk JSON içerip içermediğini görmek için dosyayı okuyun. Fork cevabının stop reason değeri moda ulaşmaz. Bu yüzden mod bu iki durumu kendisi ayırt edemez.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install memory-save@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

Modu yerel bir checkout'tan tek bir session için yüklemek için:

    claude --plugin-dir plugins/memory-save

## Kurulumdan sonra

1. Modelden `MEMORY.md` dosyasını düzenlemesini isteyen diğer bütün hook'ları, `CLAUDE.md` satırlarını ve skill'leri kaldırın. Dosyayı mod yazar. Fork çalışırken modelin yaptığı bir düzenleme, o kaydın bir hatayla durmasına neden olur.
2. Mevcut bir memory dosyanızı korumak için dosyayı `~/.cli-tweaks/memory/<project>/MEMORY.md` path'ine kopyalayın. Bir sonraki yüklemede mod dosyayı dört section'a yerleştirir ve eski kopyayı `MEMORY.pre-migration.md` olarak saklar. Dosyası olmayan bir proje, ilk kayıttan sonra bir dosya alır. Dizini mod oluşturur.
3. Claude Code'u yeniden başlatın. Memory session başında, resume sırasında, `/clear` ve compaction'da yüklenir.

Modun bir komutu yoktur. Kayıtları durdurmak için modu devre dışı bırakın: `claude plugin disable memory-save@kilimcininkoroglu-mods`.

## Nelere erişir

Claude Code 2.1.288 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, prompt.submit, tool.call, turn.complete
    ❯ ./register.ts calls: $.clock.after, $.clock.now (via report), $.env.get (via locate), $.fs.exists (via readFile), $.fs.list (via memoryContext), $.fs.read (via readFile), $.fs.write (via ask, save, templated, writeTopics), $.model.fork (via ask), $.process.run (via git), $.sidebar.clear (via clearReport), $.sidebar.set (via report), $.ui.log (via ask, git, logEvent), $.ui.status (via clearReport, report)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: HOME

Reach L2: dosya yazar, git çalıştırır ve Claude'u yönlendirir.

    1. Okur:         HOME; ~/.cli-tweaks/memory/<project>/ altındaki MEMORY.md'yi, topic dosyalarını ve dizin listesini; fork ile session transcript'ini; her prompt'un kaynağını ve bir ana loop tool'unun çalışıp çalışmadığını (prompt metnini ve tool input'unu hiçbir zaman okumaz)
    2. Çalıştırır:   projeyi adlandırmak için her session'da iki kez git rev-parse; her ana loop turn'ü için tool'suz bir $.model.fork
    3. Gönderir:     MEMORY.md dosyasını session başında, resume sırasında, /clear ve compaction'da session context'i olarak; fork mesajını (yazma kuralları ve mevcut MEMORY.md) session'ın transcript'inin üstüne, session'ın kendi API client'ına
    4. Saklar:       ~/.cli-tweaks/memory/<project>/ altında MEMORY.md, MEMORY.pre-migration.md, topic dosyalarını ve okunamayan son fork cevabını (memory-save.failed-reply.txt)
    5. Düşman girdi: fork'un cevabı güvenilmez bir metindir; yalnız belgelenmiş JSON biçimi uygulanır, topic dosyalarının adları kontrol edilir ve sonuç yazılmadan önce her kontrolden geçmek zorundadır

## Sınırlar

- Fork'un tool'u yoktur. Fork yalnız transcript'i ve mevcut dosyayı bilir.
- Session ortasında yüklenen bir mod (`/reload-plugins`, bir enable) memory'yi bir sonraki `/clear`, compaction ya da session'da yükler.
- `claude plugin test` test engine'i `classic.SessionStart` olayını tetikleyemez. Yükleme, metninin unit testleri ve canlı bir session kontrolü ile test edilir.
- Her ana loop turn'ü bir fork gerektirir: transcript cache read olarak, mevcut dosya ve kurallar input olarak, cevap output olarak sayılır.
- Başarısız bir kayıt yeniden denenmez. Bir sonraki turn yeniden kaydeder.
- Bir fork metin olmadan dönebilir: konuşmanın ilk cevabından önce, bir API hatasında ya da bir abort ile kesildiğinde. Bu durumda status line nedeni bildirir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
