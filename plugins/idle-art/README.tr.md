# idle-art

Uzun bir turn'ü beklerken prompt'un üstünde yalnız dönen bir spinner görünür. Bu mod, model çalışırken bu alana ASCII bir animasyon çizer. Dört sahne modla birlikte gelir: matrix yağmuru, ateş, akvaryum ve bir kedi. Kendi animasyonlarınızı da ekleyebilirsiniz: `/idle-art import` bir GIF'i karakterlerden oluşan bir klibe çevirir ve bütün projelerde kullanmak için saklar. Mod yalnız görüntü çizer: modele hiçbir şey gönderilmez. Bu yüzden mod token harcamaz ve prompt cache'i değiştirmez.

## Ne gösterir

Resim bir turn'ün 3. saniyesinde görünür. Bu yüzden kısa bir turn hiçbir şey göstermez. Turn bittiğinde resim kaybolur. Varsayılan ayarda her turn, modla gelen sahneler ve kaydettiğiniz klipler arasından rastgele birini çizer. Bir önceki gösterilen sahne hiçbir zaman yeniden seçilmez. Uzun bir turn'de rastgele başka bir sahneye geçilir. Modla gelen bir sahne 20 saniye sonra değişir. Kedi ve bir klip, 20 saniyeden sonra biten ilk turlarının ya da döngülerinin sonunda değişir. Bu yüzden uzun bir klip bir kez baştan sona oynar, kısa bir klip bu süre dolana kadar tekrar eder. Adıyla seçtiğiniz bir sahne bütün turn boyunca kalır. Bir turn çizilirken bir sahne seçerseniz resim hemen değişir.

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
| `fire` | Isı, band'in altındaki gizli bir satırdan yükselir ve yukarı çıktıkça soğur. Ateş `.` ile `@` arasındaki karakterlerle, koyu kırmızıdan açık sarıya kadar çizilir. |
| `aquarium` | Dört farklı şekilde bir balık sürüsü iki yönde de geçer. Balıklardan ve kumdan çıkan kabarcıklar yükseldikçe büyür. Kumun üstünde uzun yosunlar sallanır. En üst satırda su yüzeyi dalgalanır. |
| `cat` | Bir bahçe: iki yavru kedi çimenin üstünde, biri sağda biri solda, bir o yana bir bu yana oynar. Ayaklarının dibinde bir yün yumağı yuvarlanır, üstlerinde bir kelebek uçar. Büyük bir kedi, başı önde, yavaşça yürüyerek ortaya gelir, oturur, göz kırpar ve `meow` der. Ardından her turda farklı bir sırayla numaralarını yapar: yerde bir o yana bir bu yana yuvarlanır, üç kez zıplar, başından bir kalp yükselirken mırlar, sağa ve sola bakar. Sonra `MEOW!` der, sağa doğru yavaşça yürüyerek sahneden çıkar ve yeniden gelir. Her söz, başının üstündeki bir konuşma balonunda görünür. Bir tur yaklaşık 38 saniye sürer. `random`, başka bir sahneye geçmeden önce kedinin sahneden çıkmasını bekler. |

    ● Brewing… (8s)
                     .------.
                    ( meow )
                     '------'
                    /
               /\_/\
              ( o.o )
               > ^ <
               (_|_)~

Band en fazla 8 satır kaplar ve terminalin bütün genişliğini kullanır. Terminalde daha az yer varsa band daha alçak çizilir. Bir klip band'in ortasında gösterilir. 3 satırdan kısa bir band'e hiçbir şey çizilmez. Mod yalnız terminalde çizer ve açık bir anket varsa çizimi durdurur. Sahneler saniyede yaklaşık 60 kare çizilir. Her sahne, geçen süreye göre ilerler. Böylece yağmur, balıklar ve kedi her karede bir adım kayar. Ateşin ısısı saniyede on kez değişir. Bir klip ise kendi kare sürelerine göre değişir.

## Kendi GIF'leriniz

    /idle-art import ~/Downloads/kedi.gif kedi

Mod GIF'i okur ve her kareyi kendi süresi ve şeffaflığıyla çözer. Ardından her kareyi karakterlere çevirir. Her hücre, kapladığı piksellerin ortalama rengini alır. Renk, her kanal için altı seviyeye yuvarlanır. Böylece komşu hücreler aynı rengi paylaşır. Hücrenin karakteri, parlaklığına göre `.:-=+*#%@` dizisinden seçilir. Parlaklık, klibin en koyu ve en parlak hücresi arasına dağıtılır. Büyük kısmı şeffaf olan bir hücre boş kalır. Resim en-boy oranını korur ve band'in 8 satırını doldurur. Genişliği en fazla 100 sütundur. Bir hücrenin yüksekliği, genişliğinin iki katı sayılır. Klip, band'in ortasında döngü hâlinde oynar ve her kare kendi süresi kadar gösterilir.

    ● Brewing… (6s)
        ....=*******++=+***+====-....
        ....=******=----=*#=====-....
        ....-+++++*==+----===---:....
        ....:--=###++*=-:-=-:---:....
        ....-+#%#%*--==-:-:-==--:....
        ....+**#*++-:-:---::::--:....
        ....-====+-=:--:::::.:-+-....
        ....:-=*++*+++=-:-=--=-=-....

