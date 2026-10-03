# disk-janitor

Build araçları arkalarını hiç toplamaz: `node_modules`, Rust'ın `target`'ı ve Python'ın `.venv`'i disk dolana kadar sessizce büyür. Bu mod session'ın repository'sindeki build artifact'larını ölçer, toplam 5 GB'ı geçince gösterir ve `/disk-janitor` pane'inde seçtiğin dizinleri siler. Bir veri dizini hiçbir zaman listelenmez, hiçbir zaman silinmez.

## Ne yapar

1. Session başında, etkileşimli bir session'da 60 sn'de bir ve son ölçüm 10 dakikadan eskiyse bir turn'den sonra, session dizininin repository'sinde `git ls-files --others --ignored --exclude-standard --directory -z` çalıştırır. Bu dizin session'ın başladığı dizindir ve başlangıçta bir kez okunur, çünkü Bash'teki bir `cd` session'ın kendi dizinini değiştirir ve ölçümü başka bir repository'ye yöneltirdi. Git repository'si dışında hiçbir şey yapmaz. 60 sn'lik ölçüm, bu session boştayken başka bir pencerede yapılan bir build'i ya da silmeyi gösterir. Pane'deki sil butonu kuruluyken bekler, çünkü bir ölçüm butonu sıfırlar; bir önceki ölçüm hâlâ sürüyorsa atlanır.
2. Git'in ignore ettiği her dizini adına ve içeriğine göre ayırır:
   - **kesin**: `node_modules` (içinde `.package-lock.json`, `.modules.yaml`, `.yarn-integrity` ya da `.yarn-state.yml` varsa), `target` (`CACHEDIR.TAG` ya da `.rustc_info.json` ile), `.venv` ve `venv` (`pyvenv.cfg` ile), `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.phpunit.cache`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `.gradle`, `DerivedData`, `Pods`. İşaret dosyası olmayan kesin bir ad belirsiz sayılır.
   - **belirsiz**: `dist`, `build`, `out`, `bin`, `obj`, `vendor`, `.cache`, `coverage`. `(unsure)` ile listelenir, hiçbir zaman önceden seçilmez.
   - **veri**: `docker-data`, `data`, `training`, `dataset`, `datasets`, `models`, `uploads`, `media`, `storage`, `db`, `database`, `pgdata`, `volumes`, `backup`, `backups`, `dump`, `dumps`, `logs`, `git-clone`, `release`, `releases`, `artifacts`, `cache`. Hiçbir zaman listelenmez. Mod bir seviye içine bakar ve oradaki bir artifact'ı (`training/.venv`) listeler, veri dizininin kendisini asla.
   - Başka her ad listelenmez.
3. Listelenen dizinleri argv ile tek bir `du -sk` çağrısıyla, arka planda ölçer; böylece hiçbir prompt onu beklemez.
4. Status line toplamı 5 GB'tan itibaren gösterir, 20 GB'tan itibaren daha belirgin söyler:

       disk-janitor: artifacts 7.4 GB · /disk-janitor
       disk-janitor: over 20 GB: artifacts 23.1 GB · /disk-janitor

   [sidebar](../sidebar) açıksa bu satır oraya, session boyunca duran bir `build artifacts` section'ı olarak gider ve status line boş kalır. Yalnız boyut renklidir: 5 GB'tan itibaren sarı, 20 GB'tan itibaren kırmızı; `· /disk-janitor` soluktur. 5 GB'ın altında section kaldırılır. İkinci, soluk bir satır son silmeyi gösterir: silinen kısım yeşil, `N skipped` sarı, `N failed` kırmızı. Bir `clean up` butonu pane'i açar:

       disk-janitor: build artifacts
       artifacts 7.4 GB · /disk-janitor
       deleted 2 dir(s), 2.5 GB
       [ clean up ]

   Buton `/disk-janitor` çalıştırır; o da pane'i açar (açıksa kapatır). Buton kendi başına hiçbir şey silmez: seçimler ve iki basış pane'de kalır.

   Sidebar yoksa status line yukarıdaki gibi çizilir.

## Pane

`/disk-janitor` pane'i açar, yeniden çalıştırmak kapatır. Pane tuşları alır, Esc onu kapatır.

    /Users/you/app · 6.5 GB
    [x] node_modules  2.0 GB
    [x] target  4.0 GB
    [ ] dist  1 MB  (unsure)
    [x] data/venv  512 MB
    [ Delete selected (6.5 GB) ]
    kept, data: data

Bir satırda Enter onu seçer ya da seçimden çıkarır. Sil butonundaki ilk Enter onu `Press again to delete 3 dir(s), 6.5 GB`'a çevirir; ikincisi siler. Seçimlerin sonraki ölçümlerde de korunur.

