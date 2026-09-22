# context-restore

Compaction'ın kestiği her skill ve command'ın tam metnini geri koyan ve session sırasında diskte değişen bir skill, command ya da rules dosyasının yeni metnini modele veren bir Claude Code Mod'u.

## Ne yapar

1. Bir skill ya da command her açıldığında (`/name` yazılarak, Skill tool ile çağrılarak ya da bir subagent'a önceden yüklenerek) mod, modelin okuduğu metni, metnin geldiği dosyayı ve o dosyanın son yazılma zamanını kaydeder. Bir skill dizinini ilk satırında adlandırır (`Base directory for this skill: <dizin>`), yani dosyası `<dizin>/SKILL.md` olur. Bir command'ın dosyası aranır: `<plugin>:<ad>` için plugin'in `commands/<ad>.md` dosyası, değilse projenin ya da sizin `commands/<ad>.md` dosyanız. Built-in bir command'ın dosyası yoktur.
2. Bir compaction'dan sonra engine kullanılan skill'leri modele tek bir `invoked_skills` attachment'ı ile geri verir ve 20.000 karakterden uzun bir skill'i `[... skill content truncated for compaction; use Read on the skill path if you need the full text]` satırıyla keser (2.1.280 üzerinde ölçüldü). Mod bu attachment'ı istek gitmeden önce yeniden yazar: her skill ve command, session onu kullandığında modelin okuduğu metni alır. Yeni bir process'te resume edilen bir session'da böyle bir kayıt yoktur, bu durumda metin dosyadan gelir.
3. Mod, `instructions` attachment'ının taşıdığı her rules dosyasını kaydeder (her biri `Contents of <yol> (` ile başlar ve yalnız içinde `/rules/` geçen yol sayılır). Rules bir compaction'dan bütün olarak çıkar (ölçüldü: aynı metin yeniden gönderilir), bu yüzden bir rules dosyası yalnız değişiklik için izlenir.
4. Gönderdiğiniz her prompt'ta mod kaydettiği her dosyanın son yazılma zamanına bakar. Session onu okuduktan sonra yazılmış bir dosya, o prompt ile modele yalnız modelin okuduğu bir not olarak gider: dosya ve öncekinin yerine geçen güncel metni. Her değişiklik bir kere gönderilir.
5. Her olay için [sidebar](../sidebar) stream'inde, sidebar kapalıyken transcript'te tek satır okursunuz:

       context-restore: restored after compaction: commit, no-ai
       context-restore: changed on disk, the new text went to the model: context7.md

6. `/context-restore` ayarı, kaç skill, command ve rules dosyasının izlendiğini ve son olayı yazar.

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

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=context-restore}, skill.prompt, prompt.attachment{type=invoked_skills}, prompt.attachment{type=instructions}, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.env.get, $.fs.exists (via commandFileOf, fullTextOf, mtimeOf, pluginDirs), $.fs.read (via changedRules, pluginDirs, readBody), $.fs.stat (via mtimeOf), $.sidebar.set (via toPerson), $.store.get, $.store.set (via setEnabled), $.ui.log (via changeNotes, recordUse, restoreSkills, toPerson)
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1, dosya okur.

    1. Okur:     session'ın açtığı her skill ve command'ın metnini; kullandığı skill, command ve rules dosyalarını ve son yazılma zamanlarını; bir plugin'in command dosyasını bulmak için host'un installed_plugins.json dosyasını
    2. Çalıştırır: hiçbir şey
    3. Gönderir: modele, bir compaction'dan sonra kullanılan skill ve command'ların tam metnini, ve diskte değişen kullanılmış bir dosyanın metnini
    4. Saklar:   $.store içinde on/off ayarını; kaydedilen metinler bellekte yaşar ve session ile biter
    5. Düşman girdi: gönderilen her metin session'ın kendisinin kullandığı bir dosyadır; düşman metin taşıyan bir skill ya da rules dosyası mod onu yeniden göndermeden önce zaten context'teydi

## Sınırlar

- Tam metin kesik olandan büyüktür: 50 KB'lık bir skill her compaction'dan sonra context'te bütün boyutuna mal olur. `/context-restore off` engine'in kesmesini korur.
- Diskten okunan bir dosya (resume edilen bir session ya da bir değişiklik) yazıldığı gibi gönderilir; frontmatter'ı atılır ve `$ARGUMENTS` doldurulmaz.
- Değişen bir dosya modele yazıldığı anda değil, sonraki prompt ile gider.
- Dosyası mod'un baktığı iki yerde de olmayan bir command (`--plugin-dir` ile yüklenen bir plugin, iç içe bir command adı) kaydından geri konur, dosyasındaki bir değişiklik görülmez.
- CLAUDE.md izlenmez.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
