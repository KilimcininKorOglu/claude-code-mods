# task-poke

Model sekiz adımlık bir task listesi yazar, üçünü bitirir ve turn'ünü bir özetle kapatır; session sen "devam et" yazana kadar boşta bekler. Bu mod bunu senin yerine yapar: bir ana loop turn'ü bittiğinde task listesi hâlâ pending ya da in-progress task taşıyorsa bir devam prompt'u gönderir. Engine'in kendi task listesini session başında okur; yani bugün resume ettiğin bir session'da haftalar önce açılmış bir liste, o task'lar oluşturulurken mod kurulu olsa da olmasa da ilk turn'den sayılır. Arka arkaya 99 poke'tan sonra, `/task-poke limit <n>` ile ayarladığın sınırdan sonra ya da hiçbir şeyi ilerletmeyen üç poke'tan sonra durur. Gönderdiğin bir prompt (composer'dan, bridge'den ya da SDK'dan) sayımı sıfırlar.

İki task formatını da okur:

- `TodoWrite`: her çağrı bütün listenin yerini alır.
- `TaskCreate`, `TaskUpdate` ve `TaskList` (Claude Code 2.1.142'den beri varsayılan): `TaskCreate` bir task ekler ve id tool sonucundan gelir (`{ task: { id } }`). `TaskUpdate` bir task'ı `taskId` ile patch'ler (ham `id` ve `task_id` key'leri de okunur). `status: "deleted"` bir task'ı kaldırır. Bir `TaskList` sonucu bütün listeyi taşır, yani replay'in tuttuğunun yerini alır ve ondan sonraki satırlar üstüne uygulanır.

Sonraki bir `TodoWrite`, Task tool'larından kurulmuş her state'in yerini alır.

## Poke nasıl gönderilir

Poke mod'un kendi markdown komutunu, `/task-poke:send <prompt>` komutunu çalıştırır; bu komutun gövdesi yalnız argümanlarıdır. Transcript o komut satırını gösterir ve model poke'u yazıldığı gibi, yazılmış bir slash komutu gibi okur. Bir `$.prompt.submit` metni ona `The task-poke plugin sent a message:` çerçevesi içinde ulaşırdı. Komut turn bittikten sonra bir timer'dan çalışır, çünkü engine turn'ün beklediği `turn.complete` hook'u içinde `$.command.run` çağrısını reddeder. Engine komutu reddederse kırmızı bir kayıt bunu söyler ve poke o çerçeveyle bir plugin prompt'u olarak gider.

2.1.282 üzerindeki canlı kontrolde iki task'tan birini pending bırakan bir turn `/task-poke:send The task list still has unfinished tasks. ...` olarak üç poke aldı, model her birini yalnız sözle cevapladı ve mod üçüncüden sonra durdu.

## Sayım ve transcript penceresi

`$.session.messages()` uzun bir transcript'in yalnız en yeni mesajlarını cevaplar, yani o pencerenin replay'i ondan önce oluşturulmuş hiçbir task'ı görmez. Mod bu boşluğu iki taraftan kapatır:

1. Session'ın başlangıcında engine'in kendi listesini bir kere okur, `$.tool.call({ tool: 'TaskList' })` ile. Resume edilmiş bir session, `TaskCreate` çağrısı pencerenin çok dışında kalan task'ları geri getirir ve bu okuma onları ilk turn'den sayar. Çağrı konuşmaya hiçbir mesaj taşımaz: bir tool satırı bırakmaz ve model onu hiç görmez (ölçüldü). Başarısız olduğunda, task tool'ları kapalı olduğu için ya da engine reddettiği için, kırmızı bir satır bunu söyler ve transcript tek başına cevaplar.
2. Sonraki her pencere, son okumanın listesi üzerine replay edilir, yani 8000 mesaj önce oluşturulmuş ve o günden beri dokunulmamış bir task sayılı kalır.

Modelin kendisinin çağırdığı bir `TaskList` aynı okunur: sonucu bütün listedir ve replay'in tuttuğunun yerini alır.

## Her modelde task tool'ları

