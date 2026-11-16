# disk-janitor

Build araçları kendi çıktılarını hiçbir zaman temizlemez. `node_modules`, Rust'ın `target` dizini ve Python'ın `.venv` dizini disk dolana kadar büyür. Bu mod, session'ın repository'sindeki build artifact'larının boyutunu ölçer. Toplam 5 GB'ı geçtiğinde bunu gösterir. `/disk-janitor` pane'inde seçtiğiniz dizinleri siler. Bir veri dizini hiçbir zaman listelenmez ve hiçbir zaman silinmez.

## Ne yapar

1. Mod, session dizininin repository'sinde `git ls-files --others --ignored --exclude-standard --directory -z` komutunu şu anlarda çalıştırır: session başında, etkileşimli bir session'da 60 saniyede bir ve son ölçüm 10 dakikadan eskiyse bir turn'den sonra. Session dizini, session'ın başladığı dizindir ve başlangıçta bir kez okunur. Bunun nedeni, Bash'te çalışan bir `cd` komutunun session'ın dizinini değiştirmesi ve ölçümü başka bir repository'ye yönlendirmesidir. Bir git repository'si dışında mod hiçbir şey yapmaz. 60 saniyelik ölçüm sayesinde, bu session boştayken başka bir pencerede yapılan bir build ya da silme işlemi de gösterilir. Pane'deki silme butonu onay beklerken ölçüm yapılmaz, çünkü bir ölçüm butonu sıfırlar. Önceki ölçüm hâlâ sürüyorsa yeni ölçüm atlanır.
2. Mod, git'in ignore ettiği her dizini adına ve içeriğine göre sınıflandırır:
   - **kesin**: `node_modules` (içinde `.package-lock.json`, `.modules.yaml`, `.yarn-integrity` ya da `.yarn-state.yml` varsa), `target` (`CACHEDIR.TAG` ya da `.rustc_info.json` varsa), `.venv` ve `venv` (`pyvenv.cfg` varsa), `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.phpunit.cache`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `.gradle`, `DerivedData`, `Pods`. İşaret dosyası olmayan kesin bir ad belirsiz sayılır.
   - **belirsiz**: `dist`, `build`, `out`, `bin`, `obj`, `vendor`, `.cache`, `coverage`. Bu dizinler `(unsure)` etiketiyle listelenir ve hiçbir zaman önceden seçilmez.
   - **veri**: `docker-data`, `data`, `training`, `dataset`, `datasets`, `models`, `uploads`, `media`, `storage`, `db`, `database`, `pgdata`, `volumes`, `backup`, `backups`, `dump`, `dumps`, `logs`, `git-clone`, `release`, `releases`, `artifacts`, `cache`. Bu dizinler hiçbir zaman listelenmez. Mod bir seviye içine bakar ve oradaki artifact'ları (`training/.venv`) listeler. Veri dizininin kendisi hiçbir zaman listelenmez.
   - Diğer adlar listelenmez.
3. Listelenen dizinlerin boyutu argv ile tek bir `du -sk` çağrısıyla, arka planda ölçülür. Bu yüzden hiçbir prompt ölçümü beklemez.
4. Status line, toplamı 5 GB'tan itibaren gösterir. 20 GB'tan itibaren daha belirgin bir uyarı yazar:

       disk-janitor: artifacts 7.4 GB · /disk-janitor
       disk-janitor: over 20 GB: artifacts 23.1 GB · /disk-janitor

   [sidebar](../sidebar) açıksa bu satır status line yerine sidebar'da, session boyunca kalan bir `build artifacts` section'ında gösterilir ve status line boş kalır. Yalnız boyut renklidir: 5 GB'tan itibaren sarı, 20 GB'tan itibaren kırmızı. `· /disk-janitor` soluk renktedir. Toplam 5 GB'ın altına düşünce section kaldırılır. İkinci, soluk bir satır son silme işlemini gösterir: silinen kısım yeşil, `N skipped` sarı, `N failed` kırmızı renktedir. Bir `clean up` butonu pane'i açar:

       disk-janitor: build artifacts
       artifacts 7.4 GB · /disk-janitor
       deleted 2 dir(s), 2.5 GB
       [ clean up ]

   Buton `/disk-janitor` komutunu çalıştırır. Bu komut pane'i açar, pane açıksa kapatır. Buton kendisi hiçbir şeyi silmez: seçimler ve iki basışlık onay pane'de yapılır.

   Sidebar yoksa status line yukarıdaki gibi çizilir.

## Pane

`/disk-janitor` pane'i açar. Komutu yeniden çalıştırmak pane'i kapatır. Pane açıkken tuşları pane alır ve Esc pane'i kapatır.

    /Users/you/app · 6.5 GB
    [x] node_modules  2.0 GB
    [x] target  4.0 GB
    [ ] dist  1 MB  (unsure)
    [x] data/venv  512 MB
    [ Delete selected (6.5 GB) ]
    kept, data: data

