# slash-chain

`/init && /initialize` yazdığınızda ikinci komutun da çalışmasını beklersiniz. Ancak engine yalnız ilk komutu çalıştırır ve geri kalanını hiçbir uyarı vermeden atar. Bu mod, `&&` ile birleştirilmiş slash komutlarını bir shell gibi sırayla çalıştırır: `/tiny && /context` yazdığınızda `/tiny` başarıyla bittikten sonra `/context` çalışır.

## Ne yapar

1. Engine, ilk komutun adından sonraki her şeyi o komuta argüman olarak verir. Mod bu argümanları her `&& /<ad>` noktasında böler. İlk komut yalnız kendi argümanlarıyla çalışır. Bir `&&` işaretinden sonra gelen her `/<ad>`, kendi argümanlarıyla ayrı bir adım olur. Arkasından `/<ad>` gelmeyen bir `&&` argümanlarda kalır. Bu yüzden `/commit build && test` metni değişmeden kalır.
2. Her adım, bir sonraki adım çalışmadan önce başlattığı işin bitmesini bekler:
   - Modele bir prompt veren bir komut (bir skill ya da bir prompt komutu) kendi turn'ünün bitmesini bekler. `answer` ile biten bir turn sonraki adımı çalıştırır. `error`, `refusal` ya da `aborted` (Esc) ile biten bir turn zinciri durdurur. Modelin AskUserQuestion ile sorduğu bir soru o turn'ün içinde kalır. Bu yüzden zincir sorunun cevabını da bekler.
   - Focus alan bir pane açan bir komut (`/disk-janitor`) o pane kapanana kadar bekler.
   - Yerleşik bir dialog (`/cost`, `/model`) kapanana kadar komutunu bekletir.
   - Diğer bütün komutlar döndüğünde biter.
3. Hata fırlatan (throw eden) bir komut zinciri durdurur.
4. Her adım için transcript'e tek bir satır yazılır. Zincirin sonunda da bir satır yazılır:

       1/2: /tiny
       2/2: /context
       all 2 command(s) ran
       stopped after /tiny: its turn ended with aborted; not run: /context

5. Bir zincir beklerken yazdığınız bir prompt ya da yeni bir zincir, bekleyen zinciri iptal eder: `cancelled; not run: /context`. Yeni zincir bu noktadan başlar. Tek başına yazdığınız bir komut (`/cost`) bekleyen zincirle birlikte çalışır ve zinciri iptal etmez, çünkü mod yalnız argümanlarında `&& /<ad>` olan komutları izler. Engine yine de her plugin komutunun çıktısının önüne bu modun adını yazar (`task-poke+slash-chain: ...`). Bunun nedeni, engine'in yazacağı adları yalnız bir hook'un `command` matcher'ına bakarak seçmesidir. Bir zincir herhangi bir komutla başlayabilir, bu yüzden bu hook tek bir komut adı belirtemez (2.1.281 üzerinde iki probe plugin ile ölçüldü: yalnız `args` matcher'ı olan ve hiç çalışmayan bir hook'un adı yazıldı, `command` matcher'ı olan bir hook'un adı yazılmadı).

## Bir adım sözle başarısız olduğunda

Engine bir turn için exit kodu vermez. Bir adımı yapamayan, bunu söyleyen ve turn'ünü normal şekilde bitiren bir modelin turn'ü `answer` ile biter. Bu durumda sonraki adım yine çalışırdı. Bu yüzden zincirde arkasından başka adımlar gelen bir skill ya da prompt adımının metninden sonra bir satır eklenir:

    [slash-chain] This is step 1/2 of a chain; after it: /exit. If you could not do what this step asks, call the mcp__slash-chain__fail tool with the reason before you end your turn, and the steps after it do not run.

Mod, `mcp__slash-chain__fail` (`reason`) tool'unu session başında tanımlar. Tool, ToolSearch arkasında değil, doğrudan modelin tool listesinde durur. Bu yüzden model tool'u hemen çağırabilir. Bir çağrı zinciri durdurur:

    stopped after /fail: the model reported it failed: Writing /nonexistent-dir/CLAUDE.md failed: EROFS read-only file system, could not create /nonexistent-dir.; not run: /exit

