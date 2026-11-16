# dep-sentinel

Model bir paket yüklerken paketin adını hafızasından yazar. Bu ad yanlış yazılmış olabilir, var olmayan bir paketi gösterebilir, geçen hafta yayımlanmış bir taklit pakete ait olabilir ya da bilinen güvenlik açıkları olan bir sürüme sabitlenmiş olabilir. Bu mod her paketi yükleme çalışmadan önce kontrol eder: paketin registry'sine ve OSV.dev'e sorar ve bir sorun varsa yüklemeyi durdurur. Model durdurma nedenini ve en güncel sürümü okur.

## Ne yapar

1. Mod Bash komutunu shell'e vermeden okur ve komutun yüklediği paketleri bulur:
   - npm: `npm i|install|add`, `pnpm add`, `yarn add`, `bun add|install`;
   - PyPI: `pip install`, `pip3 install`, `python -m pip install`, `uv pip install`, `uv add`, `poetry add`;
   - Go: `go get`, `go install`;
   - crates.io: `cargo add`;
   - Packagist: `composer require`.

   Yerel bir path, bir URL, bir git kaynağı, bir requirements dosyası (`-r`) ve editable yükleme (`-e`) kontrol edilmez. Bir komutta en fazla 10 paket kontrol edilir.
2. Mod her paket için registry'ye sorar: registry.npmjs.org, pypi.org, proxy.golang.org, crates.io ya da repo.packagist.org. Bir Go paket path'i kendi modülünde, yani proxy'nin tanıdığı en yakın üst path'te aranır. Claude Code bir moda bir cevabın en fazla 4 MiB'ını verir ve geri kalanını hiçbir işaret bırakmadan keser. Ancak bir npm dokümanı bundan büyük olabilir (webpack 5 MB, vite 39 MB). Böyle bir paket için mod bunun yerine `npm view <name> time.created dist-tags.latest versions --json` komutunu çalıştırır. PATH'te npm yoksa paket kontrol edilmeden kalır. Başka bir registry'den gelen büyük bir cevapta paket, adıyla birlikte kontrol edilmemiş olarak bildirilir.
3. Mod, yüklenecek sürüm için OSV.dev'e bilinen güvenlik açıklarını sorar. Sürüm sabitlenmişse o sürüm, sabitlenmemişse en güncel sürüm sorgulanır.
4. Mod yüklemeyi şu durumlarda durdurur:
   - Paketi hiçbir registry tanımıyorsa.
   - Ad, popüler bir paket adından bir ya da iki harf farklıysa. 7 karakterden kısa adlarda yalnız bir harf farkı, 4 karakterden kısa adlarda hiç fark sayılmaz. Paket bir yıldan eski ve en az 10 sürüme sahipse yükleme durdurulmaz.
   - Paket ilk kez 7 günden kısa süre önce yayımlandıysa. Eski bir paketin yeni bir sürümü durdurulmaz.
   - Tam olarak sabitlenmiş bir sürüm (`lodash@4.17.15`, `requests==2.25.0`, `tokio@=1.38.0`, `go get x@v1.9.0`, `vendor/pkg:2.0.0`) en güncel sürüm değilse. Durdurma nedeni en güncel sürümü verir. Aynı major sürümdeki en güncel sürüm farklıysa onu da verir.
   - OSV.dev o sürüm için bilinen bir güvenlik açığı listeliyorsa. Durdurma nedeni açıkların id'lerini ve onları kapatan sürümleri verir.
5. Model nedenleri komutun hatası olarak okur. Hatanın yanında, en güncel sürümü ya da doğru adı yüklemesini isteyen bir talimat vardır. Tam olarak o paketi istiyorsanız model size nedeni açıklar ve komutu `DEP_SENTINEL_SKIP=1` önekiyle yeniden çalıştırır. Mod bu atlamayı log'a yazar.
6. Registry'ye ya da OSV.dev'e ulaşılamazsa yükleme çalışır. Model hangi paketin neden kontrol edilmeden yüklendiğini okur. Aynı anda transcript'e size bir satır yazılır:

       dep-sentinel: the install ran unchecked for: lodash (api.osv.dev answered HTTP 503)

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz.
7. [sidebar](../sidebar) açıksa kontrol edilmeyen ve atlanan paketler transcript yerine sidebar'ın stream'ine, her paket için bir satır olarak yazılır ve transcript temiz kalır. Kontrol edilmeyen bir paketin adı kırmızı, nedeni soluk renktedir. İsteğinizle atlanan bir paket sarı renktedir, çünkü atlamayı siz istemişsinizdir. Bir kayıt, yeni kayıtlar onu pane'den çıkarana kadar görünür. Sidebar kapalıysa ya da yüklü değilse satırlar yukarıdaki gibi transcript'e yazılır.

