# desk-notify

Bir session'ı bir pencerede çalışır hâlde bırakıp başka bir pencereye geçtiğinizi düşünün. Bu sırada model size bir soru sorar, plan onayınızı bekler ya da turn'ünü bitirir. Ancak sizi bundan haberdar eden bir şey yoktur. Bu mod bu anlarda bir masaüstü bildirimi gönderir. Böylece hiçbir session siz fark etmeden beklemez.

## Ne yapar

1. Model `AskUserQuestion` çağırdığında, soru cevabınızı beklemeye başlamadan önce `Question awaiting your answer` bildirimi gönderilir.
2. Model `ExitPlanMode` çağırdığında, plan onayınızı beklemeye başlamadan önce `Plan awaiting your approval` bildirimi gönderilir.
3. Bir ana loop turn'ü bittiğinde (`Stop`) `Turn finished` bildirimi gönderilir. Bir subagent'ın bitişi `SubagentStop` olayıdır ve bildirim göndermez.
4. Bir API hatası turn'ü bitirdiğinde (`StopFailure`) hatanın ilk satırıyla birlikte `Turn failed` bildirimi gönderilir. Satır 60 karakterde kesilir ve markdown işaretleri temizlenir. Hata metni yoksa satırın yerine turn'ün son kelimeleri kullanılır.
5. Her bildirim `Claude Code` alt başlığını ve proje adını taşır. Proje adı şu sırayla belirlenir: ana repository (git worktree içinde de), yoksa git kökü, o da yoksa session'ın dizini. Ad session başında bir kez okunur. Bu yüzden shell'de çalışan bir `cd` adı değiştirmez.

Bildirim komutu hemen döner ve 5 saniye sonra sonlandırılır. Böylece yanıt vermeyen bir bildirim servisi hiçbir tool çağrısını bekletmez:

| Masaüstü | Komut |
|---|---|
| macOS | `osascript -e 'display notification ...'` |
| Linux | `notify-send <başlık> <alt başlık ve gövde>` (alt başlık alanı yoktur) |
| Windows | bir tıklamayı hiçbir zaman beklemeyen bir PowerShell toast'ı |

Masaüstü türü her session'da bir kez okunur: `OS=Windows_NT` Windows anlamına gelir. Diğer durumlarda `uname -s` çıktısı `Darwin` ya da `Linux` olur. Başka bir sistemde mod bunu bir kez bildirir ve hiçbir bildirim göndermez. Bildirim komutu başarısız olursa ya da bulunamazsa mod bunu transcript'e bir satırla bir kez yazar. Farklı bir hata gelene kadar aynı satır tekrarlanmaz.

2.1.282 üzerindeki canlı denemede model `AskUserQuestion` ile bir soru sordu. Soru ekranda görünmeden önce `osascript` çalıştı ve exit 0 ile bitti.

## Komut

    /desk-notify                  masaüstü türü ve her olayın ayarı (/desk-notify status da olur)
    /desk-notify ask on | off     cevabınızı bekleyen bir soru
    /desk-notify plan on | off    onayınızı bekleyen bir plan
    /desk-notify stop on | off    biten ya da başarısız olan bir turn

Her olay varsayılan olarak açıktır ve ayarı session'lar arasında korunur. Tek başına bir `on` ya da `off` komutu yoktur: olaylar tek tek açılır ve kapatılır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install desk-notify@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. macOS'ta bildirim görünmüyorsa Sistem Ayarları → Bildirimler bölümünde `osascript` bildirimlerinin göründüğü uygulamanın ayarlarını kontrol edin. Linux'ta `notify-send` (`libnotify`) paketini yükleyin.
3. Bu bildirimleri zaten gönderen kendi hook'unuz varsa onu kaldırın. Aksi hâlde her olay için iki bildirim gelir.

## Nelere erişir

Claude Code 2.1.288 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=desk-notify}, tool.call{tool=/"^AskUserQuestion$"/}, tool.call{tool=/"^ExitPlanMode$"/}, classic.Stop, classic.StopFailure
    ❯ ./register.ts calls: $.clock.after (via notifyOn), $.command.register, $.env.get (via readPlatform), $.process.run (via gitOut, readPlatform, send), $.session.cwd (via readProject), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log
    ❯ ./register.ts env reads: OS

Reach L2: process çalıştırır.

    1. Okur:         OS değişkenini, her çağrının tool adını, başarısız bir turn'ün hata metnini ve son asistan mesajını
    2. Çalıştırır:   her session'da bir kez uname -s ve iki git rev-parse çağrısı; her bildirim için bir osascript, notify-send ya da powershell.exe
    3. Gönderir:     sabit bir başlık, proje adı ve başarısız bir turn için hatanın ilk 60 karakterini içeren bir masaüstü bildirimi; modele hiçbir şey göndermez, makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       her olayın açık/kapalı ayarını $.store içinde
    5. Düşman girdi: proje adı ve hata metni AppleScript string literal'i için escape edilir; PowerShell script'ine yalnız base64 (UTF-16LE) olarak girer ve script -EncodedCommand ile çalışır; notify-send'e tek bir argv öğesi olarak verilir; bu yüzden hiçbiri bir komut çalıştıramaz

## Sınırlar

- macOS bildiriminin kendine ait bir simgesi yoktur, çünkü `display notification` simge argümanı almaz.
- Sizin yarıda kestiğiniz bir turn'ün `Stop` olayını tetikleyip tetiklemediği ölçülmedi.
- Linux ve Windows komutları canlı olarak ölçülmedi.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
