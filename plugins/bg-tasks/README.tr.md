# bg-tasks

Model arka planda bir dev server ya da dosya izleyici başlatır, işine devam eder ve onu unutur. Bir saat sonra o süreç hâlâ çalışıyordur ve nereden çıktığını bilmezsin. Bu mod session'daki her arka plan shell task'ını bitene kadar gözünün önünde tutar ve istediğini tek tuşla durdurmanı sağlar.

## Ne yapar

1. Bash tool'unu izler. `backgroundTaskId` döndüren her çağrı listeye girer: modelin `run_in_background` ile başlattığı da, senin Ctrl+B ile arka plana attığın da.
2. Bir task şu durumlarda listeden çıkar:
   - bildirimi gelince (`<task-id>` taşıyan ve status'u `running` olmayan bir `<task-notification>`). Ana loop bunu bir prompt olarak okur. Hâlâ çalışan bir subagent onu kendi loop'unda sıraya girmiş bir mesaj olarak okur. Cevabını çoktan vermiş bir subagent ise bu bildirimle yeniden uyandırılır; mod da o agent'ın mesajlarını turn'ünün sonunda okur;
   - foreground'da çalışan bir subagent cevap verince. Engine o agent'ın arka plan task'larını cevabıyla birlikte sonlandırır ve bildirim göndermez; mod da onları `killed` olarak kapatır;
   - model onu TaskStop tool'uyla durdurunca;
   - sen onu pane'den durdurunca.
3. Status line kaç task'ın çalıştığını, en eskisinin yaşını ve komutunu gösterir; her 30 saniyede bir yenilenir:

       bg-tasks: 2 running · oldest 12m (npm run dev)

   Çalışan task yoksa satır da yoktur.
4. `/bg-tasks` her task için bir satırı olan bir pane açar, en eskisi en üstte:

          age  who    command
       [ stop ]    12m  model  npm run dev
       [ stop ]     3m  you    tail -f logs/app.log

   Bir satırda Enter'a basınca mod o task'ı engine'in TaskStop tool'uyla durdurur; ayrıca onay sorulmaz, onay senin basmandır. Ardından pane `stopped: npm run dev` yazar. Task durmadıysa sebebiyle birlikte `not stopped: ...` yazar ve task listede kalır.
5. [sidebar](../sidebar) açıksa liste oraya gider ve status line boş kalır. Liste, başlığında sayıyı gösteren (`2 running`) tek bir section'dır; içinde aynı satırlar ve her task için bir `[ stop ... ]` butonu vardır. Satırda yaş ve task'ı kimin başlattığı soluk, komut varsayılan renktedir. Yaş bir saati geçince sarıya döner, böylece kontrolden çıkmış bir task göze çarpar. Buton `/bg-tasks stop <id>` çalıştırır ve task'ı aynı yoldan durdurur. Sidebar yoksa her şey yukarıdaki gibi işler.
6. Kendiliğinden biten bir task sidebar'ın stream'ine de bir kayıt bırakır. Böylece yukarıdaki section yalnız çalışanları gösterirken pane, bitenlerin kaydını da tutar. Kayıt task'ın nasıl bittiğini söyler ve yalnız o kelime renklidir: `completed` için yeşil `finished`, sarı `killed`, kırmızı `failed` (ya da engine'in bildirdiği başka herhangi bir status):

       bg-tasks: task finished
       sleep 600 · finished after 12m

       bg-tasks: task failed
       npm test · failed after 3m

   Senin ya da modelin durdurduğu task böyle bir kayıt bırakmaz; pane zaten `stopped: <task>` der. Sidebar kapalıysa hiçbir şey yazılmaz, çünkü engine'in kendi task bildirimi bitişi zaten haber verir.

2.1.282'deki canlı denemede subagent'lı üç yolun üçü de task'ını kapattı: foreground bir subagent'ın bitmesini beklediği `sleep 5`, foreground bir subagent'ın cevap verirken çalışır bıraktığı `sleep 120` ve agent'tan sonra biten, background bir subagent'ın `sleep 15`'i.

Daha önceki bir canlı denemede model arka planda `sleep 900` başlattı. Status line `1 running · oldest <1m (sleep 900)` gösterdi. Pane'de satırına basılınca süreç durdu; hem status line hem de engine'in `1 shell` alt satırı kayboldu.

## Komut

    /bg-tasks            pane'i açar ya da kapatır
    /bg-tasks list       task'ları id'leriyle birlikte metin olarak verir
    /bg-tasks stop <id>  o task'ı durdurur; sidebar butonunun çalıştırdığı komut budur
    /bg-tasks on | off   varsayılan açık; off listeyi temizler

Komutun adı `/bg` değil, çünkü engine `/bg`'yi yerleşik `/background` komutu için ayırıyor.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bg-tasks@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=bg-tasks}, tool.call{tool=Bash}, tool.call{tool=TaskStop}, prompt.submit{origin has {kind=task-notification}}, prompt.attachment{type=queued_command}, turn.complete, ui.render{component=Pane}
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.session.messages (via afterAgentTurn), $.sidebar.clear (via offSidebar), $.sidebar.set (via toFinished, toSidebar), $.store.get (via readSettings), $.store.set (via runCommand), $.tool.call (via stopTask), $.ui.close (via togglePane), $.ui.invalidate (via changed), $.ui.open (via togglePane), $.ui.panes (via togglePane), $.ui.resolve, $.ui.status (via showStatus)

Reach L2: bir tool çağırır.

    1. Okur:     her Bash çağrısının komutunu ve sonucunu; task bildirimlerinin metnini; her TaskStop çağrısının task id'sini; bir subagent'ın turn'ü bitince, listedeki bir task'ı başlatmış subagent'ın mesajlarını
    2. Çalıştırır: engine'in TaskStop tool'unu; yalnız sen pane'de ya da sidebar butonunda bastığında
    3. Gönderir: modele hiçbir şey; status line ve pane yalnız senin için çizilir
    4. Saklar:   $.store içinde açık/kapalı ayarını; task listesi session boyunca bellekte durur
    5. Düşman girdi: TaskStop'a giden task id yalnız engine'in kendi Bash sonuçlarından kurulan listeden gelir; bildirim metninde yalnız id'ler aranır

## Sınırlar

- Yalnız mod yüklüyken başlayan task'lar listelenir. Resume, `/reload-plugins` ya da güncellemeden sonra daha önce başlamış task'ları bilmez.
- Yalnız arka plan shell'leri listelenir; subagent'lar, workflow'lar ve monitor'ler listelenmez.
- Bildirimi hâlâ sırada bekleyen (session meşgulken biten) bir task, bildirim gelene kadar listede kalır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
