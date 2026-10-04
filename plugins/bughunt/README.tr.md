# bughunt

Bir bug avı prompt'u modele önce bug'ı kanıtlamasını, sonra düzeltmesini söyler. Model çoğu zaman önce düzeltmeyi, sonra da düzeltmeden sonra geçen bir test yazar. Bu mod avı turlara böler ve her turu kanıtına bağlar. Model bir kanıt komutu yazar, mod komutu kendisi çalıştırır. Kanıt sıfır olmayan bir kodla ve bir `FAIL` satırıyla çıkana kadar üretim kodu değişmez. Bir tur ancak şöyle düzeltilmiş sayılır: aynı komut sonra 0 ile çıkar ve bir `PASS` satırı yazar; mod düzeltmeyi kısa bir süre geri alır ve komut yeniden başarısız olur. Döngü her turun sonucunu okur, engellenen ya da doğrulanmayan bir turda bir sonraki turu başlatmaz, durur.

`/bughunt collab <yollar>` ikinci ve salt okunur bir moddur: bir scanner, bir planner ve bir critic subagent'ı yolları sırayla inceler. Rapor bulguları, planı ve critic'in kararını taşır.

## Ne yapar

### Turlar

1. `/bughunt [--rounds N] [hedef]` hedef üzerinde, hedef yoksa bütün projede 1 ile 25 tur arası bir av başlatır. `--rounds` argümanların herhangi bir yerinde olabilir. Av session'ın herhangi bir anında başlar.
2. Mod her turu bir prompt olarak gönderir: tur numarası, kapsam, turun kanıt dizini (`.temp_files/bughunt/<tur>/`), önceki turların parmak izleri ve protokol. Model önce bütün kuralları taşıyan `bughunt:hunt` skill'ini açar. Tur sürerken mod skill metninin sonuna turun bloğunu ekler.
3. Tur sürerken:
   - Skill bu turda açılmadıysa Edit, Write ve NotebookEdit durur.
   - Mod bir `FAIL` kaydedene kadar kanıt dizini dışındaki bir edit durur.
   - Hedef verildiyse, `FAIL`'den sonra hedef dışındaki bir edit de durur. Regression test'i suite'e girebilsin diye test dosyaları (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`) geçer.
   - Her subagent spawn'ı durur: bir tur tek bir konuşmada çalışır.
4. Model `mcp__bughunt__proof` tool'unu `phase: "before"` ve kanıt komutunun `argv`'si ile çağırır. Mod komutu çalıştırır (en fazla 5 dakika). `FAIL`'i yalnız komut sıfır olmayan bir kodla çıkar ve `FAIL` ile başlayan bir satır yazarsa kaydeder. Böyle bir satır yazmayan bir kurulum ya da import hatası reddedilir. Düzeltmeden sonra aynı `argv` ile `phase: "after"` komutu yeniden çalıştırır. Komutun 0 ile çıkması ve `PASS` ile başlayan bir satır yazması gerekir. Model çıkış kodunu, çıktının son 20 satırını ve nedeni okur.
5. Mod `PASS`'i kaydetmeden önce kanıtın düzeltmeye ulaştığını kontrol eder. `FAIL` kaydedilirken çalışma ağacının bir snapshot'ını almıştır (`git stash create`, stash listesine kayıt eklemez; temiz bir ağaçta `HEAD`). Kabul edilen bir `PASS` çalıştırmasından sonra o snapshot'tan beri değişen dosyaları listeler (`git diff --diff-filter=M`), kanıt dizinini ve test dosyalarını dışarıda bırakır ve bu dosyaları çalışma ağacında snapshot'taki hâline döndürür (`git restore --source`, index olduğu gibi kalır). Kanıtı yeniden çalıştırır, sonra düzeltmeyi geri koyar. `PASS` yalnız bu geri alınmış çalıştırma sıfır olmayan bir kodla ve bir `FAIL` satırıyla çıkarsa sayılır. Aksi hâlde çağrı reddedilir, model kanıtı düzeltip yeniden çağırabilir. Model her durumda nedeni okur:
   - kanıt düzeltme geri alınmışken de geçer, yani düzeltilen koda ulaşmaz;
   - `FAIL`'den beri hiçbir üretim dosyası değişmedi;
   - dizin bir git reposu değil;
   - bir git komutu başarısız oldu.

   Düzeltme geri alınmışken mod `$.store` içinde bir kayıt tutar. Bir çökme kontrolü yarıda keserse, aynı dizindeki bir sonraki session düzeltmeyi geri koyar, ama yalnız geri alınan dosyalar hâlâ değişmemişse. Dosyalar o arada değiştiyse onların üzerine yazmaz ve sana düzeltmeyi geri getiren `git restore` komutunu söyler.
