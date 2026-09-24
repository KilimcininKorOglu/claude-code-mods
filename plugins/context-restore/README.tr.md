# context-restore

Bir skill ya da command çağrısına, dosyası session onu yükledikten sonra diskte değiştiyse dosyanın güncel metnini veren ve diskte değişen bir rules dosyasını ya da global CLAUDE.md dosyasını modele veren bir Claude Code Mod'u.

## Ne yapar

Claude Code 2.1.281 üzerinde ölçüldü:

- Engine her skill ve command'ı bir kere yükler ve dosyası diskte değişse de her çağrıda o kopyayı verir. Yazılan bir `/name` eski metni gönderir, bir Skill tool çağrısı `Skill /<name> is already loaded above; instructions unchanged.` cevabını verir.
- Compaction'ın kestiği bir skill yeniden çağrıldığında, yazılarak ya da Skill tool ile, engine onu kendisi bütün olarak yeniden gönderir. Mod bu durumda bir şey yapmaz.
- İki prompt arasında değişen bir rules dosyası ya da global `~/.claude/CLAUDE.md` dosyası bir compaction'a kadar modele ulaşmaz.

Bu yüzden mod iki şey yapar:

1. Bir skill ya da command'ın her çağrısında (`/name` yazılarak, Skill tool ile çağrılarak ya da bir subagent'a önceden yüklenerek) metnin geldiği dosyayı okur. Bir skill dizinini ilk satırında adlandırır (`Base directory for this skill: <dizin>`), yani dosyası `<dizin>/SKILL.md` olur. Bir command'ın dosyası aranır: `<plugin>:<ad>` için plugin'in `commands/<ad>.md` dosyası, değilse projenin ya da sizin `commands/<ad>.md` dosyanız. Built-in bir command'ın dosyası yoktur.
   - Placeholder taşımayan bir dosya engine'in metniyle karşılaştırılır. Farklıysa engine'in kopyasının yerine dosyanın metni konur ve engine'in arkasına eklediği argümanlar (`ARGUMENTS: ...`) kalır. Engine o zaman yeni metni gönderir, bir Skill tool çağrısında da.
   - Placeholder taşıyan bir dosya (`$ARGUMENTS`, `$1`, `${...}`, `` !`...` ``) karşılaştırılamaz, çünkü engine onları doldurmuştur. Dosya session başladıktan sonra yazıldıysa engine'in doldurulmuş metni kalır ve dosyanın güncel metni onun ardından gelir, yukarıdaki talimatların yerine geçtiğini ve yukarıdaki argümanların hâlâ geçerli olduğunu söyleyen bir not ile.
   - Yeniden çağrılmayan bir skill ya da command yeniden gönderilmez.
2. `instructions` attachment'ının taşıdığı her rules dosyasını kaydeder (her biri `Contents of <yol> (` ile başlar ve yalnız içinde `/rules/` geçen yol sayılır), ve global `CLAUDE.md` dosyasını (`~/.claude/CLAUDE.md`, `CLAUDE_CONFIG_DIR` ayarlıysa onun altında). Bir projenin `CLAUDE.md` dosyası sayılmaz. Gönderdiğiniz her prompt'ta, session onu okuduktan sonra yazılmış bir rules dosyası o prompt ile modele yalnız modelin okuduğu bir not olarak gider: dosya ve öncekinin yerine geçen güncel metni. Her değişiklik bir kere gönderilir.

Her olay için [sidebar](../sidebar) stream'inde, sidebar kapalıyken transcript'te tek satır okursunuz:

    context-restore: changed on disk, the call got the current text: commit
    context-restore: changed on disk, the new text went to the model: context7.md

`/context-restore` ayarı, kaç rules dosyasının izlendiğini ve son olayı yazar.

## Komut

    /context-restore            ayar, izlenenler ve son olay
    /context-restore on | off   varsayılan on

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install context-restore@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Olay satırları için [sidebar](../sidebar) mod'unu kurun. O olmadan mod satırları transcript'e yazar.

## Nereye uzanır

Claude Code 2.1.281 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=context-restore}, skill.prompt, prompt.attachment{type=instructions}, prompt.submit
    ❯ ./register.ts calls: $.clock.now, $.command.register, $.env.get, $.fs.exists (via commandFileOf, mtimeOf, pluginDirs), $.fs.read (via changedRules, pluginDirs, readBody), $.fs.stat (via mtimeOf), $.sidebar.set (via toPerson), $.store.get, $.store.set (via setEnabled), $.ui.log
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1, dosya okur.

    1. Okur:     session'ın çağırdığı her skill ve command'ın dosyasını ve son yazılma zamanını; session'ın okuduğu rules dosyalarını ve global CLAUDE.md dosyasını, ve son yazılma zamanlarını; bir plugin'in command dosyasını bulmak için host'un installed_plugins.json dosyasını
    2. Çalıştırır: hiçbir şey
    3. Gönderir: modele, dosyası değişmiş çağrılan bir skill ya da command'ın güncel metnini, ve diskte değişen okunmuş bir rules dosyasının ya da global CLAUDE.md dosyasının bütün metnini
    4. Saklar:   $.store içinde on/off ayarını; rules kayıtları bellekte yaşar ve session ile biter
    5. Düşman girdi: gönderilen her metin session'ın kendisinin kullandığı bir dosyadır; düşman metin taşıyan bir skill ya da rules dosyası modele engine üzerinden de ulaşır

## Sınırlar

- Placeholder taşıyan bir dosya, son yazılma zamanı session'ın başlangıcıyla karşılaştırılarak değişmiş sayılır. `/reload-plugins` sonrası mod reload anından sayar, yani ondan önce yapılan bir değişiklik görülmez.
- Placeholder taşıyan bir dosyanın güncel metni engine'in metninden sonra, placeholder'ları doldurulmadan gelir.
- Dosyası mod'un baktığı iki yerde de olmayan bir command (`--plugin-dir` ile yüklenen bir plugin, iç içe bir command adı) engine'in metnini korur.
- Değişen bir rules dosyası modele yazıldığı anda değil, sonraki prompt ile gider. Değişiklik ile sonraki prompt arasına bir compaction girerse dosyayı engine de gönderir.
- Bir projenin CLAUDE.md dosyası izlenmez; yalnız global olan izlenir.
- Global CLAUDE.md her değişiklikte modele bütün olarak gider, 21 KB'lık bir dosya için yaklaşık 5k token.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
