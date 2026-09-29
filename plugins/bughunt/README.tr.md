# bughunt

Bir bug avı prompt'u modele önce bug'ı kanıtlamasını, sonra düzeltmesini söyler. Model çoğu zaman önce düzeltmeyi, sonra düzeltmeden sonra geçen bir test'i yazar. Bu mod avı turlara böler ve her turu kanıtına bağlar. Model bir kanıt komutu yazar, mod komutu kendisi çalıştırır. Kanıt sıfır olmayan bir kodla ve bir `FAIL` satırıyla çıkana kadar üretim kodu değişmez. Tur ancak aynı komut sonra 0 ile ve bir `PASS` satırıyla çıkarsa düzeltilmiş sayılır. Döngü her turun sonucunu okur, engellenen ya da doğrulanmayan bir turda bir sonraki turu başlatmaz, durur.

`/bughunt collab <yollar>` ikinci ve salt okunur bir moddur: bir scanner, bir planner ve bir critic subagent'ı yolları sırayla inceler. Rapor bulguları, planı ve critic'in kararını taşır.

## Ne yapar

### Turlar

1. `/bughunt [--rounds N] [hedef]` hedef üzerinde, hedef yoksa bütün projede 1 ile 25 tur arası bir av başlatır. `--rounds` argümanların herhangi bir yerinde olabilir. Av session'ın herhangi bir anında başlar.
2. Mod her turu bir prompt olarak gönderir: tur numarası, kapsam, turun kanıt dizini (`.temp_files/bughunt/<tur>/`), önceki turların parmak izleri ve protokol. Model önce bütün kuralları taşıyan `bughunt:bughunt` skill'ini açar. Tur sürerken mod skill metninin sonuna turun bloğunu ekler.
3. Tur sürerken:
   - Skill bu turda açılmadıysa Edit, Write ve NotebookEdit durur.
   - Mod bir `FAIL` kaydedene kadar kanıt dizini dışındaki bir edit durur.
   - Hedef verildiyse, `FAIL`'den sonra hedef dışındaki bir edit de durur. Regression test'i suite'e girebilsin diye test dosyaları (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`) geçer.
   - Her subagent spawn'ı durur: bir tur tek bir konuşmada çalışır.
4. Model `mcp__bughunt__proof` tool'unu `phase: "before"` ve kanıt komutunun `argv`'si ile çağırır. Mod komutu çalıştırır (en fazla 5 dakika). `FAIL`'i yalnız komut sıfır olmayan bir kodla çıkar ve `FAIL` ile başlayan bir satır yazarsa kaydeder. Böyle bir satır yazmayan bir kurulum ya da import hatası reddedilir. Düzeltmeden sonra aynı `argv` ile `phase: "after"` yalnız 0 çıkış kodu ve `PASS` ile başlayan bir satırla `PASS` kaydeder. Model çıkış kodunu, çıktının son 20 satırını ve nedeni okur.
5. Turun turn'ü bitince mod cevabın ilk satırını okur:
   - `fixed-and-verified` ancak mod bu turda önce `FAIL` sonra `PASS` kaydettiyse devam eder. Kayıt yoksa av durur.
   - `no-proven-bug` devam eder.
   - `blocked`, `fixed-verification-incomplete`, sonuç satırının olmaması, bir kesinti ya da bir API hatası avı durdurur.
   - Son turdan sonra av biter.

   Her cevabın `fingerprint:` satırı sonraki turların prompt'una girer, böylece aynı kök neden iki kez sayılmaz.
6. Senin yazdığın bir prompt avı bitirir. `/bughunt` komutları bitirmez.

### Collab

1. `/bughunt collab <yollar>` ya da modelin `mcp__bughunt__collab` tool'u üç subagent'ı sırayla başlatır. Bunlar modun kendi agent tipleridir (`bughunt:scanner`, `bughunt:planner`, `bughunt:critic`). Modelin agent listesinde görünmezler ve yalnız okuyabilirler: `Read`, `Grep`, `Glob`.
2. Scanner her bulguyu hemen `mcp__bughunt__found` ile bildirir (dosya, satır, önem derecesi, açıklama, isteğe bağlı düzeltme). Mod alanları kontrol eder ve bulguyu saklar. Tool'u yalnız çalışan scanner çağırabilir.
3. Planner bulguları ve scanner'ın raporunu alır, bir düzeltme planı yazar. Critic bulguları ve planı alır, cevabına `verdict: approve`, `revise` ya da `reject` ile başlar.
4. Her adımın bir süre sınırı vardır (scanner 10, planner 8, critic 6 dakika). Süresi dolan adım raporda `timed-out` olarak adlandırılır. Scanner'ın o ana kadar gönderdiği bulgular raporda kalır.
5. Critic bir karar satırı yazmazsa karar `no-verdict` olur, hiçbir zaman `approve` olmaz.
6. Bir adımın hand-back mesajını mod alır, böylece mesaj kendi turn'ünü başlatmaz. Rapor modele bir kez ulaşır: tool'un sonucu olarak ya da `/bughunt collab` sonrası bir mesaj olarak.
7. Bir tur sürerken collab başlamaz.

