# idle-art

Model çalışırken prompt'un üstüne ASCII bir animasyon çizen bir Claude Code Mod'u. Altı sahne yerleşik olarak gelir: matrix yağmuru, ateş, yıldız alanı, akvaryum, Game of Life ve bir kedi. Kendi animasyonlarını da ekleyebilirsin: `/idle-art import` bir GIF'i karakterlerden oluşan bir klibe çevirir ve bütün projelerde kullanılmak üzere saklar. Yalnız görüntüdür: modele hiçbir şey gitmez, bu yüzden mod token harcamaz ve prompt cache'e dokunmaz.

## Ne gösterir

Resim bir turn'ün 3. saniyesinde çıkar, bu yüzden kısa bir turn hiçbir şey göstermez. Turn bitince resim kaybolur. Varsayılan olarak her turn, yerleşik sahneler ve kaydettiğin klipler arasından rastgele birini çizer ve bir önce gösterileni asla tekrar seçmez. Uzun bir turn, rastgele başka bir sahneye geçer. Yerleşik bir sahne 20 saniye sonra değişir. Bir klip, 20 saniyeden sonra biten ilk döngüsünün sonunda değişir: uzun bir klip bir kez baştan sona oynar, kısa bir klip o süre dolana kadar tekrar eder. Adıyla seçtiğin bir sahne bütün turn boyunca kalır. Bir turn çizilirken sahne seçersen resim hemen değişir.

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
| `cat` | Bir kedi yavaş yavaş yürüyerek ortaya gelir, oturur, göz kırpar ve `meow` der. Sonra her turda başka bir sırayla şebeklik yapar: yerde bir o yana bir bu yana yuvarlanır, iki kez zıplar, başından bir kalp yükselirken mırlar, sağa sola bakar. `MEOW!` der, sağdan yürüyüp çıkar ve yeniden gelir. |

    ● Brewing… (8s)
                      < meow >
               /\_/\
              ( o.o )
               > ^ <
               (_|_)~

Band en fazla 8 satır ve 100 sütun kaplar. Terminalde daha az yer varsa daha küçük çizilir. 3 satırdan kısa bir band'e hiçbir şey çizmez. Yalnız terminalde çizer ve açık bir anketin önünden çekilir.

## Kendi GIF'lerin

    /idle-art import ~/Downloads/kedi.gif kedi

Mod GIF'i okur ve her kareyi kendi süresi ve şeffaflığıyla çözer. Sonra her kareyi karakterlere çevirir. Her hücre, kapladığı piksellerin ortalama rengini alır. Hücrenin karakteri `.:-=+*#%@` dizisinden parlaklığına göre seçilir. Parlaklık, klibin kendi en koyu ve en parlak hücresi arasına yayılır. Çoğu şeffaf olan bir hücre boş kalır. Resim şeklini korur ve band'in 8 satırını doldurur. Bir hücre, genişliğinin iki katı yükseklikte sayılır. Klip band'in ortasında, her kare kendi süresi kadar gösterilerek döngü halinde oynar.

    ● Brewing… (6s)
        ....=*******++=+***+====-....
        ....=******=----=*#=====-....
        ....-+++++*==+----===---:....
        ....:--=###++*=-:-=-:---:....
        ....-+#%#%*--==-:-:-==--:....
        ....+**#*++-:-:---::::--:....
        ....-====+-=:--:::::.:-+-....
        ....:-=*++*+++=-:-=--=-=-....

Bir klip 90.000 karakterin altında tutulur. Çünkü tek bir çizim, çizim thread'ine en fazla bu kadar veri verebilir. Daha uzun bir klip her iki kareden birini düşürür ve sığana kadar bunu tekrarlar. Kalan her kare, düşen karenin süresini de üstlenir. Cevap kaç karenin kaldığını söyler. Klipler mod'un store'unda durur. Store toplam 4 MiB tutar, bu da yaklaşık kırk klip eder. Sığmayan bir klip, sebebiyle birlikte reddedilir.

Klip adı küçük harf, rakam ve tire içerir, en fazla 24 karakterdir. Yerleşik bir sahnenin adı ya da komutun okuduğu bir kelime olamaz. Kayıtlı bir adla yeniden import etmek o klibi değiştirir. `~` ile başlayan bir yol ev dizinini gösterir. Göreli bir yol oturumun dizinine göre çözülür. Yolda boşluk olabilir: son kelime klibin adıdır.

## Komut

    /idle-art                          durum: açık ya da kapalı, stil, gecikme
    /idle-art on | off                 çizimi aç ya da kapat
    /idle-art <sahne ya da klip>       her zaman onu çiz: matrix, fire, stars, aquarium, life, cat ya da kayıtlı bir klip
    /idle-art random                   her turn ve yaklaşık her 20 saniyede yeni bir sahne ya da klip (varsayılan)
    /idle-art delay <n>                turn'ün n. saniyesinde başla, 0 ile 60 arası (varsayılan 3)
    /idle-art import <gif yolu> <ad>   bir GIF'i klibe çevir ve o adla sakla
    /idle-art list                     yerleşik sahneler ve kayıtlı klipler
    /idle-art remove <ad>              kayıtlı bir klibi sil; stil o klipse yeniden random olur
    /idle-art help

Ayarlar ve klipler mod'un store'unda durur. Store bütün projelerde ortaktır ve güncellemelerden sonra da kalır.

## Nasıl çizer

