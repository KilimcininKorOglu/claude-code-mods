# dep-sentinel

Model bir paket kurarken adını aklından yazar. O ad yanlış yazılmış olabilir, hiç var olmayan bir paketi gösterebilir, geçen hafta yayımlanmış bir taklide ait olabilir ya da bilinen açıkları olan bir version'a sabitlenmiş olabilir. Bu mod her paketi kurulum çalışmadan önce kontrol eder: paketin registry'sine ve OSV.dev'e sorar, bir sorun varsa kurulumu durdurur. Model sebebini ve en güncel version'ı okur.

## Ne yapar

1. Bash komutunu shell'e vermeden okur ve kurduğu paketleri bulur:
   - npm: `npm i|install|add`, `pnpm add`, `yarn add`, `bun add|install`;
   - PyPI: `pip install`, `pip3 install`, `python -m pip install`, `uv pip install`, `uv add`, `poetry add`;
   - Go: `go get`, `go install`;
   - crates.io: `cargo add`;
   - Packagist: `composer require`.

   Yerel bir yol, bir URL, bir git kaynağı, bir requirements dosyası (`-r`) ve editable kurulum (`-e`) kontrol edilmez. Bir komutta en fazla 10 paket kontrol edilir.
2. Her paket için registry'ye sorar: registry.npmjs.org, pypi.org, proxy.golang.org, crates.io ya da repo.packagist.org. Go paket yolu kendi modülünde, yani proxy'nin tanıdığı en yakın üst yolda aranır. Claude Code bir mod'a cevabın en fazla 4 MiB'ını verir, gerisini hiçbir işaret bırakmadan keser; oysa bir npm dokümanı bundan büyük olabilir (webpack 5 MB, vite 39 MB). Böyle bir pakette mod onun yerine `npm view <name> time.created dist-tags.latest versions --json` çalıştırır; PATH'te npm yoksa paket kontrolsüz kalır. Başka bir registry'den gelen büyük cevap, adıyla birlikte kontrolsüz olarak bildirilir.
3. Kurulacak version için OSV.dev'e bilinen açıkları sorar: sabitlenmiş version varsa onu, yoksa en güncelini.
4. Kurulumu şu durumlarda durdurur:
   - paketi hiçbir registry tanımıyorsa;
   - ad, popüler bir paket adından bir ya da iki harf farklıysa (7 karakterden kısa adlarda yalnız bir harf farkı sayılır, 4 karakterden kısa adlarda hiç sayılmaz); paket bir yıldan eski ve en az 10 version'lıysa durdurmaz;
   - paket ilk kez 7 günden kısa süre önce yayımlandıysa; eski bir paketin yeni version'ı durdurulmaz;
   - tam sabitlenmiş bir version (`lodash@4.17.15`, `requests==2.25.0`, `tokio@=1.38.0`, `go get x@v1.9.0`, `vendor/pkg:2.0.0`) en güncel version değilse; sebep en güncelini, farklıysa aynı major version'daki en güncelini de söyler;
   - OSV.dev o version için bilinen bir açık listeliyorsa; sebep açıkların id'lerini ve onları kapatan version'ları söyler.
5. Model sebepleri komutun hatası olarak okur, yanında da en güncel version'ı ya da doğru adı kurmasını söyleyen talimatı. Sen tam o paketi istiyorsan model sana sebebini anlatır ve komutu `DEP_SENTINEL_SKIP=1` önekiyle yeniden çalıştırır. Mod bu atlamayı log'a yazar.
6. Registry'ye ya da OSV.dev'e ulaşılamazsa kurulum çalışır, model de hangi paketin neden kontrolsüz kurulduğunu okur. Aynı anda transcript'e sana bir satır düşer:

       dep-sentinel: the install ran unchecked for: lodash (api.osv.dev answered HTTP 503)

   Not ile satır ayrı kanallardır: model satırı hiç okumaz, sen de notu hiç okumazsın.
7. [sidebar](../sidebar) açıksa kontrolsüz ve atlanan paketler onun stream'ine gider, her paket bir satır; transcript temiz kalır. Kontrolsüz paketin adı kırmızı, sebebi soluk görünür. İstek üzerine atlanan paket sarıdır, çünkü onu sen istedin. Bir kayıt, yenileri onu pane'den itene kadar durur. Sidebar kapalıysa ya da kurulu değilse satırlar yukarıdaki gibi transcript'e düşer.

