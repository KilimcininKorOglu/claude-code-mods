# commit-cadence

Her turn sonunda working tree'yi ölçen ve hâlâ commit edilmemiş olanı adlandıran bir Claude Code Mod'u. Böylece biten iş session'ın sonuna yığılmak yerine biter bitmez commit edilir.

## Ne yapar

1. Her main-loop turn sonunda mod, session'ın başladığı dizinde `git status --porcelain=v1 -z` komutunu çalıştırır ve adlandırdığı path'leri okur, stage'lenmiş olsun olmasın. Ignore edilen dosyalar ve üretilen `.claude/` dizini dışarıda kalır.
2. Kirli bir tree, path kümesi başına bir kere raporlanır. Hiçbir şeyi değiştirmeyen sonraki bir turn hiçbir şey söylemez; yeni ya da kalkmış bir path tekrar raporlanır. Böylece uzun bir edit serisi aynı satırı tekrarlamaz.
3. Kişi bulguyu [sidebar](../sidebar) stream'inde tek satır olarak okur, sidebar kapalıyken tek transcript satırı olarak:

       commit-cadence: 2 uncommitted file(s): src/app.ts, src/new.ts

4. Bir sonraki prompt yalnız modelin okuduğu bir not taşır: neyin commit edilmediğini ve biten, doğrulanmış her parçanın şimdi kendi commit'ine ait olduğunu. Not rapor başına bir kere borçlanılır, yani bir prompt onu taşır, sonraki taşımaz.
5. Temizlenen bir tree bulguyu yeşil bir satırla kapatır: `the working tree is clean again`. Tree'nin son temiz olduğu andan beri yazılan kırmızı entry'ler önce temizlenir, yani bir pane restore onları geri getirmez.
6. `/commit-cadence` o anda ölçer ve ayarı ile tree'nin ne tuttuğunu yazar.

Hiçbir şeyi durdurmaz. Neyin commit'e değer olduğuna kişi karar verir; model notu bir gate olarak değil, bir hatırlatma olarak okur.

## Komut

    /commit-cadence            ayar ve tree'nin şu an ne tuttuğu
    /commit-cadence on | off   varsayılan on

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install commit-cadence@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Bulgu satırları için [sidebar](../sidebar) mod'unu kurun. O olmadan mod satırları transcript'e yazar.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=commit-cadence}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.process.run (via readTree), $.session.cwd, $.sidebar.clear (via dropEntries), $.sidebar.set (via toPerson), $.store.get, $.store.set (via setEnabled), $.ui.log (via toPerson)

Reach L2, bir process çalıştırır.

    1. Okur:     session'ın kendi dizininde git status'ün adlandırdığı path'leri. Hiçbir dosya içeriğini, prompt'u ya da cevabı okumaz.
    2. Çalıştırır: git status --porcelain=v1 -z, biten her turn'de bir kere ve her /commit-cadence komutunda bir kere
    3. Gönderir: modele, commit edilmemiş dosyaların sayısını ve ilk altı path'ini, onları commit etmekle ilgili tek cümleyle
    4. Saklar:   $.store içinde on/off ayarını; raporlanan path'ler bellekte yaşar ve session ile biter
    5. Düşman girdi: çizilen ve gönderilen tek metin git'in kendi yazdığı path'lerdir, altı adla ve bir sayıyla sınırlanmış

## Sınırlar

- Tree ölçülür, yazarlık değil. Sizin elle değiştirdiğiniz bir dosya, modelin değiştirdiğiyle aynı sayılır.
- Ölçüm session'ın kendi dizinidir. Aynı session'da başka bir yerdeki repository okunmaz.
- Bir subagent'ın turn'ü ölçülmez; yalnız main loop'un sonu ölçülür.
- Sadece ignore edilen bir path dışarıda kalır, `.claude/` altındaki her şey de, çünkü o dizin üretilmiştir.
- Dosyaları adlandırır, hunk'ları değil. İki alakasız değişiklik tutan bir dosya tek path olarak okunur.
- Hiçbir şey commit edilmez ve hiçbir şey durdurulmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
