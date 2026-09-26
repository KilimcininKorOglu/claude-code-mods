# idle-art

Model çalışırken prompt'un üstüne ASCII bir animasyon çizen bir Claude Code Mod'u. Beş sahne var: matrix yağmuru, ateş, yıldız alanı, akvaryum ve Game of Life. Yalnız görüntüdür: modele hiçbir şey gitmez, bu yüzden mod token harcamaz ve prompt cache'e dokunmaz.

## Ne gösterir

Resim bir turn'ün 3. saniyesinde çıkar, bu yüzden kısa bir turn hiçbir şey göstermez. Turn bitince resim kaybolur. Varsayılan olarak her turn rastgele bir sahne çizer, ama bir önceki turn'ün sahnesini asla seçmez.

    ● Brewing… (5s)
             .:   .                 ,
                       ,   ::,,,
        ::;;:;    ;;::;          .
         ,  ;:+ :*;++++      , ,,
        :::*oO;*:;*:+:  :+++,::**o ++:, :
      ;,,   ;,;+;+::+;,;+:**+**,;  ;  ,
     :  +;*:+**o*;;;;*+**:,*:;;***o:,::;;
    :,::;oOoO*ooOOO#oO*o*O*o**OOOoOo;+;,

| Sahne | Ne hareket eder |
|---|---|
| `matrix` | Yarım genişlikte katakana ve rakamlardan oluşan akışlar yeşil renkte düşer. Her akışın parlak bir başı ve solan bir kuyruğu vardır. Kuyruğun altındaki karakterler titrer. |
| `fire` | Isı, band'in altındaki gizli bir satırdan yükselir ve yukarı çıktıkça soğur. `.` ile `@` arasındaki karakterlerle, koyu kırmızıdan açık sarıya kadar çizilir. |
| `stars` | Yıldızlar merkezden izleyiciye doğru uçar. Yaklaştıkça gri bir `·` işaretinden beyaz bir `✦` işaretine büyür. |
| `aquarium` | Dört şekilde balık iki yönde de geçer. Balıklardan çıkan kabarcıklar yükseldikçe büyür. Kumun üstünde yosunlar sallanır. |
| `life` | Conway'in Game of Life'ı kenarları birbirine bağlı bir tahtada oynanır. Tahta yarım bloklarla çizilir, her satırda iki hücre vardır. Yeni doğan hücreler pembe, eski hücreler mordur. Tahta ölünce, kendini tekrar edince ya da 300 nesle ulaşınca yeniden tohumlanır. |

Band en fazla 8 satır ve 100 sütun kaplar. Terminalde daha az yer varsa daha küçük çizilir. 3 satırdan kısa bir band'e hiçbir şey çizmez. Yalnız terminalde çizer ve açık bir anketin önünden çekilir.

## Komut

    /idle-art                 durum: açık ya da kapalı, stil, gecikme
    /idle-art on | off        çizimi aç ya da kapat
    /idle-art <sahne>         her zaman o sahneyi çiz: matrix, fire, stars, aquarium, life
    /idle-art random          her turn yeni bir sahne (varsayılan)
    /idle-art delay <n>       turn'ün n. saniyesinde başla, 0 ile 60 arası (varsayılan 3)
    /idle-art help

Ayarlar mod'un store'unda durur ve güncellemelerden sonra da kalır.

## Nasıl çizer

`AbovePrompt` için bir `ui.render` hook'u, `isWorking` true olduğu sürece bir `Client` element mount eder. `Client`, `hooks/scene.tsx` modülünü çizim thread'inde çalıştırır. 100 ms'lik bir `surface.every` tick'i sahneyi bir adım ilerletir ve sonraki frame'i ister. Bu yüzden frame başına hiçbir hook çalışmaz. Her sahne `hooks/art/` altında saf bir modüldür ve bir hücre grid'i döner. Bir satırdaki aynı renkli ardışık hücreler tek bir `Text` olarak çizilir. Hooks modülü, band çalışan bir turn'ü ilk gördüğünde stili ve rastgele bir seed seçer. Gecikme dolunca bir `$.clock.after` timer'ı band'i yeniden çizdirir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install idle-art@kilimcininkoroglu-mods

Function hooks erken erişimdedir. Flag olmadan hiçbir şey yüklenmez:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Bir oturum için yerel checkout'tan yüklemek için:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/idle-art

Flag'i açık tutmak için `~/.claude/settings.json` dosyasına şunu ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

Claude Code'u yeniden başlatın ya da açık bir oturumda `/reload-plugins` çalıştırın. Mod kurulumdan sonra açıktır. `/idle-art off` komutu onu kapatır.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, ui.render{component=AbovePrompt}, turn.complete, command.run{command=idle-art}
    ❯ ./register.tsx calls: $.clock.after (via beginTurn), $.clock.now (via sceneFor), $.command.register, $.store.get (via loadConfig), $.store.set (via apply), $.ui.invalidate (via apply, beginTurn), $.ui.resolve
    ❯ ./register.tsx surface modules: hooks/scene.tsx

Reach L0: çizer ve hatırlar.

    1. Reads:    band'in props değerleri (çalışıyor mu, anket var mı, satır, sütun) ve saat; store'daki kendi üç ayarı
    2. Runs:     hiçbir şey; process ve fork yok; turn başına gecikme için bir timer, band görünürken çizim thread'inin 100 ms'lik tick'i
    3. Sends:    hiçbir şey; network çağrısı yok, modele bir şey gitmez
    4. Persists: açık/kapalı durumu, stil ve gecikme, mod'un store'unda
    5. Hostile input: dışarıdan girdi almaz; komut sabit bir kelime listesi ve 0 ile 60 arası bir tam sayı kabul eder, geri kalan her şeyi kullanım satırıyla reddeder

## Sınırlar

- Sahnelerin renklerini terminal kendi paletiyle çizer. True color desteklemeyen bir terminal, 256 rengi içinden en yakın olanı gösterir.
- `matrix` yarım genişlikte katakana, `stars` ise `∗` ve `✦` çizer. Bu karakterleri içermeyen bir font yerlerine yedek bir karakter çizer.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10, üstünde build başarısız olur
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
