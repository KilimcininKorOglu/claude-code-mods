# dep-sentinel

Modelin kurduğu her paketi, kurulum çalışmadan önce kontrol eden bir Claude Code Mod'u. Paketin registry'sine ve OSV.dev'e sorar; var olmayan, çok yeni, benzer adlı, eski ya da açığı olan bir paketin kurulumunu durdurur. Model sebebi ve en güncel version'ı okur.

## Ne yapar

1. Mod Bash komutunu shell'siz okur ve kurduğu paketleri bulur:
   - npm: `npm i|install|add`, `pnpm add`, `yarn add`, `bun add|install`;
   - PyPI: `pip install`, `pip3 install`, `python -m pip install`, `uv pip install`, `uv add`, `poetry add`;
   - Go: `go get`, `go install`;
   - crates.io: `cargo add`;
   - Packagist: `composer require`.

   Local bir path, bir URL, bir git kaynağı, bir requirements dosyası (`-r`) ve editable kurulum (`-e`) kontrol edilmez. Komut başına en fazla 10 paket kontrol edilir.
2. Her paket için registry'ye sorar: registry.npmjs.org, pypi.org, proxy.golang.org, crates.io ya da repo.packagist.org. Bir Go paket path'i, proxy'nin bildiği en yakın üst path olan module'ü üzerinden aranır.
3. OSV.dev'e, kurulacak version'ın bilinen açıklarını sorar: sabitlenmiş version, yoksa en günceli.
4. Kurulum şu durumlarda durdurulur:
   - hiçbir registry paketi tanımıyorsa;
   - ad, popüler bir paket adından bir ya da iki edit uzaktaysa (7 karakterin altında bir edit, 4 karakterin altında hiç), paket bir yıldan eski ve 10 ya da daha fazla version'a sahip değilse;
   - paket ilk kez 7 günden kısa süre önce yayınlandıysa; eski bir paketin yeni bir version'ı durdurulmaz;
   - tam sabitlenmiş bir version (`lodash@4.17.15`, `requests==2.25.0`, `tokio@=1.38.0`, `go get x@v1.9.0`, `vendor/pkg:2.0.0`) en güncel değilse; sebep en günceli adlandırır, farklıysa aynı major içindeki en günceli de;
   - OSV.dev o version için bilinen bir açık listeliyorsa; sebep id'leri ve onları düzelten version'ları adlandırır.
5. Model sebepleri komutun hatası olarak okur, en güncel version'ı ya da doğru adı kurma talimatıyla. Kullanıcının tam olarak o pakete ihtiyacı varsa model kullanıcıya sebebini söyler ve komutu `DEP_SENTINEL_SKIP=1` ön eki ile tekrar çalıştırır. Mod böyle bir atlamayı log'lar.
6. Bir registry'ye ya da OSV.dev'e ulaşılamadığında kurulum çalışır ve model hangi paketin kontrolsüz çalıştığını ve neden çalıştığını okur. Aynı anda transcript'e bir satır yazılır, böylece siz de görürsünüz:

       dep-sentinel: the install ran unchecked for: lodash (api.osv.dev answered HTTP 503)

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
7. [sidebar](../sidebar) açıkken kontrolsüz kalan ve atlanan paketler oraya gider, paket başına bir satır, stream'in içinde kayıtlar olarak; transcript temiz kalır. Bir kayıt, yenileri onu pane'in dışına itene kadar durur. Sidebar kapalıyken ya da o mod kurulu değilken yukarıdaki transcript satırları yazılır.

8. Kontrolsüz kalmış bir bulgu asla hatırlanan bir cevap değildir: borçlu olduğu kontrol tekrar çalıştırılır, yani iki yoldan kapanır. Paketin aynı ekosistemdeki sonraki bir kurulumu onu kontrol eder (bir npm `lodash` bir PyPI `lodash` bulgusunu kapatmaz) ve guarded bir git komutu kontrolü kendisi çalıştırır, iki modda da. Kayıt temizlenir ve yerine yenisi gelir:

       dep-sentinel: a later install checked the packages that stayed unchecked: lodash
       dep-sentinel: the registry and OSV.dev answered for the packages that stayed unchecked: lodash

   Geç gelen cevabın söyledikleri kendi kırmızı kaydı olarak yazılır, çünkü ait olduğu kurulum çoktan çalışmıştır:

       dep-sentinel: the check that was owed says: lodash@4.17.21 has 1 known vulnerability(ies) on OSV.dev: GHSA-29mw-wpgm-hmr9; fixed in 4.17.22

   Sidebar kapalıyken aynı metinler transcript satırlarıdır. Model bunların hiçbirini okumaz.