6. Turun turn'ü bitince mod cevabın sonuç satırını okur: bir sonuç etiketiyle başlayan ilk satır. Böylece önündeki bir cümle etiketi gizlemez:
   - Av, `fixed-and-verified` sonucunda ancak mod bu turda önce `FAIL` sonra `PASS` kaydettiyse devam eder; kayıt yoksa durur.
   - `no-proven-bug` ile de devam eder.
   - `blocked`, `fixed-verification-incomplete`, sonuç satırının olmaması, bir kesinti ya da bir API hatası avı durdurur.
   - Son turdan sonra av biter.

   Her cevabın `fingerprint:` satırı sonraki turların prompt'una girer, böylece aynı kök neden iki kez sayılmaz.
7. Senin yazdığın bir prompt avı bitirir. `/bughunt` komutları bitirmez.

### Collab

1. `/bughunt collab <yollar>` ya da modelin `mcp__bughunt__collab` tool'u üç subagent'ı sırayla başlatır. Bunlar modun kendi agent tipleridir (`bughunt:scanner`, `bughunt:planner`, `bughunt:critic`). Modelin agent listesinde görünmezler ve yalnız okuyabilirler: `Read`, `Grep`, `Glob`.
2. Scanner her bulguyu hemen `mcp__bughunt__found` ile bildirir (dosya, satır, önem derecesi, açıklama, isteğe bağlı düzeltme). Mod alanları kontrol eder ve bulguyu saklar. Tool'u yalnız çalışan scanner çağırabilir.
3. Planner bulguları ve scanner'ın raporunu alır, bir düzeltme planı yazar. Critic bulguları ve planı alır, cevabına `verdict: approve`, `revise` ya da `reject` ile başlar.
4. Her adımın bir süre sınırı vardır (scanner 10, planner 8, critic 6 dakika). Süresi dolan adım raporda `timed-out` olarak adlandırılır. Scanner'ın o ana kadar gönderdiği bulgular raporda kalır.
5. Critic bir karar satırı yazmazsa karar `no-verdict` olur, hiçbir zaman `approve` olmaz.
6. Komut ve tool scanner başlayınca döner. Rapor sonra tek bir mesaj olarak gelir ve model onu salt okunur bir inceleme olarak okur. Bir adımın hand-back mesajını mod alır ve düşürür, böylece mesaj kendi turn'ünü başlatmaz.
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

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurduktan sonra

1. Claude Code'u yeniden başlat.
2. `/bughunt`'ı, testlerini komut satırından çalıştırabildiğin bir repoda çalıştır. Kanıt komutu senin yetkilerinle çalışır, bu yüzden modelin önerdiği komutu oku.

## Neye ulaşabilir

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=bughunt}, agent.offer{agent=/"^bughunt:(scanner|planner|critic)$"/}, tool.describe{tool=/"^mcp__bughunt__(proof|found|collab)$"/}, tool.call{tool=/"^mcp__bughunt__proof$"/}, tool.call{tool=/"^mcp__bughunt__found$"/}, tool.call{tool=/"^mcp__bughunt__collab$"/}, prompt.submit, skill.prompt{skill=bughunt:hunt}, tool.call{tool=Skill}, tool.call{tool=Edit}, tool.call{tool=Write}, tool.call{tool=NotebookEdit}, agent.spawn, turn.complete
    ❯ ./register.ts calls: $.agent.register (via declare), $.agent.spawn (via portsOf), $.clock.after (via portsOf, send), $.command.register (via declare), $.command.run (via send), $.process.run (via git, recoverFix, runProof), $.prompt.submit (via send), $.sidebar.clear (via show), $.sidebar.set (via show, toPerson), $.store.delete (via putBack, recoverFix), $.store.get (via readSettings, recoverFix), $.store.set (via revertCheck, setEnabled), $.tool.register (via declare), $.ui.log (via launchCollab, send, toPerson)

