# session-watch

Context'in ne kadar dolu olduğu, session'ın neye mal olduğu, son isteğin hangi effort'la gittiği ve branch'in ne durumda olduğu `/context`, `/cost`, `/model` ve bir git çağrısı arasında dağılmıştır; hiçbiri ekranda kalmaz. Bu mod bu session'ın durumunu [sidebar](../sidebar)'da tutar: context doluluğu, token toplamları, maliyet, model ve effort, Claude Code sürümü, bu makinedeki diğer session'lar, git branch'i ve durumu.

## Ne gösterir

**Sidebar'ın en üstünde bir bölüm** (`order: 5`), Claude Code 2.1.282 üzerinde ölçüldü:

    session-watch: session
    ctx 8% · 81k / 1.0M · CR 74k · CW 7k · CH 91%
    tokens T 81k · I 2 · O 8 · TH 5 · CR 74k · CW 7k · CH 91%
    cost $0.07
    model opus-5-5[1m] · effort medium
    Claude Code 2.1.282
    sessions: 2 others · 1 busy · 1 idle
      cors-fix
    main · 1 untracked · no upstream

- `ctx`: son cevabın input token'ı, modelin context window'u ve ikisinin oranı. %50 altı yeşil, %50 ile %80 arası sarı, %80 üstü kırmızı. Üç değeri de engine verir (`$.session.usage().context`), mod hiçbirini hesaplamaz. Ardından main loop'un son model isteğinin, yani pencereyi şu an tutan isteğin cache read ve cache write token'ları ve o isteğin cache hit'i gelir (`CH`, tokens satırındakiyle aynı ölçü). İsteğin cache'lenmemiş input'u (cache'li bir session'da cache'in ötesindeki birkaç token, çoğu zaman 1 ya da 2) ve output'u tokens satırında kalır. Bir subagent'ın isteğinin kendi penceresi vardır ve satırı değiştirmez. Yalnız yüzdeler renklenir. İlk cevaptan önce satır `ctx: no reply yet` yazar.
- `tokens`: session'ın toplamları: `T` hepsi, `I` input, `O` output, `TH` thinking token'ları, `O`'nun bir parçası, `CR` cache read, `CW` cache write ve `CH` cache hit: input token'larının cache'ten okunan payı, `CR / (I + CR + CW)`, aşağı yuvarlanır, böylece tek bir soğuk write'ı olan bir session hiçbir zaman %100 okumaz. Yalnız yüzde renklenir: %90 ve üstü yeşil, %70 ile %90 arası sarı, %70 altı kırmızı. İlk input'tan önce yazılmaz. Toplamı tutulmamış bir session, toplamları bir kez kendi transcript'lerinden (main loop'unkinden ve her subagent'ınkinden) okur ve her model cevabını bir kez sayar. Ondan sonra her turn kendi token'larını ekler, bir subagent'ınki de. Hiçbir transcript'in kaydetmediği bir request döndüğü anda sayılır: bir plugin'in kendi model çağrısı (`$.model.fork`, `$.model.complete`, örneğin memory-save'in her turn sonunda çalıştırdığı fork) ve bir compaction özeti. 2.1.282 üzerinde ölçüldü: 16 input token'lık bir fork ve 14'lük bir completion `I`'yı 2'den 32'ye çıkardı. Bir fork `turn.complete` tetiklemez, bu yüzden bir kez sayılır. Toplamlar session başına `$.store` içinde tutulur, böylece reload edilen bir modül kaldığı yerden devam eder. Transcript'ler okunurken satır `tokens: reading the transcripts` yazar. 2.1.282 üzerinde resume edilen bir session'da ölçüldü: toplamlar `/cost`'un session modeline ait satırına eşitti, `6 input, 19 output, 222.3k cache read, 21.5k cache write`.
  Hiçbir hook'un usage'ı thinking token'larını taşımaz (2.1.283 üzerinde ölçüldü: bir isteğin hook usage'ı input, output ve cache sayılarını tutuyordu, transcript satırı ise yanlarında `output_tokens_details.thinking_tokens: 8` tutuyordu). Bu yüzden `TH` transcript'lerden okunur: bir kez baştan sona, sonra yalnız her transcript'in son okumadan beri eklenen kısmı. `TH`'den önce tutulmuş toplamlar sayılarını korur, çünkü onlar hiçbir transcript'in kaydetmediği plugin model çağrılarını içerir; transcript'lerden bir kez yalnız thinking okunur.
