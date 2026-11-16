# sidebar

Bir düzine mod bulgularını transcript satırı ve status line olarak yazdığında transcript, konuşmaya ait olmayan satırlarla dolar. Bir bulgu da siz okumadan yukarı kayar. Bu mod transcript'in yanında ortak bir pane açar ve diğer bütün modların bu pane'e yazdıklarını çizer. Her mod için ayrı bir pane yoktur, tek bir sidebar vardır: bir mod, satırlardan ve button'lardan oluşan bir section ile `$.sidebar.set(...)` çağırır ve bu mod section'ı çizer.

## Ne yapar

1. `/sidebar` pane'i açar, `/sidebar off` pane'i kapatır. Seçim `$.store` içinde saklanır. Bu yüzden daha sonra başlayan bir session sidebar'ı kendiliğinden yeniden açar. Seçim açıkken mod, session başında engine'den fullscreen layout'u da ister (`/tui fullscreen`, mod tarafından çalıştırılır), çünkü pane'leri transcript'in yanına yerleştiren tek layout budur. Session zaten fullscreen'deyse bu istek hiçbir şeyi değiştirmez. Başlatma flag'leri bu geçişi yasaklayan bir session isteği yok sayar. Pane ya sidebar olarak gösterilir ya da hiç gösterilmez: surface pane'leri transcript'in yanına yerleştiriyorsa (fullscreen layout, 110 sütundan itibaren) pane orada açılır. Yerleştirmiyorsa pane ilk çiziminde kendini kapatır, her mod kendi transcript satırını ya da status line'ını göstermeye devam eder ve seçim değişmez. Pane'i kendi kapatma tuşuyla ya da `/sidebar off` ile kapatmak, sidebar'ı yalnız o session için kapatır: kapatılan sidebar, siz `/sidebar off` çalıştırana kadar bir sonraki session'da yeniden açılır.
2. Pane açıkken herhangi bir mod bir section yazabilir: `$.sidebar.set({ consumer, key, title, lines, buttons, until, order })` çağrısı `true` döndürür. Pane kapalıyken hiçbir şey saklanmaz ve çağrı `false` döndürür. Bu durumda mod kendi transcript satırını ya da status line'ını göstermeye devam eder.
3. Bir section; kalın bir başlık (`<consumer>: <title>`, bir stream kaydında ayrıca saat), satırlar (`ok` yeşil, `warn` sarı, `error` kırmızı, `dim` soluk) ve button'lar olarak çizilir. Pane iki bölümden oluşur: üstte kalıcı section'lar (`until: 'session'`, ardından `until: 'turn'`; her grup `order`, consumer ve key sırasıyla sıralanır) ve altlarında stream.
4. Stream, `until: 'stream'` ile yazılan kayıtlardır: bulguların bir log'u, en yenisi en üstte, kalıcı section'ların hemen altında. İkisi birlikte çizildiğinde aralarında soluk bir ayraç satırı bulunur: pane genişliğinde tireler ve tam ortada bir `o` (`---------o---------`). Bir kayıt başka bir kaydın yerine geçmez. Bu yüzden aynı mod ve key ile iki kez yazılan bir bulgu iki kayıt olarak görünür. Bir stream kaydının başlığı, kaydın yazıldığı günü ve saati de bilgisayarın kendi time zone'unda gösterir (`edit-loop: edit loop (21.09 14:32)`). Böylece log'u sonradan okuyabilirsiniz. Kalıcı bir section saat göstermez, çünkü her ölçümde yeniden yazılır. Turn'ün sonunda hiçbir kayıt kaldırılmaz: yeni kayıtlar onu aşağı iter. Kayıt pane'in son satırını geçtiğinde ona kaydırarak ulaşırsınız (5. madde). Daha uzun bir terminal stream'in daha fazlasını, daha kısa bir terminal daha azını gösterir. Stream'in satırları paylaşılır: birden çok mod stream'e yazarken her biri en fazla kendi payı kadar satır çizer. Böylece çok kayıt yazan bir mod, başka bir modun bulgusunu pane'den çıkaramaz. Bir payın kullanmadığı satırlar, bu payın geri tuttuğu kayıtlara verilir. Tek başına yazan bir mod bütün alanı kullanır.
5. Stream kendi başına kayar. Kalıcı section'lar hiç yer değiştirmez. Pane'in üstünde mouse tekerleği, pane focus'tayken de ok ve page tuşları stream'i tam kayıtlar hâlinde kaydırır. Eski kayıtlar görünürken ayraç, üstte kalan yeni kayıtların sayısını gösterir (`---- 3 newer ^ -----`). Ayraç, kalıcı section yokken de çizilir. Siz kaydırmışken yazılan bir kayıt görünümü yerinde tutar ve bu sayıyı bir artırır. En üste döndüğünüzde stream yine en yeni kayıtlarını, satırları yukarıdaki gibi paylaştırarak gösterir. Kaydırılmış görünüm ise her kaydı sırayla, paylaşılan satırların geri tuttukları kayıtlar da dahil, çizer.
6. Bir button bir slash komutu çalıştırır: `{ label: 'stop', command: 'bg-tasks', args: 'stop b1' }` için `[ stop ]` button'una basmak, `/bg-tasks stop b1` komutunu siz yazmışsınız gibi çalıştırır. Komutun ilk cevap satırı pane'in altında soluk renkte görünür. Çalışmayan bir komut orada `/<command> did not run: <error>` gösterir ve `did not run` kırmızı renkte çizilir. Button'u sunan mod bu komutu kendisi karşılar. Etiket, işaretçi üstüne geldiğinde kırmızıya döner. Böylece bir basışın neyi çalıştıracağı basmadan önce görünür.
7. Üç ömür vardır: `session` mod onu değiştirene ya da temizleyene kadar üstte kalır, `stream` alttaki log'a eklenir, `turn` turn bittiğinde kaldırılır. Kapatılıp yeniden yüklenen (`/reload-plugins`) bir plugin kendi section'ını artık temizleyemez. Bu yüzden sidebar, her turn'ün başında plugin'i kapalı olan bir modun kalıcı section'larını kaldırır: bu adın her `enabledPlugins` key'i false'tur ve session'daki hiçbir komut bu plugin'den gelmez. `--plugin-dir` ile yüklenen bir plugin'in section'ları kalır, çünkü kendi komutu listededir. Adı hiçbir key'de geçmeyen bir consumer'ın section'ları da kalır. Böyle bir plugin'in stream'e yazdığı kayıtlar yerinde kalır.
8. Her stream kaydı ayrıca bu projenin kendi log dosyasına yazılır: `~/.claude/sidebar/<project>-<YYYY-MM-DD>.log`, her satırda bir JSON object. Pane açıldığında bu projenin log'larındaki en yeni 10 kayıt stream'e geri gelir. Her kayıt ilk yazıldığı gün ve saatle gösterilir. Böylece yarın başlayan bir session dün bulunanları da gösterir. Geri gelen bir kayıt log'a yeniden yazılmaz. Gün, yazma işleminin günüdür. Bu yüzden gece yarısını geçen bir session yeni günün dosyasına yazar. Her yazma işlemi dosyayı önce yeniden okur. Böylece aynı gün aynı projenin iki session'ı birbirinin satırlarını korur. Var olan ancak okunamayan bir dosyanın üzerine yazılmaz. Stream kayıtlarını kaldıran bir `clear`, log'a kendi satırını yazar (`{"at", "cleared": {consumer, key}}`): kayıtlar geçmiş olarak dosyada kalır. Geri yükleme, bu key'in bu satırdan önce yazılmış her kaydını dışarıda bırakır, satır daha yeni bir günün dosyasında olsa da. Böylece kapanmış bir bulgu, kendi kapanış satırının yanında geri gelmez. `/sidebar log`, dosyanın path'ini ve temizlenenler de dahil en yeni 10 kaydını yazar.
9. Model pane'i `mcp__sidebar__read` tool'u ile okur. Tool, session başından itibaren ToolSearch ile yüklenmesi gerekmeden listelenir. Tool'un açıklaması, sidebar'da görünen bir şeyden söz ettiğinizde modelden tool'u çağırmasını ister. Böylece pane'in içeriğini prompt'a yapıştırmanız gerekmez. Tool pane'in içeriğini düz metin olarak döndürür: her section'ın başlığı ve altında girintili satırları, kalıcı section'lar ile stream arasındaki çizgi `---` olarak, bir button `[ label ]` olarak. Renkler korunmaz. `/sidebar snapshot` aynı metni komutun cevabı olarak verir ve model bu metni de okur. Kapalı bir sidebar hiçbir şey tutmadığını bildirir. Claude Code 2.1.288 üzerinde canlı bir session'da ölçüldü: sidebar'da ne yazdığı sorulan model tool'u hemen çağırdı ve ctx satırını kelimesi kelimesine aktardı.