Bir klip 90.000 karakterin altında tutulur, çünkü tek bir çizim, çizim thread'ine en fazla bu kadar veri gönderebilir. Daha uzun bir klipte her iki kareden biri çıkarılır. Klip sığana kadar bu işlem tekrarlanır. Kalan her kare, çıkarılan karenin süresini de alır. Komutun cevabı kaç karenin kaldığını bildirir. Klipler modun store'unda saklanır. Store toplam 4 MiB veri tutar. Bu, yaklaşık kırk klibe yeter. Sığmayan bir klip, nedeniyle birlikte reddedilir.

Klip adı küçük harf, rakam ve tire içerir, bir harf ya da rakamla başlar ve en fazla 24 karakterdir. Büyük harfle yazılan bir ad küçük harfe çevrilir. Ad, modla gelen bir sahnenin adı ya da komutun okuduğu bir kelime olamaz. Kayıtlı bir adla yeniden import yapmak o klibi değiştirir. `~` ile başlayan bir path, ev dizininizin altındadır. Göreli bir path, session'ın dizinine göre çözülür. Path boşluk içerebilir: son kelime klibin adıdır.

## Komut

    /idle-art                          durum: açık ya da kapalı, stil, gecikme
    /idle-art on | off                 çizimi açar ya da kapatır
    /idle-art <sahne ya da klip>       her zaman onu çizer: matrix, fire, aquarium, cat ya da kayıtlı bir klip
    /idle-art random                   her turn'de ve yaklaşık her 20 saniyede yeni bir sahne ya da klip (varsayılan)
    /idle-art delay <n>                turn'ün n. saniyesinde başlar, 0 ile 60 arası (varsayılan 3)
    /idle-art import <gif path'i> <ad> bir GIF'i klibe çevirir ve o adla saklar
    /idle-art list                     modla gelen sahneler ve kayıtlı klipler
    /idle-art remove <ad>              kayıtlı bir klibi siler; stil o klipse yeniden random olur
    /idle-art help

Ayarlar ve klipler modun store'unda saklanır. Store bütün projelerde ve bütün pencerelerde ortaktır ve güncellemelerden sonra da korunur. Her pencere ayarları ve klipleri her `/idle-art` komutunda, her turn'ün başında ve bir turn çalışırken 2 saniyede bir yeniden okur. Böylece başka bir pencerede yapılan bir açma, kapatma, stil, gecikme ya da klip değişikliği, çalışan bir turn'de 2 saniye içinde, değilse bir sonraki turn'de bu pencerede de görünür. Aynı anda import yapan iki pencere iki klibi de korur.

## Nasıl çizer

`AbovePrompt` için bir `ui.render` hook'u, `isWorking` değeri true olduğu sürece bir `Client` element'i mount eder. `Client`, `hooks/scene.tsx` modülünü çizim thread'inde çalıştırır. 16 ms'lik bir `surface.every` tick'i sahneyi 16 ms ilerletir ve sonraki kareyi ister. Bu yüzden her kare için hiçbir hook çalışmaz. 2.1.283 üzerinde ölçüldü: kare saati bu hızı korur. Saniyede 5 hücre yürüyen kedi, çalışan bir band'de her saniye 5 hücre ilerledi. Modla gelen her sahne, `hooks/art/` altında saf bir modüldür ve bir hücre grid'i döndürür. Kayıtlı bir klip, çizim thread'ine `Client`'ın props değeriyle ulaşır ve `hooks/clip.ts` ile oynatılır. Bir satırdaki aynı renkli ardışık hücreler tek bir `Text` olarak çizilir. Hooks modülü, band çalışan bir turn'ü ilk gördüğünde sahneyi ve rastgele bir seed seçer. Gecikme dolduğunda bir `$.clock.after` timer'ı band'i yeniden çizdirir. Ana loop'un `turn.complete` olayı turn'ü bitirir. Böylece sonraki turn yeniden seçim yapar. Bir turn çalışırken bir `$.clock.every` timer'ı ayarları ve klip adlarını 2 saniyede bir yeniden okur. Bir `turn.start` hook'u da bunları her turn'ün başında okur. Bu yüzden çizimin kendisi store'u hiçbir zaman okumaz. Klipler yalnız store'daki adlar ya da bir import veya remove işleminin yazdığı damga değiştiğinde yeniden yüklenir, çünkü store büyüdükçe tek bir okuma uzar: 2.1.283 üzerinde küçük bir store için 0,28 ms, 3,5 MB'lık bir store için 3,1 ms ölçüldü. `random` modunda sahnenin süresini çizim thread'i kendisi sayar. Süre dolduğunda sahnenin adını `surface.post` ile gönderir. `ui.message` hook'u sıradaki sahneyi seçer ve onun props değerini döndürür. Çalışan instance bu değeri yerinde alır. Artık gösterilmeyen bir sahnenin adını içeren bir mesaj hiçbir şeyi değiştirmez. Böylece geç gelen ya da tekrarlanan bir mesaj bir sahneyi atlatamaz. Hiçbir klip, gösterilme sırası gelmeden çizim thread'ine gönderilmez, çünkü tek bir klip, bir `Client`'ın props sınırı olan 100.000 karakterin büyük bölümünü kaplayabilir. `hooks/gif.ts` içindeki GIF decoder'ı bu mod için yazıldı ve bilgisayarda başka bir araç gerektirmez.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install idle-art@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

