# bughunt

Bir bug hunt prompt'u modele hatayı düzeltmeden önce kanıtlamasını söyler; model çoğu zaman önce düzeltmeyi yazar, ardından ondan sonra geçen bir test. Bu mod avı turlara böler ve her turu kendi kanıtına bağlar. Model bir proof komutu yazar, mod komutu kendisi çalıştırır ve proof, `FAIL` satırıyla sıfırdan farklı bir exit code verene kadar production kodu değişmez. Bir tur ancak şöyle düzeltilmiş sayılır: aynı komut daha sonra exit 0 ile `PASS` satırı verir ve mod düzeltmeyi bir anlığına geri aldığında yeniden `FAIL` verir. Döngü her turun sonucunu okur; bloke ya da doğrulanmamış bir turda durur, yenisini başlatmaz.

`/bughunt collab <paths>` ikinci, read-only bir moddur: scanner, planner ve critic subagent'ları yolları sırayla inceler ve rapor; bulguları, planı ve critic'in kararını taşır.

## Ne yapar

### Turlar

1. `/bughunt [--rounds N] [target]`, hedef üzerinde ya da hedef yoksa bütün projede 1 ile 25 arası turdan bir av başlatır. `--rounds` argument'lar arasında herhangi bir yerde durabilir. Av, session'ın herhangi bir anında başlar.
2. Mod her turu bir prompt olarak gönderir: tur numarası, kapsam, turun proof dizini (`.temp_files/bughunt/<round>/`), önceki turların fingerprint'leri ve protokol. Model önce bütün kuralları taşıyan `bughunt:hunt` skill'ini açar; tur sürerken mod, turun bloğunu skill'in metnine ekler.
3. Bir tur sürerken:
   - Skill o turda açılana kadar Edit, Write ve NotebookEdit durur.
   - Proof dizini dışındaki bir edit, mod bir `FAIL` kaydedene kadar durur.
   - Target verildiyse onun dışındaki bir edit de `FAIL`'den sonra durur. Bir test dosyası (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`) geçer; böylece regression test suite'e girebilir.
   - Her subagent spawn'ı durur: bir tur tek bir konuşmada sürer.
4. Model `mcp__bughunt__proof`'u `phase: "before"` ve proof komutunun `argv`'siyle çağırır. Mod komutu çalıştırır (en fazla 5 dakika) ve ancak komut sıfırdan farklı çıkıp `FAIL` ile başlayan bir satır bastığında `FAIL` kaydeder. Böyle bir satır basmayan bir setup ya da import hatası reddedilir. Düzeltmeden sonra aynı `argv` ile `phase: "after"` komutu yeniden çalıştırır ve exit 0 ile `PASS` ile başlayan bir satır ister. Model exit code'u, çıktının son 20 satırını ve sebebi okur.
5. `PASS`'i kaydetmeden önce mod, proof'un düzeltmeye ulaştığını kontrol eder. `FAIL` kaydedilirken çalışma ağacının bir snapshot'ı alınmıştı (`git stash create`, stash girdisi eklemez; temiz ağaçta `HEAD`). Kabul edilen bir `PASS` koşusundan sonra mod, o andan beri değişen dosyaları listeler (`git diff --diff-filter=M`), proof dizinini ve test dosyalarını ayırır ve onları çalışma ağacında snapshot'a geri getirir (`git restore --source`; index olduğu gibi kalır). Proof'u bir kez daha çalıştırır ve düzeltmeyi yerine geri koyar. `PASS`, geri alınmış koşu `FAIL` satırıyla sıfırdan farklı çıkarsa sayılır. Değilse çağrı reddedilir; model proof'u düzeltip yeniden çağırabilir. Model her durumda sebebi okur:
   - proof, düzeltme geri alınmışken geçiyor; demek ki düzeltilen koda ulaşmıyor;
   - `FAIL`'den beri hiçbir production dosyası değişmedi;
   - dizin bir git repository'si değil;
   - bir git komutu başarısız oldu.

   Düzeltme geri alınmışken mod `$.store`'da bir kayıt tutar. Bir çökme kontrolü yarıda keserse, aynı dizindeki sonraki session düzeltmeyi geri koyar; geri alınan dosyalar hâlâ değişmemişse. Değişmişlerse üstlerine yazmaz ve düzeltmeyi geri getiren `git restore` komutunu size söyler.
