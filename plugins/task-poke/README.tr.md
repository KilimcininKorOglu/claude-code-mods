# task-poke

Model sekiz adımlık bir task listesi yazar, üç adımı bitirir ve turn'ünü bir özetle kapatır. Ardından session, siz "devam et" yazana kadar boşta bekler. Bu mod bu işi sizin yerinize yapar. Bir ana loop turn'ü bittiğinde task listesinde hâlâ pending ya da in-progress task varsa bir devam prompt'u gönderilir. Mod, engine'in kendi task listesini session başında okur. Bu yüzden bugün resume ettiğiniz bir session'da haftalar önce açılmış bir liste, task'lar oluşturulurken mod yüklü olsun ya da olmasın, ilk turn'den itibaren sayılır. Mod, art arda 99 poke'tan sonra, `/task-poke limit <n>` ile ayarladığınız sınırdan sonra ya da hiçbir şeyi ilerletmeyen üç poke'tan sonra durur. Sizin gönderdiğiniz bir prompt (composer'dan, bridge'den ya da SDK'dan) sayacı sıfırlar.

Mod iki task formatını da okur:

- `TodoWrite`: her çağrı listenin tamamının yerine geçer.
- `TaskCreate`, `TaskUpdate` ve `TaskList` (Claude Code 2.1.142'den beri varsayılan): `TaskCreate` bir task ekler ve id tool sonucundan alınır (`{ task: { id } }`). `TaskUpdate` bir task'ı `taskId` ile günceller (`id` ve `task_id` key'leri de okunur). `status: "deleted"` bir task'ı kaldırır. Bir `TaskList` sonucu listenin tamamını içerir. Bu yüzden replay'in tuttuğu listenin yerine geçer ve ondan sonraki satırlar bu listenin üstüne uygulanır.

Sonraki bir `TodoWrite` çağrısı, Task tool'larından oluşturulan her durumun yerine geçer.

## Poke nasıl gönderilir

Poke, modun kendi markdown komutunu çalıştırır: `/task-poke:send <prompt>`. Bu komutun gövdesi yalnız argümanlarından oluşur. Transcript bu komut satırını gösterir. Model poke'u, elle yazılmış bir slash komutunu okuduğu gibi, yazıldığı hâliyle okur. Bir `$.prompt.submit` metni ise modele `The task-poke plugin sent a message:` çerçevesi içinde ulaşırdı. Komut, turn bittikten sonra bir timer'dan çalışır, çünkü engine turn'ün beklediği `turn.complete` hook'u içindeki bir `$.command.run` çağrısını reddeder. Engine komutu reddederse bunu kırmızı bir kayıt bildirir ve poke bu çerçeveyle, plugin prompt'u olarak gönderilir.

2.1.282 üzerindeki canlı denemede iki task'tan birini pending bırakan bir turn, `/task-poke:send The task list still has unfinished tasks. ...` biçiminde üç poke aldı. Model her birine yalnız sözle cevap verdi ve mod üçüncü poke'tan sonra durdu.

## Sayım ve transcript penceresi

`$.session.messages()`, uzun bir transcript'in yalnız en yeni mesajlarını döndürür. Bu yüzden bu pencerenin replay'i, pencereden önce oluşturulmuş hiçbir task'ı görmez. Mod bu boşluğu iki yoldan kapatır:

1. Session başında engine'in kendi listesini `$.tool.call({ tool: 'TaskList' })` ile bir kez okur. Resume edilen bir session, `TaskCreate` çağrısı pencerenin çok dışında kalan task'ları da geri getirir. Bu okuma o task'ları ilk turn'den itibaren sayar. Çağrı konuşmaya hiçbir mesaj eklemez: bir tool satırı bırakmaz ve model onu hiçbir zaman görmez (ölçüldü). Çağrı başarısız olursa (task tool'ları kapalı olduğu ya da engine çağrıyı reddettiği için) bunu kırmızı bir satır bildirir ve sayım yalnız transcript'e göre yapılır.
2. Sonraki her pencere, son okumadaki listenin üstüne replay edilir. Bu yüzden 8000 mesaj önce oluşturulmuş ve o zamandan beri değiştirilmemiş bir task da sayılmaya devam eder.

Modelin kendisinin çağırdığı bir `TaskList` de aynı şekilde okunur: sonucu listenin tamamıdır ve replay'in tuttuğu listenin yerine geçer.

## Her modelde task tool'ları

Claude Code task takip tool'larını yalnız Claude 3.x, Opus 4.0 ile 4.7, Sonnet 4.0 ile 4.6 ve Haiku 4.5 modellerinde sunar. Diğer modellerde modun sayacağı bir şey olmaz. Bu yüzden mod `session.start` sırasında Claude Code process'i için `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` ayarlar. Bu sayede Claude Code task tool'larını her modelde sunar.

- Mod, sizin kendi ayarladığınız bir değeri değiştirmez. `CLAUDE_CODE_ENABLE_TODO_TOOLS=0` task tool'larını kapalı tutar.
- `/task-poke off` saklı olduğu sürece mod değişkeni ayarlamaz. `/task-poke off`, task tool'ları üzerinde bir sonraki session'dan itibaren geçerli olur.
- Değişken, session'ın başlattığı her Bash komutuna ve MCP server'a da ulaşır.
- `CLAUDE_CODE_ENABLE_TASKS=false`, Task tool'larının yerine `TodoWrite` kullanılmasını sağlar. Mod iki formatı da okur.

## Ne gösterir

[sidebar](../sidebar) açıkken sayım, session boyunca kalan bir `task list` section'ında gösterilir. Section her turn'de yeniden yazılır:

    task-poke: task list
    3 unfinished tasks, poke 2/99

Yalnız `poke N/M` kısmı renklidir: son poke'tan önce yeşil, son poke'ta sarı, poke'lar durduktan sonra kırmızı. Bitmemiş task'lar varsayılan renkte kalır. Bitmemiş hiçbir task kalmadığında section kaldırılır. Bulgular ise stream'e yazılır. Baştaki ifade kırmızı, `: ` işaretinden sonraki ayrıntı varsayılan renktedir. Böylece sonraki sayım bulguları pane'den kaldırmaz. Bulgular şunlardır: poke sınırında durma, hiçbir şeyi ilerletmeyen üç poke'tan sonra durma, engine'in iptal ettiği bir poke ve modun okuyamadığı bir task listesi.

Sidebar kapalıysa ya da yüklü değilse transcript'e yalnız poke gönderen bir turn satır yazar. Üç bulgu da önceden olduğu gibi transcript satırı olarak yazılır.

## Bir poke hiçbir şeyi ilerletmediğinde

Her poke modele bir turn daha verir. Bu turn hiçbir task'ın status'unu değiştirmediyse ve hiçbir tool çalıştırmadıysa poke hiçbir şeyi ilerletmemiştir: model yalnız sözle cevap vermiştir ve sonraki poke da aynı cevabı alır. Art arda üç böyle poke'tan sonra mod durur ve bunu kırmızı bir kayıt bildirir:

    task-poke: stopped after 3 pokes that moved nothing: no task changed status and no tool ran. Send a prompt to start again.

Sayaç, bir şeyi ilerleten ilk turn'de sıfırlanır. Bu yüzden uzun bir task üzerinde çalışan bir model bu kural yüzünden hiçbir zaman durdurulmaz. Bir sonraki prompt'unuz poke'ları yeniden başlatır.

## Ne zaman poke gönderilmez

- Turn kesildiyse, reddedildiyse ya da bir API hatasıyla bittiyse (`reason` değeri `answer` değilse).
- Turn bir subagent'ta çalıştıysa.
- Son asistan mesajı `AskUserQuestion` çağırdıysa.
- Son prompt'unuzdan beri poke sınırı kadar poke gönderildiyse. Durma, kırmızı bir kayıtla bildirilir.
- Art arda üç poke, yukarıda anlatıldığı gibi hiçbir şeyi ilerletmediyse.
- Arka planda hâlâ çalışan bir iş varsa: turn'ün `Stop` input'u bir background task ya da agent listeliyorsa. Model bu durumda yalnız bu işi bekler. Bu yüzden bir poke yalnız sözden oluşan bir turn üretirdi. Böyle bir turn poke göndermez ve hiçbir şeyi ilerletmeyen üç poke'a sayılmaz. Background iş olmadan biten ilk turn yeniden poke gönderir. Bu kontrol eklenmeden önce ölçüldü: iki background agent bekleyen bir session art arda üç devam prompt'u aldı ve her birine tek bir cümleyle cevap verdi.
- `/task-poke off` ayarlıysa.

## Komutlar

    /task-poke          durum
    /task-poke on       açar (varsayılan), session'lar arasında saklanır
    /task-poke off      kapatır, session'lar arasında saklanır
    /task-poke limit 20 art arda en fazla 20 poke; 1 ile 999 arası, varsayılan 99, session'lar arasında saklanır
    /task-poke:send <prompt>  bir poke'un çalıştırdığı komut; elle yazılırsa prompt'u yazıldığı gibi gönderir

`/task-poke:send` modun ikinci komutudur ve "her mod için tek komut" kuralının istisnasıdır. Bunun nedeni, modele plugin çerçevesi olmadan prompt vermenin tek yolunun bir markdown komutu olmasıdır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install task-poke@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

Modu yerel bir checkout'tan tek bir session için yüklemek için:

    claude --plugin-dir plugins/task-poke

## Kurulumdan sonra

Claude Code'u yeniden başlatın. Mod task tool'larını session başında açar. Bu yüzden yukarıdaki listenin dışındaki bir modelde task tool'ları bir sonraki session'dan itibaren kullanılabilir.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=task-poke}, prompt.submit, classic.Stop, turn.complete
    ❯ ./register.ts calls: $.clock.after (via sendPoke), $.command.register, $.command.run (via sendPoke), $.env.get, $.env.set, $.prompt.submit (via submitPoke), $.session.messages (via afterTurn), $.sidebar.clear (via clearCount), $.sidebar.set (via toCount, toStream), $.store.get (via readLimit, readSettings), $.store.set, $.tool.call (via seedTasks), $.ui.log (via toCount, toStream)
    ❯ ./register.ts env writes: CLAUDE_CODE_ENABLE_TODO_TOOLS
    ❯ ./register.ts env reads: CLAUDE_CODE_ENABLE_TODO_TOOLS

Reach L2: Claude'u yönlendirir, transcript'i okur ve bir environment variable yazar.

    1. Okur:         transcript'i $.session.messages ile (TodoWrite, TaskCreate, TaskUpdate, TaskList ve AskUserQuestion tool adlarını, input'larını ve sonuçlarını); session başında tek bir $.tool.call ile engine'in task listesini; her prompt'un kaynak türünü, hiçbir zaman metnini değil; her turn'ün Stop input'undaki background task sayısını; CLAUDE_CODE_ENABLE_TODO_TOOLS
    2. Çalıştırır:   session başında ve /task-poke on sırasında salt okunur bir TaskList çağrısı; bitmemiş task'larla biten her ana loop turn'ü için bir /task-poke:send çalıştırması, art arda en fazla 99 ya da ayarladığınız sınır kadar ve hiçbir şeyi ilerletmeyen art arda en fazla 3 tane; tanımlı değilse her session'da bir kez CLAUDE_CODE_ENABLE_TODO_TOOLS=1 ayarlar
    3. Gönderir:     yalnız sabit poke prompt'unu, normal bir turn olarak
    4. Saklar:       $.store içinde bir boolean (enabled) ve poke sınırını; environment variable yalnız process süresince geçerlidir
    5. Düşman girdi: transcript'ten hiçbir metin poke prompt'una girmez; bilinmeyen bir task status'u, task.id içermeyen bir TaskCreate sonucu ya da id içermeyen bir TaskList satırı poke'ları durdurur ve bir satır, hata değişene kadar hatayı bildirir

## Sınırlar

- `$.session.messages()` en yeni 4096 mesajı döndürür. Session başındaki okuma ve modun turn'ler arasında tuttuğu liste, bu pencerenin dışında kalanları kapsar.
- Bir `TaskGet` sonucu parse edilmez. Durumu `TodoWrite`, `TaskCreate`, `TaskUpdate` ve `TaskList` oluşturur.
- Modun tuttuğu liste, session'ın plugin state'inde saklanır. `/reload-plugins`, `session.start` olayını yeniden çalıştırır. Bu yüzden engine'in listesi de yeniden okunur.
- Yeni bir session boş bir engine listesiyle başlar: Claude Code task'ları resume edilen bir session'a taşır, yeni bir session'a taşımaz (ölçüldü).

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