Modu yerel bir checkout'tan tek bir session için yüklemek için:

    claude --plugin-dir plugins/idle-art

## Kurulumdan sonra

Claude Code'u yeniden başlatın ya da açık bir session'da `/reload-plugins` komutunu çalıştırın. Mod yüklendikten sonra açıktır. `/idle-art off` modu kapatır.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, ui.render{component=AbovePrompt} (default matcher key: plugin), ui.message, turn.start, turn.complete, command.run{command=idle-art}
    ❯ ./register.tsx calls: $.clock.after (via beginTurn), $.clock.every (via beginTurn), $.clock.now (via sceneFor), $.command.register, $.env.get (via resolvePath), $.fs.exists (via readGifBytes), $.fs.read (via readGifBytes), $.fs.stat (via readGifBytes), $.process.spawn (via streamedStdout), $.session.cwd (via resolvePath), $.store.delete (via removeClip), $.store.get (via clipsMark, loadClips, loadConfig, writeClipNames), $.store.set (via importGif, removeClip, setting, writeClipNames), $.ui.invalidate (via beginTurn, setting, sync), $.ui.log (via rereadOrStop), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: HOME
    ❯ ./register.tsx surface modules: hooks/scene.tsx

Reach L2: 4 MiB'tan büyük bir GIF'i okumak için `base64` çalıştırır.

    1. Okur:         band'in props değerlerini (çalışıyor mu, anket var mı, satır, sütun) ve saati; store'daki ayarları ve klipleri, her komutta, her turn'ün başında ve bir turn çalışırken 2 saniyede bir; /idle-art import komutunun verdiği GIF'i, 32 MiB ya da daha küçükse, bir kez; bu path'i çözmek için HOME'u ve session'ın dizinini
    2. Çalıştırır:   4 MiB'tan büyük bir GIF için her import'ta bir kez base64 -i <path>; fork yok; her turn için gecikme timer'ı; bir turn çalışırken ayarları 2 saniyede bir okuyan bir timer; band görünürken çizim thread'inin 16 ms'lik tick'i
    3. Gönderir:     hiçbir şey; network çağrısı yapılmaz ve modele hiçbir şey gönderilmez
    4. Saklar:       modun store'unda açık/kapalı durumunu, stili, gecikmeyi, import edilen her klibi ve son import ya da remove işleminin damgasını
    5. Düşman girdi: bir GIF güvenilmeyen byte'lardır: decoder her okumayı dosyanın uzunluğuyla sınırlar, bozuk bir kod akışını ya da eksik bir color table'ı reddeder ve 500 karede durur; başarısız bir import hiçbir şey saklamaz; yanlış biçimde kaydedilmiş bir klip yüklenirken atlanır; komut yalnız sabit bir kelime listesini, 0 ile 60 arası bir tam sayıyı ve küçük harf, rakam ve tireden oluşan bir klip adını kabul eder

## Sınırlar

- 8 satır küçük bir alandır: bir GIF, yaygın 2:1 oranda yaklaşık 30 sütun ve 8 satır olur. Bu bir siluet ya da hareket için yeterlidir, ancak ayrıntı için yeterli değildir.
- 4 MiB'a kadar bir GIF `$.fs.read` ile okunur. 32 MiB'a kadar daha büyük bir GIF, `base64 -i <path>` ile parça parça okunur. Bunun nedeni, `$.fs.read`'in 4 MiB'tan büyük bir dosyayı reddetmesi ve `$.process.run`'ın çıktısını 4 MiB'ta kesmesidir (2.1.283 üzerinde ölçüldü). Dönen byte'lar dosyanın boyutuyla aynı olmalıdır. Aynı değilse import reddedilir.
- Her kare, çözüldüğü anda hücrelerine indirgenir. Böylece büyük bir GIF bellekte aynı anda yalnız bir karenin piksellerini tutar. Bir GIF'ten en fazla 500 kare okunur.
- Uzun bir GIF, 90.000 karakter sınırı yüzünden kare kaybeder. Hareketin süresi aynı kalır, ancak daha kaba adımlarla ilerler.
- Renkleri terminal kendi paletiyle çizer. True color desteklemeyen bir terminal, 256 rengi içinden en yakın olanı gösterir.
- `matrix` yarım genişlikte katakana çizer. Bu karakterleri içermeyen bir font, bunların yerine yedek bir karakter çizer.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