2.1.281 üzerinde ölçüldü: `/fail` başarısız bir dosya yazma isteği içeriyordu. `/fail && /exit` zinciri tool'u çağırdı, `/exit` komutundan önce durdu ve session açık kaldı. `/ok && /context` zinciri tool'u çağırmadı ve iki komutu da çalıştırdı. Turn'ü bekleyen zincirli bir adım yokken gelen, bir subagent'tan gelen ya da neden belirtmeyen bir çağrı reddedilir. Zincirin son adımına ve zincir dışındaki bir komuta satır eklenmez.

## Komut

    /slash-chain          ayar ve çalışan zincir, neyi beklediğiyle birlikte
    /slash-chain stop     çalışan zinciri iptal eder
    /slash-chain on | off varsayılan açık; kapalıyken komut engine'in verdiği gibi bırakılır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install slash-chain@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=mcp__slash-chain__fail}, tool.call{tool=mcp__slash-chain__fail}, command.run{command=slash-chain}, command.run{args=/"(?:^|\\s)&&\\s*\\/[A-Za-z0-9_:.-]+(?=\\s|$)"/}, skill.prompt, ui.open, ui.close, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.clock.after (via advance), $.command.register, $.command.run (via runStep), $.store.get (via readSettings), $.store.set (via setEnabled), $.tool.register, $.ui.log (via advance, cancel, runFirst, stop)

Reach L2: Claude'u yönlendirir, çünkü zincirlediğiniz slash komutlarını çalıştırır.

    1. Okur:         her slash komutunun argümanlarını, her skill prompt'unun adını, her pane'in id'sini ve focus durumunu, her ana loop turn'ünün bitiş nedenini; hiçbir dosyayı, prompt metnini ya da cevabı okumaz; bir `fail` çağrısının nedenini okur
    2. Çalıştırır:   bir zincirde ilk komuttan sonraki her komutu, sizin yazdığınız argümanlarla bir kez; session başında bir tool tanımlar: `mcp__slash-chain__fail`
    3. Gönderir:     modele, tool listesindeki `fail` tool'unu ve zincirde arkasından adım gelen bir skill ya da prompt adımının metninden sonra bir satır; network'e hiçbir şey
    4. Saklar:       açık/kapalı ayarını $.store içinde
    5. Düşman girdi: zincir sizin yazdığınız metinden gelir; bir adım yalnız engine'in bildiği bir komutu kendi argümanlarıyla çalıştırır; bir komutun argümanlarında `&& /<ad>` içeren yapıştırılmış bir metin o komutu da çalıştırır

## Sınırlar

- `fail` tool'u, zincir olmadığında da her session'ın tool listesinde durur, çünkü tanımlanmış bir tool geri alınamaz.
- İlk adımdan sonraki adımlar plugin olarak çalışır (`origin.kind: 'plugin'`). Bu yüzden yalnız kullanıcıya cevap veren bir komut bu adımlarda reddeder. `/disk-janitor delete <path>` bu komutlardan biridir.
- Yerel bir komut hata fırlatmadığında başarılı sayılır. Engine başka bir hata işareti vermez. Bu yüzden bir hata yazıp normal şekilde dönen bir komut da bitmiş sayılır.
- Bir skill ya da prompt komutu, turn'ü `answer` ile bittiğinde ve model `fail` çağırmadığında başarılı sayılır. Tool'u çağırmadan başarısız olduğunu söyleyen bir modelin adımı da bitmiş sayılır. Tool eklenmeden önce 2.1.281 üzerinde ölçüldü: `/fail` komutu `I could not write CLAUDE.md.` cevabını verdi, ancak `/fail && /exit` zinciri `/exit` komutunu çalıştırdı ve session kapandı. Esc ile durdurduğunuz bir turn ise zinciri durdurur: `/slow && /exit` zinciri `stopped after /slow: its turn ended with aborted; not run: /exit` ile durdu ve session açık kaldı.
- `/exit` sonraki bir adım olarak çalışır: engine bu komutu bir plugin'den kabul eder ve session kapanır.
- Bilinmeyen bir ilk komut moda hiç ulaşmaz: engine `Unknown skill` cevabını verir ve arkasındaki hiçbir komut çalışmaz. Bilinmeyen bir sonraki komut, zinciri engine'in hatasıyla durdurur: `stopped after /x: it failed: $.command.run: no command named /x in this session`.
- Yalnız `&&` okunur. `||`, `;` ve `|` argümanlarda kalır.
- Focus alan bir pane, kendi adımı sırasında açıldığında tanınır. Bir komutun daha sonra bir timer'dan açtığı pane beklenmez.
- Zincir yalnız etkileşimli bir session'da kontrol edildi. Headless bir session (`claude -p`) ölçülmedi.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
