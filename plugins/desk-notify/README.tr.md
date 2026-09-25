# desk-notify

Bir soru ya da bir plan cevabınızı beklerken ve bir tur bittiğinde ya da düştüğünde masaüstü bildirimi gönderen bir Claude Code Mod'u. Başka bir pencerede duran bir session fark edilmeden beklemez.

## Ne yapar

1. Model `AskUserQuestion` çağırınca mod, soru sizi beklemeye başlamadan önce `Question awaiting your answer` gönderir.
2. Model `ExitPlanMode` çağırınca, onay sizi beklemeye başlamadan önce `Plan awaiting your approval` gönderir.
3. Bir ana döngü turu bitince (`Stop`) `Turn finished` gönderir. Bir subagent'ın bitişi `SubagentStop` olayıdır ve hiçbir şey göndermez.
4. Bir API hatası bir turu bitirince (`StopFailure`) `Turn failed` gönderir; yanında hatanın ilk satırı, 60 karakterde kesilmiş ve markdown işaretleri atılmış olarak durur. Hata metni yoksa turun son sözleri onun yerini alır.
5. Her bildirim `Claude Code` subtitle'ını ve proje adını taşır: git worktree içinde de ana repository, yoksa git kökü, yoksa session'ın dizini. Ad session başında bir kere okunur, yani bir shell `cd` onu değiştirmez.

Bildirim komutu hemen döner ve 5 saniye sonra öldürülür, yani takılan bir bildirim daemon'ı hiçbir tool çağrısını bekletmez:

| Masaüstü | Komut |
|---|---|
| macOS | `osascript -e 'display notification ...'` |
| Linux | `notify-send <title> <subtitle ve gövde>` (subtitle alanı yoktur) |
| Windows | hiçbir tıklamayı beklemeyen bir PowerShell toast'ı |

Masaüstü session başına bir kere okunur: `OS=Windows_NT` Windows'u adlandırır, yoksa `uname -s` `Darwin` ya da `Linux` adını verir. Başka bir sistemde mod bunu bir kere söyler ve hiçbir şey göndermez. Başarısız olan ya da bulunmayan bir bildirim komutu, başka bir hata onun yerini alana kadar, bir kere transcript satırı olarak raporlanır.

2.1.282 üzerindeki canlı kontrolde modelin `AskUserQuestion` ile sorduğu bir soru, soru görünmeden önce `osascript`'i exit 0 ile çalıştırdı.

## Komut

    /desk-notify                  masaüstü ve her olayın ayarı
    /desk-notify ask on | off     cevabınızı bekleyen bir soru
    /desk-notify plan on | off    onayınızı bekleyen bir plan
    /desk-notify stop on | off    biten ya da düşen bir tur

Her olay varsayılan olarak on'dur ve ayarı session'lar arasında saklanır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install desk-notify@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. macOS'ta bildirim görünmezse System Settings > Notifications içinde `osascript` bildirimlerinin altında göründüğü uygulamayı kontrol edin. Linux'ta `notify-send`'i (`libnotify`) kurun.
3. Bu bildirimleri zaten gönderen kendi hook'unuzu kaldırın, yoksa her olay iki bildirim gönderir.

## Nereye uzanır

Claude Code 2.1.282 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=desk-notify}, tool.call{tool=/"^AskUserQuestion$"/}, tool.call{tool=/"^ExitPlanMode$"/}, classic.Stop, classic.StopFailure
    ❯ ./register.ts calls: $.command.register, $.env.get (via readPlatform), $.process.run (via gitOut, readPlatform, send), $.session.cwd (via readProject), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log
    ❯ ./register.ts env reads: OS

Reach L2, process çalıştırır.

    1. Okur:     OS değişkenini, her çağrının tool adını, ve düşen bir turun hata metnini ve son assistant mesajını
    2. Çalıştırır: session başına bir kere uname -s ve iki git rev-parse; her bildirim için bir osascript, notify-send ya da powershell.exe
    3. Gönderir: sabit bir başlık, proje adı ve düşen bir turda hatanın 60 karakteri ile bir masaüstü bildirimi; model'e hiçbir şey, makineden dışarı hiçbir şey
    4. Saklar:   $.store içinde her olayın on/off ayarını
    5. Düşman girdi: proje adı ve hata metni AppleScript ve PowerShell string literal'leri için escape edilir ve notify-send'e tek bir argv elemanı olarak geçer, yani ikisi de komut çalıştıramaz

## Sınırlar

- macOS bildiriminin kendi ikonu yoktur: `display notification` ikon argümanı almaz.
- Sizin kestiğiniz bir turun `Stop` olayı raise edip etmediği ölçülmedi.
- Linux ve Windows komutları canlı ölçülmedi.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