`AbovePrompt` için bir `ui.render` hook'u, `isWorking` true olduğu sürece bir `Client` element mount eder. `Client`, `hooks/scene.tsx` modülünü çizim thread'inde çalıştırır. 100 ms'lik bir `surface.every` tick'i sahneyi bir adım ilerletir ve sonraki frame'i ister. Bu yüzden frame başına hiçbir hook çalışmaz. Her yerleşik sahne `hooks/art/` altında saf bir modüldür ve bir hücre grid'i döner. Kayıtlı bir klip çizim thread'ine `Client`'ın props değeriyle ulaşır ve `hooks/clip.ts` ile oynar. Bir satırdaki aynı renkli ardışık hücreler tek bir `Text` olarak çizilir. Hooks modülü, band çalışan bir turn'ü ilk gördüğünde sahneyi ve rastgele bir seed seçer. Gecikme dolunca bir `$.clock.after` timer'ı band'i yeniden çizdirir. Ana döngünün `turn.complete` olayı turn'ü bitirir, böylece sonraki turn yeniden seçer. `random` modunda sahnenin süresini çizim thread'i kendisi sayar. Süre dolunca sahnenin adını `surface.post` ile gönderir. `ui.message` hook'u sıradaki sahneyi seçer ve onun props değerini döner, çalışan instance bunu yerinde alır. Artık gösterilmeyen bir sahneyi adlandıran mesaj hiçbir şeyi değiştirmez, böylece geç gelen ya da tekrarlanan bir mesaj bir sahneyi atlatamaz. Hiçbir klip, gösterilme sırası gelmeden çizim thread'ine gönderilmez. Çünkü tek bir klip, bir `Client`'ın props sınırı olan 100.000 karakterin büyük kısmını kaplayabilir. `hooks/gif.ts` içindeki GIF decoder'ı bu mod için yazıldı ve makinede başka bir araç gerektirmez.

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

    ❯ ./register.tsx hooks: session.start, ui.render{component=AbovePrompt}, ui.message, turn.complete, command.run{command=idle-art}
    ❯ ./register.tsx calls: $.clock.after (via beginTurn), $.clock.now (via sceneFor), $.command.register, $.env.get (via resolvePath), $.fs.exists (via readGifBytes), $.fs.read (via readGifBytes), $.fs.stat (via readGifBytes), $.process.spawn (via streamedStdout), $.session.cwd (via resolvePath), $.store.delete (via removeClip), $.store.get (via loadClips, loadConfig), $.store.set (via importGif, removeClip, saveClips, setting), $.ui.invalidate (via beginTurn, setting), $.ui.resolve
    ❯ ./register.tsx env reads: HOME
    ❯ ./register.tsx surface modules: hooks/scene.tsx

Reach L2: 4 MiB'tan büyük bir GIF'i okumak için `base64` çalıştırır.

    1. Reads:    band'in props değerleri (çalışıyor mu, anket var mı, satır, sütun) ve saat; store'daki ayarları ve klipleri; /idle-art import komutunun verdiği GIF'i, 32 MiB veya daha küçükse, bir kez; bu yolu çözmek için HOME ve oturumun dizini
    2. Runs:     4 MiB'tan büyük bir GIF için import başına bir kez base64 -i <yol>; fork yok; turn başına gecikme için bir timer, band görünürken çizim thread'inin 100 ms'lik tick'i
    3. Sends:    hiçbir şey; network çağrısı yok, modele bir şey gitmez
    4. Persists: açık/kapalı durumu, stil, gecikme ve import edilen her klip, mod'un store'unda
    5. Hostile input: bir GIF güvenilmeyen byte'lardır: decoder her okumayı dosyanın uzunluğuyla sınırlar, bozuk bir kod akışını ya da eksik bir color table'ı reddeder, 500 karede durur; başarısız bir import hiçbir şey saklamaz; yanlış biçimdeki kayıtlı bir klip yüklenirken atlanır; komut sabit bir kelime listesi, 0 ile 60 arası bir tam sayı ve küçük harf, rakam ve tireden oluşan bir klip adı kabul eder

## Sınırlar

- 8 satır küçük bir tuvaldir: bir GIF, alışılmış 2:1 oranda yaklaşık 30 sütun ve 8 satır olur. Bu bir siluet ya da hareket için yeterlidir, ayrıntı için yetmez.
- 4 MiB'a kadar bir GIF `$.fs.read` ile okunur. 32 MiB'a kadar daha büyük bir GIF, `base64 -i <yol>` ile parça parça okunur. Sebebi şu: `$.fs.read` 4 MiB'tan büyük bir dosyayı reddeder, `$.process.run` da çıktısını 4 MiB'ta keser (2.1.283 üzerinde ölçüldü). Dönen byte'lar dosyanın boyutuyla aynı olmalıdır, değilse import reddedilir.
- Her kare, çözülür çözülmez hücrelerine indirilir. Böylece büyük bir GIF bellekte aynı anda yalnız bir karenin piksellerini tutar. Bir GIF'ten en fazla 500 kare okunur.
- Uzun bir GIF, 90.000 karakter sınırı yüzünden kare kaybeder. Hareketi aynı sürede kalır, ama daha kaba adımlarla ilerler.
- Renkleri terminal kendi paletiyle çizer. True color desteklemeyen bir terminal, 256 rengi içinden en yakın olanı gösterir.
- `matrix` yarım genişlikte katakana, `stars` ise `∗` ve `✦` çizer. Bu karakterleri içermeyen bir font yerlerine yedek bir karakter çizer.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10, üstünde build başarısız olur
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