## Diğer modların kullandığı API

`plugin.json` içinde `"dependencies": ["sidebar"]` **tanımlamayın**. Tanımlanan bir dependency zorunludur: kullanıcıda sidebar yüklü değilse engine modunuzu hiç yüklemez (2.1.278 üzerinde ölçüldü). Bunun yerine API'yi bir kontrolün arkasından çağırın. Böylece modunuz sidebar olsa da olmasa da çalışır:

```ts
/** The finding the person reads: the sidebar while it is open, else the mod's own transcript line. */
async function toPerson($: EngineInterface, findings: readonly string[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({
      consumer: 'my-mod',              // your mod's name, drawn in the section heading
      key: 'src-users.ts',             // names the section inside your mod; [A-Za-z0-9._:-]
      title: 'SQL built from strings', // the heading beside the consumer
      lines: findings.map(text => ({ text, kind: 'error' })), // kind: 'ok' | 'warn' | 'error' | 'dim' | 'info' (blue), or absent
      buttons: [{ label: 'fix', command: 'my-mod', args: 'fix src/users.ts' }], // optional
      until: 'stream',                 // 'stream' logs it, 'session' keeps it standing, 'turn' drops it at the turn's end
      order: 50,                       // smaller is higher inside your group; 100 when absent
    })
    if (taken) return
  } catch {
    // The sidebar mod is not installed, so $.sidebar is missing and the call throws.
  }
  $.ui.log(line)
}
```

