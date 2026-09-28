# desk-notify

Bir session'ı bir pencerede çalışır bırakıp başka bir pencereye geçiyorsun. Bu arada model sana bir soru soruyor, plan onayını bekliyor ya da turn'ünü bitiriyor ve hiçbir şey seni haberdar etmiyor. Bu mod o anlarda bir masaüstü bildirimi gönderir; böylece hiçbir session sen fark etmeden beklemez.

## Ne yapar

1. Model `AskUserQuestion` çağırınca, soru seni beklemeye başlamadan önce `Question awaiting your answer` gönderir.
2. Model `ExitPlanMode` çağırınca, onay seni beklemeye başlamadan önce `Plan awaiting your approval` gönderir.
3. Bir ana loop turn'ü bitince (`Stop`) `Turn finished` gönderir. Bir subagent'ın bitişi `SubagentStop`'tur ve bildirim göndermez.
4. Bir API hatası turn'ü bitirince (`StopFailure`) hatanın ilk satırıyla birlikte `Turn failed` gönderir; satır 60 karakterde kesilir ve markdown işaretlerinden arındırılır. Hata metni yoksa turn'ün son kelimeleri onun yerine geçer.
5. Her bildirim `Claude Code` alt başlığını ve proje adını taşır: ana repository (git worktree'de de), yoksa git kökü, o da yoksa session'ın dizini. Ad session başlarken bir kez okunur, böylece bir shell `cd`'si onu değiştirmez.

Bildirim komutu hemen döner ve 5 saniye sonra sonlandırılır; böylece takılan bir bildirim servisi hiçbir tool çağrısını bekletmez:

| Masaüstü | Komut |
|---|---|
| macOS | `osascript -e 'display notification ...'` |
| Linux | `notify-send <başlık> <alt başlık ve gövde>` (alt başlık alanı yoktur) |
| Windows | hiçbir zaman bir tıklamayı beklemeyen bir PowerShell toast'ı |

Masaüstü session başına bir kez okunur: `OS=Windows_NT` Windows demektir, değilse `uname -s` `Darwin` ya da `Linux` der. Başka bir sistemde mod bunu bir kez söyler ve hiçbir şey göndermez. Bildirim komutu başarısız olursa ya da bulunamazsa mod bunu bir transcript satırıyla bir kez söyler; farklı bir hata gelene kadar tekrarlamaz.

2.1.282'deki canlı denemede model `AskUserQuestion` ile bir soru sordu; soru ekrana gelmeden önce `osascript` çalıştı ve exit 0 ile bitti.

## Komut

    /desk-notify                  masaüstü ve her olayın ayarı (/desk-notify status da olur)
    /desk-notify ask on | off     cevabını bekleyen bir soru
    /desk-notify plan on | off    onayını bekleyen bir plan
    /desk-notify stop on | off    biten ya da başarısız olan bir turn

Her olay varsayılan olarak açıktır ve ayarı session'lar arasında korunur. Tek başına bir `on` ya da `off` yoktur: olayları tek tek açıp kapatırsın.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install desk-notify@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. macOS'ta bildirim görünmüyorsa Sistem Ayarları > Bildirimler'de `osascript` bildirimlerinin göründüğü uygulamayı kontrol et. Linux'ta `notify-send`'i (`libnotify`) kur.
3. Bu bildirimleri zaten gönderen kendi hook'un varsa onu kaldır, yoksa her olay iki kez bildirim gönderir.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=desk-notify}, tool.call{tool=/"^AskUserQuestion$"/}, tool.call{tool=/"^ExitPlanMode$"/}, classic.Stop, classic.StopFailure
    ❯ ./register.ts calls: $.command.register, $.env.get (via readPlatform), $.process.run (via gitOut, readPlatform, send), $.session.cwd (via readProject), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log
    ❯ ./register.ts env reads: OS

Reach L2: process çalıştırır.

    1. Okur:     OS değişkenini, her çağrının tool adını, başarısız bir turn'ün hata metnini ve son asistan mesajını
    2. Çalıştırır: session başına bir kez uname -s ve iki git rev-parse çağrısı; bildirim başına bir osascript, notify-send ya da powershell.exe
    3. Gönderir: sabit bir başlık, proje adı ve başarısız bir turn için hatanın 60 karakterini taşıyan bir masaüstü bildirimi; modele hiçbir şey, makineden dışarı hiçbir şey
    4. Saklar:   $.store içinde her olayın açık/kapalı ayarını
    5. Düşman girdi: proje adı ve hata metni AppleScript ve PowerShell string literal'leri için escape edilir, notify-send'e tek bir argv öğesi olarak geçer; ikisi de bir komut çalıştıramaz

## Sınırlar

- macOS bildiriminin kendine ait bir simgesi yoktur, çünkü `display notification` simge argümanı almaz.
- Senin yarıda kestiğin bir turn'ün `Stop` tetikleyip tetiklemediği ölçülmedi.
- Linux ve Windows komutları canlı olarak ölçülmedi.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
