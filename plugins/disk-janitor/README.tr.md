# disk-janitor

Session'ın repository'sindeki build artifact'lerini ölçen, 5 GB'ı geçtiklerinde status line'da gösteren ve `/disk-janitor` pane'inde seçtiklerinizi silen bir Claude Code Mod'u. Bir veri dizini hiç listelenmez ve hiç silinmez.

## Ne yapar

1. Session başlangıcında ve son ölçümün üzerinden 10 dakika geçtiyse bir turn sonunda, session'ın dizinindeki repository'de `git ls-files --others --ignored --exclude-standard --directory` komutunu çalıştırır. Session'ın dizini, başlangıçta bir kere okunan, başladığı dizindir; çünkü bir Bash `cd` session'ın kendi dizinini kaydırır ve ölçümü başka bir repository'ye yöneltirdi. git repository'si dışında hiçbir şey yapmaz.
2. Her git-ignore edilmiş dizini adına ve içeriğine göre sınıflar:
   - **kesin**: `node_modules` (içinde `.package-lock.json`, `.modules.yaml`, `.yarn-integrity` ya da `.yarn-state.yml` varsa), `target` (`CACHEDIR.TAG` ya da `.rustc_info.json` varsa), `.venv` ve `venv` (`pyvenv.cfg` varsa), `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.phpunit.cache`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `.gradle`, `DerivedData`, `Pods`. İşaret dosyası olmayan kesin bir ad, şüpheli sayılır.
   - **şüpheli**: `dist`, `build`, `out`, `bin`, `obj`, `vendor`, `.cache`, `coverage`. `(unsure)` ile listelenir, önceden hiç seçili gelmez.
   - **veri**: `docker-data`, `data`, `training`, `dataset`, `datasets`, `models`, `uploads`, `media`, `storage`, `db`, `database`, `pgdata`, `volumes`, `backup`, `backups`, `dump`, `dumps`, `logs`, `git-clone`, `release`, `releases`, `artifacts`, `cache`. Hiç listelenmez. Mod bir seviye içine bakar ve oradaki bir artifact'i listeler (`training/.venv`), veri dizininin kendisini asla.
   - Diğer her ad listelenmez.
3. Listelenen dizinleri tek bir `du -sk` çağrısıyla, argv ile, arka planda ölçer; yani hiçbir prompt onu beklemez.
4. Status line toplamı 5 GB'dan itibaren gösterir ve 20 GB'dan itibaren daha yüksek sesle söyler:

       disk-janitor: artifacts 7.4 GB · /disk-janitor
       disk-janitor: over 20 GB: artifacts 23.1 GB · /disk-janitor

   [sidebar](../sidebar) açıkken bu satır oraya gider, session boyunca duran bir `build artifacts` section'ı olarak; status line temiz kalır. Satır 5 GB'dan itibaren sarı, 20 GB'dan itibaren kırmızıdır ve section 5 GB'ın altında kalkar. Altındaki ikinci, soluk satır son silmeyi tutar; bir `clean up` tuşu pane'i açar:

       disk-janitor: build artifacts
       artifacts 7.4 GB · /disk-janitor
       deleted 2 dir(s), 2.5 GB
       [ clean up ]

   Tuş `/disk-janitor` komutunu çalıştırır; komut pane'i açar (açıksa kapatır). Tuş kendi başına hiçbir şey silmez: seçim ve iki basış pane'de kalır.

   Sidebar kapalıyken ya da o mod kurulu değilken status line yukarıdaki gibi çizilir.

## Pane

`/disk-janitor` pane'i açar, tekrar yazınca kapatır. Tuşları alır; Esc kapatır.

    /Users/you/app · 6.5 GB
    [x] node_modules  2.0 GB
    [x] target  4.0 GB
    [ ] dist  1 MB  (unsure)
    [x] data/venv  512 MB
    [ Delete selected (6.5 GB) ]
    kept, data: data

Bir satırda Enter onu seçer ya da seçimi kaldırır. Silme butonundaki ilk Enter onu `Press again to delete 3 dir(s), 6.5 GB` haline getirir; ikincisi siler. Seçim sonraki ölçümlerde korunur.