`set`, section saklanıp çizildiğinde `true`, sidebar kapalıyken `false` döndürür. Bu yüzden tek bir `if (taken) return` hem kapalı hem de yüklü olmayan sidebar durumunu kapsar. `clear({ consumer, key })`, bu key'in kalıcı section'ını ve her stream kaydını kaldırır. Ayrıca sonraki bir session'ın bu kayıtları log'dan geri yüklemesini önler. `isOpen()`, pane'in açık olup olmadığını döndürür.

Bir satır `parts` içerdiğinde tek bir kelimeyi renklendirebilir: `{ text: 'model opus-5-5', parts: [{ text: 'model ' }, { text: 'opus-5-5', kind: 'error' }] }`. Her part kendi `kind` değerini alır. `kind` değeri olmayan bir part, satırın `kind` değerini alır. Part'ların birleştirilmiş metinleri, pane'in çizdiği ve wrap ettiği satırdır. Bir part, wrap edilen bir satırda da rengini korur. Satırın tamamını `text` içinde de tutun, çünkü 0.11.0'dan eski bir sidebar yalnız `text` değerini çizer.

Contract, `types/index.d.ts` dosyasıdır: `SidebarSection`, `SidebarLine`, `SidebarPart`, `SidebarKind`, `SidebarButton`, `SidebarUntil` ve `Sidebar`. `/plugin-types` bu dosyayı etkin her plugin için `.claude/types/claude-code-plugins/` altına kopyalar. Böylece `$.sidebar`, modunuzda elle hiçbir şey kopyalamadan type'lanır. Bu contract'a göre geliştirme yapmak için `claude --plugin-dir <modunuz> --plugin-dir <sidebar path'i>` kullanın.