6. Turun turn'i bittiğinde mod cevabın outcome satırını okur: outcome etiketiyle başlayan ilk satır; çünkü önündeki bir cümle onu gizlemesin:
   - `fixed-and-verified` yalnız mod o turda önce `FAIL` sonra `PASS` kaydettiyse devam eder; yoksa av durur.
   - `no-proven-bug` devam eder.
   - `blocked`, `fixed-verification-incomplete`, bir outcome satırının yokluğu, bir interrupt ya da bir API hatası avı durdurur.
   - Son turdan sonra av biter.

   Her cevabın `fingerprint:` satırı sonraki turların prompt'larına girer; böylece aynı kök neden iki kez sayılmaz.
7. Sizin kendiniz yazdığınız bir prompt avı bitirir; `/bughunt` komutları bitirmez.

### Collab

1. `/bughunt collab <paths>` ya da modelin `mcp__bughunt__collab` tool'u, üç subagent'ı sırayla başlatır. Onlar modun kendi agent tipleridir (`bughunt:scanner`, `bughunt:planner`, `bughunt:critic`), modelin agent listesinde görünmezler ve her biri yalnız okuyabilir: `Read`, `Grep`, `Glob`.
2. Scanner her bulguyu anında `mcp__bughunt__found` ile bildirir (file, line, severity, description, isteğe bağlı fix). Mod alanları kontrol eder ve bulguyu tutar. Tool'u yalnız o an çalışan scanner çağırabilir.
3. Planner bulguları ve scanner'ın raporunu alır, bir düzeltme planı yazar. Critic bulguları ve planı alır ve cevabına `verdict: approve`, `revise` ya da `reject` ile başlar.
4. Her adımın bir süre sınırı vardır (scanner 10, planner 8, critic 6 dakika). Süresi dolan adım raporda `timed-out` diye adlandırılır ve scanner'ın o ana kadar gönderdiği bulgular raporda kalır.
5. Critic bir verdict satırı vermediğinde verdict `no-verdict`'tir; asla `approve` değildir.
6. Komut ve tool, scanner başlar başlamaz döner; rapor daha sonra tek bir mesaj olarak gelir ve model onu read-only bir inceleme olarak okur. Bir adımın elden çıkarma mesajını mod alır ve düşürür; böylece kendi turn'ünü başlatmaz.
7. Bir tur sürerken collab başlamaz.

### Siz ne görürsünüz

[sidebar](../sidebar), sürekli bir `bughunt` section'ı gösterir: tur numarası, skill'in açık olup olmadığı, proof'un durumu ve bitmiş her turun sonucuyla fingerprint'i. Durdurulan edit'ler, proof sonuçları ve avın bitişi sidebar stream'ine gider. Sidebar yoksa her biri `bughunt: edit stopped (proof): src/a.ts` gibi bir transcript satırıdır.

## Komut

    /bughunt [--rounds N] [target]    N turluk bir av başlatır (varsayılan 1, en çok 25)
    /bughunt collab <paths>           read-only bir scanner, planner ve critic incelemesi
    /bughunt stop                     süren avı bitirir
    /bughunt status                   açık mı kapalı mı ve süren tur
    /bughunt on | off                 varsayılan açık; off hiçbir şey başlatmaz ve hiçbir edit'i tutmaz

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bughunt@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Testlerini komut satırından çalıştırabildiğiniz bir repository'de `/bughunt` çalıştırın. Proof komutu sizin izinlerinizle çalışır; modelin önerdiklerini okuyun.