Her silmeden hemen önce mod dizini tekrar kontrol eder: hâlâ bir dizin olmalı ve link olmamalı, (çözülmüş path'i ile) repository'nin içinde kalmalı, hâlâ git-ignore edilmiş olmalı (`git check-ignore`) ve hâlâ listelendiği sınıfta olmalı. Başarısız olan dizin atlanır ve adlandırılır. Silme, shell olmadan, argv ile `rm -rf -- <mutlak path>` şeklindedir.

Sonra tek bir transcript satırı neyin gittiğini ve neyin kaldığını söyler, veri dizinlerini adıyla:

    disk-janitor: deleted 1 dir(s), 3 MB: node_modules (3 MB) · kept, data: data

## Komut

    /disk-janitor                  pane'i aç ya da kapat
    /disk-janitor list             listelenen dizinleri metin olarak yazar, pane'i olmayan bir surface için
    /disk-janitor rescan           şimdi tekrar ölç
    /disk-janitor delete <path>    listelenen bir dizini siler, pane ile aynı kontrollerle

`delete` yalnız prompt'ta yazdığınız ya da bridge üzerinden gelen bir komut için çalışır. Bir plugin'in çalıştırdığı komut reddedilir, yani model silemez.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install disk-janitor@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

Claude Code'u yeniden başlatın. Mod'un key'e ve ayara ihtiyacı yoktur. Claude Code'u bir git repository'si içinde başlatın; ilk ölçüm session başlangıcında çalışır.

## Nereye uzanır

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, turn.complete, command.run{command=disk-janitor}, ui.render{component=Pane}, ui.close
    ❯ ./register.tsx calls: $.clock.now, $.command.register, $.fs.exists (via hasAnyMarker), $.fs.list (via insideData), $.fs.stat (via staleReason), $.process.run (via findArtifacts, measure, removeDir, repoRoot, staleReason), $.session.cwd (via refresh), $.sidebar.clear (via toSidebar), $.sidebar.isOpen (via toSidebar), $.sidebar.set (via toSidebar), $.ui.close (via openPane), $.ui.invalidate (via pressDelete, refresh, toggle), $.ui.log (via pressDelete, refreshInBackground), $.ui.open (via openPane), $.ui.panes (via openPane), $.ui.resolve, $.ui.status (via showTotal)

Reach L2, process çalıştırır ve dizin siler.

    1. Okur:     repository'nin git-ignore edilmiş dizin adlarını; listelenen bir dizinin işaret dosyalarını; bir veri dizininin bir seviye içindeki girdileri; silinmeden önce bir dizinin çözülmüş path'ini
    2. Çalıştırır: git rev-parse, git ls-files ve git check-ignore, salt okuma; du -sk; pane'de iki kere seçtiğiniz ya da /disk-janitor delete ile adlandırdığınız bir dizin üzerinde rm -rf --; hepsi argv ile, shell yok
    3. Gönderir: hiçbir şey; /disk-janitor çıktı satırı, her komut çıktısı gibi model tarafından okunur
    4. Saklar:   hiçbir şey; son ölçüm ve seçimleriniz bellekte yaşar
    5. Düşman girdi: bir dizin adı git'ten ve diskten gelir, modelden asla; bir silme sizin tuşunuzu ya da yazdığınız komutu ister ve bir path hemen öncesinde her kontrolü tekrar geçmek zorundadır

## Sınırlar

- Yalnız git'in ignore ettiği bir dizin listelenir. Commit edilmiş ya da hiçbir yerde ignore edilmeyen bir build çıktısı listelenmez.
- Üç listenin dışındaki bir ad, build çıktısı olsa bile listelenmez.
- Ignore edilmiş bir dizinin içindeki ignore edilmiş dizin listelenmez, dıştaki bir veri dizini olmadıkça (yalnız bir seviye).
- Çok büyük bir ağaçta `du` uzun sürebilir. Ölçüm arka planda 60 saniye sınırıyla çalışır; ilk ölçüm bitene kadar pane `measuring…` gösterir.
- En fazla 500 dizin listelenir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