Bir `claude plugin test` dosyasında test engine'i `engine.create` çalıştırmaz. Bu yüzden noun'u inline bir plugin ile stub'layın ve çağrılarını test world'ünde cevaplayın:

```ts
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}
// then in the test: on('sidebar.set', (_, e) => ({ value: true }))
```

Her section için sınırlar: 50 satır ve 5 button. Dışarıda kalan satırlar pane'de sayı olarak gösterilir. Pane, surface'in body'sine verdiği kadar satır çizer, en fazla 200 satır. Stream, satırlar bunların kaçını gösterirse göstersin, her consumer için en yeni 20 kaydı ve toplam 100 kaydı tutar. Stream'in çizdiği satırlar, stream'e yazan consumer'lar arasında paylaşılır. Pane'in genişliğinden uzun bir satır en fazla 4 satıra wrap edilir (Sınırlar bölümüne bakın). Bir satır en fazla 16 part içerebilir. `consumer`, `key` ya da `title` değeri başka biçimde olan bir section, çağıran modun okuduğu bir hatayla reddedilir.

## Komut

    /sidebar            pane'i açar, açıksa kapatır
    /sidebar on | off   aynı işlem, adıyla
    /sidebar status     açık mı kapalı mı, kaç section gösteriliyor ve stream kaç kayıt tutuyor
    /sidebar log        bu projenin bugünkü log'unun path'i ve en yeni 10 kaydı
    /sidebar snapshot   pane'in içeriği düz metin olarak, sizin kopyalamanız ve modelin okuması için

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sidebar@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Bir kez `/sidebar` komutunu çalıştırın. Bundan sonra siz `/sidebar off` çalıştırana kadar her session sidebar'ı açar. Pane'in kendi kapatma tuşu sidebar'ı yalnız o session için kapatır ve seçim korunur.

## Nelere erişir

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ types ./types/index.d.ts declares on $: $.sidebar
    ❯ ./register.tsx hooks: engine.create, session.start, tool.describe{tool=/"^mcp__sidebar__read$"/}, tool.call{tool=/"^mcp__sidebar__read$"/}, command.run{command=sidebar}, ui.render{component=Pane} (default matcher key: plugin), ui.scroll{component=Pane, requestId=sidebar}, ui.close, turn.start, turn.complete
    ❯ ./register.tsx calls: $.clock.after (via setOpen), $.clock.now, $.command.list (via dropOff), $.command.register, $.command.run (via pressButton, switchToFullscreen), $.env.get (via openLog), $.fs.exists, $.fs.list (via logFiles), $.fs.read, $.fs.write, $.session.cwd (via openLog), $.settings.read (via dropOff), $.store.get, $.store.set (via setOpen), $.tool.register, $.ui.close (via closePane), $.ui.invalidate, $.ui.log (via switchToFullscreen), $.ui.open (via showPane), $.ui.panes (via closePane), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: HOME

Reach L2: bir dosya yazar.

    1. Okur:         diğer modların verdiği section'ları; bir stream kaydının saati için saati; HOME'u; session'ın dizinini ve ~/.claude/sidebar altındaki bu projenin kendi log dosyalarını
    2. Çalıştırır:   bir button'ın belirttiği slash komutunu, $.command.run ile, yalnız siz bastığınızda
    3. Gönderir:     makineden dışarı hiçbir şey çıkmaz; model mcp__sidebar__read çağırdığında ya da siz /sidebar snapshot çalıştırdığınızda pane'in metni modelin context'ine girer
    4. Saklar:       sidebar'ın açık olup olmadığını $.store içinde; ~/.claude/sidebar içinde her proje ve gün için bir log dosyası; bu dosya diğer modların yazdığı stream kayıtlarını ve kayıt kaldıran her clear için bir satırı tutar
    5. Düşman girdi: bir section başka bir plugin'den gelir ve veri olarak okunur: consumer, key ve title kontrol edilir; başka biçimdeki her satır ve button çıkarılır; metin tek satıra indirilir ve genişliğe göre wrap edilir; sayılar sınırlanır. Bir log satırı da aynı şekilde okunur. Bu yüzden elle düzenlenmiş ya da kesilmiş bir dosya yalnız o satırı kaybeder, başka hiçbir şeyi kaybetmez.