9. Aynı kontrol her main-loop turn sonunda çalışır ve hâlâ açık olan paketler bir sonraki prompt ile modele tek not olarak ulaşır:

       dep-sentinel: 1 package(s) are still installed unchecked: lodash. Run the install again so the registry and OSV.dev answer, or take the package out.

   Turn başına bir not, prompt başına değil. Bu olmasa bulgu bir kere, kurulum anında söylenir ve model onu unutmuşken pane'de dururdu. Siz yeni bir şey okumazsınız: pane zaten aynı bulguyu taşır.

10. `deny` modunda mod ayrıca, bir paket kontrolsüz kaldığı sürece `git commit`, `git push` ve `git merge` komutlarını durdurur. Gate önce borçlu olunan kontrolü çalıştırır, yani yalnız network kapalı olduğu için başarısız olan paket gate'i kendisi açar; registry'nin hâlâ cevap vermediği bir paket komutu durdurur. Kaçış yolu yoktur; gate'i yalnız kişi `/dep-sentinel mode note` ile kapatır. `note` varsayılandır ve hiçbir git komutunu durdurmaz, ama aynı kontrolü bir git komutunda çalıştırır, böylece çözülmüş bir bulgu pane'de kalmaz. Bir kurulum iki modda da durdurulur, yukarıdaki gibi.

Canlı testte `npm install --dry-run lodash@4.17.15` en güncel version 4.18.1 ve 6 OSV id'si ile durduruldu, `npm install --dry-run lodahs` lodash'ın benzeri olarak MAL-2025-25502 id'si ile durduruldu ve `npm install --dry-run left-pad` çalıştı.

## Komut

    /dep-sentinel                 on ya da off, mod ve hâlâ kontrolsüz paketler
    /dep-sentinel on | off        varsayılan on
    /dep-sentinel mode note       kontrolsüz paket yalnız raporlanır; varsayılan
    /dep-sentinel mode deny       bir paket kontrolsüz kaldığında commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install dep-sentinel@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=dep-sentinel}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now, $.command.register, $.http.fetch (via fetchText, osvCheck), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via toPerson)

Reach L3, network'e çıkar.

    1. Okur:     Bash komut metnini
    2. Çalıştırır: hiçbir şey
    3. Gönderir: her paket adını ve version'ını kendi açık registry'sine ve api.osv.dev adresine; kurulumda, bulgu açıkken guarded bir git komutunda ve her turn sonunda tekrar; bir kontrol başarısız olduğunda modele bir not ve transcript'e bir satır, bulgu dururken bir sonraki prompt ile bir not daha; makineden başka hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: paket adı modelin komutundan gelir; registry'ye yalnız bir URL path'i ya da bir JSON gövdesi içinde ulaşır ve registry cevabı veri olarak okunur

## Sınırlar

- Popüler ad listesi `hooks/popular.ts` içinde sabittir (yaklaşık 150 npm ve PyPI adı, diğer registry'ler için daha az). Listede olmayan bir paketin benzeri görülmez.
- Bir version aralığı (`^18`, `>=4`, `cargo add serde@1.0`) eski diye durdurulmaz, çünkü onu installer çözer; en güncel version'ı OSV.dev'de kontrol edilir.
- npm paket doküman'ları büyüktür (typescript için 16 MB, ölçüldü), yani bir kontrol birkaç saniyeye kadar sürebilir.
- Bir script'in, bir alias'ın ya da bir lockfile'ın çalıştırdığı kurulum (`npm ci`, `pip install -r`) kontrol edilmez.
- `deny` modunun kaçış yolu yoktur. Bir registry ulaşılamaz kaldığında kişi gate'i `/dep-sentinel mode note` ile kapatır.
- Bulgu açıkken bir git komutu o kontrolü bekler, yani başarısız bir kurulumdan sonraki ilk commit registry kadar sürer.
- Gate komut metnini okur. `git commit` komutunu gizleyen bir script ya da alias üzerinden atılan commit durdurulmaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
