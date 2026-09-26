# limit-watch

Subscription kullanım limitlerini ekranda tutan bir Claude Code Mod'u. Bir Claude subscription'ı 5 saatlik ve 7 günlük bir limit taşır, bir Claude gateway ise bir spend limit ekleyebilir. Claude Code bunları yalnız bir limit dolmaya yakınken bir uyarıda gösterir. limit-watch bunları session boyunca gösterir, her reset'e kadar geri sayar, bugünkü hızın bir limiti ne zaman dolduracağını tahmin eder ve bir limit %80 ile %95'i geçtiğinde bir uyarı yazar.

## Ne gösterir

**Prompt'un altında bir status line**, her turdan sonra ve her 60 saniyede bir güncellenir:

    limit-watch: 5h 9%, reset in 2h 36m · 7d 15%, reset in 5d 10h · measuring the pace

Son kısım şunlardan biridir:

- `5h hits 100% in ~1h 40m`: bugünkü hızda bu limit reset'inden önce dolar. Birden fazla limit doluyorsa ilki adlandırılır.
- `no limit fills before its reset`: her limit, bugünkü hız onu doldurmadan önce reset olur.
- `measuring the pace`: hiçbir limitin henüz yeterince uzun bir aralıkta örneği yok.
- `5h limit reached`: bir limit %100'de.

Bir API key session'ı hiçbir limit bildirmez. Status line o zaman `no usage limits reported yet` der. Yeni bir session da Claude bir kere cevap verene kadar bunu gösterir.

**[sidebar](../sidebar) içinde bir section**, sidebar açıkken o status line'ın yerine: aynı parçalar, limit başına bir satır; yalnızca yüzde renklidir (%80 altında yeşil, %80'den itibaren sarı, %95'ten itibaren kırmızı, pane'deki bar ile aynı adımlar) ve reset geri sayımı soluktur. Altlarında hız satırı durur: `limit reached` kırmızı, `hits 100% in` ifadesinin `~<süre>` kısmı sarı olur; hiçbir limit dolmadığında satırın tamamı yeşil, hız hâlâ ölçülürken soluktur. Status line o sırada temizlenir. Sidebar kapalıyken ya da o mod kurulu değilken status line yukarıdaki gibi kalır.

**`/limit-watch` ile açılıp kapanan bir pane**, limit başına bir blok ile:

    5-hour limit · 9% used
    ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    resets 22:40, in 2h 36m
    pace +4.2%/h over the last 38m

Bar pane'in genişliğini doldurur. %80 altında yeşil, %80'den itibaren sarı ve %95'ten itibaren kırmızıdır. Hız ölçülürken hız satırı ne kadar daha örnek gerektiğini söyler.

**Transcript'te bir uyarı**, bir limit %80'i geçtiğinde ve %95'i geçtiğinde yeniden:

    limit-watch: 5-hour limit passed 80% (now 82%), resets 22:40 (in 1h 5m)

Her uyarı limit cycle'ı başına bir kere gelir. Aynı cycle'daki yeni bir session onu tekrarlamaz, aynı anda açık ikinci bir session da tekrarlamaz: her sample uyarmadan önce uyarılmış seviyeleri store'dan yeniden okur. Aynı anda sample alan iki session yine ikisi de uyarabilir. Limit reset olduktan sonra uyarılar yeniden gelir.

## Sayılar nasıl oluşur

