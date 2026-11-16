# orphan-server

Model bir geliştirme sunucusunu `(cmd &)` ile başlatır. Session biter, ancak sunucu port'u tutmaya devam eder. Günler sonra aynı port'u açmak istediğinizde `address already in use` hatası alırsınız. Sunucunun hâlâ çalıştığını size bildiren başka bir şey yoktur. Bu mod, modelin bu repository'de bir Bash çağrısıyla başlattığı ve bir port'u dinler hâlde bıraktığı sunucuları listeler. Her sunucu yaşı, session'ı ve bir stop butonuyla birlikte gösterilir.

## Ne yapar

1. Mod, TCP port'u dinleyen process'leri (`lsof -nP -iTCP -sTCP:LISTEN`) şu anlarda okur: session başında, her ana loop turn'ünün sonunda, etkileşimli bir session'da 60 saniyede bir ve `/orphan-server` komutunda. 60 saniyelik tarama sayesinde, bu session boştayken başka bir session'ın bıraktığı sunucu da listeye eklenir. Başka bir yerde durdurulan sunucunun satırı da listeden kaldırılır. Başarısız olan bir 60 saniyelik tarama nedenini bir kez yazar. Bir tarama yeniden başarılı olana kadar neden tekrar yazılmaz.
2. Yalnız şu iki koşulu sağlayan process'ler tutulur: parent'ı 1'dir (onu başlatan shell kapandıktan sonra çalışmaya devam etmiştir) ve working directory'si session'ın git repository'si ya da onun altındaki bir dizindir.
3. Her process için bu repository'nin transcript'lerinde onu başlatan Bash çağrısı aranır. Aranan çağrı, process başladığı sırada çalışmakta olan (model çağrıyı yazdıktan sonra, sonucu gelmeden önce) ve komutu process'in argümanlarını içeren çağrıdır. Transcript'lerin yalnız bu çağrının bulunabileceği dakikalardaki satırları okunur. Her process yalnız bir kez aranır.
4. Bulunan sunucular tek bir [sidebar](../sidebar) section'ında, en eskisi başta olacak şekilde ve her biri bir stop butonuyla gösterilir. Her satırda port'lar sarı renktedir. Yaş sarı renktedir ve bir günü geçince kırmızıya döner. Başka bir session'ın id'si soluk renktedir. `this session` varsayılan renkte kalır:

       :8787 Python -m http.server 8787 · 3h · session 450600b2
       [ stop :8787 ]

   Sidebar kapalıyken transcript'e, sunucuları pid'leriyle adlandıran tek bir satır yazılır. Bu satır her sunucu kümesi için bir kez yazılır. Section, sidebar açıldıktan sonraki ilk taramada çizilir.
5. Buton `/orphan-server stop <pid>` komutunu çalıştırır. Mod önce process'i yeniden okur. Pid artık listelenen sunucuya ait değilse (parent, argümanlar ya da başlama zamanı farklıysa) process'e sinyal gönderilmez. Pid hâlâ aynı sunucuya aitse SIGTERM gönderilir. Sunucu 5 saniye sonra hâlâ çalışıyorsa SIGKILL gönderilir. Sonuç bir satırla bildirilir: `stopped :8787 ...` (`stopped` yeşil renktedir) ya da sunucunun `still runs after SIGKILL` olduğu (bu kelimeler kırmızı renktedir).

## Komut

    /orphan-server             sunucuları hemen okur ve pid'leriyle listeler
    /orphan-server stop <pid>  listelenen bir sunucuya SIGTERM, 5 saniye sonra SIGKILL
    /orphan-server on | off    varsayılan açık; kapalıyken yalnız /orphan-server komutunda okur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install orphan-server@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Section ve stop butonları için [sidebar](../sidebar) modunu yükleyin. Sidebar yüklü değilse mod transcript'e tek bir satır yazar. Bu durumda bir sunucuyu `/orphan-server stop <pid>` komutuyla durdurabilirsiniz.

## Nelere erişir

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=orphan-server}, turn.complete
    ❯ ./register.ts calls: $.clock.after (via later, stop), $.clock.every, $.clock.now (via listenersIn, readProc, runCommand, show, toSidebar), $.command.register, $.env.get, $.process.run (via output, rootOf), $.session.id, $.sidebar.clear (via toSidebar), $.sidebar.set (via toSidebar, toStream), $.store.get (via readSettings), $.store.set (via setEnabled), $.ui.log (via later, show, stop, tick, toStream)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2: process çalıştırır ve sinyal gönderir.

    1. Okur:         dinleyen TCP process'lerini (pid, port'lar, parent, yaş, argümanlar, working directory); bu repository'nin session'larına ait transcript satırlarını, her process'in başlama anının çevresindeki dakikalar için
    2. Çalıştırır:   her session'da bir kez git rev-parse --show-toplevel; session başında, her turn sonunda, etkileşimli bir session'da 60 saniyede bir ve /orphan-server komutunda lsof, ps ve grep; durdurduğunuz bir sunucu için kill -TERM ve kill -KILL
    3. Gönderir:     modele ve network'e hiçbir şey
    4. Saklar:       açık/kapalı ayarını $.store içinde
    5. Düşman girdi: bir process'in argümanları ve bir transcript'in komutları metin olarak çizilir ve metin olarak karşılaştırılır, hiçbir zaman çalıştırılmaz; bir stop işleminin pid'i sinyal gönderilmeden önce yeniden okunur

## Sınırlar

- Yalnız repository kökünün ve session'ın başladığı dizinin transcript'leri okunur. Başka bir alt dizinde açılmış eski bir session'ın başlattığı sunucu listelenmez.
- Hâlâ çalışan bir wrapper ile başlatılan sunucu (`npm run dev`, `make serve`) listelenmez, çünkü parent'ı 1 değil, wrapper'dır.
- Eşleşme zamana ve komut metnine göre yapılır. Aynı çağrıda aynı argümanlarla başlatılan iki process ayrı sunucular olarak okunur ve ikisi de listelenir.
- Argümanları 3 karakterden kısa bir process hiçbir zaman eşleşmez.
- Claude Code dışında elle başlattığınız bir sunucu hiçbir zaman listelenmez, çünkü hiçbir transcript onun Bash çağrısını içermez.
- `lsof` ve `ps` yalnız sizin process'leriniz için cevap verir.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