Mod her silmeden hemen önce dizini yeniden kontrol eder: hâlâ bir dizin olmalı ve bir link olmamalı, (çözülmüş yoluyla) repository'nin içinde bulunmalı, hâlâ git tarafından ignore ediliyor olmalı (`git check-ignore`) ve listelendiği sınıfta kalmalıdır. Bir kontrolü geçemeyen dizin atlanır ve adıyla bildirilir. Silme, shell olmadan argv ile `rm -rf -- <mutlak yol>` olarak yapılır.

Ardından tek bir transcript satırı neyin gittiğini ve neyin kaldığını söyler; veri dizinlerini de adlarıyla sayar:

    disk-janitor: deleted 1 dir(s), 3 MB: node_modules (3 MB) · kept, data: data

## Komut

    /disk-janitor                  pane'i açar ya da kapatır
    /disk-janitor list             listelenen dizinleri metin olarak verir; pane'i olmayan bir yüzey için
    /disk-janitor rescan           şimdi yeniden ölçer
    /disk-janitor delete <yol>     listelenen tek bir dizini, pane'deki kontrollerin aynısıyla siler

`delete` yalnız senin prompt'tan ya da bridge üzerinden yazdığın bir komutta çalışır. Bir plugin'in çalıştırdığı komut reddedilir, yani model hiçbir şey silemez.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install disk-janitor@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat. Mod'un bir key'e ya da ayara ihtiyacı yoktur.
2. Claude Code'u bir git repository'sinin içinde başlat; ilk ölçüm session başında çalışır.

## Nereye uzanır

Claude Code 2.1.288 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, turn.complete, command.run{command=disk-janitor}, ui.render{component=Pane}, ui.close
    ❯ ./register.tsx calls: $.clock.after (via refreshInBackground), $.clock.every, $.clock.now, $.command.register, $.fs.exists (via hasAnyMarker), $.fs.list (via insideData), $.fs.stat (via staleReason), $.process.run (via findArtifacts, measure, removeDir, repoRoot, staleReason), $.session.cwd (via refresh), $.sidebar.clear (via toSidebar), $.sidebar.isOpen (via toSidebar), $.sidebar.set (via toSidebar), $.ui.close (via openPane), $.ui.invalidate (via pressDelete, refresh, toggle), $.ui.log (via pressDelete, refreshInBackground), $.ui.open (via openPane), $.ui.panes (via openPane), $.ui.resolve, $.ui.status (via showTotal)

Reach L2: process çalıştırır ve dizin siler.

    1. Okur:     repository'nin git tarafından ignore edilen dizin adlarını; listelenen bir dizinin işaret dosyalarını; bir veri dizininin bir seviye içindeki girdileri; silmeden önce bir dizinin çözülmüş yolunu
    2. Çalıştırır: salt okunur git rev-parse, git ls-files ve git check-ignore; du -sk; pane'de iki kez seçtiğin ya da /disk-janitor delete ile adını verdiğin bir dizin için rm -rf --; hepsi argv ile, shell yok
    3. Gönderir: hiçbir şey; /disk-janitor çıktı satırını model her komut çıktısı gibi okur
    4. Saklar:   hiçbir şey; son ölçüm ve seçimlerin bellekte durur
    5. Düşman girdi: dizin adı git'ten ve diskten gelir, hiçbir zaman modelden gelmez; silme ancak senin tuşunla ya da yazdığın komutla olur ve yol, hemen öncesinde bütün kontrolleri yeniden geçmek zorundadır

## Sınırlar

- Yalnız git'in ignore ettiği dizinler listelenir. Commit'lenmiş ya da hiçbir yerde ignore edilmeyen bir build çıktısı listelenmez.
- Üç listenin dışındaki bir ad, build çıktısı olsa bile listelenmez.
- Ignore edilen bir dizinin içindeki başka bir ignore edilen dizin listelenmez. Tek istisna dıştaki dizinin bir veri dizini olmasıdır; o zaman mod yalnız bir seviye içine bakar.
- Çok büyük bir ağaçta `du` uzun sürebilir. Ölçüm arka planda, 60 saniyelik bir sınırla çalışır; ilki bitene kadar pane `measuring…` gösterir. Etkileşimli bir session ölçümü 60 sn'de bir çalıştırır; artifact dizinlerinin altında yüz binlerce dosya olan bir repository bu dosyaları o sıklıkla okur (ölçüldü: bu mod'un repository'sinde git'in ignore ettiği 42 dizin, 231 MB, üzerinde `du -sk` 0,14 sn sürdü).
- En fazla 500 dizin listelenir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
