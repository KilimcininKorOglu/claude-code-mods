# commit-cadence

Uzun bir session çoğu zaman yirmi değişmiş dosya ve tek bir büyük commit ile biter. Bu commit'te düzeltme, refactor ve deneme birbirine karışır. Bu mod her turn'ün sonunda working tree'yi kontrol eder ve hâlâ commit edilmemiş dosyaları size ve modele bildirir. Böylece biten iş sona bırakılmaz, bittiği anda commit edilir.

## Ne yapar

1. Her main loop turn'ünün sonunda session'ın başladığı dizinde `git status --porcelain=v1 -z` çalıştırılır. Komutun listelediği path'ler, stage edilmiş olsun ya da olmasın, okunur. Ignore edilen dosyalar ve üretilen `.claude/` dizini altındaki untracked dosyalar hesaba katılmaz.
2. Kirli bir tree, aynı path listesi için yalnız bir kez bildirilir. Hiçbir şeyi değiştirmeyen sonraki turn'lerde bildirim gelmez. Listeye yeni bir path eklenirse ya da listeden bir path çıkarsa bildirim yenilenir. Böylece uzun bir düzenleme sürecinde aynı satır tekrarlanmaz.
3. Bulgu [sidebar](../sidebar) stream'inde kırmızı tek bir satır olarak görünür. Sidebar kapalıysa satır transcript'e yazılır:

       commit-cadence: 2 uncommitted file(s): src/app.ts, src/new.ts

4. Bir sonraki prompt'unuzla birlikte modele, yalnız modelin okuduğu bir not gönderilir. Not, commit edilmemiş dosyaları listeler ve bitmiş, doğrulanmış her parçanın hemen kendi commit'ine alınmasını ister. Not her bildirim için bir kez gönderilir: bir prompt notu taşır, sonraki prompt taşımaz.
5. Tree yeniden temizlendiğinde yeşil bir satır bulguyu kapatır: `the working tree is clean again`. Tree'nin son temiz olduğu andan bu yana yazılan kırmızı kayıtlar önce silinir. Böylece pane stream'ini geri yüklediğinde bu kayıtlar yeniden görünmez.
6. Bulgu açık olduğu sürece her repository için `$.store` içinde tutulur: path'leri ve kırmızı kayıtlarının key'leri. Modül yeniden yüklendiğinde (`/reload-plugins`, bir güncelleme ya da yeniden başlatma) bulgu session başında geri okunur. Ardından mod, önceki modülün yazdığı kırmızı kayıtları silebilir. Aynı path'leri yeniden bildirmez ve notu tekrar göndermez.
7. `/commit-cadence` tree'yi o anda ölçer. Ayarı ve tree'deki değişiklikleri yazar.

Mod hiçbir işlemi durdurmaz. Hangi değişikliğin commit edileceğine siz karar verirsiniz. Model de notu bir engel olarak değil, hatırlatma olarak okur.

## Komut

    /commit-cadence            ayar ve tree'de şu an ne olduğu (/commit-cadence status da olur)
    /commit-cadence on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install commit-cadence@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Bulguları sidebar'da görmek için [sidebar](../sidebar) modunu yükleyin. Sidebar yüklü değilse satırlar transcript'e yazılır.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=commit-cadence}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.process.run (via readTree), $.session.cwd, $.sidebar.clear (via dropEntries), $.sidebar.set (via toPerson), $.store.delete (via saveOpen), $.store.get (via loadOpen, readSettings), $.store.set (via saveOpen, setEnabled), $.ui.log (via toPerson)

Reach L2: bir process çalıştırır.

    1. Okur:         session'ın kendi dizininde git status'un listelediği path'leri; dosya içeriği, prompt ya da cevap okumaz
    2. Çalıştırır:   git status --porcelain=v1 -z; biten her turn'de ve her /commit-cadence komutunda bir kez
    3. Gönderir:     modele, commit edilmemiş dosyaların sayısını ve ilk altı path'ini, bunları commit etmeyle ilgili tek bir cümleyle
    4. Saklar:       açık/kapalı ayarını $.store içinde; tree temizlenene kadar her repository için açık bulguyu (commit edilmemiş path'ler ve kırmızı kayıtlarının key'leri)
    5. Düşman girdi: ekrana yazılan ve modele gönderilen tek metin git'in kendi yazdığı path'lerdir; altı ad ve bir sayıyla sınırlıdır

## Sınırlar

- Mod tree'yi ölçer, değişikliği kimin yaptığını ölçmez. Elle düzenlediğiniz bir dosya da modelin düzenlediği bir dosya gibi sayılır.
- Mod yalnız session'ın kendi dizinini ölçer. Aynı session'da çalıştığınız başka bir repository okunmaz.
- Yalnız main loop'un turn sonu ölçülür. Subagent'ların turn sonu ölçülmez.
- Ignore edilen path'ler hesaba katılmaz. `.claude/` altındaki untracked dosyalar da katılmaz, çünkü bu dizin otomatik üretilir.
- Mod dosyaları adlandırır, hunk'ları adlandırmaz. İki ilgisiz değişiklik içeren bir dosya tek bir path olarak görünür.
- Mod hiçbir şeyi commit etmez ve hiçbir işlemi durdurmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