- `$.session.usage()` her limiti `{ kind, percentUsed, resetsAt }` olarak verir, son API cevabından okunur. limit-watch bunu session başlangıcında, her ana döngü turundan sonra, interaktif bir session'da her 60 saniyede bir ve `/limit-watch` pane'i açtığında okur. Session başlangıcında ya da timer'da başarısız olan bir okuma bir kere `cannot read the usage limits: <error>` olarak log'lanır ve 60 saniyelik timer çalışmaya devam eder.
- Her okuma bir örnektir (`{ at, percent }`) ve `$.store` içinde tutulur, böylece bir restart hızı korur.
- 5 saatlik ve spend limitleri hızı örneklerinden okur: yakın bir aralığın bütün örneklerinden en küçük kareler ile geçirilen doğrunun eğimi, saat başına yüzde olarak. Her örnek hesaba girer, bu yüzden iki uçtan birindeki tek bir tam sayı adımı hızı tek başına belirlemez. Aralık 5 saatlik limit için son bir saat, spend limiti için son 24 saattir; böylece hız bugün nasıl çalıştığınızı izler. Bir hız yalnız örnekleri en az 10 dakika (5 saatlik limit) ya da 2 saat (spend limiti) yayıldığında gösterilir. Daha kısa bir aralık, yüzdenin tek bir adımının ikiye katlayabileceği bir hız verir.
- 7 günlük limit hızı cycle'ın şimdiye kadarki ortalaması olarak okur: yüzde, cycle'ın başından beri geçen süreye bölünür (`resetsAt` eksi 7 gün). Geceler, boş saatler ve hiçbir session'ın çalışmadığı süre de bu süreye girer, yani hız için örnek gerekmez. Hız cycle'ın ikinci gününden itibaren gösterilir. Bu kuraldan önce ölçüldü: 2,4 yoğun saatten sonra %4, `7d hits 100% in ~2d 8h` olarak okundu, çünkü o saatlerin hızı iki güne aralıksız yayıldı; aynı okumanın cycle ortalaması limiti yaklaşık 6 günde doldurur.
- Status line'ın son kısmı %100'e kalan süre için `(100 - percent) / pace` kullanır. O süreden önce reset olan bir limit dolan sayılmaz.
- Yeni bir cycle, `resetsAt` 5 dakikadan fazla kaydığında başlar; `resetsAt` taşımayan bir limit içinse yüzde yarım puandan fazla düştüğünde. Yeni bir cycle o limitin örneklerini ve uyarılarını temizler.
- Bilinmeyen biçimde saklanmış bir değer tek bir log satırıyla bildirilir ve örnekler baştan başlar.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install limit-watch@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Tek bir session için yerel bir checkout'tan yükleyin:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/limit-watch

Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Bir Claude subscription ile giriş yapın (`/login`). Bir API key üzerindeki session hiçbir limit bildirmez ve status line `no usage limits reported yet` olarak kalır.
3. Bir prompt gönderin. Limitler son API cevabından gelir, yani status line ilk cevaptan sonra dolar. Pane'i `/limit-watch` ile açın.

## Nereye uzanır

Claude Code 2.1.281 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, turn.complete, command.run{command=limit-watch}, ui.render{component=Pane}
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.session.usage (via sample), $.sidebar.set (via toSidebar), $.store.get, $.store.set (via sample), $.ui.close, $.ui.invalidate (via sample), $.ui.log, $.ui.open, $.ui.panes, $.ui.resolve, $.ui.status (via sample)

Reach L0, çizer ve hatırlar.

    1. Okur:     $.session.usage'ın rate-limit window'larını (kind, kullanılan yüzde, reset zamanı); dört hook'unun event payload'larını
    2. Çalıştırır: hiçbir şey; interaktif bir session'da bir 60 saniyelik timer
    3. Gönderir: makineden hiçbir şey çıkmaz
    4. Saklar:   her limitin örneklerini ve uyarılmış seviyelerini $.store içinde, limit başına en fazla 1500 örnek
    5. Düşman girdi: tek dış girdi kullanım rakamlarıdır; bilinmeyen biçimde saklanmış bir değer bildirilir ve değiştirilir, hiçbir zaman güvenilmez

## Sınırlar

- Yeni bir session, Claude bir kere cevap verene kadar okuma taşımaz, çünkü rakamlar son API cevabından gelir.
- 7 günlük limit cycle'ının ilk 24 saatinde hız göstermez.
- 7 günlük hız, cycle'ın `resetsAt`'ten tam 7 gün önce başladığını varsayar.
- Bir spend limit %100'ü geçebilir. Bar dolu yerde durur; yüzde durmaz.
- `/limit-watch` tek bir pane'i açıp kapar. İkinci çalıştırma onu kapatır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
