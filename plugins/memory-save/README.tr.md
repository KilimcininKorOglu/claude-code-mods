# memory-save

Proje başına bir `MEMORY.md` dosyasını, stop'u engellemeden güncel tutan ve session'a yükleyen bir Claude Code Mod'u. Her ana döngü turundan sonra session'ın tool'suz bir fork'una projenin neyi hatırlaması gerektiğini sorar ve cevabı kendisi yazar. Ana konuşma bir memory edit'i hiç görmez: engellenen bir stop yok, `MEMORY.md` üzerinde bir Read ya da Edit yok, fazladan bir tur yok.

## Ne yapar

### Memory'yi yükler

Başlangıçta, resume'da, `/clear` ve compaction'da `classic.SessionStart` hook'u tek bir context bloğu ekler:

    [PROJECT MEMORY: <project>]
    Answer in the language of the user's own messages, in every reply and every progress line, also at the end of a long turn whose context (tool output, docs, this memory) is in another language. Keep technical terms and identifiers as they are.

    <bütün MEMORY.md>

    Topic files in ~/.cli-tweaks/memory/<project>: history.md

Dil satırı orada, çünkü context'i çoğunlukla İngilizce olan uzun turlar başka bir dildeki prompt'lara İngilizce cevaplarla bitiyordu (ölçüldü). Topic satırı yalnız topic dosyaları varken bulunur. `MEMORY.md` olmayan bir proje hiçbir blok almaz. Blok, dosyayı yazma talimatı taşımaz, çünkü dosyayı mod yazar. Memory bu olaylar arasında tekrarlanmaz, yani context'i tur tur büyütmez.

### Memory'yi kaydeder

Bir cevapla ya da bir kesintiyle biten her ana döngü turundan sonra:

1. `~/.cli-tweaks/memory/<project>/MEMORY.md` dosyasını, varsa, okur.
2. `$.model.fork`'a tek bir mesaj gönderir. Fork bütün session transcript'ini görür ve prompt cache'ini paylaşır, ama tool'u yoktur. Mesaj mevcut dosyayı, yazma kurallarını ve cevap biçimini taşır. Yazma kuralları, template ve MIGRATION, OFFLOAD ve BULLET SPLIT notları klasik memory-save Stop hook'unun metinleridir, kelimesi kelimesine; yalnız durdurmaya dair kısımlar dışarıda bırakılır, çünkü fork durdurmaz.
3. Fork JSON ile cevap verir: eklenecek, kaldırılacak ya da değiştirilecek madde'ler ve `history.md` gibi topic dosyalarına eklenecek metin.
4. Mod cevabı uygular, sonucu kontrol eder ve dosyaları yazar.

Kayıt arka planda çalışır. Fork çalışırken sonraki prompt beklemez. Aynı anda bir kayıt çalışır; bir kayıt sırasında biten bir tur, ondan sonra bir kayıt daha ister.

Proje adı, bir git worktree içinde de birincil repository adıdır; yoksa git top level, yoksa çalışma dizinidir.

## Ne gösterir

**Prompt'un altında bir status line**, bir kayıt çalışırken ve sonrasında:

    memory-save: saving… · 14:31
    memory-save: +2 -1 · 14:32
    memory-save: +3 -1 ~3 topic: history · 14:32
    memory-save: no change · 14:32
    memory-save: +2 1 refused · 14:32
    memory-save: error: reply has no JSON object · 14:32

[sidebar](../sidebar) açıkken bu durum oraya gider, session boyunca duran ve her kayıtta yeniden yazılan bir `MEMORY.md` section'ı olarak, ve status line boş kalır. Orada satır renklidir: yazılmış bir kayıt yeşil, bir kısmı atlayan ya da reddeden bir kayıt sarı, bir hata kırmızı, `saving…` ya da `no change` soluk. Sidebar kapalıyken ya da o mod kurulu değilken status line yukarıdaki gibi, engine'in kendi renginde çizilir.

Section, durumun altında ikinci, soluk bir satır taşır: son transcript satırı, başındaki `MEMORY.md:` olmadan. Durum kaydın nerede olduğunu söyler, ikinci satır ne yaptığını:

    MEMORY.md
    topic: history · 14:32
    topic files only; appended to history.md

**Transcript'te bir satır**, bir kayıt bir dosyayı değiştirdiğinde. Bu satır modele gönderilmez:

    memory-save: MEMORY.md: 2 added, 1 removed; appended to history.md

## Dosya biçimi

`MEMORY.md` tam olarak şu section'ları, bu sırada taşır: `## CRITICAL RULES`, `## Architecture & Config Facts`, `## Active Warnings`, `## Topic Files`. Yeni bir dosya bu iskeletten başlar.

