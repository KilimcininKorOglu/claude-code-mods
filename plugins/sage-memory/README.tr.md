# sage-memory

Proje ve global kayıtları paylaşılan yerel bir daemon üzerinden SQLite'ta tutar, modele dosya tool çağrılarına, prompt'lara ve subagent görevlerine uyan kayıtları verir, her ana loop turn'ünden sonra yeni kayıtları bir haiku consolidator ile kaydeder.

[memory-save](../memory-save) ile yan yana çalışır: memory-save oturum başında `MEMORY.md`'nin tamamını verir, sage-memory bir kaydı ilgili olduğu anda verir. Context'in zaten gösterdiği bir kayıt (`MEMORY.md`, `CLAUDE.md`, bir tool sonucu) tekrar verilmez.

## Ne yapar

1. **Her oturum için tek daemon.** Oturum başında mod Node'u kontrol eder (22.18 ya da üstü, yerleşik TypeScript ve `node:sqlite` ile), sonra `node daemon/launch.ts` çalıştırır. Launcher `daemon/server.ts`'i ayrık başlatır ya da çalışanı bulur. Daemon bir Unix socket'i dinler, yalnız rastgele token'ını taşıyan isteğe cevap verir ve son isteğinden beş dakika sonra kapanır.
2. **İki depo.** `~/.claude/sage-memory/global.db` `user` kayıtlarını tutar. `~/.claude/sage-memory/<proje>/sage.db` bir deponun `project`, `session`, `file` ve `symbol` kayıtlarını tutar; linked worktree'ler aynı dosyayı kullanır. Ad `<depo>-<git common dir'in 8 hex'i>` biçimindedir.
3. **Memory reminder'lar.** Bir reminder, modelin kayıtlı proje hafızası olarak okuduğu `<memory>` girdilerinden oluşan bir bloktur. System prompt'taki bir not bloğu tanıtır:
   - her dosya tool'unun sonucunda (Read, Grep, Glob, LSP, Edit, Write, NotebookEdit ve dosya adı taşıyan MCP tool'ları), o çağrının dokunduğu yollara bağlı ve devam eden görevlerle ilgili kayıtlar; context doldukça daha az (%65'in altında 8, %82'ye kadar 3, %95'e kadar 1, üstünde hiç). Model bunları o sonucun hemen ardından okur. Bir dosyanın iki kaydı (örneğin fonksiyon başına bir kayıt) ikisi de gider; paralel çağrıların ikisinin de bulduğu tek bir kayıt bunlardan biriyle gider;
   - yazdığınız bir prompt'la, ona uyan en fazla 8 kayıt;
   - bir subagent'a, görevinin önünde: onun tipi ya da permission mode'u için yazılmış kayıtlar, sonra göreviyle ilgili kayıtlar.

   memory-save'in `MEMORY.md`'yi gönderdiği gibi her başlangıçta giden bir kayıt yoktur: her kayıt yalnız ilgili olduğunda gider. Her kayıt bir context'te bir kez gider. Compaction yeni bir context başlatır, kayıt yeniden gidebilir. Hatırlatılan bir kaydı kullanan cevap bir kullanım sayılır.
4. **Öğrenme.** Prompt'unuz ya da bir tool çağrısı olan her ana loop turn'ünden sonra bir consolidator (varsayılan haiku) cevabı, turn'ün okuduğu ve yazdığı dosyaları, son 10 Bash komutunu ve tamamlanan görevleri okur ve saklanmaya değeri İngilizce ekler. Dosya yazan bir turn'den sonra bir curator o dosyaların kayıtlarını gözden geçirir: supersede, merge, recalibrate, çelişki işareti ya da archive. Permanent bir kayıt asla supersede, contradict ya da archive edilmez.
5. **Doğrulama.** Bir edit, değişen dosyaya bağlı kayıtları yeniden kontrol eder (yol, content hash, symbol, komut, agent, git blob); anchor'ı tutmayan kayıt stale olur. Bir `mv`, `git mv` ya da `Move-Item` taşıma diskte gerçekleşince anchor'ları dosyayla taşır. Oturum sonunda daemon hygiene'i arka planda, depo başına saatte en fazla bir kez çalıştırır: doğrulama, kopyalar, çelişkiler, inceleme önerileri ve transcript'i silinmiş oturumların session kayıtlarının silinmesi.
6. **Arama.** Her zaman tam metin arama (FTS5). `/sage-memory setup`'tan sonra ayrıca çok dilli bir embedding modeli (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`), offline; böylece bir soru başka dildeki bir kaydı bulabilir. Yalnız bu kanaldan gelen bir sonuç 0.46 cosine ister; bunun altında kalan bir yeniden ifade tam metin aramasına ve anchor'lara kalır (ölçüldü: `deploy.sh betiği nerede` sorusu `Deploys go through the deploy.sh script...` kaydını 0.55 ile buldu, `Uygulamayı sunucuya nasıl gönderiyoruz?` 0.46'nın altında kaldı).

## Sidebar

[sidebar](../sidebar) açıkken mod orada bir `memory` bölümü tutar; bölümdeki `manage` butonu pane'i açar:

    sage-memory: memory
    daemon ready · my-app · embeddings off · /sage-memory setup
    this session: reminded 4 · used 1 · added 2
    [ manage ]

Altındaki akış her reminder'ı (soluk), her eklenen kaydı (yeşil), her kontrolü ve her hatayı (kırmızı) gösterir. Sidebar kapalıyken ilk satır status line'a, akış satırları transcript'e gider.

## Pane

`/sage-memory pane` ya da `manage` butonu bellek yöneticisini açar, tekrar çalıştırmak kapatır. Bir arama alanı, bir scope filtresi ve bir status filtresi vardır, kayıtlar 30'luk sayfalarla listelenir (`next`, `previous`). Bir satırda Enter kaydı butonlarıyla gösterir: `mark stale`, `make active`, `archive`, `permanent`, `delete` (ikinci basış ister) ve silinmiş bir kayıt için `recover`. `candidates` bekleyen önerileri listeler: yeni bir kaydı accept ya da reject edin, bir incelemeyi `delete`, `archive` ya da `keep` ile çözün.

## Komut

    /sage-memory                          durum
    /sage-memory on | off                 modu her pencerede açar ya da kapatır
    /sage-memory setup                    embedding runtime'ını ve modelini kurar, her kaydı embed eder
    /sage-memory pane                     bellek yöneticisi
    /sage-memory show <id> | search <sorgu> | file <yol> | graph <id|sorgu> | audit [n] | stats
    /sage-memory remember [flag'ler] <metin>  bir kayıt yazar; `--scope session` bu oturuma aittir
    /sage-memory update <id> [flag'ler] [metin]
    /sage-memory delete <id> | forget <sorgu> | recover <id>
    /sage-memory audience remember --role <tip> <metin> | clear <id> | transfer <eski> <yeni>
    /sage-memory hygiene | verify [id] | candidates [list|accept|reject|resolve]
    /sage-memory triage [apply]           bütün kayıtların incelemesi; `apply` olmadan kuru çalışır
    /sage-memory compact [apply]          kısaltma ve birleştirme önerisi; `apply` yazar
    /sage-memory import <yol> [--section <başlık>] [--kind <kind>] [--scope project|user]
    /sage-memory model [ad]               consolidator, curator, triage ve compact'ın modeli (haiku)
    /sage-memory remind tools|prompt|subagent [on|off]
    /sage-memory consolidate|curate [on|off]
    /sage-memory daily [on|off]           günde bir triage kuru çalışması, bir başlangıçtan bir saat sonra (kapalı)
    /sage-memory capture outcomes|errors [on|off]   Bash sonuçlarını kaydeder (kapalı)

Flag'ler: `--kind --scope --status --persistence --policy --tag --anchor --directory --symbol path#Name --command --agent --role --mode --importance --confidence --freshness --supersedes --contradicts`.

`import` bir markdown dosyasının ya da bir başlığın altındaki bölümün her maddesini, kaynağı o dosya olan sıradan bir kayıt olarak yazar. Başka bir dosyada tutulan notları bir kez depoya taşır; içe alınan kayıtlar sonra diğerleri gibi ilgiye göre hatırlatılır.

## Modelin çağırabildiği tool'lar

On beş tool, `mcp__sage-memory__<ad>`: `remember`, `search`, `search_explain`, `for_file`, `for_path`, `graph`, `gather`, `update`, `delete`, `forget`, `recover`, `backfill_recoverable`, `verify`, `hygiene`, `candidates`. `remember` ve `search` hemen listelenir, diğerleri ToolSearch arkasında bekler. Hiçbiri onay sormaz: her biri yalnız modun kendi depolarına yazar. Bir session kaydı onu yazan oturuma aittir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sage-memory@kilimcininkoroglu-mods

Function hooks erken erişimdedir. Flag olmadan hiçbir şey yüklenmez. Açık tutmak için `~/.claude/settings.json`'a şunu ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurduktan sonra

1. Claude Code'u yeniden başlatın.
2. `PATH`'te `node` olarak Node.js 22.18 ya da üstü bulunsun. Daha eski bir Node `daemon failed: needs Node.js 22.18 or later ...` gösterir ve mod başka bir şey yapmaz.
3. İsteğe bağlı: embedding araması için `/sage-memory setup`'ı bir kez çalıştırın. `@huggingface/transformers` 4.3.0'ı `~/.claude/sage-memory/runtime` altına `npm install` ile kurar ve modeli indirir: diskte toplam 615 MB, bunun 145 MB'ı model (ölçüldü). Model yüklüyken daemon 648 MB resident bellek tuttu (ölçüldü). Kurulmadan arama yalnız tam metindir.
4. İsteğe bağlı: her zaman görünmesini istediğiniz kuralları içe alın (Komut bölümüne bakın).
5. Bütün kayıtları silmek için hiçbir oturum çalışmıyorken `~/.claude/sage-memory`'yi silin.

## Nereye uzanır

Claude Code 2.1.283'te `claude plugin validate` ile doğrulandı (validator `calls:` satırını kendisi kısaltıyor):

    ❯ ./register.tsx hooks: session.start, tool.describe{tool=/"^mcp__sage-memory__"/}, tool.check{tool=/"^mcp__sage-memory__"/}, tool.call{tool=/"^mcp__sage-memory__"/}, prompt.section{name=env_info_simple}, classic.SessionStart, session.compact, prompt.context, prompt.attachment, classic.PostToolBatch, tool.call{tool=/"^(Read|Grep|Glob|LSP|Edit|Write|NotebookEdit|MultiEdit|mcp__(?!sage-memory__).+)$"/}, prompt.submit, agent.spawn, turn.complete, tool.call{tool=/"^(Edit|Write|NotebookEdit|MultiEdit)$"/}, tool.call{tool=Bash}, session.end, command.run{command=sage-memory}, ui.render{component=Pane}, ui.close, turn.start
    ❯ ./register.tsx calls: $.clock.after (via scheduleDaily, within), $.clock.every (via pollSetup), $.clock.now (via captureOutcome, consolidate, dailyRun, fileProposals, scheduleDaily, triageReport), $.command.register, $.env.get (via layoutFor), $.fs.read (via importCommand, launch), $.http.fetch (via ask), $.model.complete (via answerOf, consolidate, curate, proposeCompact), $.process.run (via checkNode, git, launch), $.session.cwd, $.session.id (via afterCall, ask, beforePrompt, captureOutcome, consolidate, countUse, curate, forSubagent, importCommand, newContext, record, remapMoved, rememberCommand, serveTool, verifyChanged), $.session.usage (via budgetOf), $.sidebar.set (via toPerson, toStream), $.store.get (via afterCall, beforePrompt, captureOutcome, consolidate, curate, dailyRun, forSubagent, jobModel, onByDefault, readEnabled, scheduleDaily, toggle), $.store.set (via dailyRun, modelCommand, onByDefault, setEnabled, toggle), $.tool.call (via completedOf, readTasks), $.tool.registe… [+224 chars]

Reach L3: uzun yaşayan yerel bir süreç başlatır, turn'leri bir modele gönderir, `/sage-memory setup`'ta paket ve model indirir.

    1. Reads:    oturumun cevapları, prompt'ları, subagent görevleri ve dosya tool çağrıları; bir kaydın bağlı olduğu dosyalar; içe aldığınız markdown dosyası; biten oturumları bulmak için transcript dizini
    2. Runs:     node (sürüm kontrolü, launcher, daemon), git rev-parse ve git hash-object, setup'ta npm install; hepsi argv ile, shell yok
    3. Sends:    consolidate edilen her turn'ü, curate edilen dosya kümesini, triage ve compact isteklerini seçtiğiniz modele (varsayılan haiku); setup'ta npm registry'ye ve Hugging Face'e istekler; daemon yalnız ~/.claude/sage-memory içindeki bir Unix socket'i dinler
    4. Persists: kayıtlar, grafları, audit log ve reminder defteri ~/.claude/sage-memory altında SQLite'ta; ayarlar modun $.store'unda
    5. Hostile input: bir kayıt, bir modelin ya da tool'un yazdığı metindir ve escape edilmiş bir <memory> fence'i içinde geri verilir; secret'a benzeyen bir metin yazılırken reddedilir; bir kayıt yalnız her isteğin token'ını kontrol eden daemon üzerinden değişir

## Ölçümler

**Tool reminder'ın yeri.** Claude Code 2.1.283'te (Sonnet 5), kayıt bir `/clear`'dan önce yazılmış ve prompt reminder kapalıyken, her biçim için 10 çalışma: bütün tool batch'inden sonra eklendiğinde model kaydı 4 kez şüpheli talimat ya da prompt injection saydı; dosya tool'unun kendi sonucuna bağlandığında 1 kez. Kaydın bilgisini iki biçimde de aynı sıklıkta kullandı (kaydın doğru olduğu senaryoda 5'te 4). 0.2.0 sürümü reminder'ı sonuca taşıdı.

Claude Code 2.1.283, macOS, Node 24.18 üzerinde: socket üzerinden bir daemon isteği 3 ile 9 ms sürdü (`/status` 7.0 ms, `/memory/remember` 9.3 ms, `/remind/prompt` 2.9 ile 3.7 ms, `/remind/tools` 3.5 ms); setup kurulumdan sonra 24 kaydı 19 s'de embed etti. Art arda çalışan bütün probe oturumlarına tek daemon hizmet verdi. Consolidator'ın turn başına token maliyeti ölçülmedi.

## Sınırlar

- Yalnız macOS ve Linux: daemon bir Unix socket kullanır ve yaklaşık 100 byte'ı aşan bir socket yolu modu durdurur.
- Anchor'sız ve varsayılan puanlı bir kayıt nadiren hatırlatılır: reminder kapısı 0.65 puan ister.
- Embedding olmadan bir dildeki soru başka dildeki kaydı yalnız ortak terimlerle bulur.
- Claude Code'un LSP tool'unda rename yoktur; yeniden adlandırılan bir symbol anchor'ını taşımaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript, @types/node
    make lint        # complexity sınırı 10, üstünde build'i durdurur
    make typecheck   # hooks ve daemon; /plugin-types'ın .claude/types/'ı gerekir
    make validate
    make test        # claude plugin test, sonra daemon için node --test
