# sidebar

Transcript'in yanında tek bir paylaşılan pane açan ve diğer her mod'un oraya yazdığını çizen bir Claude Code Mod'u. Tek bir sidebar vardır, mod başına bir pane değil: bir mod `$.sidebar.set(...)` çağrısını satır ve button'lardan oluşan bir section ile yapar, bu mod da onu çizer.

## Ne yapar

1. `/sidebar` pane'i açar, `/sidebar off` kapatır. Seçim `$.store` içinde tutulur, yani daha sonra başlayan bir session sidebar'ı kendiliğinden yeniden açar.
2. Açıkken herhangi bir mod bir section yazar: `$.sidebar.set({ consumer, key, title, lines, buttons, until, order })` `true` cevaplar. Kapalıyken hiçbir şey tutulmaz ve çağrı `false` cevaplar, yani mod kendi transcript satırını ya da status line'ını göstermeye devam eder.
3. Bir section kalın bir başlık (`<consumer>: <title>`, bir stream entry'sinde ayrıca saat), satırları (`ok` yeşil, `warn` sarı, `error` kırmızı, `dim` soluk) ve button'ları olarak çizilir. Pane iki parçadır: üstte duran section'lar (`until: 'session'`, sonra `until: 'turn'`, her grup `order`, sonra consumer, sonra key sırasıyla) ve altlarında stream.
4. Stream, `until: 'stream'` ile yazılanlardır: bulguların bir log'u, en yenisi önce, duran section'ların hemen altında. İkisi birlikte çizildiğinde aralarında soluk bir ayraç satırı durur: pane genişliğinde tireler ve tam ortada bir `o` (`---------o---------`). Bir entry başka birinin yerini almaz, yani aynı mod ve key iki kere iki entry olarak okunur. Bir stream entry'sinin başlığı ayrıca yazıldığı gün ve saati taşır, makinenin kendi time zone'unda (`edit-loop: edit loop (21.09 14:32)`), böylece kişi log'u sonradan okur; duran bir section saat taşımaz, çünkü her ölçümde yeniden yazılır. Turun sonunda hiçbir şey bir entry'yi düşürmez: bir entry yalnız yenileri onu pane'in son satırının ötesine ittiğinde gider. Daha uzun bir terminal stream'in daha fazlasını tutar, daha kısası daha azını. Stream'in satırları paylaşılır: birden fazla mod oraya yazarken her biri en fazla kendi payı kadar satır çizer, yani konuşkan bir mod başka bir mod'un bulgusunu pane'den itemez. Bir payın artırdığı satırlar onun geri tuttuğu entry'lere gider ve tek başına yazan bir mod bütün alanı alır.
5. Bir button bir slash komutu çalıştırır: `{ label: 'stop', command: 'bg-tasks', args: 'stop b1' }` için `[ stop ]` basışı `/bg-tasks stop b1` komutunu kişi gibi çalıştırır ve komutun ilk cevap satırı pane'in altında görünür. Button'u sunan mod o komutu kendisi karşılar. Etiket işaretçi altında kırmızıya döner, yani bir basışın ne çalıştıracağı basıştan önce açıktır.
6. Üç ömür: `session` mod onu değiştirene ya da temizleyene kadar üstte durur, `stream` altındaki log'a katılır, `turn` tur bitince gider.
7. Her stream entry'si ayrıca bu projenin kendi log dosyasına yazılır, `~/.claude/sidebar/<project>-<YYYY-MM-DD>.log`, satır başına bir JSON object. Pane açıldığında o projenin log'larının en yeni 10 entry'si stream'e geri gelir, her biri ilk yazıldığı gün ve saatle, yani yarın başlayan bir session dün bulunanı yine gösterir. Geri gelen bir entry log'a yeniden yazılmaz. Gün, yazmanın günüdür, yani gece yarısını geçen bir session yeni günün dosyasına yazar. Her yazma dosyayı önce yeniden okur, yani aynı gün aynı projenin iki session'ı birbirinin satırlarını korur; var olan ama okunamayan bir dosyanın üstüne yazılmaz. Stream entry'lerini kaldıran bir `clear`, log'a kendi satırını yazar (`{"at", "cleared": {consumer, key}}`): entry'ler geçmiş olarak dosyada kalır, ve restore o key'in bu satırdan önce yazılmış her entry'sini dışarıda bırakır, satır daha yeni bir günün dosyasında olsa da. Böylece kapanmış bir bulgu kendi kapanış satırının yanında geri gelmez. `/sidebar log` dosyanın path'ini ve en yeni 10 entry'sini yazar, temizlenmiş olanlar da dahil.

## Diğer mod'ların kullandığı API

`plugin.json` içinde `"dependencies": ["sidebar"]` **bildirmeyin**. Bildirilen bir dependency serttir: kişide sidebar kurulu değilken engine mod'unuzu hiç yüklemez (2.1.278 üzerinde ölçüldü). API'yi bir guard arkasından çağırın; böylece mod'unuz bu mod olsun olmasın çalışır:

```ts
/** The finding the person reads: the sidebar while it is open, else the mod's own transcript line. */
async function toPerson($: EngineInterface, findings: readonly string[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({
      consumer: 'my-mod',              // your mod's name, drawn in the section heading
      key: 'src-users.ts',             // names the section inside your mod; [A-Za-z0-9._:-]
      title: 'SQL built from strings', // the heading beside the consumer
      lines: findings.map(text => ({ text, kind: 'error' })), // kind: 'ok' | 'warn' | 'error' | 'dim', or absent
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

`set`, section tutulup çizildiğinde `true`, sidebar kapalıyken `false` cevaplar, yani tek bir `if (taken) return` hem kapalı hem eksik durumu kapsar. `clear({ consumer, key })` o key'in duran section'ını ve her stream entry'sini kaldırır ve sonraki bir session'ın o entry'leri log'dan geri almasını önler; `isOpen()` pane'in açık olup olmadığını cevaplar.

Bir satır `parts` taşıdığında tek bir kelimeyi renklendirir: `{ text: 'model opus-5-5', parts: [{ text: 'model ' }, { text: 'opus-5-5', kind: 'error' }] }`. Her part kendi `kind`'ını alır, `kind`'ı olmayan bir part satırınkini alır, ve part'ların birleşen metinleri pane'in çizdiği ve wrap ettiği satırdır; bir part wrap edilen bir satırda da rengini korur. Bütün satırı `text` içinde de tutun, çünkü 0.11.0'dan eski bir sidebar yalnız `text`'i çizer.

`types/index.d.ts` contract'tır: `SidebarSection`, `SidebarLine`, `SidebarPart`, `SidebarKind`, `SidebarButton`, `SidebarUntil` ve `Sidebar`. `/plugin-types` onu etkin her plugin için `.claude/types/claude-code-plugins/` altına kopyalar, yani `$.sidebar` mod'unuzda elle hiçbir şey kopyalamadan type'lanır. Ona karşı geliştirmek için `claude --plugin-dir <your mod> --plugin-dir <path to sidebar>` kullanın.

Bir `claude plugin test` dosyasında test engine'i `engine.create` çalıştırmaz, bu yüzden noun'u inline bir plugin ile stub'layın ve çağrılarını world'de cevaplayın:

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

Section başına sınırlar: 50 satır ve 5 button; dışarıda kalan satırlar pane'de sayılır. Pane, surface'in body'sine verdiği kadar satır çizer, en fazla 200. Stream consumer başına en yeni 20 entry'yi ve toplamda 100 tanesini tutar, satırlar bunların kaçını gösterirse göstersin, ve çizdiği satırlar oraya yazan consumer'lar arasında paylaşılır. Pane'in genişliğinden uzun bir satır kesilir. `consumer`, `key` ya da `title` değeri başka biçimde olan bir section, çağıran mod'un okuduğu bir hata ile reddedilir.

## Komut

    /sidebar            pane'i açar, açıksa kapatır
    /sidebar on | off   aynısı, adlandırılmış
    /sidebar status     on ya da off, kaç section durduğu ve stream'in kaç entry tuttuğu
    /sidebar log        bu projenin bugünkü log'unun path'i ve en yeni 10 entry'si

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sidebar@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Bir kere `/sidebar` çalıştırın. O andan sonra `/sidebar off` çalıştırana kadar her session onu açar.

## Nereye uzanır

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ types ./types/index.d.ts declares on $: $.sidebar
    ❯ ./register.tsx hooks: engine.create, session.start, command.run{command=sidebar}, ui.render{component=Pane}, ui.close, turn.complete
    ❯ ./register.tsx calls: $.clock.now, $.command.register, $.command.run (via pressButton), $.env.get (via openLog), $.fs.exists, $.fs.list (via logFiles), $.fs.read, $.fs.write, $.session.cwd (via openLog), $.store.get, $.store.set, $.ui.close (via closePane), $.ui.invalidate, $.ui.open (via openPane), $.ui.panes (via closePane), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: HOME

Reach L2, bir dosya yazar.

    1. Okur:     diğer mod'ların verdiği section'ları, bir stream entry'sinin kendi saati için saati, HOME, session'ın dizinini ve ~/.claude/sidebar altındaki bu projenin kendi log dosyalarını
    2. Çalıştırır: bir button'ın adlandırdığı slash komutunu, $.command.run üzerinden, yalnız kişinin basışıyla
    3. Gönderir: hiçbir şey
    4. Saklar:   $.store içinde sidebar'ın açık olup olmadığını; ~/.claude/sidebar içinde proje ve gün başına bir log dosyası, diğer mod'ların yazdığı stream entry'lerini ve entry kaldıran her clear için bir satırı tutar
    5. Düşman girdi: bir section başka bir plugin'den gelir ve veri olarak okunur: consumer, key ve title kontrol edilir, başka biçimde her satır ve button düşürülür, metin tek satıra katlanır ve genişliğe wrap edilir, sayılar sınırlanır. Bir log satırı da aynı okunur, yani elle düzenlenmiş ya da kesilmiş bir dosya yalnız o satırı kaybeder, başka bir şeyi değil.

## Sınırlar

- Log dizini 0.7.0'a kadar `~/.claude/stream` idi ve 0.8.0'dan itibaren `~/.claude/sidebar`, yani her mod'un kendi dizini mod'un adını taşır. Hiçbir şey taşınmaz: eski dosyalar diskte okunmadan kalır. Daha eski günlerin geri gelmesini istiyorsanız onları kendiniz taşıyın: `mv ~/.claude/stream/* ~/.claude/sidebar/`.

- Pane yalnız fullscreen layout altında transcript'in yanına konur; diğer durumda prompt'un üstünde açılır.
- Sidebar'ı saklanan seçimden açan bir session onu kişi olarak değil plugin olarak açar: engine böyle bir pane'i 144 terminal kolonunun altında çizmez, kişi o pane'i bir kere kendisi açtıysa 110'un altında. O session'daki `/sidebar` onu her genişlikte yerleştirir.
- Sidebar'ı kapatmak her section'ı ve bütün stream'i düşürür. Yeniden açıldığında hiçbiri geri gelmez; her mod kendi section'ını sonraki güncellemede yazar.
- Pane'deki stream session boyunca durur; diskteki log bir restart'tan sonra kalan şeydir ve yalnız en yeni 10 entry'si geri gelir.
- Log proje ve gün başınadır. Proje, session'ın başladığı dizinin son parçasıdır, yani bir repository'nin iki checkout'u bir log dosyası paylaşır.
- Bir günün dosyası en yeni 500 satırını tutar. Eski bir günün dosyasını hiçbir şey kaldırmaz; onu temizlemek sizin işinizdir.
- Her entry'de bütün dosya yeniden yazılır, çünkü engine'in `$.fs` arayüzünde append yoktur. Başarısız bir yazma geçilir ve pane çalışmaya devam eder.
- Bir stream entry'sinin saati, mod'un onu yazdığı andır, `$.clock.now()` ile okunur ve makinenin kendi time zone'unda çizilir. Bulgunun olduğu an değildir ve sonradan değişmez.
- Pane'in genişliğinden uzun bir satır, sığan son boşlukta, en fazla 4 satıra wrap edilir; ilkinden sonraki her satır iki boşluk girintilidir. O 4 satırdan uzun bir satırın son satırı `…` ile kesilir. Bir başlık wrap edilmez, kesilir.
- Stream consumer başına 20, toplamda 100 entry tutar. Kendi sayısını aşan bir mod kendi en eski entry'sini düşürür, hiçbir zaman başka bir mod'unkini değil.
- Bir button yalnız bir slash komutu çalıştırabilir. Button isteyen bir mod onun için bir komut sunmak zorundadır.
- Pane'in scroll penceresi engine'e aittir; bu mod kendi scroll'unu eklemez.

## Geliştirme

    make install     # eslint, typescript, typescript-eslint
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
