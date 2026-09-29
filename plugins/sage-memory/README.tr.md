# sage-memory

Her başlangıçta bütünüyle yüklenen bir memory dosyası context'i dolduracak kadar büyür; düzenlediğin dosyayla ilgili tek not da onun ortasında bir yerde durur. Bu mod proje ve global kayıtları paylaşılan yerel bir daemon üzerinden SQLite'ta tutar, modele dosya tool çağrılarına, prompt'lara ve subagent görevlerine uyan kayıtları verir ve her ana loop turn'ünden sonra yeni kayıtları bir haiku consolidator ile kaydeder.

[memory-save](../memory-save) ile yan yana çalışır: memory-save session başında `MEMORY.md`'nin tamamını verir, sage-memory ise bir kaydı ilgili olduğu anda verir. Context'in zaten gösterdiği bir kayıt (`MEMORY.md`, `CLAUDE.md`, bir tool sonucu) yeniden verilmez.

## Ne yapar

1. **Bütün session'lar için tek daemon.** Session başında mod Node'u kontrol eder (22.18 ya da üstü, yerleşik TypeScript ve `node:sqlite` ile), sonra `node daemon/launch.ts`'i çalıştırır. Launcher `daemon/server.ts`'i ayrık başlatır ya da çalışanı bulur. Daemon bir Unix socket'i dinler, yalnız rastgele token'ını taşıyan isteğe cevap verir ve son isteğinden beş dakika sonra kapanır.
2. **İki depo.** `~/.claude/sage-memory/global.db` `user` kayıtlarını tutar. `~/.claude/sage-memory/<proje>/sage.db` bir repository'nin `project`, `session`, `file` ve `symbol` kayıtlarını tutar; linked worktree'ler aynı dosyayı paylaşır. Ad `<repository>-<git common dir'in 8 hex'i>` biçimindedir.
3. **Memory reminder'lar.** Bir reminder, modelin kayıtlı proje hafızası olarak okuduğu `<memory>` girdilerinden oluşan bir bloktur; system prompt'taki bir not bu bloğu tanıtır. Her girdi id'sini, kind'ını, scope'unu ve status'unu taşır; varsa önceliğini (importance 0.9'da `critical`, 0.75'te `high`), `permanent` persistence'ı, ilk anchor'ını (`about`) ve ilk üç tag'ini de taşır:
   - her dosya tool'unun sonucunda (Read, Grep, Glob, LSP, Edit, Write, NotebookEdit ve dosya adı taşıyan MCP tool'ları): o çağrının dokunduğu path'lere ya da onların üstündeki bir dizine (her seviye, `src` dahil) bağlı ve devam eden görevlerle ilgili kayıtlar; context doldukça daha azı (%65'in altında 8, %82'ye kadar 3, %95'e kadar 1, üstünde hiç). Model bunları o sonucun hemen ardından okur. Bir dosyanın iki kaydı (örneğin fonksiyon başına bir kayıt) ikisi de gider; paralel çağrıların ikisinin de bulduğu tek bir kayıt bunlardan biriyle gider;
   - yazdığın bir prompt'la birlikte, ona uyan en fazla 8 kayıt;
   - bir subagent'a, görevinin önünde: onun tipi ya da permission mode'u için yazılmış kayıtlar, sonra göreviyle ilgili kayıtlar.

   Bir `user` kaydı global bir kuraldır, bu yüzden ilgili olmayı beklemez: bütün aktif `user` kayıtları bir context'in ilk prompt'uyla, prompt ne sorarsa sorsun, sayı ve boyut sınırı olmadan gider; her subagent'ın görevinin önüne de konur. Compaction context'i yeniden başlatır, bu yüzden kayıtlar sonraki prompt'la ya da compaction turn'ün ortasında geldiyse ilk dosya tool'uyla yeniden gider. Tek bir audience için yazılmış ya da `never` policy'si verilmiş bir `user` kaydı kendi yolundan gider. Bir `project` kaydı yalnız ilgili olduğunda gider. Her kayıt bir context'te bir kez gider. Compaction yeni bir context başlatır, kayıt o zaman yeniden gidebilir. Hatırlatılan bir kaydı kullanan cevap bir kullanım sayılır. Global kurallar hiçbir kaydın hatırlatma sayısına eklenmez, çünkü context ne sorarsa sorsun giderler. Kullanımı sayılmamış bir hatırlatma hiçbir kaydın sırasını düşürmez ve inceleme açmaz, çünkü kullanım sayısı bir alt sınırdır (Sidebar bölümüne bak).