Template hiçbir zaman bozulmaz. Her yüklemede (başlangıç, resume, `/clear`, compaction) ve her kayıttan önce, tam olarak bu dört section'ı bu sırada taşımayan bir dosya, fork olmadan mod tarafından template'e konur: section'lar sıraya girer, tekrarlanan bir section tek bir section'da birleşir, eksik bir section `- None yet.` olarak eklenir ve diğer her `## ` section'ı `## Architecture & Config Facts` sonuna bir `### Unsorted: <heading>` satırı altında taşınır. Hiçbir satır düşmez. Sonraki kayıt fork'a, sıralanmamış her maddeyi ait olduğu section'a ya da history'yi bir topic dosyasına taşımasını ve boşaldığında `### Unsorted:` satırını kaldırmasını söyler. Eski dosya yanında `MEMORY.pre-migration.md` olarak tutulur (sonraki bir onarım o kopyayı değiştirir) ve transcript'te bir satır bunu söyler:

    memory-save: MEMORY.md: put into the four sections (old copy: MEMORY.pre-migration.md)

Sonucu template'te olmayan bir kayıt hiçbir zaman yazılmaz.

## Bir yazma öncesinde ne kontrol edilir

- Cevap tek bir JSON object'idir. Parser'ın okuyamadığı bir cevap sonraki tura bırakılır: hiçbir şey yazılmaz, cevap kanıt olarak tutulur ve bir transcript satırı bunu status line olmadan söyler. Başka biçimde bir op ya da topic tek başına reddedilir, cevabın geri kalanı yazılır, status line onu sayar (`+2 1 refused`), transcript satırı adlandırır ve sonraki kayıt fork'a neyi reddettiğini söyler. Tek bir bozuk op artık bütün kaydı kaybetmez.
- Bir `add`, dosyanın zaten taşıdığı bir heading'i adlandırır: dört section'dan biri ya da onun bir `### ` alt başlığı, büyük küçük harf fark etmez. Bir madde o heading'in kendi bloğunun sonuna gider, yani bir section'a yapılan ekleme ilk alt başlığından önce iner. Heading'i dosyada olmayan bir ekleme tek başına reddedilir.
- Kaldırılan ya da değiştirilen bir satır dosyada tam olarak bulunur, ya da yalnız baştaki bir liste işaretiyle tek bir satırdan ayrılır. Fork her girdiyi madde olarak yazar, dosyada düz bir paragraf satırı olarak duranı da. Satırı dosyada olmayan bir remove ya da replace atlanır ve diğer op'lar yazılır: status line onu sayar (`+1 1 skipped`), transcript satırı adlandırır ve sonraki kayıt fork'a böyle bir satırı markup'ı ile birlikte tam kopyalamasını söyler. Yanlış alıntılanmış bir satır (fork birinin etrafına `**` eklemişse mesela) eskiden bütün kaydı durduruyordu.
- Bir topic dosya adı küçük harftir, `.md` ile biter, dizin kısmı taşımaz ve `memory.md` değildir.
- Sonuç dört section'ı sırada, 200 satırdan az ve 50000 karakterden az taşır. Zaten bir sınırda ya da üstünde olan bir dosya (bu kontrollerden önce yazılmış biri mesela) istisnadır: onu iki ölçüde de küçülten bir kayıt yazılır, böylece dosya her kaydın başarısız olması yerine adım adım sınırların altına iner. Bir sınırı aşan bir sonuç da kaybolmaz: eklemeler ve topic append'leri düşer, yalnız kaldırmalar yazılır ve düşen kısım reddedilmiş sayılır. Başlığı ya da dört `## ` section satırından birini alacak bir remove ya da replace tek başına reddedilir, böylece template bozulamaz; bir `### ` alt başlığı yine gidebilir.
- 160 satırdan ya da 42000 karakterden itibaren fork'a bu kaydın kaç satır ve karakter kaldırması gerektiği söylenir. Bir sınırın üstünde not, yalnız küçültme kaydına döner: yeni madde ekleme, yalnız girdileri bir topic dosyasına taşı.
- O not altında çalışan bir kayıt bir `## CRITICAL RULES` maddesini kaldırmaz. Böyle bir remove tek başına reddedilir ve fork'a maddeyi bunun yerine bir replace op ile kısaltması söylenir. 160 satırın ve 42000 karakterin altındaki bir kayıt bir CRITICAL RULES maddesini kaldırabilir, çünkü fork onu orada yalnız konuşma kuralın artık geçerli olmadığını gösterdiğinde kaldırır. Kaldırılan madde `history.md` dosyasına `## Retired CRITICAL RULES` başlığı altında gider, transcript satırı onu adlandırır (`retired from CRITICAL RULES, kept in history.md: ...`) ve status line sarıya döner (`1 rule(s) retired`). Böylece fork'un yanlışlıkla kaldırdığı bir kuralı geri koyabilirsiniz. Bu kontrolden önce ölçülen durum: 160 satırdaki bir projede kullanıcının seçtiği bir kural kayboldu, çünkü offload notu fork'a dışarı taşınacak maddeleri seçtirdi.
- Hiçbir yeni madde 600 karakterden uzun değildir. Maddesi daha uzun olan bir `add` ya da `replace` tek başına reddedilir: diğer op'lar yazılır, status line onu sayar (`+1 1 refused`), transcript satırı adlandırır ve sonraki kayıt fork'a böyle bir maddeyi bölmesini ya da detayını bir topic dosyasına taşımasını söyler.
- Fork çalışırken `MEMORY.md` değişmedi.