Reach L2: modelin adlandırdığı kanıt komutunu çalıştırır.

    1. Okur:           her Edit, Write ve NotebookEdit çağrısının yolunu; prompt'larını, yalnız senin yazıp yazmadığını görmek için; her turun son cevabını; collab subagent'larının cevaplarını
    2. Çalıştırır:     modelin mcp__bughunt__proof'a verdiği kanıt komutunu, shell olmadan argv olarak, çalışma dizininde ya da verdiği cwd'de, en fazla 5 dakika, düzeltme geri alınmışken bir kez daha; bu kontrol için çalışma dizininde git stash create, rev-parse, diff ve restore --worktree; collab için salt okunur üç subagent
    3. Gönderir:       her turun prompt'unu ve her collab raporunu modele mesaj olarak, durdurulan bir edit ya da spawn için bir deny metni, skill metninin sonuna turun bloğunu, sana sidebar bölümleri ve satırları ya da transcript satırları; makineden hiçbir şey çıkmaz
    4. Saklar:         $.store içinde açık/kapalı ayarını, bir geri alma kontrolü sürerken düzeltmeyi tutan snapshot'ı ve geri alınan dosyaları; avın kendisi bellekte durur ve session ile biter
    5. Güvenilmez girdi: kanıt komutu modelindir ve bir Bash çağrısı gibi senin yetkilerinle, ama shell olmadan çalışır; bir bulgunun alanları saklanmadan önce kontrol edilir

## Sınırlar

- Gate Edit, Write ve NotebookEdit'i okur. Bash ile değiştirilen bir dosya (`sed -i`, bir yönlendirme, bir script) tutulmaz.
- Geri alma kontrolü kanıtın düzeltmenin değiştirdiği dosyalara bağlı olduğunu gösterir. Kanıtın doğru davranışı assert edip etmediğini ölçemez.
- Geri alma kontrolü yalnız düzeltmenin değiştirdiği, git'in izlediği dosyaları geri alır. Yalnız dosya ekleyen bir düzeltmede geri alınacak bir şey yoktur, bu yüzden `PASS` reddedilir. Git reposu dışında hiçbir `PASS` kaydedilmez.
- Kontrol sürerken (en fazla bir kanıt çalıştırması) düzeltilen dosyalar eski kodu taşır. Bu sırada onları okuyan başka bir süreç bug'ı görür.
- Mod skill'in teslim edildiğini ölçer, modelin onu okuduğunu değil.
- Süresi dolan bir collab adımı bitene kadar arka planda çalışmaya devam eder. Mod artık onu beklemez.
- Test engine subagent başlatamaz. Bu yüzden collab beklemeleri (hand-back, erken cevap, süre sınırı, başarısız bitiş) `pipeline.ts` üzerinde sahte engine çağrılarıyla test edilir, bütün akış canlı kontrolle doğrulanır. 2.1.284 üzerinde canlı kontrol: iki turluk bir av önce FAIL sonra PASS kaydetti, parmak izini 2. tura taşıdı ve orada bitti. Bir collab scanner'ın bulgusunu sakladı, critic'in kararını okudu ve üç hand-back hiçbir turn başlatmadı. Bir git reposundaki tur, geri alınmış çalıştırma başarısız olduktan sonra `PASS` kaydetti. Düzeltme sonra yerindeydi ve `git stash list` boş kaldı.
- Bir turun gate'lerini aşmanın yolu yoktur. `/bughunt stop` avı bitirir, `/bughunt off` modu kapatır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10, üstünde build başarısız olur
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