8. Mod kontrolsüz bir paket için bellekteki eski cevaba güvenmez: eksik kalan kontrol yeniden çalışır ve bulgu iki yoldan kapanır. Aynı paketin aynı ekosistemde sonradan kurulması onu kontrol eder (npm'deki `lodash`, PyPI'deki `lodash`'ı kapatmaz). Korunan bir git komutu da kontrolü kendisi çalıştırır, iki modda da. Kayıt silinir, yerine yenisi gelir:

       dep-sentinel: a later install checked the packages that stayed unchecked: lodash
       dep-sentinel: the registry and OSV.dev answered for the packages that stayed unchecked: lodash

   Geç gelen cevabın söyleyecek bir şeyi varsa o ayrı bir kayıt olur, çünkü ait olduğu kurulum çoktan çalıştı. Orada sabitlenmiş eski version ve `has N known vulnerability(ies)` kırmızı, en güncel version ve `fixed in X` yeşil, `no fixed version is listed` ile yeni bir paketin yaşı sarıdır:

       dep-sentinel: the check that was owed says: lodash@4.17.21 has 1 known vulnerability(ies) on OSV.dev: GHSA-29mw-wpgm-hmr9; fixed in 4.17.22

   Sidebar kapalıysa aynı metinler transcript satırı olur. Model bunların hiçbirini okumaz.

9. Aynı kontrol her main-loop turn'ünün sonunda da çalışır. Hâlâ açık kalan paketler modele bir sonraki prompt'la tek bir not olarak ulaşır:

       dep-sentinel: 1 package(s) are still installed unchecked: lodash. Run the install again so the registry and OSV.dev answer, or take the package out.

   Her prompt'ta değil, her turn'de bir not gelir. Bu not olmasa model bulguyu yalnız kurulum anında bir kez duyar ve sonra unuturdu; bulgu da pane'de öylece dururdu. Sana yeni bir satır düşmez, çünkü aynı bulgu zaten pane'de.

10. `deny` modunda mod, bir paket kontrolsüz kaldığı sürece `git commit`, `git push` ve `git merge` komutlarını da durdurur. Gate önce eksik kalan kontrolü çalıştırır; paket yalnız ağ kesik olduğu için takıldıysa gate kendiliğinden açılır. Registry'nin hâlâ cevap vermediği paket komutu durdurur. Bunu aşmanın yolu yoktur; gate'i yalnız sen `/dep-sentinel mode note` ile kapatırsın. Varsayılan `note` modudur ve hiçbir git komutunu durdurmaz, ama git komutunda aynı kontrolü çalıştırır; böylece çözülmüş bir bulgu pane'de kalmaz. Kurulum ise yukarıdaki gibi iki modda da durdurulur.

Canlı denemede `npm install --dry-run lodash@4.17.15` en güncel version 4.18.1 ve 6 OSV id'siyle durduruldu, `npm install --dry-run lodahs` lodash taklidi olarak MAL-2025-25502 OSV id'siyle durduruldu, `npm install --dry-run left-pad` ise çalıştı.

## Komut

    /dep-sentinel                 açık mı kapalı mı, mod ve hâlâ kontrolsüz paketler
    /dep-sentinel on | off        varsayılan olarak açık
    /dep-sentinel mode note       kontrolsüz paket yalnız bildirilir; varsayılan
    /dep-sentinel mode deny       kontrolsüz paket varken commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install dep-sentinel@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=dep-sentinel}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now, $.command.register, $.http.fetch (via fetchText, osvCheck), $.process.run (via npmView), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via isEnabled, readSettings), $.store.set (via runCommand, setMode), $.ui.log (via toPerson)

Reach L3: ağa çıkar.

    1. Okur:     Bash komutunun metnini
    2. Çalıştırır: npm view; yalnız registry dokümanı bir fetch'in okuduğu 4 MiB'ı aşan npm paketleri için
    3. Gönderir: her paketin adını ve version'ını kendi public registry'sine ve api.osv.dev'e; kurulumda, bulgu açık kaldıkça korunan git komutunda ve her turn'ün sonunda yeniden; bir kontrol başarısız olunca modele bir not ve transcript'e bir satır, bulgu durdukça bir sonraki prompt'la bir not daha; makineden başka bir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını ve modu
    5. Düşman girdi: paket adı modelin komutundan gelir; registry'ye yalnız bir URL yolu ya da JSON body içinde ulaşır, registry cevabı veri olarak okunur

## Sınırlar

- Popüler adlar listesi `hooks/popular.ts` içinde sabit (npm ve PyPI için 150 kadar ad, diğer registry'ler için daha az). Listede olmayan bir paketin taklidi gözden kaçar.
- Version aralığı (`^18`, `>=4`, `cargo add serde@1.0`) eski diye durdurulmaz, çünkü onu installer çözer. Aralığın en güncel version'ı OSV.dev'de kontrol edilir.
- npm paket dokümanları büyüktür (typescript için 16 MB, ölçüldü); bu yüzden bir kontrol birkaç saniye sürebilir.
- Bir script'in, alias'ın ya da lockfile'ın çalıştırdığı kurulum (`npm ci`, `pip install -r`) kontrol edilmez.
- `deny` modunu aşmanın yolu yoktur. Registry'ye ulaşılamadığı sürece gate'i `/dep-sentinel mode note` ile sen kapatırsın.
- Bulgu açıkken çalışan bir git komutu o kontrolü bekler. Başarısız bir kurulumdan sonraki ilk commit, registry ne kadar sürerse o kadar sürer.
- Gate komutun metnini okur. `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit durdurulmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