8. Kontrol edilmeyen bir paket için mod bellekteki eski bir cevaba güvenmez. Eksik kalan kontrol yeniden çalıştırılır ve bulgu iki yoldan kapanır. Aynı paketin aynı ekosistemde sonradan yüklenmesi paketi kontrol eder (npm'deki `lodash`, PyPI'deki `lodash` bulgusunu kapatmaz). Korunan bir git komutu da kontrolü kendisi çalıştırır. Bu iki modda da geçerlidir. Mevcut kayıt silinir ve yerine yenisi yazılır:

       dep-sentinel: a later install checked the packages that stayed unchecked: lodash
       dep-sentinel: the registry and OSV.dev answered for the packages that stayed unchecked: lodash

   Geç gelen cevabın bildireceği bir sorun varsa bu sorun ayrı bir kayıt olarak yazılır, çünkü cevabın ait olduğu yükleme zaten çalışmıştır. Bu kayıtta sabitlenmiş eski sürüm ve `has N known vulnerability(ies)` kırmızı, en güncel sürüm ve `fixed in X` yeşil, `no fixed version is listed` ve yeni bir paketin yaşı sarı renktedir:

       dep-sentinel: the check that was owed says: lodash@4.17.21 has 1 known vulnerability(ies) on OSV.dev: GHSA-29mw-wpgm-hmr9; fixed in 4.17.22

   Sidebar kapalıysa aynı metinler transcript'e satır olarak yazılır. Model bunların hiçbirini okumaz.

9. Aynı kontrol her main loop turn'ünün sonunda da çalışır. Hâlâ açık olan paketler, bir sonraki prompt ile modele tek bir not olarak gönderilir:

       dep-sentinel: 1 package(s) are still installed unchecked: lodash. Run the install again so the registry and OSV.dev answer, or take the package out.

   Bu not her turn için bir kez gönderilir, her prompt için değil. Bu not olmasaydı model bulguyu yalnız yükleme anında bir kez duyar ve ardından unuturdu. Bulgu da pane'de kalırdı. Size yeni bir satır gösterilmez, çünkü pane aynı bulguyu zaten gösterir.

10. `deny` modunda bir paket kontrol edilmeden kaldığı sürece mod `git commit`, `git push` ve `git merge` komutlarını da durdurur. Gate, önce eksik kalan paket kontrolünü çalıştırır. Paket yalnız network bağlantısı kesildiği için kontrol edilememişse gate kendiliğinden açılır. Registry'nin hâlâ cevap vermediği bir paket komutu durdurur. Gate'i atlamanın bir yolu yoktur. Gate'i yalnız siz `/dep-sentinel mode note` ile kapatabilirsiniz. Varsayılan mod `note` modudur ve hiçbir git komutunu durdurmaz. Ancak bu modda da git komutu sırasında aynı kontrol çalışır. Böylece çözülmüş bir bulgu pane'de kalmaz. Yükleme ise yukarıda anlatıldığı gibi iki modda da durdurulur.

Canlı denemede `npm install --dry-run lodash@4.17.15` komutu, en güncel sürüm 4.18.1 ve 6 OSV id'siyle durduruldu. `npm install --dry-run lodahs` komutu, MAL-2025-25502 OSV id'siyle lodash taklidi olarak durduruldu. `npm install --dry-run left-pad` komutu çalıştı.

## Komut

    /dep-sentinel                 açık mı kapalı mı, mod ve hâlâ kontrol edilmemiş paketler
    /dep-sentinel on | off        varsayılan açık
    /dep-sentinel mode note       kontrol edilmemiş paket yalnız bildirilir; varsayılan
    /dep-sentinel mode deny       kontrol edilmemiş bir paket varken commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install dep-sentinel@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=dep-sentinel}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now, $.command.register, $.http.fetch (via fetchText, osvCheck), $.process.run (via npmView), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via isEnabled, readSettings), $.store.set (via runCommand, setMode), $.ui.log (via toPerson)

Reach L3: network'e erişir.

    1. Okur:         Bash komutunun metnini
    2. Çalıştırır:   npm view; yalnız registry dokümanı bir fetch'in okuyabildiği 4 MiB'ı aşan npm paketleri için
    3. Gönderir:     her paketin adını ve sürümünü kendi public registry'sine ve api.osv.dev'e; yüklemede ve bulgu açık kaldığı sürece korunan git komutunda ve her turn'ün sonunda yeniden; bir kontrol başarısız olduğunda modele bir not ve transcript'e bir satır; bulgu açık kaldığı sürece bir sonraki prompt'la bir not daha; makineden dışarı başka hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde
    5. Düşman girdi: paket adı modelin komutundan gelir; registry'ye yalnız bir URL path'i ya da bir JSON body içinde gönderilir; registry cevabı veri olarak okunur

## Sınırlar

- Popüler paket adları listesi `hooks/popular.ts` içinde sabittir (npm ve PyPI için yaklaşık 150 ad, diğer registry'ler için daha az). Listede olmayan bir paketin taklidi fark edilmez.
- Bir sürüm aralığı (`^18`, `>=4`, `cargo add serde@1.0`) eski olduğu için durdurulmaz, çünkü aralığı yükleme aracı çözer. Aralığın en güncel sürümü OSV.dev'de kontrol edilir.
- npm paket dokümanları büyüktür (typescript için 16 MB, ölçüldü). Bu yüzden bir kontrol birkaç saniye sürebilir.
- Bir script'in, alias'ın ya da lockfile'ın çalıştırdığı yükleme (`npm ci`, `pip install -r`) kontrol edilmez.
- `deny` modunu atlamanın bir yolu yoktur. Registry'ye ulaşılamadığı sürece gate'i `/dep-sentinel mode note` ile siz kapatırsınız.
- Bir bulgu açıkken çalışan bir git komutu bu kontrolün bitmesini bekler. Bu yüzden başarısız bir yüklemeden sonraki ilk commit, registry'nin cevap süresi kadar uzar.
- Gate komutun metnini okur. `git commit` komutunu gizleyen bir script ya da alias ile yapılan bir commit durdurulmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
