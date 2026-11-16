# session-watch

Context'in ne kadar dolu olduğu, session'ın maliyeti, son isteğin hangi effort ile gönderildiği ve branch'in durumu `/context`, `/cost`, `/model` ve bir git çağrısı arasında dağılmıştır. Bunların hiçbiri ekranda kalmaz. Bu mod, bu session'ın durumunu [sidebar](../sidebar)'da tutar: context doluluğu, token toplamları, maliyet, model ve effort, Claude Code sürümü, bu bilgisayardaki diğer session'lar, git branch'i ve durumu.

## Ne gösterir

**Sidebar'ın en üstünde bir section** (`order: 5`). Claude Code 2.1.282 üzerinde ölçüldü:

    session-watch: session
    ctx 8% · 81k / 1.0M · CR 74k · CW 7k · CH 91%
    tokens T 81k · I 2 · O 8 · TH 5 · CR 74k · CW 7k · CH 91%
    cost $0.07
    model opus-5-5[1m] · effort medium
    Claude Code 2.1.282
    sessions: 2 others · 1 busy · 1 idle
      cors-fix
    main · 1 untracked · no upstream

- `ctx`: son cevabın input token sayısı, modelin context window'u ve ikisinin oranı. Oran %50'nin altında yeşil, %50 ile %80 arasında sarı, %80'in üstünde kırmızıdır. Üç değeri de engine verir (`$.session.usage().context`). Mod bunların hiçbirini hesaplamaz. Ardından ana loop'un son model isteğinin, yani context window'u şu anda dolduran isteğin cache read ve cache write token'ları gelir. Sonra bu isteğin cache hit oranı gelir (`CH`, tokens satırındakiyle aynı ölçü). İsteğin cache'lenmemiş input'u (cache kullanan bir session'da cache'in dışında kalan birkaç token, çoğu zaman 1 ya da 2) ve output'u tokens satırında kalır. Bir subagent'ın isteğinin kendi context window'u vardır ve bu satırı değiştirmez. Yalnız yüzdeler renklidir. İlk cevaptan önce satır `ctx: no reply yet` gösterir.
- `tokens`: session'ın toplamları. `T` toplam, `I` input, `O` output, `TH` thinking token'ları (`O`'nun bir parçası), `CR` cache read, `CW` cache write ve `CH` cache hit oranıdır. Cache hit oranı, input token'larının cache'ten okunan payıdır: `CR / (I + CR + CW)`. Oran aşağı yuvarlanır. Böylece tek bir soğuk cache write'ı olan bir session hiçbir zaman %100 göstermez. Yalnız yüzde renklidir: %90 ve üstü yeşil, %70 ile %90 arası sarı, %70'in altı kırmızı. İlk input'tan önce satır yazılmaz. Toplamları saklanmamış bir session, toplamları bir kez kendi transcript'lerinden (ana loop'un ve her subagent'ın transcript'inden) okur ve her model cevabını bir kez sayar. Ardından her turn kendi token'larını ekler. Bir subagent'ın token'ları da eklenir. Hiçbir transcript'in kaydetmediği bir istek, döndüğü anda sayılır: bir plugin'in kendi model çağrısı (`$.model.fork`, `$.model.complete`, örneğin memory-save'in her turn sonunda çalıştırdığı fork) ve bir compaction özeti. 2.1.282 üzerinde ölçüldü: 16 input token'lık bir fork ve 14 input token'lık bir completion, `I` değerini 2'den 32'ye çıkardı. Bir fork `turn.complete` tetiklemez. Bu yüzden bir kez sayılır. Toplamlar her session için `$.store` içinde saklanır. Böylece yeniden yüklenen bir modül kaldığı yerden devam eder. Transcript'ler okunurken satır `tokens: reading the transcripts` gösterir. 2.1.282 üzerinde resume edilen bir session'da ölçüldü: toplamlar, `/cost`'un session modeline ait satırına eşitti: `6 input, 19 output, 222.3k cache read, 21.5k cache write`.
  Hiçbir hook'un usage değeri thinking token'larını içermez (2.1.283 üzerinde ölçüldü: bir isteğin hook usage'ı input, output ve cache sayılarını içeriyordu, transcript satırı ise bunların yanında `output_tokens_details.thinking_tokens: 8` değerini içeriyordu). Bu yüzden `TH` transcript'lerden okunur: önce bir kez baştan sona, ardından yalnız her transcript'in son okumadan sonra eklenen kısmı. `TH` eklenmeden önce saklanan toplamlar kendi sayılarını korur, çünkü bu sayılar hiçbir transcript'in kaydetmediği plugin model çağrılarını içerir. Bu toplamlar için transcript'lerden yalnız thinking token'ları bir kez okunur.
- `cost`: session'ın maliyeti, `/cost`'un toplamı olarak ABD doları cinsinden.
- `model`: ana loop'un modeli ve ana loop'un son model isteğinin effort'u: `low` ile `max` arası bir seviye, bir budget, effort ayarı olmayan bir model için `no effort setting` ya da hiçbir kaynak bir effort bildirmiyorsa `effort: not read yet`. İlk istekten önce satır, transcript'teki son cevabın kaydettiği effort'u gösterir (resume edilen bir session). Bu yoksa `CLAUDE_CODE_EFFORT_LEVEL` değerini, o da yoksa settings'teki `effortLevel` değerini gösterir. session-watch'ın altındaki bir hook (örneğin effort-auto) isteği session ayarından farklı bir effort ile gönderdiyse satır ikisini de gösterir. Ayar soluk renktedir: `effort low (session medium)`. Modelin adı ailesine göre renklidir. En pahalı model en sıcak renktedir: opus kırmızı, fable sarı, sonnet yeşil, haiku soluk. Effort seviyesi, ne kadar düşünme istediğine göre renklidir: `low` soluk, `medium` yeşil, `high` sarı, `xhigh` ve `max` kırmızı. Tek bir kelimeyi renklendirmek için sidebar 0.11.0 ya da sonrası gerekir. Daha eski bir sidebar satırı tek renkte gösterir.
- `Claude Code`: engine'in sürümü.
- `sessions`: bu bilgisayardaki, aynı hesabın kullanım limitlerini kullanan diğer çalışan Claude Code session'ları. Satır, session sayısını, meşgul olanların sayısını sarı renkte ve boşta olanların sayısını gösterir. Ardından her meşgul session, adıyla kendi girintili satırında yazılır (en fazla üçü, geri kalanı `+N more`). Bu bilgi Claude Code'un kayıtlarından okunur: `<config dizini>/sessions/<pid>.json`. Pid'i artık çalışmayan bir dosya (çöken bir session bu dosyayı geride bırakır) tek bir `ps` ile kontrol edilir ve dışarıda bırakılır. Başka bir session yoksa satır yazılmaz.
- Git satırı: branch (ya da `detached at <sha>`); staged, modified, untracked ve conflicted dosyalar; upstream'in önünde ve arkasında olan commit'ler (`↑1 ↓0` ya da `no upstream`). Yalnız durum renklidir: `clean` yeşil, değişen dosyaların her sayısı sarı, bir conflict kırmızı, bir commit sayısı sıfırdan büyükse sarı, sıfırsa soluk, `no upstream` soluk renktedir. Bir repository dışında satır `git: this folder is not a git repository` gösterir. Git başka bir dilde çalışsa da satır değişmez, çünkü git C locale'i ile çalıştırılır.

**Bir status line.** Sidebar kapalıysa ya da yüklü değilse section'ın yerine status line kullanılır:

    session-watch: ctx 56% · 557k / 1.0M · $0.11 · CR 557k · CW 502 · CH 99% · main*

Status line context doluluğunu, maliyeti, ana loop'un son isteğinin cache dağılımını (section'daki ctx satırındaki gibi) ve branch'i gösterir. Session'ın bir sonraki isteğine kadar dağılım, transcript'in kaydettiği son cevabın dağılımıdır. Bir git repository'si dışında branch yazılmaz. Branch'ten sonraki `*`, değişiklik içeren bir working tree'yi gösterir. Sidebar section'ı gösterdiği sürece status line temizlenir.