## Sınırlar

- Log dizini 0.7.0 sürümüne kadar `~/.claude/stream` idi ve 0.8.0 sürümünden itibaren `~/.claude/sidebar` oldu. Böylece her modun kendi dizini modun adını taşır. Hiçbir dosya taşınmaz: eski dosyalar diskte okunmadan kalır. Eski günlerin geri yüklenmesini istiyorsanız dosyaları kendiniz taşıyın: `mv ~/.claude/stream/* ~/.claude/sidebar/`.
- Pane, yalnız fullscreen layout'ta transcript'in yanına yerleştirilir. Diğer durumda prompt'un üstünde açılır.
- Sidebar'ı saklanan seçime göre açan bir session, pane'i kullanıcı olarak değil, plugin olarak açar: engine böyle bir pane'i 144 terminal sütununun altında çizmez. Kullanıcı bu pane'i daha önce bir kez kendisi açtıysa sınır 110 sütundur. O session'da çalıştırılan `/sidebar`, pane'i her genişlikte yerleştirir.
- Sidebar'ı kapatmak her section'ı ve bütün stream'i kaldırır. Sidebar yeniden açıldığında bunların hiçbiri geri gelmez. Her mod kendi section'ını bir sonraki güncellemede yeniden yazar.
- Pane'deki stream session boyunca tutulur. Diskteki log ise Claude Code yeniden başlatıldıktan sonra kalan kayıttır ve bunun yalnız en yeni 10 kaydı geri gelir.
- Log her proje ve her gün için ayrıdır. Proje, session'ın başladığı dizinin son parçasıdır. Bu yüzden bir repository'nin iki checkout'u aynı log dosyasını paylaşır.
- Bir günün dosyası en yeni 500 satırını tutar. Eski bir günün dosyasını hiçbir şey silmez. Bu dosyaları sizin temizlemeniz gerekir.
- Her kayıtta dosyanın tamamı yeniden yazılır, çünkü engine'in `$.fs` arayüzünde append yoktur. Başarısız bir yazma işlemi atlanır ve pane çalışmaya devam eder.
- Bir stream kaydının saati, modun kaydı yazdığı andır. Bu saat `$.clock.now()` ile okunur ve bilgisayarın kendi time zone'unda gösterilir. Bulgunun gerçekleştiği an değildir ve sonradan değişmez.
- Pane'in genişliğinden uzun bir satır, sığan son boşlukta, en fazla 4 satıra wrap edilir. İlk satırdan sonraki her satır iki boşluk girintilidir. Bu 4 satıra sığmayan bir satırın son satırı `…` ile kesilir. Bir başlık wrap edilmez, kesilir.
- Stream her consumer için 20, toplam 100 kayıt tutar. Kendi sınırını aşan bir mod kendi en eski kaydını kaybeder, hiçbir zaman başka bir modun kaydını değil.
- Bir button yalnız bir slash komutu çalıştırabilir. Button isteyen bir mod, bunun için bir komut sunmak zorundadır.
- Stream satır satır değil, tam kayıtlar hâlinde kayar. Session'ın bellekte tuttuğu kayıtlara ulaşır (yukarıdaki stream sınırına bakın), diskteki log'a ulaşmaz. Log'u `/sidebar log` okur.
- Pane yalnız body'sinin gösterdiği kadar satır çizer. Bu yüzden engine'in kendi scroll penceresi hiç kaymaz ve pane'in her kaydırma işlemini mod kendisi karşılar.

## Geliştirme

    make install     # eslint, typescript, typescript-eslint
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