Bir satırda Enter'a basmak o satırı seçer ya da seçimini kaldırır. Silme butonunda ilk Enter, butonu `Press again to delete 3 dir(s), 6.5 GB` metnine çevirir. İkinci Enter silme işlemini yapar. Seçimleriniz sonraki ölçümlerde de korunur.

Mod her silme işleminden hemen önce dizini yeniden kontrol eder. Dizin hâlâ bir dizin olmalı ve bir link olmamalıdır. Çözülmüş path'i repository'nin içinde olmalıdır. Hâlâ git tarafından ignore ediliyor olmalıdır (`git check-ignore`). Listelendiği sınıfta kalmalıdır. Bir kontrolü geçemeyen dizin atlanır ve adıyla bildirilir. Silme işlemi, shell olmadan argv ile `rm -rf -- <mutlak path>` olarak yapılır.

Ardından tek bir transcript satırı nelerin silindiğini ve nelerin kaldığını bildirir. Veri dizinleri de adlarıyla listelenir:

    disk-janitor: deleted 1 dir(s), 3 MB: node_modules (3 MB) · kept, data: data

## Komut

    /disk-janitor                  pane'i açar ya da kapatır
    /disk-janitor list             listelenen dizinleri metin olarak yazar; pane'i olmayan bir arayüz için
    /disk-janitor rescan           hemen yeniden ölçer
    /disk-janitor delete <path>    listelenen tek bir dizini, pane'deki kontrollerin aynısıyla siler

`delete` yalnız sizin prompt'tan ya da bridge ile yazdığınız bir komutta çalışır. Bir plugin'in çalıştırdığı komut reddedilir. Bu yüzden model hiçbir şeyi silemez.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install disk-janitor@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın. Mod bir key ya da ayar gerektirmez.
2. Claude Code'u bir git repository'si içinde başlatın. İlk ölçüm session başında çalışır.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, turn.complete, command.run{command=disk-janitor}, ui.render{component=Pane} (default matcher key: plugin), ui.close
    ❯ ./register.tsx calls: $.clock.after (via refreshInBackground), $.clock.every, $.clock.now, $.command.register, $.fs.exists (via hasAnyMarker), $.fs.list (via insideData), $.fs.stat (via staleReason), $.process.run (via findArtifacts, measure, removeDir, repoRoot, staleReason), $.session.cwd (via refresh), $.sidebar.clear (via toSidebar), $.sidebar.isOpen (via toSidebar), $.sidebar.set (via toSidebar), $.ui.close (via openPane), $.ui.invalidate (via pressDelete, refresh, toggle), $.ui.log (via pressDelete, refreshInBackground), $.ui.open (via openPane), $.ui.panes (via openPane), $.ui.resolve, $.ui.status (via showTotal)

Reach L2: process çalıştırır ve dizin siler.

    1. Okur:         repository'de git'in ignore ettiği dizinlerin adlarını; listelenen bir dizinin işaret dosyalarını; bir veri dizininin bir seviye içindeki girdileri; silmeden önce bir dizinin çözülmüş path'ini
    2. Çalıştırır:   salt okunur git rev-parse, git ls-files ve git check-ignore; du -sk; pane'de iki kez onayladığınız ya da /disk-janitor delete ile adını verdiğiniz bir dizin için rm -rf --; hepsi argv ile, shell olmadan
    3. Gönderir:     hiçbir şey; model /disk-janitor çıktı satırını diğer komut çıktıları gibi okur
    4. Saklar:       hiçbir şey; son ölçüm ve seçimleriniz bellekte tutulur
    5. Düşman girdi: dizin adı git'ten ve diskten gelir, hiçbir zaman modelden gelmez; silme işlemi yalnız sizin tuşunuzla ya da yazdığınız komutla yapılır ve path silmeden hemen önce bütün kontrolleri yeniden geçmek zorundadır

## Sınırlar

- Yalnız git'in ignore ettiği dizinler listelenir. Commit edilmiş ya da hiçbir yerde ignore edilmeyen bir build çıktısı listelenmez.
- Üç listenin dışındaki bir ad, build çıktısı olsa bile listelenmez.
- Ignore edilen bir dizinin içindeki başka bir ignore edilen dizin listelenmez. Tek istisna, dıştaki dizinin bir veri dizini olmasıdır. Bu durumda mod yalnız bir seviye içine bakar.
- Çok büyük bir dizin ağacında `du` uzun sürebilir. Ölçüm arka planda, 60 saniyelik bir sınırla çalışır. İlk ölçüm bitene kadar pane `measuring…` gösterir. Etkileşimli bir session ölçümü 60 saniyede bir çalıştırır. Bu yüzden artifact dizinlerinin altında yüz binlerce dosya olan bir repository'de bu dosyalar o sıklıkla okunur (ölçüldü: bu modun repository'sinde git'in ignore ettiği 42 dizin, toplam 231 MB, üzerinde `du -sk` 0,14 saniye sürdü).
- En fazla 500 dizin listelenir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
