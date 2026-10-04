# bg-tasks

Model arka planda bir dev server ya da dosya izleyici başlatır, işine devam eder ve onu unutur. Bir saat sonra süreç hâlâ çalışıyordur ve nereden başlatıldığını bilmezsiniz. Bu mod, session'daki her arka plan shell task'ını bitene kadar gözünüzün önünde tutar ve istediğinizi tek bir basışla durdurmanızı sağlar.

## Ne yapar

1. Bash tool'unu izler. `backgroundTaskId` döndüren her çağrı listeye girer: modelin `run_in_background` ile başlattığı task kadar, sizin Ctrl+B ile arka plana attığınız da.
2. Bir task şu durumlarda listeden çıkar:
   - Bildirimi geldiğinde (`<task-id>` taşıyan ve status'u `running` olmayan bir `<task-notification>`). Main loop bu bildirimi bir prompt olarak okur. Hâlâ çalışan bir subagent onu kendi loop'unda sıraya girmiş bir mesaj olarak okur. Cevabını çoktan vermiş bir subagent ise bu bildirimle yeniden başlatılır ve mod, o agent'ın mesajlarını turn'ünün sonunda okur;
   - Foreground'da çalışan bir subagent cevap verdiğinde. Engine, o agent'ın arka plan task'larını cevabıyla birlikte bitirir ve bildirim göndermez; mod da onları `killed` olarak kapatır;
   - Model, TaskStop tool'uyla durdurduğunda;
   - Siz, pane'den durdurduğunuzda.
3. Status line, kaç task'ın çalıştığını, en eskisinin yaşını ve komutunu gösterir; 30 saniyede bir yeniden çizilir:

       bg-tasks: 2 running · oldest 12m (npm run dev)

   Çalışan hiçbir şey yoksa satır da yoktur.
4. `/bg-tasks`, her task için bir satır taşıyan bir pane açar; en eskisi üsttedir:

          age  who    command
       [ stop ]    12m  model  npm run dev
       [ stop ]     3m  you    tail -f logs/app.log

   Bir satırda Enter'a basmak o task'ı engine'in TaskStop tool'uyla durdurur; onay sizin basışınızdır. Pane ardından `stopped: npm run dev` yazar; durmadıysa sebebiyle birlikte `not stopped: ...` yazar ve o durumda task listede kalır.
5. [sidebar](../sidebar) açıkken liste oraya gider ve status line boş kalır. Liste, başlığında sayıyı taşıyan (`2 running`) tek bir section'dır; içinde aynı satırlar ve her task için bir `[ stop ... ]` butonu vardır. Satırda yaş ve başlatanın kim olduğu soluk, komut varsayılan renktedir. Yaş bir saate ulaştığında sarıya döner; böylece kontrolden çıkmış bir task göz çarpar. Buton, `/bg-tasks stop <id>`'yi çalıştırır ve task'ı aynı yolla durdurur. Sidebar kapalıysa her şey yukarıdaki gibi işler.
6. Kendi kendine biten bir task, sidebar'ın stream'ine de bir kayıt bırakır. Böylece pane, bitenlerin kaydını taşırken yukarıdaki section yalnız çalışanları taşır. Kayıt task'ın nasıl bittiğini söyler ve yalnız o kelime renklidir: `completed` için yeşil `finished`, `killed` için sarı, `failed` (ya da engine'in bildirdiği başka herhangi bir status) için kırmızı:

       bg-tasks: task finished
       sleep 600 · finished after 12m

       bg-tasks: task failed
       npm test · failed after 3m

   Sizin ya da modelin durdurduğu task böyle bir kayıt yazmaz; pane zaten `stopped: <task>` der. Sidebar kapalıyken hiçbir şey yazılmaz; çünkü engine'in kendi task bildirimi bitişi zaten haber verir.

2.1.282'deki canlı denemede üç subagent yolu da task'ını kapattı: bir foreground subagent'ın bekleyerek bitirdiği `sleep 5`; başka bir foreground subagent'ın cevap verirken çalışır bıraktığı `sleep 120`; ve agent'ından sonra biten bir background subagent'ın `sleep 15`'i.

Daha eski bir canlı denemede model arka planda `sleep 900` başlattı. Status line `1 running · oldest <1m (sleep 900)` gösterdi. Pane'de satırına basılınca süreç durdu; hem status line hem engine'in `1 shell` alt yazısı kayboldu.

## Komut

    /bg-tasks            pane'i açar ya da kapatır
    /bg-tasks list       task'ları metin olarak, id'leriyle verir
    /bg-tasks stop <id>  o task'ı durdurur; sidebar butonunun çalıştırdığı komut budur
    /bg-tasks on | off   varsayılan açık; off listeyi temizler

Komutun adı `/bg` değildir; çünkü engine `/bg`'yi yerleşik `/background` komutu için saklı tutar.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bg-tasks@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=bg-tasks}, tool.call{tool=Bash}, tool.call{tool=TaskStop}, prompt.submit{origin has {kind=task-notification}}, prompt.attachment{type=queued_command}, turn.complete, ui.render{component=Pane}
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.session.messages (via afterAgentTurn), $.sidebar.clear (via offSidebar), $.sidebar.set (via toFinished, toSidebar), $.store.get (via readSettings), $.store.set (via runCommand), $.tool.call (via stopTask), $.ui.close (via togglePane), $.ui.invalidate (via changed), $.ui.open (via togglePane), $.ui.panes (via togglePane), $.ui.resolve, $.ui.status (via showStatus)

Reach L2: bir tool çağırır.

    1. Okur:     her Bash çağrısının komutunu ve sonucunu; task bildirimlerinin metnini; her TaskStop çağrısının task id'sini; bir subagent'ın turn'ünün sonunda, listedeki bir task'ı başlatmış subagent'ın mesajlarını
    2. Çalıştırır: engine'in TaskStop tool'unu; yalnız sizin pane'deki basışınız ya da sidebar butonu üzerine
    3. Gönderir: modele hiçbir şey; status line ve pane yalnız sizin için çizilir
    4. Saklar:   $.store içinde açık/kapalı ayarını; task listesi session boyunca bellekte yaşar
    5. Düşman girdi: TaskStop'a giden task id, yalnız engine'in kendi Bash sonuçlarının kurduğu listeden gelir; bildirim metninde yalnız id aranır

## Sınırlar

- Yalnız mod yüklüyken başlatılan task'lar listelenir. Bir resume, `/reload-plugins` ya da güncellemeden sonra daha önce başlatılmış task'ları bilmez.
- Yalnız arka plan shell'leri listelenir; subagent'lar, workflow'lar ve monitor'ler listelenmez.
- Bildirimi hâlâ sırada bekleyen bir task (session meşgulken biten), bildirim gelene kadar listede kalır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