Hiçbir şey yazmayan ve status line'da bir hata gösteren iki durum kalır: fork okunacak bir metin vermedi (henüz fork edilecek bir şey yok, status'u ve türüyle bir API hatası, metinsiz bir cevap ya da kesilen bir çağrı) ve fork çalışırken `MEMORY.md` değişti.

Cevabın JSON object'i son `}` işaretinden geriye, adlandırılmış alanlardan oluşan ve parse edilen ilk `{` işaretine kadar okunur. JSON'dan önce bir cümle yazan bir cevap yine okunur, kendi parantezlerini taşıyan bir cümleli olanı da, mesela bir `{ tool: 'Edit' }` matcher'ı.

Bu biçimde bir JSON object'i olmayan bir cevap memory dizinindeki `memory-save.failed-reply.txt` dosyasına yazılır ve bir transcript satırı sebebini ve output token sayısını adlandırır:

    memory-save: MEMORY.md: this turn's reply was not read (reply is not valid JSON (JSON Parse error: Expected '}')); 1840 output tokens, kept in memory-save.failed-reply.txt

Böyle her cevap dosyayı değiştirir, yani dosya sonuncusunu tutar. Cevabın kesilip kesilmediğini ya da bozuk JSON taşıdığını görmek için onu okuyun. Fork cevabının stop reason'ı bir mod'a ulaşmaz, bu yüzden mod ikisini kendisi ayırt edemez.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install memory-save@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Tek bir session için yerel bir checkout'tan yükleyin:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/memory-save

Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Modele `MEMORY.md` dosyasını edit etmesini söyleyen diğer her hook'u, `CLAUDE.md` satırını ya da skill'i kaldırın. Dosyayı mod yazar ve fork çalışırken bir model edit'i o kaydı bir hata ile durdurur.
2. Elinizde olan bir memory dosyasını korumak için onu `~/.cli-tweaks/memory/<project>/MEMORY.md` yoluna kopyalayın. Sonraki yüklemede mod onu dört section'a koyar ve eski kopyayı `MEMORY.pre-migration.md` olarak tutar. Dosyası olmayan bir proje ilk kaydından sonra bir tane alır; dizini mod oluşturur.
3. Claude Code'u yeniden başlatın. Memory başlangıçta, resume'da, `/clear` ve compaction'da yüklenir.

Mod'un komutu yoktur. Kayıtları durdurmak için onu devre dışı bırakın: `claude plugin disable memory-save@kilimcininkoroglu-mods`.

## Nereye uzanır

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, turn.complete
    ❯ ./register.ts calls: $.clock.now (via report), $.env.get (via locate), $.fs.exists (via readFile), $.fs.list (via memoryContext), $.fs.read (via readFile), $.fs.write (via ask, save, templated, writeTopics), $.model.fork (via ask), $.process.run (via git), $.sidebar.clear (via clearReport), $.sidebar.set (via report), $.ui.log (via ask, git, logEvent), $.ui.status (via clearReport, report)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: HOME

Reach L2, dosya yazar, git çalıştırır ve Claude'u sürer.

    1. Okur:     HOME; ~/.cli-tweaks/memory/<project>/ altındaki MEMORY.md, topic dosyalarını ve dizin listesini; fork üzerinden session transcript'ini
    2. Çalıştırır: git rev-parse, session başına iki kere, projeyi adlandırmak için; ana döngü turu başına bir tool'suz $.model.fork
    3. Gönderir: MEMORY.md dosyasını başlangıçta, resume'da, /clear ve compaction'da session context'i olarak; fork mesajını (yazma kuralları ve mevcut MEMORY.md) session'ın kendi API client'ına, session'ın transcript'i üzerine
    4. Saklar:   ~/.cli-tweaks/memory/<project>/ altında MEMORY.md, MEMORY.pre-migration.md, topic dosyalarını ve okunamayan son fork cevabını (memory-save.failed-reply.txt)
    5. Düşman girdi: fork'un cevabı güvenilmez metindir; yalnız belgelenmiş JSON biçimi uygulanır, topic dosya adları kontrol edilir ve sonuç bir yazmadan önce her kontrolü geçmek zorundadır

## Sınırlar

- Fork'un tool'u yoktur. Yalnız transcript'i ve mevcut dosyayı bilir.
- Session ortasında yüklenen bir mod (`/reload-plugins`, bir enable) memory'yi sonraki `/clear`, compaction ya da session'da yükler.
- `claude plugin test` test engine'i `classic.SessionStart` olayını raise edemez. Yükleme, metninin unit test'leri ve canlı bir session kontrolü ile kapsanır.
- Her ana döngü turu bir fork'a mal olur: cache okuması olarak transcript, input olarak mevcut dosya ve kurallar, output olarak cevap.
- Başarısız bir kayıt tekrar denenmez. Sonraki tur yeniden kaydeder.
- Bir fork metinsiz dönebilir: konuşmanın ilk cevabından önce, bir API hatasında ya da bir abort ile kesildiğinde. Status line o zaman sebebi adlandırır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