4. **Öğrenme.** Prompt'un ya da bir tool çağrısı olan her ana loop turn'ünden sonra bir consolidator (varsayılan haiku) son consolidation'dan beri yazdıklarını (son 3 prompt'un), cevabı, turn'ün okuduğu ve yazdığı dosyaları, son 10 Bash komutunu ve tamamlanan görevleri okur, saklamaya değer olanı İngilizce ekler: bir karar ve gerekçesi, bir hatanın nedeni, bir sınır, açık kalan bir eksik, kalıcı bir tercih ya da yapılması gereken bir adım. Önce her adayı etiketler ve yalnız keep diye işaretlediklerini yazar; bu yüzden turn'ün yaptığı işin raporu, bir plan, bir durum satırı ya da kodun zaten gösterdiği bir bilgi kaydedilmez. SAGE'den farklı olarak her cevabın session özetini yazmaz: triage'ın gürültü olarak bulduğu kayıtların çoğu bu özetlerdi. Dosya yazan bir turn'den sonra bir curator o dosyaların kayıtlarını turn'ün değiştirdiklerine göre gözden geçirir: değeri değişen bir kaydı yeniden yazar (15'ten 20'ye çıkan bir sınır gibi), turn'ün yanlış hâle getirdiği ya da gösterilen başka bir kaydın çeliştiği kaydı siler, birleştirir ya da böler ve puanları yeniden ayarlar. Permanent bir kayıt hiçbir zaman yeniden yazılmaz ya da silinmez.
5. **Düzeltme.** Yanlış bir kayıt tutulmaz, silinir: artık doğru olmayan bir kayıt sonraki her session'ı yanıltmaya devam eder. System prompt notu modele, yanlış bulduğu bir kaydı hemen düzeltmesini söyler: güncel bilgiyi biliyorsa `update` ile, bilmiyorsa `delete` ile. Her düzeltme stream'de bir satırdır. Silinen bir kayıt `recover` ile geri alınabilir.
6. **Doğrulama.** Bir edit, değişen dosyaya bağlı kayıtları yeniden kontrol eder (path, content hash, symbol, komut, agent, git blob); anchor'ı artık tutmayan kayıt stale olur. Bir `mv`, `git mv` ya da `Move-Item` taşıma diskte gerçekleşince anchor'ları dosyayla birlikte taşır. Session sonunda daemon hygiene'i arka planda, depo başına saatte en fazla bir kez çalıştırır: doğrulama, kopyalar, çelişkiler, inceleme önerileri ve transcript'i silinmiş session'ların session kayıtlarının silinmesi.
7. **Arama.** Tam metin arama (FTS5) her zaman vardır. `/sage-memory setup`'tan sonra ayrıca çok dilli bir embedding modeli (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`) offline çalışır; böylece bir soru başka dildeki bir kaydı bulabilir. Yalnız bu kanaldan gelen bir sonuç 0.46 cosine ister; bunun altında kalan bir yeniden ifade tam metin aramasına ve anchor'lara kalır (ölçüldü: `deploy.sh betiği nerede` sorusu `Deploys go through the deploy.sh script...` kaydını 0.55 ile buldu, `Uygulamayı sunucuya nasıl gönderiyoruz?` 0.46'nın altında kaldı).

## Sidebar

[sidebar](../sidebar) açıkken mod orada tek bir `memory` section'ı tutar; section'daki `manage` tuşu pane'i açar:

    sage-memory: memory
    daemon ready · my-app
    embeddings off · /sage-memory setup
    this project: 2031 active · global: 12 active
    this session: reminded 4 · used 1 · added 2
    [ manage ]

İlk satır daemon'un cevap verdiğini söyler ve projeyi adlandırır; ikinci satır embeddings modelini adlandırır, model başarısız olduysa sarıdır. Model kurulu ama henüz yüklenmemişse satırda `embeddings available` yazar: daemon modeli ilk aramada ya da ilk yazımda yükler, sonraki çizim model adını gösterir. Üçüncü satır bu projenin deposundaki ve global depodaki aktif kayıtları sayar; section her çizildiğinde sayılar daemon'dan okunur. Etkileşimli bir session 60 sn'de bir embeddings durumunu ve sayıları yeniden okur ve section'ı yeniden çizer; böylece başka bir pencerenin yüklediği model ve başka bir session'ın ya da projenin kaydettiği kayıt, bu session boştayken de görünür. Bu okuma bir istektir, bu yüzden etkileşimli bir session açık kaldıkça daemon kapanmaz. Global depo `user` kayıtlarını tutar ve bu kayıtlar her projede hatırlatılır; proje sayısı yeşil, global sayı mavidir. Dördüncü satır bu session'ın yaptıklarını sayar: hatırlatılan kayıtlar, kullanılanlar ve modelin ya da consolidator'ın ekledikleri. Her sayı kendi renginde çizilir: reminded mavi, used sarı, added yeşil. Hatırlatılan bir kayıt bir kez kullanılmış sayılır: cevap id'sini anarsa; veya sonraki başarılı bir tool çağrısı anchor'ına dokunursa: dosyasının ya da dizinindeki bir dosyanın edit'i, ya da anchor'daki komutu (4 karakter veya daha uzun) içeren bir Bash komutu. Cevabın bir kayıtla paylaştığı kelimeler sayılmaz: bu kelimeler ikisinin yazıldığı dile bağlıdır ve bir kaydın yanlış olduğunu söyleyen cevap da onları paylaşır. Okuma sayılmaz, çünkü kayıtları getiren zaten dosyanın okunmasıdır. Sayı bir alt sınırdır: modelin id'sini anmadan ya da anchor'ına dokunmadan uyduğu bir kayıt sayılmaz.

Altındaki stream her reminder'ı soluk gösterir; yalnız `reminded` kelimesi mavidir. Bir kayıttaki her değişiklik de bir satırdır; değişikliği model, consolidator, curator ya da bir kontrol yapmış olabilir. Satırda yalnız ne olduğunu söyleyen kelime renklidir: eklenen yeşil, değişen sarı (güncellenen, birleştirilen, stale olan, taşınan), silinen kırmızı. Bir hata kırmızı bir satırdır. Sidebar kapalıyken ilk satır status line'a, stream satırları transcript'e gider.

## Pane

`/sage-memory pane` ya da `manage` tuşu memory yöneticisini açar, ikinci kez çalıştırmak kapatır. Bir arama alanı, bir scope filtresi ve bir status filtresi vardır; kayıtlar 30'luk sayfalarla listelenir (`next`, `previous`). Bir satırda Enter kaydı tuşlarıyla gösterir: `mark stale`, `make active`, `archive`, `permanent`, `delete` (ikinci basış ister) ve silinmiş bir kayıt için `recover`. `candidates` bekleyen önerileri listeler: yeni bir kaydı accept ya da reject edersin, bir incelemeyi `delete`, `archive` ya da `keep` ile çözersin.

## Komut

    /sage-memory                          durum
    /sage-memory on | off                 mod'u her pencerede açar ya da kapatır
    /sage-memory setup                    embedding runtime'ını ve modelini kurar, her kaydı embed eder
    /sage-memory pane                     memory yöneticisi
    /sage-memory show <id> | search <sorgu> | file <yol> | graph <id|sorgu> | audit [n] | stats
    /sage-memory remember [flag'ler] <metin>  bir kayıt yazar; `--scope session` bu session'a aittir
    /sage-memory update <id> [flag'ler] [metin]  `--scope project|user` kaydı o depoya taşır
    /sage-memory delete <id> | forget <sorgu> | recover <id>
    /sage-memory audience remember --role <tip> <metin> | clear <id> | transfer <eski> <yeni>
    /sage-memory hygiene | verify [id] | candidates [list|accept|reject|resolve]
    /sage-memory triage [apply]           bütün kayıtların her değişikliği listeleyen incelemesi; `apply` olmadan kuru çalışır
    /sage-memory compact [apply]          kısaltma ve birleştirme önerisi; `apply` yazar
    /sage-memory import <yol> [--section <başlık>] [--kind <kind>] [--scope project|user] [--policy auto|never] [--tag <tag'ler>] [--importance <n>] [--confidence <n>]
    /sage-memory model [ad]               consolidator, curator, triage ve compact'ın modeli (haiku)
    /sage-memory remind tools|prompt|subagent [on|off]
    /sage-memory consolidate|curate [on|off]
    /sage-memory daily [on|off]           günde bir hygiene ve uygulanan bir triage, bir başlangıçtan bir saat sonra (açık)
    /sage-memory capture outcomes|errors [on|off]   Bash sonuçlarını kaydeder (kapalı)

Flag'ler: `--kind --scope --status --persistence --policy --tag --anchor --directory --symbol path#Name --command --agent --role --mode --importance --confidence --freshness --supersedes --contradicts`.

`triage` her kaydı kurallara, bir değer puanına ve modelin verdiği bir puana göre ayırır, sonra `apply`'ın yazacağı her şeyi listeler: gerekçesiyle her silme, her birleştirme, her puan değişikliği ve importance'ı 0.9 ya da üstü olan bir kayıt için bir inceleme; böyle bir kaydı hiçbir zaman silmez. Modelin 1 ya da 2 verdiği kayıt ve kuralların ya da puanın bulduğu döküntü (bir `wip:` notu, süresi dolmuş bir kayıt) silinir. SAGE bir cevabın kullandığı her kaydı da tutuyordu; bu kural kalktı, çünkü bir kaydın yanlış olduğunu söylemek için onu anan cevap da bir kullanım sayılıyor.

`import` bir markdown dosyasının ya da bir başlığın altındaki bölümün her maddesini, kaynağı o dosya olan sıradan bir kayıt olarak yazar. Başka bir dosyada tutulan notları bir kez depoya taşır; içe alınan kayıtlar sonra diğerleri gibi ilgiye göre hatırlatılır. Başlığında "retired" geçen bir bölüm alt bölümleriyle birlikte atlanır. İçe alınan bir kayıt importance 0.8 ve confidence 0.9 ile başlar, çünkü elle tutulmuş bir kuraldır: `remember`'ın varsayılanlarıyla (0.6 ve 0.75) bir sorunun andığı içe alınmış not, prompt reminder eşiğinin hemen altında kaldı. Rapor daemon'un her maddeyle ne yaptığını sayar (eklendi, zaten vardı, near-duplicate'e katıldı, reddedildi) ve her katılmayı adıyla yazar, çünkü katılma iki metinden birini tutar. Bu repository'nin 13 memory-save dosyasında ölçüldü: 2093 madde 2000 kayıt oldu; 0 red, 11 zaten vardı, 82 katılma. Katılmaların neredeyse hepsi iki kez yazılmış aynı bilgiydi.

## memory-save'den import

`import` tek dosya alır ve session'ın başlatıldığı projenin deposuna yazar. Bir memory-save dizininin tamamını taşımak için projenin kök dizininde `claude` aç ve aşağıdaki prompt'u yapıştır. Prompt, modelin slash komutu çalıştırmasını sağlayan `self-command` mod'unu ister. Model her turn'de bir import çalıştırır; her import'un çıktısı sonraki prompt olarak döner, böylece zincir son dosyaya kadar sen dokunmadan ilerler. Aynı prompt her projede değişmeden çalışır.

    sage-memory'ye bu projenin eski memory-save dosyalarını import et. Dizin: ~/.cli-tweaks/memory/<git root dizininin adı>/. Önce MEMORY.md, sonra dizindeki diğer bütün .md dosyaları, alfabetik sırayla. MEMORY.pre-migration.md, " 2.md" ile biten dosyaları ve .txt dosyalarını atla. Her dosya için mcp__self-command__run ile `sage-memory` komutunu `import "<tam path>"` argümanıyla çalıştır. Bir turn'de yalnız bir komut çalıştır ve turn'ü bitir. Çıktı sonraki prompt olarak geldiğinde bir sonraki dosyaya geç. Dizin yoksa ya da boşsa bunu söyle ve dur. Sonunda her dosyanın added, exact ve near sayılarını bir tablo olarak ver.

Her dosya bir turn sürer; 20 topic dosyalı bir proje 20 turn alır. Dizin adı `claude`'u açtığın dizinden değil, git root'tan gelir. Bir memory-save dizininin adı repository'sinin adından farklıysa model dizinin olmadığını söyler ve durur; o durumda path'i prompt'a kendin yaz.

## Modelin çağırabildiği tool'lar

On beş tool, `mcp__sage-memory__<ad>`: `remember`, `search`, `search_explain`, `for_file`, `for_path`, `graph`, `gather`, `update`, `delete`, `forget`, `recover`, `backfill_recoverable`, `verify`, `hygiene`, `candidates`. `remember`, `search`, `for_file`, `update` ve `delete` hemen listelenir, diğerleri ToolSearch arkasında bekler. System prompt'taki plugin notu modele şunları söyler: daha fazlasına `search` ve `for_file` ile baksın, yanlış bir notu `update` ya da `delete` ile düzeltsin, kalıcı bir kuralı, kararı, uyarıyı ya da kök nedeni turn'ün bitmesini beklemeden `remember` ile hemen kaydetsin: repository ile ilgili bir bilgiyi `project` scope ve bir anchor ile, her projede geçerli bir tercihi `user` scope ile ve anchor olmadan. Not ayrıca scope'u kuralın gerekçesine göre seçmesini söyler, senin ne kadar sert söylediğine göre değil. `scope` verilen `update` bir project kaydını aynı id ile user deposuna taşır ya da geri getirir; ayrıldığı depoda kopya kalmaz. `user`'a taşıma path anchor'larını düşürür; anchor'suz kalan bir `file_note` ya da `symbol_note` aynı çağrıda başka bir kind ister. Session kaydı taşınmaz. Şemasında olmayan bir alan taşıyan tool çağrısı, tool'un alanlarının listesiyle reddedilir; böylece yanlış bir çağrı başarılı görünmez. Hiçbiri onay sormaz: her biri yalnız mod'un kendi depolarına yazar. Bir session kaydı onu yazan session'a aittir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sage-memory@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. `PATH`'te `node` olarak Node.js 22.18 ya da üstü bulunsun. Daha eski bir Node `daemon failed: needs Node.js 22.18 or later ...` gösterir ve mod başka hiçbir şey yapmaz.
3. İsteğe bağlı: embedding araması için `/sage-memory setup`'ı bir kez çalıştır. `@huggingface/transformers` 4.3.0'ı `~/.claude/sage-memory/runtime` altına `npm install` ile kurar ve modeli indirir: diskte toplam 615 MB, bunun 145 MB'ı model (ölçüldü). Model yüklüyken daemon 648 MB resident bellek tuttu (ölçüldü). Kurulmazsa arama yalnız tam metindir.
4. İsteğe bağlı: bir markdown dosyasındaki notları `/sage-memory import` ile içe al (Komut bölümüne bak).
5. Bütün kayıtları silmek için hiçbir session çalışmıyorken `~/.claude/sage-memory`'yi sil.

## Nereye uzanır

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı (validator `calls:` satırını kendisi kısaltıyor):

    ❯ ./register.tsx hooks: session.start, tool.describe{tool=/"^mcp__sage-memory__"/}, tool.check{tool=/"^mcp__sage-memory__"/}, tool.call{tool=/"^mcp__sage-memory__"/}, prompt.section{name=env_info_simple}, classic.SessionStart, session.compact, prompt.context, prompt.attachment, classic.PostToolBatch, tool.call{tool=/"^(Read|Grep|Glob|LSP|Edit|Write|NotebookEdit|MultiEdit|mcp__(?!sage-memory__).+)$"/}, prompt.submit, agent.spawn, turn.complete, tool.call{tool=/"^(Edit|Write|NotebookEdit|MultiEdit)$"/}, tool.call{tool=Bash}, session.end, command.run{command=sage-memory}, ui.render{component=Pane}, ui.close, turn.start
    ❯ ./register.tsx calls: $.clock.after (via scheduleDaily, within), $.clock.every, $.clock.now (via captureOutcome, dailyRun, fileProposals, scheduleDaily, triageReport), $.command.register, $.env.get (via layoutFor), $.fs.read (via importCommand, launch), $.http.fetch (via send), $.model.complete (via answerOf, consolidate, curate, proposeCompact), $.process.run (via checkNode, git, launch), $.session.cwd, $.session.id (via afterCall, beforePrompt, captureOutcome, consolidate, countUse, curate, forSubagent, importCommand, newContext, record, remapMoved, rememberCommand, send, serveTool, verifyChanged), $.session.usage (via budgetOf), $.sidebar.set (via toPerson, toStream), $.store.get (via afterCall, beforePrompt, captureOutcome, consolidate, curate, dailyRun, forSubagent, isDailyOn, jobModel, onByDefault, readEnabled, scheduleDaily, toggle), $.store.set (via dailyRun, modelCommand, onByDefault, setEnabled, toggle), $.tool.call (via taskList), $.tool.register (via declareTools), $.ui.clo… [+194 chars]
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: CLAUDE_CONFIG_DIR, HOME

Reach L3: uzun yaşayan yerel bir process başlatır, turn'leri bir modele gönderir, `/sage-memory setup`'ta paket ve model indirir.

    1. Okur:     session'ın cevaplarını, prompt'larını, subagent görevlerini ve dosya tool çağrılarını; bir kaydın bağlı olduğu dosyaları; içe aldığın markdown dosyasını; biten session'ları bulmak için transcript dizinini
    2. Çalıştırır: node (sürüm kontrolü, launcher, daemon), git rev-parse ve git hash-object, setup'ta npm install; hepsi argv ile, shell yok
    3. Gönderir: consolidate edilen her turn'ü, curate edilen dosya kümesini, triage ve compact isteklerini seçtiğin modele (varsayılan haiku); setup'ta npm registry'ye ve Hugging Face'e istekler; daemon yalnız ~/.claude/sage-memory içindeki bir Unix socket'i dinler
    4. Saklar:   kayıtları, graflarını, audit log'u ve reminder defterini ~/.claude/sage-memory altında SQLite'ta; ayarları mod'un $.store'unda
    5. Düşman girdi: bir kayıt, bir modelin ya da tool'un yazdığı metindir ve escape edilmiş bir <memory> fence'i içinde geri verilir; secret'a benzeyen bir metin yazılırken reddedilir; bir kayıt yalnız her isteğin token'ını kontrol eden daemon üzerinden değişir

## Ölçümler

**Tool reminder'ın yeri.** Claude Code 2.1.283'te (Sonnet 5), kayıt bir `/clear`'dan önce yazılmış ve prompt reminder kapalıyken, her biçim için 10 çalıştırma: bütün tool batch'inden sonra eklendiğinde model kaydı 4 kez şüpheli bir talimat ya da prompt injection saydı; dosya tool'unun kendi sonucuna bağlandığında 1 kez. Kaydın bilgisini iki biçimde de aynı sıklıkta kullandı (kaydın doğru olduğu senaryoda 5'te 4). 0.2.0 sürümü reminder'ı sonuca taşıdı.

Claude Code 2.1.283, macOS, Node 24.18 üzerinde: socket üzerinden bir daemon isteği 3 ile 9 ms sürdü (`/status` 7.0 ms, `/memory/remember` 9.3 ms, `/remind/prompt` 2.9 ile 3.7 ms, `/remind/tools` 3.5 ms); setup kurulumdan sonra 24 kaydı 19 s'de embed etti. Art arda çalışan bütün probe session'larına tek bir daemon hizmet verdi.

**Consolidator neyi saklıyor.** Gerçek session'lardan etiketlenmiş 17 turn, her biri haiku'ya 10 kez gönderildi: SAGE'in prompt'uyla kalıcı bilgi taşımayan 7 turn'ün (turn'ün yaptığı işin raporu, bir plan, bir durum satırı) her çalıştırması en az bir kayıt yazdı (70 çalıştırmanın 0'ı temiz), kalıcı bir bilgi taşıyan 10 turn'ün 100 çalıştırmasının 99'u o bilgiyi sakladı. 0.2.1'in aday etiketleriyle 70 çalıştırmanın 62'si temiz kaldı, 100 çalıştırmanın 97'si bilgiyi sakladı. Bir consolidation ortalama 2.482 girdi ve 438 çıktı token'ı harcadı; haiku fiyatıyla yaklaşık $0,005. Bu turn'lerden ikisinde, bir iş raporunda ve bir planda, Opus 5.5 SAGE'in prompt'uyla 10 çalıştırmanın 10'unda hiçbir şey yazmadı; bir çağrı $0,005 ile $0,012 arası tuttu.

## Sınırlar

- Yalnız macOS ve Linux: daemon bir Unix socket kullanır ve yaklaşık 100 byte'ı aşan bir socket path'i mod'u durdurur.
- Anchor'sız ve varsayılan puanlı bir kayıt nadiren hatırlatılır: reminder kapısı 0.65 puan ister.
- Embedding olmadan bir dildeki soru başka dildeki bir kaydı yalnız ortak terimlerle bulur.
- Claude Code'un LSP tool'unda rename yoktur; yeniden adlandırılan bir symbol anchor'ını taşımaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript, @types/node
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # hooks ve daemon; /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test, sonra daemon için node --test