Claude Code task takip tool'larını yalnız Claude 3.x, Opus 4.0 ile 4.7, Sonnet 4.0 ile 4.6 ve Haiku 4.5 üzerinde sunar. Diğer her modelde mod'un sayacak bir şeyi olmaz. Bu yüzden mod `session.start` anında Claude Code process'i için `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` ayarlar ve Claude Code task tool'larını her modelde sunar.

- Mod senin kendin ayarladığın bir değeri değiştirmez. `CLAUDE_CODE_ENABLE_TODO_TOOLS=0` task tool'larını kapalı tutar.
- Mod, `/task-poke off` saklıyken değişkeni ayarlamaz. `/task-poke off` task tool'ları üzerinde sonraki session'dan itibaren geçerli olur.
- Değişken ayrıca session'ın başlattığı her Bash komutuna ve MCP server'a ulaşır.
- `CLAUDE_CODE_ENABLE_TASKS=false` Task tool'larını `TodoWrite` ile değiştirir. Mod iki formatı da okur.

## Ne gösterir

[sidebar](../sidebar) açıkken sayım orada session boyunca duran bir `task list` section'ı olarak durur, her turn'de yeniden yazılır:

    task-poke: task list
    3 unfinished tasks, poke 2/99

Yalnızca `poke N/M` renklidir: son poke'un altında yeşil, onda sarı ve poke'lar durduktan sonra kırmızı; bitmemiş task'lar varsayılan renkte kalır. Bitmemiş hiçbir şey kalmadığında section iner. Bulgular bunun yerine stream'e gider; baştaki ifade kırmızı, `: ` sonrasındaki ayrıntı varsayılan renktedir, böylece sonraki sayım onları pane'den almaz: poke limitinde duruş, hiçbir şeyi ilerletmeyen üç poke sonrası duruş, engine'in düşürdüğü bir poke ve mod'un okuyamadığı bir task listesi.

Sidebar kapalıyken ya da o mod kurulu değilken yalnız poke gönderen bir turn satırını transcript'e yazar ve üç bulgu eskiden olduğu gibi transcript satırıdır.

## Bir poke hiçbir şeyi ilerletmediğinde

Her poke modele bir turn daha verir. O turn hiçbir task'ın status'unu değiştirmediyse ve hiçbir tool çalıştırmadıysa poke hiçbir şeyi ilerletmemiştir: model yalnız sözle cevap vermiştir ve sonraki poke da aynı cevabı alır. Arka arkaya üç böyle poke'tan sonra mod durur ve kırmızı bir entry bunu söyler:

    task-poke: stopped after 3 pokes that moved nothing: no task changed status and no tool ran. Send a prompt to start again.

Sayım, bir şeyi ilerleten ilk turn'de sıfıra döner, yani uzun bir task üzerinde çalışan bir model bunun yüzünden hiç durdurulmaz. Sonraki prompt'un poke'ları yeniden başlatır.

## Ne zaman poke göndermez

- Turn kesildi, reddedildi ya da bir API hatasıyla bitti (`reason` `answer` değil).
- Turn bir subagent'ta çalıştı.
- Son assistant mesajı `AskUserQuestion` çağırdı.
- Son prompt'undan beri poke limiti kadar poke gönderildi. Kırmızı bir entry duruşu bildirir.
- Arka arkaya üç poke hiçbir şeyi ilerletmedi, yukarıdaki gibi.
- Arka planda iş hâlâ çalışıyor: turn'ün `Stop` input'u bir background task ya da agent listeliyor. Model yalnız onu bekler, yani bir poke yalnız sözden oluşan bir turn üretir. Böyle bir turn poke göndermez ve hiçbir şeyi ilerletmeyen üç poke'a sayılmaz. Background iş olmadan biten ilk turn yeniden poke gönderir. Bu kontrolden önce ölçüldü: iki background agent bekleyen bir session arka arkaya üç devam prompt'u aldı ve her birine tek bir cümleyle cevap verdi.
- `/task-poke off` ayarlı.