- `cost`: session'ın maliyeti, `/cost`'un toplamı olarak ABD doları.
- `model`: main loop'un modeli ve main loop'un son model request'inin effort'u: `low` ile `max` arası, bir budget, effort'u olmayan bir model için `no effort setting`, ya da hiçbir şey bir effort söylemiyorsa `effort: not read yet`. İlk request'ten önce satır, transcript'teki son cevabın kaydettiği effort'u gösterir (devam ettirilen bir session); yoksa `CLAUDE_CODE_EFFORT_LEVEL`, o da yoksa settings'teki `effortLevel` değerini. session-watch'ın altındaki bir hook o request'i session ayarından farklı bir effort ile gönderdiyse, örneğin effort-auto, satır ikisini birden gösterir, ayar soluk: `effort low (session medium)`. Modelin adı ailesine göre renklenir, en pahalısı en sıcak renkte: opus kırmızı, fable sarı, sonnet yeşil, haiku soluk. Effort seviyesi ne kadar zorladığına göre renklenir: `low` soluk, `medium` yeşil, `high` sarı, `xhigh` ve `max` kırmızı. Tek bir kelimeyi renklendirmek için sidebar 0.11.0 veya sonrası gerekir; daha eski bir sidebar satırı tek renkle çizer.
- `Claude Code`: engine'in sürümü.
- `sessions`: bu makinedeki, aynı hesabın kullanım limitlerini harcayan diğer canlı Claude Code session'ları: kaç tane oldukları, meşgul olanlar sarı renkte sayı olarak, boşta olanlar sayı olarak, ardından her meşgul session kendi girintili satırında adıyla (en çok üçü, gerisi `+N more`). Claude Code'un kayıtlarından okunur, `<config dizini>/sessions/<pid>.json`; pid'i artık çalışmayan bir dosya (çöken bir session onu geride bırakır) tek bir `ps` ile kontrol edilip dışarıda bırakılır. Başka session yoksa satır yazılmaz.
- Git satırı: branch (ya da `detached at <sha>`), staged, modified, untracked ve conflicted dosyalar, upstream'in önünde ve arkasında olan commit'ler (`↑1 ↓0`, ya da `no upstream`). Yalnız durum renklenir: `clean` yeşil, değişen dosyaların her sayısı sarı, bir conflict kırmızı, bir commit sayısı sıfırdan büyükken sarı ve sıfırken soluk, `no upstream` soluk. Bir repository dışında `git: this folder is not a git repository` yazar. Makinenin dili başka olsa da satır değişmez, çünkü git C locale'iyle çalışır.

**Bir status line**, sidebar kapalıyken ya da kurulu değilken bölümün yerine:

    session-watch: ctx 56% · 557k / 1.0M · $0.11 · CR 557k · CW 502 · CH 99% · main*

Satır context doluluğunu, maliyeti, main loop'un son request'inin cache dağılımını (bölümdeki ctx satırındaki gibi) ve branch'i tutar. Dağılım, session'ın sonraki request'ine kadar transcript'in kaydettiği son cevabın dağılımıdır, branch ise bir git repository'si dışında yazılmaz. Branch'ten sonraki `*`, değişiklik olan bir ağacı işaretler. Sidebar bölümü tuttuğu sürece status line temizlenir.

## Ne zaman okur

- Session başında.
- Her main loop turn'ünün sonunda.
- `git` adını geçen her Bash komutundan sonra, böylece bir commit, checkout ya da pull hemen görünür.
- Interactive bir session'da her 10 saniyede bir, böylece session dışında yapılan bir değişiklik (başka bir terminalde bir checkout) da görünür. Önceki 30 saniyelik timer ile ölçüldü: dışarıdan stage edilen bir dosya, bir tick içinde `1 untracked` satırını `1 staged` yaptı.
- Bir plugin'in kendi model çağrısından (`$.model.fork`, `$.model.complete`) ya da bir compaction'dan sonra, böylece memory-save'in turn sonundaki fork'u hemen görünür. Yeniden çizim bir timer'dan çalışır, bu yüzden çağrıyı yapan taraf onun git çalıştırmasını beklemez.
- `/session-watch` çağrısında. Bu komut bölümün satırlarını da yazar.

Her okuma, session'ın başladığı dizinde bir kez `git status --porcelain=v2 --branch` çalıştırır. Başarısız bir okuma bir kez `cannot read the session: <hata>` olarak loglanır.

## Komut

    /session-watch    bölümün satırları, şimdi okunmuş

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install session-watch@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. [sidebar](../sidebar) mod'unu kur ve `/sidebar` ile aç. O olmadan mod status line'ı yazar.
3. `git` kur. O olmadan git satırı hatayı yazar.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, turn.step, turn.complete, model.fork, model.complete, session.compact, tool.call{tool=Bash}, command.run{command=session-watch}
    ❯ ./register.ts calls: $.clock.after (via countCall, startTotals), $.clock.every, $.command.register, $.env.get (via configDirOf, readTail), $.fs.exists (via readOthers, readTail, transcriptsOf), $.fs.list (via readOthers, transcriptsOf), $.fs.read (via readOthers), $.fs.stat (via tailWithResponse, transcriptsOf), $.process.run (via livePids, readGit, tailWithResponse), $.process.spawn (via followOne, readTotals), $.session.id, $.session.model (via readNow), $.session.root, $.session.usage (via readNow), $.session.version, $.settings.read (via readTail), $.sidebar.set (via show), $.store.delete (via startTotals), $.store.get (via keepTotals, startTotals), $.store.set (via keepTotals), $.ui.log (via refresh, seedFromTail, seedTotals, startTotals, tryFollow), $.ui.status (via show)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CODE_EFFORT_LEVEL, CLAUDE_CONFIG_DIR, HOME