## Ne zaman okur

- Session başında.
- Her ana loop turn'ünün sonunda.
- `git` içeren her Bash komutundan sonra. Böylece bir commit, checkout ya da pull hemen görünür.
- İnteraktif bir session'da her 10 saniyede bir. Böylece session dışında yapılan bir değişiklik (örneğin başka bir terminaldeki bir checkout) da görünür. Önceki 30 saniyelik timer ile ölçüldü: dışarıdan stage'lenen bir dosya, bir tick içinde `1 untracked` satırını `1 staged` olarak değiştirdi.
- Bir plugin'in kendi model çağrısından (`$.model.fork`, `$.model.complete`) ya da bir compaction'dan sonra. Böylece memory-save'in turn sonundaki fork'u hemen görünür. Yeniden çizim bir timer'dan çalışır. Bu yüzden çağrıyı yapan taraf git'in çalışmasını beklemez.
- `/session-watch` çağrısında. Bu komut section'ın satırlarını da yazar.

Her okuma, session'ın başladığı dizinde bir kez `git status --porcelain=v2 --branch` çalıştırır. Başarısız bir okuma log'a bir kez `cannot read the session: <hata>` olarak yazılır.

## Komut

    /session-watch    section'ın satırları, şimdi okunmuş hâliyle

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install session-watch@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. [sidebar](../sidebar) modunu yükleyin ve `/sidebar` ile açın. Sidebar yoksa mod status line'ı yazar.
3. `git` yükleyin. Git yoksa git satırı hatayı gösterir.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, turn.step, turn.complete, model.fork, model.complete, session.compact, tool.call{tool=Bash}, command.run{command=session-watch}
    ❯ ./register.ts calls: $.clock.after (via countCall, startTotals), $.clock.every, $.command.register, $.env.get (via configDirOf, readTail), $.fs.exists (via readOthers, readTail, transcriptsOf), $.fs.list (via readOthers, transcriptsOf), $.fs.read (via readOthers), $.fs.stat (via tailWithResponse, transcriptsOf), $.process.run (via livePids, readGit, tailWithResponse), $.process.spawn (via followOne, readTotals), $.session.id, $.session.model (via readNow), $.session.root, $.session.usage (via readNow), $.session.version, $.settings.read (via readTail), $.sidebar.set (via show), $.store.get (via keepTotals, startTotals), $.store.set (via keepTotals)
    ❯ ./register.ts calls: $.ui.log (via refresh, seedFromTail, seedTotals, startTotals, tryFollow), $.ui.status (via show)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CODE_EFFORT_LEVEL, CLAUDE_CONFIG_DIR, HOME

