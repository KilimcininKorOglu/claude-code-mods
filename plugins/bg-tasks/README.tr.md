# bg-tasks

Model arka planda bir dev server ya da dosya izleyici başlatır, işine devam eder ve bu process'i unutur. Bir saat sonra process hâlâ çalışır ve onu neyin başlattığını bilmezsiniz. Bu mod, session'daki her arka plan shell task'ını bitene kadar görünür tutar. İstediğiniz task'ı tek bir basışla durdurabilirsiniz.

## Ne yapar

1. Mod Bash tool'unu izler. `backgroundTaskId` döndüren her çağrı listeye eklenir: modelin `run_in_background` ile başlattığı task'lar ve sizin Ctrl+B ile arka plana gönderdiğiniz task'lar.
2. Bir task şu durumlarda listeden çıkar:
   - Task'ın bildirimi geldiğinde (`<task-id>` içeren ve status'u `running` olmayan bir `<task-notification>`). Main loop bu bildirimi bir prompt olarak okur. Hâlâ çalışan bir subagent bildirimi kendi loop'unda sıraya alınmış bir mesaj olarak okur. Cevabını zaten vermiş bir subagent bu bildirimle yeniden başlatılır. Mod bu durumda o agent'ın mesajlarını turn'ünün sonunda okur.
   - Foreground'da çalışan bir subagent cevap verdiğinde. Engine, o agent'ın arka plan task'larını cevabıyla birlikte sonlandırır ve bildirim göndermez. Mod da bu task'ları `killed` olarak kapatır.
   - Model task'ı TaskStop tool'uyla durdurduğunda.
   - Siz task'ı pane'den durdurduğunuzda.
3. Status line, çalışan task sayısını, en eski task'ın yaşını ve komutunu gösterir. Satır 30 saniyede bir yeniden çizilir:

       bg-tasks: 2 running · oldest 12m (npm run dev)

   Çalışan bir task yoksa satır gösterilmez.
4. `/bg-tasks` her task için bir satır içeren bir pane açar. En eski task en üsttedir:

          age  who    command
       [ stop ]    12m  model  npm run dev
       [ stop ]     3m  you    tail -f logs/app.log

   Bir satırda Enter'a basıldığında o task engine'in TaskStop tool'uyla durdurulur. Sizin basışınız onay yerine geçer. Ardından pane'de `stopped: npm run dev` yazar. Task durmadıysa nedeniyle birlikte `not stopped: ...` yazar ve task listede kalır.
5. [sidebar](../sidebar) açıkken liste sidebar'da gösterilir ve status line boş kalır. Liste, başlığında task sayısı (`2 running`) olan tek bir section'dır. Section aynı satırları ve her task için bir `[ stop ... ]` butonunu içerir. Satırda yaş ve task'ı başlatan soluk renkte, komut varsayılan renktedir. Bir saate ulaşan yaş sarıya döner. Böylece kontrolden çıkmış bir task kolayca fark edilir. Buton `/bg-tasks stop <id>` komutunu çalıştırır ve task'ı aynı yolla durdurur. Sidebar yoksa her şey yukarıdaki gibi çalışır.
6. Kendiliğinden biten bir task, sidebar'ın stream'ine de bir kayıt yazar. Böylece pane bitenlerin kaydını tutar, yukarıdaki section ise yalnız çalışan task'ları gösterir. Kayıt task'ın nasıl bittiğini bildirir ve yalnız bu kelime renklidir: `completed` için yeşil `finished`, `killed` için sarı, `failed` (ya da engine'in bildirdiği başka herhangi bir status) için kırmızı:

       bg-tasks: task finished
       sleep 600 · finished after 12m

       bg-tasks: task failed
       npm test · failed after 3m

   Sizin ya da modelin durdurduğu bir task böyle bir kayıt yazmaz, çünkü pane zaten `stopped: <task>` gösterir. Sidebar kapalıyken hiçbir şey yazılmaz, çünkü engine'in kendi task bildirimi bitişi zaten haber verir.

2.1.282 üzerindeki canlı denemede üç subagent yolunun üçünde de task kapandı: foreground bir subagent'ın bitmesini beklediği `sleep 5`, başka bir foreground subagent'ın cevap verirken çalışır bıraktığı `sleep 120` ve background bir subagent'ın, agent bittikten sonra biten `sleep 15` task'ı.

Daha eski bir canlı denemede model arka planda `sleep 900` başlattı. Status line `1 running · oldest <1m (sleep 900)` gösterdi. Pane'de task'ın satırına basıldığında process durdu. Ardından hem status line hem de engine'in `1 shell` alt satırı kayboldu.

## Komut

    /bg-tasks            pane'i açar ya da kapatır
    /bg-tasks list       task'ları id'leriyle birlikte metin olarak yazar
    /bg-tasks stop <id>  o task'ı durdurur; sidebar butonu bu komutu çalıştırır
    /bg-tasks on | off   varsayılan açık; kapatıldığında liste temizlenir

Komutun adı `/bg` değildir, çünkü engine `/bg` adını yerleşik `/background` komutu için ayırır.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bg-tasks@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=bg-tasks}, tool.call{tool=Bash}, tool.call{tool=TaskStop}, prompt.submit{origin has {kind=task-notification}}, prompt.attachment{type=queued_command}, turn.complete, ui.render{component=Pane} (default matcher key: plugin)
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.session.messages (via afterAgentTurn), $.sidebar.clear (via offSidebar), $.sidebar.set (via toFinished, toSidebar), $.store.get (via readSettings), $.store.set (via runCommand), $.tool.call (via stopTask), $.ui.close (via togglePane), $.ui.invalidate (via changed), $.ui.open (via togglePane), $.ui.panes (via togglePane), $.ui.resolve, $.ui.status (via showStatus)

Reach L2: bir tool çağırır.

    1. Okur:         her Bash çağrısının komutunu ve sonucunu; task bildirimlerinin metnini; her TaskStop çağrısının task id'sini; bir subagent'ın turn'ü bittiğinde, listedeki bir task'ı başlatan subagent'ın mesajlarını
    2. Çalıştırır:   engine'in TaskStop tool'unu; yalnız siz pane'de bastığınızda ya da sidebar butonuna tıkladığınızda
    3. Gönderir:     modele hiçbir şey; status line ve pane yalnız sizin için çizilir
    4. Saklar:       açık/kapalı ayarını $.store içinde; task listesi session boyunca bellekte tutulur
    5. Düşman girdi: TaskStop'a gönderilen task id yalnız engine'in kendi Bash sonuçlarından oluşan listeden gelir; bildirim metninde yalnız id aranır

## Sınırlar

- Yalnız mod yüklüyken başlatılan task'lar listelenir. Bir resume, `/reload-plugins` ya da güncellemeden sonra, daha önce başlatılmış task'lar mod tarafından bilinmez.
- Yalnız arka plan shell'leri listelenir. Subagent'lar, workflow'lar ve monitor'ler listelenmez.
- Bildirimi hâlâ sırada bekleyen bir task (session meşgulken biten bir task), bildirim gelene kadar listede kalır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