Reach L2: git, ps, head ve tail çalıştırır.

    1. Okur:     session'ın usage değerlerini (context, maliyet), modelini, id'sini, başlangıç dizinini ve engine sürümünü; diğer session'ların <config dizini>/sessions/*.json altındaki kayıt dosyalarını (pid, session id, durum, ad, başlangıç dizini; yanlarındaki .key dosyalarını asla); her turn'ün token sayılarını, her plugin model çağrısının ve compaction'ın usage'ını ve her request'in effort ayarını; session başında bir kez, ana transcript'in son 256 KiB'ındaki (orada cevap yoksa 1 MB, sonra 4 MB) son cevabın kaydettiği effort'u ve token dağılımını, yoksa CLAUDE_CODE_EFFORT_LEVEL'ı ya da settings'teki effortLevel'ı; git adını geçip geçmediğini görmek için her Bash komutunun metnini; toplamı tutulmamış her session'da bir kez, <config dizini>/projects/ altındaki transcript'lerini, yalnız model cevaplarının usage alanını
    2. Çalıştırır: her okumada session'ın başlangıç dizininde git status --porcelain=v2 --branch; her okumada diğer session'ların pid'leri üzerinde ps -o pid= -p <pid'ler>; her transcript üzerinde bir kez head -c <boyut>; hiçbir hook'un bildirmediği thinking token'ları için main loop'un her isteğinden sonra onun transcript'inde ve her turn sonunda büyüyen her transcript'te tail -c +<offset>; session başında bir kez, son kaydedilen effort ve dağılım için main loop'un transcript'inde tail -c 262144, cevap bulunmazsa 1048576 ve 4000000 ile yeniden, bulunana kadar her okumada tekrar; interactive bir session'da bir 10 saniyelik timer
    3. Gönderir: makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde son 20 session'ın token toplamlarını
    5. Düşman girdi: git'in çıktısı satır biçimine göre parse edilir ve yalnız sayılır; bir transcript satırı JSON olarak parse edilir ve yalnız dört token sayısı eklenir, başka tipte bir sayı hiçbir şey eklemez; başka biçimde saklanmış bir değer yok sayılır

## Sınırlar

- Engine'in kendi yan çağrıları (`/cost`'taki `haiku` satırının bir kısmı) hiçbir hook'a ulaşmaz ve sayılmaz; 2.1.282 üzerinde ölçüldü, bir probe session'ında 902 haiku input token'ının 888'i. `$.model.classify` usage bildirmez ve o da sayılmaz. `cost` her request'i sayar.
- Modül yüklenmeden önce yapılmış bir plugin model çağrısı ya da compaction hiçbir kayıt bırakmadı, bu yüzden kurulumdan önce açılmış bir session onları kalıcı olarak kaçırır.
- Transcript'lerin boyutlarının okunduğu anı aşan bir turn iki kez sayılabilir: o andan önce yazılan cevapları transcript'ten okunur, `turn.complete` de bütün turn'ü ekler.
- Session'ın ayarı her main loop request'inden önce okunur. Request'in gerçekten gönderildiği effort ise request'ten sonra zincirin trace'inden okunur (`next.trace`, en alttaki halkanın input'u). 2.1.283 üzerinde sidebar açıkken ölçüldü: `medium` ayarlı bir session'da effort-auto'nun `low` ile gönderdiği turn `effort low (session medium)` olarak okundu, puanlanmayan sonraki turn `effort medium` olarak okundu. Main loop'un turn'ü bitince satır yeniden yalnız ayarı gösterir, çünkü değiştirilen bir effort en fazla bir turn sürer. Bir turn'ün ilk request'i sürerken satır yalnız ayarı gösterir, çünkü o request'in hangi effort ile gittiği ancak request bitince bilinir. Bir subagent'ın kendi ayarı gösterilmez.
- `git status` session'ın başladığı dizini okur; başka bir repository'ye yapılan bir Bash `cd` onu taşımaz.
- git'i adını geçmeden bir script üzerinden çalıştıran bir Bash komutu, git satırını yalnız turn sonunda ya da timer'da yeniler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