### Ne görürsün

[Sidebar](../sidebar) sabit bir `bughunt` bölümü gösterir: tur, skill'in açık olup olmadığı, kanıt durumu ve biten her turun sonucu ile parmak izi. Durdurulan edit'ler, kanıt sonuçları ve avın sonu sidebar stream'ine düşer. Sidebar yoksa her biri `bughunt: edit stopped (proof): src/a.ts` gibi tek bir transcript satırıdır.

## Komut

    /bughunt [--rounds N] [hedef]     N turluk bir av başlatır (varsayılan 1, en fazla 25)
    /bughunt collab <yollar>          salt okunur scanner, planner ve critic incelemesi
    /bughunt stop                     çalışan avı bitirir
    /bughunt status                   açık ya da kapalı, ve çalışan tur
    /bughunt on | off                 varsayılan açık; off hiçbir şey başlatmaz ve hiçbir edit'i tutmaz

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bughunt@kilimcininkoroglu-mods

Function hook'lar erken erişimdedir ve flag olmadan hiçbir şey yüklenmez. Açık tutmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurduktan sonra

1. Claude Code'u yeniden başlat.
2. `/bughunt`'ı test'lerini komut satırından çalıştırabildiğin bir repoda çalıştır. Kanıt komutu senin yetkilerinle çalışır, bu yüzden modelin önerdiği komutu oku.

## Neye ulaşabilir

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=bughunt}, agent.offer{agent=/"^bughunt:(scanner|planner|critic)$"/}, tool.describe{tool=/"^mcp__bughunt__(proof|found|collab)$"/}, tool.call{tool=/"^mcp__bughunt__proof$"/}, tool.call{tool=/"^mcp__bughunt__found$"/}, tool.call{tool=/"^mcp__bughunt__collab$"/}, prompt.submit, skill.prompt{skill=bughunt:bughunt}, tool.call{tool=Skill}, tool.call{tool=Edit}, tool.call{tool=Write}, tool.call{tool=NotebookEdit}, agent.spawn, session.receive, turn.complete
    ❯ ./register.ts calls: $.agent.register (via declare), $.agent.spawn (via runStep), $.clock.after (via answerOf, send, startCollabCommand), $.command.register (via declare), $.command.run (via send), $.process.run (via runProof), $.prompt.submit (via send), $.sidebar.clear (via show), $.sidebar.set (via show, toPerson), $.store.get (via readSettings), $.store.set (via setEnabled), $.tool.register (via declare), $.ui.log (via send, startCollabCommand, toPerson)

Reach L2: modelin adlandırdığı kanıt komutunu çalıştırır.

    1. Okur:           her Edit, Write ve NotebookEdit çağrısının yolunu; prompt'larını, yalnız senin yazıp yazmadığını görmek için; her turun son cevabını; collab subagent'larının cevaplarını
    2. Çalıştırır:     modelin mcp__bughunt__proof'a verdiği kanıt komutunu, shell olmadan argv olarak, çalışma dizininde ya da verdiği cwd'de, en fazla 5 dakika; collab için salt okunur üç subagent
    3. Gönderir:       her turun prompt'unu ve her collab raporunu modele mesaj olarak, durdurulan bir edit ya da spawn için bir deny metni, skill metninin sonuna turun bloğunu, sana sidebar bölümleri ve satırları ya da transcript satırları; makineden hiçbir şey çıkmaz
    4. Saklar:         $.store içinde açık/kapalı ayarını; avın kendisi bellekte durur ve session ile biter
    5. Güvenilmez girdi: kanıt komutu modelindir ve bir Bash çağrısı gibi senin yetkilerinle, ama shell olmadan çalışır; bir bulgunun alanları saklanmadan önce kontrol edilir

## Sınırlar

- Gate Edit, Write ve NotebookEdit'i okur. Bash ile değiştirilen bir dosya (`sed -i`, bir yönlendirme, bir script) tutulmaz.
- Mod kanıtın çıkış kodunu ve `FAIL` ile `PASS` satırlarını ölçer. Kanıtın gerçek kod yolunu çalıştırıp çalıştırmadığını ya da doğru davranışı assert edip etmediğini ölçemez.
- Mod skill'in teslim edildiğini ölçer, modelin onu okuduğunu değil.
- Süresi dolan bir collab adımı bitene kadar arka planda çalışmaya devam eder. Mod artık onu beklemez.
- Collab adımları başlatılan bir subagent'ın cevabını bekler. Test engine subagent başlatamaz, bu yol test'lerle değil canlı kontrolle doğrulanır.
- Bir turun gate'lerini aşmanın yolu yoktur. `/bughunt stop` avı bitirir, `/bughunt off` modu kapatır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10, üstünde build başarısız olur
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
