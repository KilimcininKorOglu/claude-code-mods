# session-watch

Bu session'ın durumunu [sidebar](../sidebar)'da gösteren bir Claude Code Mod'u: context doluluğu, token toplamları, maliyet, model ve thinking seviyesi, Claude Code sürümü, git branch'i ve durumu.

## Ne gösterir

**Sidebar'ın en üstünde bir bölüm** (`order: 5`), Claude Code 2.1.282 üzerinde ölçüldü:

    session-watch: session
    ctx 8% · 81k / 1.0M · CR 74k · CW 7k · CH 91%
    tokens T 81k · I 2 · O 8 · TH 5 · CR 74k · CW 7k · CH 91%
    cost $0.07
    model opus-5-5[1m] · thinking medium
    Claude Code 2.1.282
    sessions: 2 others · 1 busy (cors-fix) · 1 idle
    main · 1 untracked · no upstream

- `ctx`: son cevabın input token'ı, modelin context window'u ve ikisinin oranı. %50 altı yeşil, %50 ile %80 arası sarı, %80 üstü kırmızı. Üç değeri de engine verir (`$.session.usage().context`), mod hiçbirini hesaplamaz. Ardından main loop'un son model isteğinin, yani pencereyi şu an tutan isteğin cache read ve cache write token'ları ve o isteğin cache hit'i gelir (`CH`, tokens satırındakiyle aynı ölçü). İsteğin cache'lenmemiş input'u (cache'li bir oturumda cache'in ötesindeki birkaç token, çoğu zaman 1 ya da 2) ve output'u tokens satırında kalır. Bir subagent'ın isteğinin kendi penceresi vardır ve satırı değiştirmez. İsteğin değerleri satırdayken yalnız iki yüzde renklenir. İlk cevaptan önce satır `ctx: no reply yet` yazar.
- `tokens`: session'ın toplamları: `T` hepsi, `I` input, `O` output, `TH` thinking token'ları, `O`'nun bir parçası, `CR` cache read, `CW` cache write, ve `CH` cache hit: input token'larının cache'ten okunan payı, `CR / (I + CR + CW)`, aşağı yuvarlanır, böylece tek bir soğuk write'ı olan bir session hiçbir zaman %100 okumaz. Yalnız yüzde renklenir: %90 ve üstü yeşil, %70 ile %90 arası sarı, %70 altı kırmızı. İlk input'tan önce yazılmaz. Toplamı tutulmamış bir session, toplamları bir kez kendi transcript'lerinden (main loop'unkinden ve her subagent'ınkinden) okur ve her model cevabını bir kez sayar. Ondan sonra her turn kendi token'larını ekler, bir subagent'ınki de. Hiçbir transcript'in kaydetmediği bir request döndüğü anda sayılır: bir plugin'in kendi model çağrısı (`$.model.fork`, `$.model.complete`, örneğin memory-save'in her turn sonunda çalıştırdığı fork) ve bir compaction özeti. 2.1.282 üzerinde ölçüldü: 16 input token'lık bir fork ve 14'lük bir completion `I`'yı 2'den 32'ye çıkardı, ve bir fork `turn.complete` tetiklemez, bu yüzden bir kez sayılır. Toplamlar session başına `$.store` içinde tutulur, böylece reload edilen bir modül kaldığı yerden devam eder. Transcript'ler okunurken satır `tokens: reading the transcripts` yazar. 2.1.282 üzerinde resume edilen bir session'da ölçüldü: toplamlar `/cost`'un session modeline ait satırına eşitti, `6 input, 19 output, 222.3k cache read, 21.5k cache write`.
  Hiçbir hook'un usage'ı thinking token'larını taşımaz (2.1.283 üzerinde ölçüldü: bir isteğin hook usage'ı input, output ve cache sayılarını tutuyordu, transcript satırı ise yanlarında `output_tokens_details.thinking_tokens: 8` tutuyordu). Bu yüzden `TH` transcript'lerden okunur: bir kez baştan sona, sonra yalnız her transcript'in son okumadan beri eklenen kısmı. `TH`'den önce tutulmuş toplamlar sayılarını korur, çünkü onlar hiçbir transcript'in kaydetmediği plugin model çağrılarını içerir, ve transcript'lerden bir kez yalnız thinking'i okur.