Reach L2: git, ps, head ve tail çalıştırır.

    1. Okur:         session'ın usage değerlerini (context, maliyet), modelini, id'sini, başlangıç dizinini ve engine sürümünü; diğer session'ların <config dizini>/sessions/*.json altındaki kayıt dosyalarını (pid, session id, durum, ad, başlangıç dizini; yanlarındaki .key dosyalarını hiçbir zaman); her turn'ün token sayılarını, her plugin model çağrısının ve compaction'ın usage değerini ve her isteğin effort ayarını; session başında bir kez, ana transcript'in son 256 KiB'ındaki (orada cevap yoksa 1 MB, ardından 4 MB) son cevabın kaydettiği effort'u ve token dağılımını, bunlar yoksa CLAUDE_CODE_EFFORT_LEVEL'ı ya da settings'teki effortLevel'ı; git içerip içermediğini görmek için her Bash komutunun metnini; toplamları saklanmamış her session'da bir kez, <config dizini>/projects/ altındaki transcript'leri, yalnız model cevaplarının usage alanını
    2. Çalıştırır:   her okumada session'ın başlangıç dizininde git status --porcelain=v2 --branch; her okumada diğer session'ların pid'leri için ps -o pid= -p <pid'ler>; her transcript için bir kez head -c <boyut>; hiçbir hook'un bildirmediği thinking token'ları için ana loop'un her isteğinden sonra onun transcript'inde ve her turn sonunda büyüyen her transcript'te tail -c +<offset>; session başında bir kez, son kaydedilen effort ve dağılım için ana loop'un transcript'inde tail -c 262144, cevap bulunmazsa 1048576 ve 4000000 ile yeniden, bir cevap bulunana kadar her okumada tekrar; interaktif bir session'da 10 saniyelik bir timer
    3. Gönderir:     makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       son 20 session'ın token toplamlarını $.store içinde
    5. Düşman girdi: git'in çıktısı satır biçimine göre parse edilir ve yalnız sayılır; bir transcript satırı JSON olarak parse edilir ve yalnız dört token sayısı eklenir, başka tipte bir sayı hiçbir şey eklemez; başka biçimde saklanmış bir değer yok sayılır

## Sınırlar

- Engine'in kendi yan çağrıları (`/cost`'taki `haiku` satırının bir kısmı) hiçbir hook'a ulaşmaz ve sayılmaz. 2.1.282 üzerinde ölçüldü: bir probe session'ında 902 haiku input token'ının 888'i. `$.model.classify` usage bildirmez ve o da sayılmaz. `cost` her isteği sayar.
- Modül yüklenmeden önce yapılan bir plugin model çağrısı ya da compaction hiçbir kayıt bırakmaz. Bu yüzden mod yüklenmeden önce açılmış bir session bunları hiçbir zaman saymaz.
- Transcript'lerin boyutlarının okunduğu anda çalışan bir turn iki kez sayılabilir: o andan önce yazılan cevapları transcript'ten okunur, `turn.complete` de bütün turn'ü ekler.
- Session'ın ayarı her ana loop isteğinden önce okunur. İsteğin gerçekten gönderildiği effort ise istekten sonra zincirin trace'inden okunur (`next.trace`, en alttaki halkanın input'u). 2.1.283 üzerinde sidebar açıkken ölçüldü: `medium` ayarlı bir session'da effort-auto'nun `low` ile gönderdiği turn `effort low (session medium)` olarak okundu. Puanlanmayan sonraki turn `effort medium` olarak okundu. Ana loop'un turn'ü bittiğinde satır yeniden yalnız ayarı gösterir, çünkü değiştirilen bir effort en fazla bir turn sürer. Bir turn'ün ilk isteği çalışırken satır yalnız ayarı gösterir, çünkü o isteğin hangi effort ile gönderildiği ancak istek bittiğinde bilinir. Bir subagent'ın kendi ayarı gösterilmez.
- `git status` session'ın başladığı dizini okur. Bash'te başka bir repository'ye yapılan bir `cd` bu dizini değiştirmez.
- Git'i adını yazmadan bir script ile çalıştıran bir Bash komutu, git satırını yalnız turn sonunda ya da timer'da yeniler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