## Nereye uzanır

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=bughunt}, agent.offer{agent=/"^bughunt:(scanner|planner|critic)$"/}, tool.describe{tool=/"^mcp__bughunt__(proof|found|collab)$"/}, tool.call{tool=/"^mcp__bughunt__proof$"/}, tool.call{tool=/"^mcp__bughunt__found$"/}, tool.call{tool=/"^mcp__bughunt__collab$"/}, prompt.submit, skill.prompt{skill=bughunt:hunt}, tool.call{tool=Skill}, tool.call{tool=Edit}, tool.call{tool=Write}, tool.call{tool=NotebookEdit}, agent.spawn, turn.complete
    ❯ ./register.ts calls: $.agent.register (via declare), $.agent.spawn (via portsOf), $.clock.after (via portsOf, send), $.command.register (via declare), $.command.run (via send), $.process.run (via git, recoverFix, runProof), $.prompt.submit (via send), $.sidebar.clear (via show), $.sidebar.set (via show, toPerson), $.store.delete (via putBack, recoverFix), $.store.get (via readSettings, recoverFix), $.store.set (via revertCheck, setEnabled), $.tool.register (via declare), $.ui.log (via launchCollab, send, toPerson)

Reach L2, modelin adlandırdığı proof komutunu çalıştırır.

    1. Okur:     her Edit, Write ve NotebookEdit çağrısının yolunu; prompt'larınızı, yalnız siz mi yazdınız diye görmek için; her turun son cevabını; collab subagent'larının cevaplarını
    2. Çalıştırır: modelin mcp__bughunt__proof'a geçtiği proof komutunu, shell'siz argv olarak, çalışma dizininde ya da adlandırdığı cwd'de, en fazla 5 dakika, düzeltme geri alınmışken bir kez daha; o kontrol için çalışma dizininde git stash create, rev-parse, diff ve restore --worktree; bir collab için üç read-only subagent
    3. Gönderir: her turun prompt'unu ve her collab raporunu modele bir mesaj olarak; durdurulan bir edit ya da spawn için bir deny metni; skill'in metninden sonra turun bloğunu; size sidebar section'ları ve satırları ya da transcript satırları; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını; revert check sürerken düzeltmeyi tutan snapshot'ı ve geri alınan dosyaları; avın kendisi bellekte yaşar ve session'la biter
    5. Düşman girdi: proof komutu modelindir ve sizin izinlerinizle çalışır, bir Bash çağrısı gibi ama shell'siz; bir bulgunun alanları tutulmadan önce kontrol edilir

## Sınırlar

- Gate Edit, Write ve NotebookEdit'i okur. Bash üzerinden değişen bir dosyayı (`sed -i`, bir redirect, bir script) tutmaz.
- Revert check, proof'un düzeltmenin değiştirdiği dosyalara bağımlı olduğunu gösterir. Proof'un doğru davranışı test edip etmediğini söylemez.
- Revert check, yalnız düzeltmenin değiştirdiği takip edilen dosyaları geri alır. Yalnız dosya ekleyen bir düzeltmenin geri alınacak bir şeyi yoktur; onun `PASS`'i reddedilir. Bir git repository'si dışında hiçbir `PASS` kaydedilmez.
- Kontrol sürerken (en çok bir proof koşusu daha) düzeltilmiş dosyalar eski kodu taşır. O aralıkta onları okuyan başka bir process hatayı görür.
- Mod, skill'in ulaştığını ölçer; modelin onu okuduğunu değil.
- Süresi dolan bir collab adımı, arka planda bitene dek çalışmayı sürdürür; mod onu beklemeyi bırakır.
- Test engine bir subagent başlatamaz; bu yüzden collab'in bekleri (hand-back, erken cevap, süre sınırı, başarısız bitiş) `pipeline.ts`'de sahte engine çağrılarıyla test edilir ve bütün koşu canlı kontrol edilir. 2.1.284'te canlı: iki turluk bir av önce `FAIL` sonra `PASS` kaydetti, fingerprint'i 2. tura taşıdı ve orada bitti; bir collab scanner'ın bulgusunu tuttu, critic'in kararını okudu ve üç hand-back'i turn başlatmadı. Bir git repository'sindeki tur, geri alınmış koşu başarısız olunca `PASS` kaydetti; düzeltme sonrasında yerindeydi ve `git stash list` boş kaldı.
- Bir turun gate'lerini aşan bir yol yoktur. `/bughunt stop` avı bitirir, `/bughunt off` modu kapatır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