## Komutlar

    /task-poke          durum
    /task-poke on       açar (varsayılan), session'lar arasında saklanır
    /task-poke off      kapatır, session'lar arasında saklanır
    /task-poke limit 20 arka arkaya en fazla 20 poke; 1 ile 999 arası, varsayılan 99, session'lar arasında saklanır
    /task-poke:send <prompt>  bir poke'un çalıştırdığı komut; yazılırsa prompt'u yazıldığı gibi gönderir

`/task-poke:send` mod'un ikinci komutudur ve mod başına tek komut kuralının istisnasıdır, çünkü model'e plugin çerçevesi olmadan prompt veren tek yol bir markdown komutudur.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install task-poke@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

Yerel bir checkout'tan tek session için yüklemek istersen:

    claude --plugin-dir plugins/task-poke

## Kurulumdan sonra

Claude Code'u yeniden başlat. Mod task tool'larını session başlangıcında açar, yani yukarıdaki listenin dışındaki bir modelde task tool'ları sonraki session'dan gelir.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=task-poke}, prompt.submit, classic.Stop, turn.complete
    ❯ ./register.ts calls: $.clock.after (via sendPoke), $.command.register, $.command.run (via sendPoke), $.env.get, $.env.set, $.prompt.submit (via submitPoke), $.session.messages (via afterTurn), $.sidebar.clear (via clearCount), $.sidebar.set (via toCount, toStream), $.store.get (via readLimit, readSettings), $.store.set, $.tool.call (via seedTasks), $.ui.log (via toCount, toStream)
    ❯ ./register.ts env writes: CLAUDE_CODE_ENABLE_TODO_TOOLS
    ❯ ./register.ts env reads: CLAUDE_CODE_ENABLE_TODO_TOOLS

Reach L2: Claude'u yönlendirir, transcript'i okur ve bir environment variable yazar.

    1. Okur:     transcript'i $.session.messages üzerinden (TodoWrite, TaskCreate, TaskUpdate, TaskList ve AskUserQuestion tool adları, input'ları ve sonuçları); engine'in task listesini session başlangıcında tek bir $.tool.call ile; her prompt'un origin kind'ını, hiçbir zaman metnini değil; her turn'ün Stop input'undaki background task sayısını; CLAUDE_CODE_ENABLE_TODO_TOOLS
    2. Çalıştırır: session başlangıcında ve /task-poke on anında salt okuma bir TaskList çağrısı; bitmemiş task'larla biten her ana loop turn'ü için bir /task-poke:send çalıştırması, arka arkaya en fazla 99 ya da ayarladığın limit kadar ve hiçbir şeyi ilerletmeyen arka arkaya en fazla 3 tane; ayarlı değilken session başına bir kere CLAUDE_CODE_ENABLE_TODO_TOOLS=1 ayarlar
    3. Gönderir: yalnız sabit poke prompt'unu, normal bir turn olarak
    4. Saklar:   $.store içinde bir boolean (enabled) ve poke limitini; environment variable yalnız process boyunca durur
    5. Düşman girdi: transcript'ten hiçbir metin poke prompt'una ulaşmaz; bilinmeyen bir task status'u, task.id taşımayan bir TaskCreate sonucu ya da id taşımayan bir TaskList satırı poke'ları durdurur ve hata değişene kadar bir satır hatayı adlandırır

## Sınırlar

- `$.session.messages()` en yeni 4096 mesajı döndürür. Session başlangıcındaki okuma ve mod'un turn'ler arasında tuttuğu liste, o pencerenin kaybettiğini kapsar.
- Bir `TaskGet` sonucu parse edilmez. State'i `TodoWrite`, `TaskCreate`, `TaskUpdate` ve `TaskList` kurar.
- Mod'un tuttuğu liste session'ın plugin state'inde durur. Bir `/reload-plugins` `session.start` olayını yeniden çalıştırır, yani engine'in listesi de onunla yeniden okunur.
- Yeni bir session boş bir engine listesiyle başlar: Claude Code task'ları resume edilmiş bir session'a taşır, yeni bir session'a değil (ölçüldü).

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
