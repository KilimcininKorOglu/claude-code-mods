# session-watch

Bu session'ın durumunu [sidebar](../sidebar)'da gösteren bir Claude Code Mod'u: context doluluğu, token toplamları, maliyet, model ve thinking seviyesi, Claude Code sürümü, git branch'i ve durumu.

## Ne gösterir

**Sidebar'ın en üstünde bir bölüm** (`order: 5`), Claude Code 2.1.282 üzerinde ölçüldü:

    session-watch: session
    context 8% · 81k / 1.0M
    tokens T 81k · I 2 · O 8 · CR 74k · CW 7k
    cost $0.07
    model opus-5-5[1m] · thinking medium
    Claude Code 2.1.282
    main · 1 untracked · no upstream

- `context`: son cevabın input token'ı, modelin context window'u ve ikisinin oranı. %50 altı yeşil, %50 ile %80 arası sarı, %80 üstü kırmızı. Üç değeri de engine verir (`$.session.usage().context`), mod hiçbirini hesaplamaz. İlk cevaptan önce satır `context: no reply yet` yazar.
- `tokens`: session'ın toplamları: `T` hepsi, `I` input, `O` output, `CR` cache read, `CW` cache write. `/cost` gibi her turn sayılır, bir subagent'ınki de. Toplamlar session başına `$.store` içinde tutulur, böylece reload edilen bir modül kaldığı yerden devam eder.
- `cost`: session'ın maliyeti, `/cost`'un toplamı olarak ABD doları.
- `model`: main loop'un modeli ve main loop'un son model request'inin thinking ayarı (`effort`): `low` ile `max` arası, bir budget, effort'u olmayan bir model için `no thinking setting`, ya da ilk request'ten önce `thinking: not read yet`.
- `Claude Code`: engine'in sürümü.
- Git satırı: branch (ya da `detached at <sha>`), staged, modified, untracked ve conflicted dosyalar, upstream'in önünde ve arkasında olan commit'ler (`↑1 ↓0`, ya da `no upstream`). Ağaçta değişiklik varken sarı, temizken yeşil. Bir repository dışında `git: not a repository` yazar.

**Bir status line**, sidebar kapalıyken ya da kurulu değilken bölümün yerine:

    session-watch: ctx 8% · $0.07 · main*

Branch'ten sonraki `*`, değişiklik olan bir ağacı işaretler. Sidebar bölümü tuttuğu sürece status line temizlenir.

## Ne zaman okur

- Session başında.
- Her main loop turn'ünün sonunda.
- `git` adını geçen her Bash komutundan sonra, böylece bir commit, checkout ya da pull hemen görünür.
- Interactive bir session'da her 30 saniyede bir, böylece session dışında yapılan bir değişiklik (başka bir terminalde bir checkout) da görünür. Ölçüldü: dışarıdan stage edilen bir dosya, 30 saniye içinde `1 untracked` satırını `1 staged` yaptı.
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

Claude Code 2.1.282 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, turn.step, turn.complete, tool.call{tool=Bash}, command.run{command=session-watch}
    ❯ ./register.ts calls: $.clock.every, $.command.register, $.process.run (via readGit), $.session.id, $.session.model (via readNow), $.session.root, $.session.usage (via readNow), $.session.version, $.sidebar.set (via show), $.store.get, $.store.set (via countTurn), $.ui.log (via refresh), $.ui.status (via show)

Reach L2, git çalıştırır.

    1. Okur:     session'ın usage değerlerini (context, maliyet), modelini, id'sini, başlangıç dizinini ve engine sürümünü; her turn'ün token sayılarını ve her request'in thinking ayarını; git adını geçip geçmediğini görmek için her Bash komutunun metnini
    2. Çalıştırır: her okumada session'ın başlangıç dizininde git status --porcelain=v2 --branch; interactive bir session'da bir 30 saniyelik timer
    3. Gönderir: makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde son 20 session'ın token toplamlarını
    5. Düşman girdi: git'in çıktısı satır biçimine göre parse edilir ve yalnız sayılır; başka biçimde saklanmış bir değer yok sayılır

## Sınırlar

- Kurulumdan önce açılmış bir session'da token toplamları, modülün ilk yüklendiği andan başlar.
- Thinking ayarı main loop'un son request'inindir; bir subagent'ın kendi ayarı gösterilmez.
- `git status` session'ın başladığı dizini okur; başka bir repository'ye yapılan bir Bash `cd` onu taşımaz.
- git'i adını geçmeden bir script üzerinden çalıştıran bir Bash komutu, git satırını yalnız turn sonunda ya da timer'da yeniler.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
