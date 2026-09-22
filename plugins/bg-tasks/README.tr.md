# bg-tasks

Session'ın arka plandaki shell task'larını status line'da gösteren ve `/bg-tasks` pane'inden birini durduran bir Claude Code Mod'u. Modelin çalışır bıraktığı bir dev server ya da bir watcher, bitene kadar gözünüzün önünde kalır.

## Ne yapar

1. Mod Bash tool'unu hook'lar. `backgroundTaskId` dönen bir çağrı listeye girer: modelin `run_in_background` ile başlattığı ya da sizin Ctrl+B ile arka plana aldığınız bir task.
2. Bir task şu durumlarda listeden çıkar:
   - bildirimi geldiğinde (`<task-notification>`, bir `<task-id>` ve `running` dışında bir status ile),
   - model onu TaskStop tool'u ile durdurduğunda,
   - siz pane'de durdurduğunuzda.
3. Status line sayıyı, en eski task'ın yaşını ve komutunu gösterir, 30 saniyede bir yeniden çizilir:

       bg-tasks: 2 running · oldest 12m (npm run dev)

   Çalışan task yokken satır da yoktur.
4. `/bg-tasks` task başına bir satır taşıyan bir pane açar, en eskisi üstte:

          age  who    command
       [ stop ]    12m  model  npm run dev
       [ stop ]     3m  you    tail -f logs/app.log

   Bir satırda Enter, o task'ı engine'in TaskStop tool'u ile durdurur; onay sizin tuşunuzdur. Pane `stopped: npm run dev` der, ya da sebebiyle `not stopped: ...` der ve task o zaman listede kalır.

5. [sidebar](../sidebar) açıkken liste oraya gider: aynı satırları taşıyan bir section ve task başına bir `[ stop ... ]` butonu; status line boş kalır. Bir basış `/bg-tasks stop <id>` komutunu çalıştırır, yani task aynı yolla durur. Sidebar kapalıyken ya da o mod kurulu değilken her şey yukarıdaki gibidir.

6. Kendi kendine biten bir task, sidebar'ın stream'ine bir yeşil kayıt da yazar, böylece pane biteni tutar, üstündeki liste yalnız hâlâ çalışanı tutar:

       bg-tasks: task finished
       sleep 600 · finished after 12m

   Sizin durdurduğunuz bir task böyle bir kayıt yazmaz; pane zaten `stopped: <task>` demiştir. Sidebar kapalıyken hiçbir şey yazılmaz, çünkü engine'in kendi task bildirimi bitişi zaten haber verir.

Canlı testte model arka planda `sleep 900` başlattı. Status line `1 running · oldest <1m (sleep 900)` gösterdi. Pane'de satırına basmak process'i durdurdu, status line ve engine'in `1 shell` alt bilgisi kayboldu.

## Komut

    /bg-tasks            pane'i açar ya da kapatır
    /bg-tasks list       task'ları id'leriyle metin olarak yazar
    /bg-tasks stop <id>  o task'ı durdurur; sidebar butonunun çalıştırdığı komut
    /bg-tasks on | off   varsayılan on; off listeyi temizler

Ad `/bg` değil, çünkü engine `/bg` adını kendi `/background` komutuna ayırıyor.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bg-tasks@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, command.run{command=bg-tasks}, tool.call{tool=Bash}, tool.call{tool=TaskStop}, prompt.submit{origin has {kind=task-notification}}, ui.render{component=Pane}
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.sidebar.clear (via offSidebar), $.sidebar.set (via toFinished, toSidebar), $.store.get, $.store.set (via runCommand), $.tool.call (via stopTask), $.ui.close (via togglePane), $.ui.invalidate (via changed), $.ui.open (via togglePane), $.ui.panes (via togglePane), $.ui.resolve, $.ui.status (via showStatus)

Reach L2, bir tool çağırır.

    1. Okur:     her Bash çağrısının komutunu ve sonucunu; task bildirimlerinin metnini; her TaskStop çağrısının task id'sini
    2. Çalıştırır: engine'in TaskStop tool'unu, yalnız pane'deki tuşunuzla ya da sidebar butonuna basışınızla
    3. Gönderir: modele hiçbir şey; status line ve pane yalnız sizin için çizilir
    4. Saklar:   $.store içinde on/off ayarını; task listesi session boyunca bellekte kalır
    5. Düşman girdi: bir task id'si TaskStop'a yalnız engine'in kendi Bash sonuçlarının kurduğu listeden gider; bildirim metninde sadece id aranır

## Sınırlar

- Yalnız mod yüklüyken başlayan task'lar listelenir. Bir resume'dan, `/reload-plugins` ya da bir güncellemeden sonra daha önce başlamış task'lar bilinmez.
- Subagent'lar, workflow'lar ve monitor'ler listelenmez, yalnız arka plan shell'leri listelenir.
- Bildirim olmadan biten bir task (session meşguldü ve bildirim hâlâ kuyrukta) bildirim gelene kadar listede kalır.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
