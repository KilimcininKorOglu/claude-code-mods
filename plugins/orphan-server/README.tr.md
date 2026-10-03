# orphan-server

Model bir dev sunucusunu `(cmd &)` ile başlatır, session biter ve sunucu port'u tutmaya devam eder. Günler sonra aynı port'u açmak istediğinde `address already in use` alırsın ve sunucunun hâlâ çalıştığını sana başka hiçbir şey söylemez. Bu mod, modelin bir Bash çağrısıyla bu repository'de başlattığı ve bir port'u dinler halde bıraktığı sunucuları yaşları ve session'larıyla birlikte, her biri için bir stop tuşuyla listeler.

## Ne yapar

1. Session başında, her ana loop turn'ünün sonunda, etkileşimli bir session'da 60 sn'de bir ve `/orphan-server` komutunda mod, bir TCP port'unu dinleyen process'leri okur (`lsof -nP -iTCP -sTCP:LISTEN`). 60 sn'lik tarama, bu session boştayken başka bir session'ın bıraktığı sunucuyu gösterir ya da başka yerde durdurulan bir sunucunun satırını kaldırır. Başarısız olan bir 60 sn'lik tarama sebebini bir kere yazar; bir tarama yeniden geçene kadar tekrar yazmaz.
2. Yalnız parent'ı 1 olan (onu başlatan shell'den sonra yaşayan) ve working directory'si session'ın git repository'si ya da onun altındaki bir dizin olan process'i tutar.
3. Her biri için bu repository'nin transcript'lerinde onu başlatan Bash çağrısını okur: process başladığında çalışan (model onu yazdıktan sonra, sonucundan önce) ve komutu process'in argümanlarını içeren bir çağrı. Transcript'lerin yalnız o çağrının düşebileceği dakikalardaki satırları okunur ve her process bir kere aranır.
4. Bulunan sunucular tek bir [sidebar](../sidebar) section'ında, en eskisi önce, her biri bir stop tuşuyla durur. Her satırda portlar sarı, yaş sarı ve bir günü geçince kırmızı, başka bir session'ın id'si soluktur; `this session` varsayılan renkte kalır:

       :8787 Python -m http.server 8787 · 3h · session 450600b2
       [ stop :8787 ]

   Sidebar kapalıyken tek bir transcript satırı onları pid'leriyle adlandırır, sunucu kümesi başına bir kere; sidebar açıldıktan sonraki ilk taramada section çizilir.
5. Tuş `/orphan-server stop <pid>` komutunu çalıştırır. Mod önce process'i yeniden okur; artık listelenen sunucuya ait olmayan bir pid (başka parent, başka argümanlar, başka başlama zamanı) sinyal almaz. Aksi halde SIGTERM gönderir ve sunucu 5 saniye sonra hâlâ çalışıyorsa SIGKILL gönderir. Bir satır `stopped :8787 ...` der ve `stopped` yeşildir, ya da sunucunun `still runs after SIGKILL` olduğunu söyler ve bu kelimeler kırmızıdır.

## Komut

    /orphan-server             sunucuları şimdi okur ve pid'leriyle listeler
    /orphan-server stop <pid>  listelenen bir sunucuya SIGTERM, 5 s sonra SIGKILL
    /orphan-server on | off    varsayılan on; off yalnız /orphan-server komutunda okur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install orphan-server@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Section ve stop tuşları için [sidebar](../sidebar) mod'unu kur. O olmadan mod tek bir transcript satırı yazar ve bir sunucuyu `/orphan-server stop <pid>` durdurur.

## Nereye uzanır

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=orphan-server}, turn.complete
    ❯ ./register.ts calls: $.clock.after (via later, stop), $.clock.every, $.clock.now (via listenersIn, readProc, runCommand, show, toSidebar), $.command.register, $.env.get, $.process.run (via output, rootOf), $.session.id, $.sidebar.clear (via toSidebar), $.sidebar.set (via toSidebar, toStream), $.store.get (via readSettings), $.store.set (via setEnabled), $.ui.log (via later, show, stop, tick, toStream)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2: process çalıştırır ve sinyal gönderir.

    1. Okur:     dinleyen TCP process'lerini (pid, port'lar, parent, yaş, argümanlar, working directory) ve bu repository'nin session'larının transcript satırlarını, her birinin başlama anı çevresindeki dakikalar için
    2. Çalıştırır: git rev-parse --show-toplevel session başına bir kere; lsof, ps ve grep session başında, her turn sonunda, etkileşimli bir session'da 60 sn'de bir ve /orphan-server komutunda; durdurduğun bir sunucu için kill -TERM ve kill -KILL
    3. Gönderir: modele ve network'e hiçbir şey
    4. Saklar:   $.store içinde on/off ayarını
    5. Düşman girdi: bir process'in argümanları ve bir transcript'in komutları metin olarak çizilir ve metin olarak karşılaştırılır, hiç çalıştırılmaz; bir stop'un pid'i sinyal gönderilmeden önce yeniden okunur

## Sınırlar

- Yalnız repository kökünün ve session'ın başlangıç dizininin transcript'leri okunur. Eski bir session'ın başka bir alt dizinde açılmışken başlattığı sunucu listelenmez.
- Hâlâ çalışan bir wrapper üzerinden başlayan sunucu (`npm run dev`, `make serve`) listelenmez, çünkü parent'ı 1 değil, wrapper'dır.
- Eşleşme zamana ve komut metnine dayanır. Aynı çağrıda aynı argümanlarla başlayan iki process ayrı ayrı birer sunucu olarak okunur ve ikisi de listelenir.
- Argümanları 3 karakterden kısa bir process hiç eşleşmez.
- Claude Code dışında elle başlattığın bir sunucu hiç listelenmez, çünkü hiçbir transcript onun Bash çağrısını tutmaz.
- `lsof` ve `ps` yalnız senin process'lerin için cevap verir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
