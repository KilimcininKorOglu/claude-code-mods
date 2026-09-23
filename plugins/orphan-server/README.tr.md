# orphan-server

Modelin bir Bash çağrısıyla bu repository'de başlattığı ve bir port'u dinler halde bıraktığı sunucuları, yaşları ve session'larıyla birlikte, her biri için bir stop tuşuyla listeleyen bir Claude Code Mod'u. `(cmd &)` ile başlayan bir sunucu onu başlatan session'dan sonra da yaşar ve hâlâ çalıştığını size başka hiçbir şey söylemez.

## Ne yapar

1. Session başında, her main-loop turn sonunda ve `/orphan-server` komutunda mod, bir TCP port'unu dinleyen process'leri okur (`lsof -nP -iTCP -sTCP:LISTEN`).
2. Yalnız parent'ı 1 olan (onu başlatan shell'den sonra yaşayan) ve working directory'si session'ın git repository'si ya da onun altındaki bir dizin olan process'i tutar.
3. Her biri için bu repository'nin transcript'lerinde onu başlatan Bash çağrısını okur: process başladığında çalışan (model onu yazdıktan sonra, sonucundan önce) ve komutu process'in argümanlarını içeren bir çağrı. Transcript'lerin yalnız o çağrının düşebileceği dakikalardaki satırları okunur ve her process bir kere aranır.
4. Bulunan sunucular tek bir sarı [sidebar](../sidebar) section'ında, en eskisi önce, her biri bir stop tuşuyla durur:

       :8787 Python -m http.server 8787 · 3h · session 450600b2
       [ stop :8787 ]

   Sidebar kapalıyken tek bir transcript satırı onları pid'leriyle adlandırır, sunucu kümesi başına bir kere; sidebar açıldıktan sonraki ilk taramada section çizilir.
5. Tuş `/orphan-server stop <pid>` komutunu çalıştırır. Mod önce process'i yeniden okur; artık listelenen sunucuya ait olmayan bir pid (başka parent, başka argümanlar, başka başlama zamanı) sinyal almaz. Aksi halde SIGTERM gönderir ve sunucu 5 saniye sonra hâlâ çalışıyorsa SIGKILL gönderir. Yeşil bir satır `stopped :8787 ...` der, ya da kırmızı bir satır SIGKILL'den sonra hâlâ çalıştığını söyler.

## Komut

    /orphan-server             sunucuları şimdi okur ve pid'leriyle listeler
    /orphan-server stop <pid>  listelenen bir sunucuya SIGTERM, 5 s sonra SIGKILL
    /orphan-server on | off    varsayılan on; off yalnız /orphan-server komutunda okur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install orphan-server@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Section ve stop tuşları için [sidebar](../sidebar) mod'unu kurun. O olmadan mod tek bir transcript satırı yazar ve bir sunucuyu `/orphan-server stop <pid>` durdurur.

## Nereye uzanır

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=orphan-server}, turn.complete
    ❯ ./register.ts calls: $.clock.after (via later, stop), $.clock.now (via listenersIn, readProc, runCommand, show, toSidebar), $.command.register, $.env.get, $.process.run (via output, rootOf), $.session.id, $.sidebar.clear (via toSidebar), $.sidebar.set (via toSidebar, toStream), $.store.get, $.store.set (via setEnabled), $.ui.log (via later, show, stop, toStream)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2, process çalıştırır ve sinyal gönderir.

    1. Okur:     dinleyen TCP process'lerini (pid, port'lar, parent, yaş, argümanlar, working directory) ve bu repository'nin session'larının transcript satırlarını, her birinin başlama anı çevresindeki dakikalar için
    2. Çalıştırır: git rev-parse --show-toplevel session başına bir kere; lsof, ps ve grep session başında, her turn sonunda ve /orphan-server komutunda; durdurduğunuz bir sunucu için kill -TERM ve kill -KILL
    3. Gönderir: modele ve network'e hiçbir şey
    4. Saklar:   $.store içinde on/off ayarını
    5. Düşman girdi: bir process'in argümanları ve bir transcript'in komutları metin olarak çizilir ve metin olarak karşılaştırılır, hiç çalıştırılmaz; bir stop'un pid'i sinyal gönderilmeden önce yeniden okunur

## Sınırlar

- Yalnız repository kökünün ve session'ın başlangıç dizininin transcript'leri okunur. Eski bir session'ın başka bir alt dizinde açılmışken başlattığı sunucu listelenmez.
- Hâlâ çalışan bir wrapper üzerinden başlayan sunucu (`npm run dev`, `make serve`) listelenmez, çünkü parent'ı 1 değil, wrapper'dır.
- Eşleşme zamana ve komut metnine dayanır. Aynı çağrıda aynı argümanlarla başlayan iki process ayrı ayrı birer sunucu olarak okunur ve ikisi de listelenir.
- Argümanları 3 karakterden kısa bir process hiç eşleşmez.
- Claude Code dışında elle başlattığınız bir sunucu hiç listelenmez, çünkü hiçbir transcript onun Bash çağrısını tutmaz.
- `lsof` ve `ps` yalnız sizin process'leriniz için cevap verir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
