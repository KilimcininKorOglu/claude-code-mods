# commit-cadence

Uzun bir session kolayca yirmi değişmiş dosya ve tek bir dev commit ile biter; düzeltme, refactor ve deneme birbirine karışır. Bu mod her turn'ün sonunda working tree'ye bakar ve neyin hâlâ commit edilmediğini sana ve modele söyler. Böylece biten iş sona yığılmak yerine bittiği anda commit'lenir.

## Ne yapar

1. Her ana loop turn'ünün sonunda session'ın başladığı dizinde `git status --porcelain=v1 -z` çalıştırır ve adı geçen yolları okur; stage'lenmiş olsun olmasın. Ignore edilen dosyalar ve üretilen `.claude/` dizini altındaki untracked dosyalar dışarıda kalır.
2. Kirli bir tree, aynı yol listesi için yalnız bir kez bildirilir. Hiçbir şeyi değiştirmeyen sonraki turn sessiz kalır; listeye yeni bir yol girerse ya da bir yol çıkarsa bildirim yenilenir. Böylece uzun bir düzenleme sürecinde aynı satır tekrarlanmaz.
3. Bulguyu [sidebar](../sidebar) stream'inde kırmızı tek bir satır olarak görürsün; sidebar kapalıysa transcript'te bir satır olarak:

       commit-cadence: 2 uncommitted file(s): src/app.ts, src/new.ts

4. Bir sonraki prompt'unla birlikte yalnız modelin okuduğu bir not gider: neyin commit edilmediği ve bitmiş, doğrulanmış her parçanın şimdi kendi commit'ine girmesi gerektiği. Not her bildirim için bir kez gider; bir prompt onu taşır, sonraki taşımaz.
5. Tree yeniden temizlenince yeşil bir satır bulguyu kapatır: `the working tree is clean again`. Tree en son temiz olduğundan beri yazılan kırmızı kayıtlar önce silinir, böylece pane stream'ini geri yüklediğinde onlar geri gelmez.
6. Bulgu açık kaldıkça repository başına `$.store`'da tutulur: yolları ve kırmızı kayıtlarının key'leri. Yeniden yüklenen bir modül (`/reload-plugins`, bir güncelleme, bir yeniden başlatma) session başında onu geri alır. Böylece kendisinden önce yazılan kırmızı kayıtları yine silebilir, aynı yolları yeniden bildirmez ve notu tekrar göndermez.
7. `/commit-cadence` o anda ölçer; ayarı ve tree'de ne olduğunu yazar.

Hiçbir şeyi durdurmaz. Neyin commit'e değdiğine sen karar verirsin; model de notu bir gate değil, hatırlatma olarak okur.

## Komut

    /commit-cadence            ayar ve tree'de şu an ne olduğu (/commit-cadence status da olur)
    /commit-cadence on | off   varsayılan açık

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install commit-cadence@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Bulguları sidebar'da görmek istersen [sidebar](../sidebar) mod'unu kur. O olmadan satırlar transcript'e düşer.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=commit-cadence}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.process.run (via readTree), $.session.cwd, $.sidebar.clear (via dropEntries), $.sidebar.set (via toPerson), $.store.delete (via saveOpen), $.store.get (via loadOpen, readSettings), $.store.set (via saveOpen, setEnabled), $.ui.log (via toPerson)

Reach L2: bir process çalıştırır.

    1. Okur:     session'ın kendi dizininde git status'un adını verdiği yolları. Dosya içeriği, prompt ya da cevap okumaz.
    2. Çalıştırır: git status --porcelain=v1 -z; biten her turn'de ve her /commit-cadence'ta bir kez
    3. Gönderir: modele, commit edilmemiş dosyaların sayısını ve ilk altı yolunu, bunları commit'lemekle ilgili tek bir cümleyle
    4. Saklar:   $.store içinde açık/kapalı ayarını ve tree temizlenene kadar repository başına açık bulguyu (commit edilmemiş yollar ve kırmızı kayıtlarının key'leri)
    5. Düşman girdi: çizilen ve gönderilen tek metin, git'in kendi yazdığı yollardır; altı ad ve bir sayıyla sınırlanır

## Sınırlar

- Tree'yi ölçer, değişikliği kimin yaptığını değil. Elle düzenlediğin bir dosya da modelin düzenlediği gibi sayılır.
- Session'ın kendi dizinini ölçer. Aynı session'da çalıştığın başka bir repository okunmaz.
- Yalnız ana loop'un turn sonu ölçülür, subagent'larınki ölçülmez.
- Ignore edilen yollar dışarıda kalır; `.claude/` altındaki untracked dosyalar da, çünkü o dizin üretilir.
- Dosyaları adlandırır, hunk'ları değil. İki ilgisiz değişiklik taşıyan bir dosya tek yol olarak görünür.
- Hiçbir şeyi commit'lemez, hiçbir şeyi durdurmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