- `cost`: session'ın maliyeti, `/cost`'un toplamı olarak ABD doları.
- `model`: main loop'un modeli ve main loop'un son model request'inin thinking ayarı (`effort`): `low` ile `max` arası, bir budget, effort'u olmayan bir model için `no thinking setting`, ya da ilk request'ten önce `thinking: not read yet`. Modelin adı ailesine göre renklenir, en pahalısı en sıcak renkte: opus kırmızı, fable sarı, sonnet yeşil, haiku soluk. Thinking seviyesi ne kadar zorladığına göre renklenir: `low` soluk, `medium` yeşil, `high` sarı, `xhigh` ve `max` kırmızı. Tek bir kelimeyi renklendirmek için sidebar 0.11.0 veya sonrası gerekir; daha eski bir sidebar satırı tek renkle çizer.
- `Claude Code`: engine'in sürümü.
- `sessions`: bu makinedeki, aynı hesabın kullanım limitlerini harcayan diğer canlı Claude Code session'ları: kaç tane oldukları, meşgul olanlar sarı renkte adlarıyla (en çok üçü, gerisi üç nokta), boşta olanlar sayı olarak. Claude Code'un kayıtlarından okunur, `<config dizini>/sessions/<pid>.json`; pid'i artık çalışmayan bir dosya (çöken bir session onu geride bırakır) tek bir `ps` ile kontrol edilip dışarıda bırakılır. Başka session yoksa satır yazılmaz.
- Git satırı: branch (ya da `detached at <sha>`), staged, modified, untracked ve conflicted dosyalar, upstream'in önünde ve arkasında olan commit'ler (`↑1 ↓0`, ya da `no upstream`). Ağaçta değişiklik varken sarı, temizken yeşil. Bir repository dışında `git: this folder is not a git repository` yazar. Git başka bir dilde konuşan bir makinede de böyledir, çünkü git C locale'i ile çalışır.

**Bir status line**, sidebar kapalıyken ya da kurulu değilken bölümün yerine:

    session-watch: ctx 8% · $0.07 · main*

Branch'ten sonraki `*`, değişiklik olan bir ağacı işaretler. Sidebar bölümü tuttuğu sürece status line temizlenir.

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

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. [sidebar](../sidebar) mod'unu kurun ve `/sidebar` ile açın. O olmadan mod kısa status line'ı yazar.
3. `git` kurun. O olmadan git satırı hatayı yazar.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, turn.step, turn.complete, model.fork, model.complete, session.compact, tool.call{tool=Bash}, command.run{command=session-watch}
    ❯ ./register.ts calls: $.clock.after (via countCall, startTotals), $.clock.every, $.command.register, $.env.get (via configDirOf), $.fs.exists (via readOthers, transcriptsOf), $.fs.list (via readOthers, transcriptsOf), $.fs.read (via readOthers), $.fs.stat (via transcriptsOf), $.process.run (via livePids, readGit), $.process.spawn (via followOne, readTotals), $.session.id, $.session.model (via readNow), $.session.root, $.session.usage (via readNow), $.session.version, $.sidebar.set (via show), $.store.delete (via startTotals), $.store.get (via keepTotals, startTotals), $.store.set (via keepTotals), $.ui.log (via refresh, seedTotals, startTotals, tryFollow), $.ui.status (via show)

Reach L2, git, ps, head ve tail çalıştırır.

    1. Okur:     session'ın usage değerlerini (context, maliyet), modelini, id'sini, başlangıç dizinini ve engine sürümünü; diğer session'ların <config dizini>/sessions/*.json altındaki kayıt dosyalarını (pid, session id, durum, ad, başlangıç dizini; yanlarındaki .key dosyalarını asla); her turn'ün token sayılarını, her plugin model çağrısının ve compaction'ın usage'ını ve her request'in thinking ayarını; git adını geçip geçmediğini görmek için her Bash komutunun metnini; toplamı tutulmamış her session'da bir kez, <config dizini>/projects/ altındaki transcript'lerini, yalnız model cevaplarının usage alanını
    2. Çalıştırır: her okumada session'ın başlangıç dizininde git status --porcelain=v2 --branch; her okumada diğer session'ların pid'leri üzerinde ps -o pid= -p <pid'ler>; her transcript üzerinde bir kez head -c <boyut>; hiçbir hook'un bildirmediği thinking token'ları için main loop'un her isteğinden sonra onun transcript'inde, ve her turn sonunda büyüyen her transcript'te tail -c +<offset>; interactive bir session'da bir 10 saniyelik timer
    3. Gönderir: makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde son 20 session'ın token toplamlarını
    5. Düşman girdi: git'in çıktısı satır biçimine göre parse edilir ve yalnız sayılır; bir transcript satırı JSON olarak parse edilir ve yalnız dört token sayısı eklenir, başka tipte bir sayı hiçbir şey eklemez; başka biçimde saklanmış bir değer yok sayılır

## Sınırlar

- Engine'in kendi yan çağrıları (`/cost`'taki `haiku` satırının bir kısmı) hiçbir hook'a ulaşmaz ve sayılmaz; 2.1.282 üzerinde ölçüldü, bir probe session'ında 902 haiku input token'ının 888'i. `$.model.classify` usage bildirmez ve o da sayılmaz. `cost` her request'i sayar.
- Modül yüklenmeden önce yapılmış bir plugin model çağrısı ya da compaction hiçbir kayıt bırakmadı, bu yüzden kurulumdan önce açılmış bir session onları kalıcı olarak kaçırır.
- Transcript'lerin boyutlarının okunduğu anı aşan bir turn iki kez sayılabilir: o andan önce yazılan cevapları transcript'ten okunur, `turn.complete` de bütün turn'ü ekler.
- Thinking ayarı main loop'un son request'inindir; bir subagent'ın kendi ayarı gösterilmez.
- `git status` session'ın başladığı dizini okur; başka bir repository'ye yapılan bir Bash `cd` onu taşımaz.
- git'i adını geçmeden bir script üzerinden çalıştıran bir Bash komutu, git satırını yalnız turn sonunda ya da timer'da yeniler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
