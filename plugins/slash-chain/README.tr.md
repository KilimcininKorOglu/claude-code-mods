# slash-chain

`&&` ile birleştirilmiş slash komutlarını bir shell'in yaptığı gibi sırayla çalıştıran bir Claude Code Mod'u: `/tiny && /context`, `/tiny` iyi bitince `/context` komutunu çalıştırır. Mod olmadan engine yalnız ilk komutu çalıştırır ve gerisini atar.

## Ne yapar

1. Engine ilk komutun adından sonraki her şeyi o komuta argüman olarak verir. Mod bunları her `&& /<ad>` noktasında böler: ilk komut yalnız kendi argümanlarıyla çalışır, ve bir `&&` sonrasındaki her `/<ad>` kendi argümanlarıyla bir adım olur. Arkasından `/<ad>` gelmeyen bir `&&` argümanlarda kalır, bu yüzden `/commit build && test` metnini korur.
2. Her adım, sıradaki adım çalışmadan önce başlattığı şeyin bitmesini bekler:
   - Modele bir prompt veren bir komut (bir skill ya da bir prompt komutu) turn'ünün bitmesini bekler. `answer` ile biten bir turn sıradaki adımı çalıştırır. `error`, `refusal` ya da `aborted` (Esc) ile biten bir turn zinciri durdurur. Modelin AskUserQuestion ile sorduğu bir soru o turn'ün içinde kalır, bu yüzden zincir cevabı da bekler.
   - Focus alan bir pane açan bir komut (`/disk-janitor`) o pane kapanana kadar bekler.
   - Built-in bir dialog (`/cost`, `/model`) kapanana kadar komutunu tutar.
   - Diğer her komut döndüğünde biter.
3. Throw eden bir komut zinciri durdurur.
4. Her adım tek bir transcript satırı alır, ve zincir son bir satır alır:

       1/2: /tiny
       2/2: /context
       all 2 command(s) ran
       stopped after /tiny: its turn ended with aborted; not run: /context

5. Bir zincir beklerken yazdığınız bir prompt ya da yeni bir zincir onu iptal eder: `cancelled; not run: /context`. Yeni zincir oradan başlar. Tek başına yazdığınız bir komut (`/cost`) bekleyen zincirin yanında çalışır ve onu iptal etmez, çünkü mod yalnız argümanlarında `&& /<name>` olan komutları hook'lar. Engine yine de her plugin komutunun çıktısının önüne bu modun adını yazar (`task-poke+slash-chain: ...`): yazacağı adları yalnız bir hook'un `command` matcher'ına bakarak seçer, bir zincir ise herhangi bir komutla başlayabilir, yani bu hook tek bir komut adı veremez (2.1.281 üzerinde iki probe plugin ile ölçüldü: hiç çalışmayan, yalnız `args` matcher'ı olan bir hook adlandırıldı, `command` matcher'ı olan bir hook adlandırılmadı).

## Bir adım sözle başarısız olduğunda

Engine bir turn'e exit code vermez: bir adımı yapamayan, bunu söyleyen ve turn'ünü normal bitiren bir model turn'ü `answer` ile bitirir, ve sonraki adım çalışırdı. Bu yüzden zincirde arkasında adım olan bir skill ya da prompt adımı, metninden sonra bir satır alır:

    [slash-chain] This is step 1/2 of a chain; after it: /exit. If you could not do what this step asks, call the mcp__slash-chain__fail tool with the reason before you end your turn, and the steps after it do not run.

Mod `mcp__slash-chain__fail` (`reason`) tool'unu session başlangıcında tanımlar ve onu ToolSearch arkasında değil, modelin tool listesinde tutar, yani model onu hemen çağırabilir. Bir çağrı zinciri durdurur:

    stopped after /fail: the model reported it failed: Writing /nonexistent-dir/CLAUDE.md failed: EROFS read-only file system, could not create /nonexistent-dir.; not run: /exit

2.1.281 üzerinde ölçüldü: başarısız bir yazma isteyen `/fail` ile `/fail && /exit` zinciri tool'u çağırdı, `/exit` komutundan önce durdu ve session açık kaldı; `/ok && /context` tool'u çağırmadı ve ikisini de çalıştırdı. Turn'ü bekleyen zincirli bir adım yokken, bir subagent'tan ya da sebep olmadan gelen bir çağrı reddedilir. Zincirin son adımı ve zincir dışındaki bir komut satır almaz.

## Komut

    /slash-chain          ayar ve çalışan zincir, neyi beklediğiyle birlikte
    /slash-chain stop     çalışan zinciri iptal eder
    /slash-chain on | off varsayılan on; off komutu engine'in verdiği gibi bırakır

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install slash-chain@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.281 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=mcp__slash-chain__fail}, tool.call{tool=mcp__slash-chain__fail}, command.run{command=slash-chain}, command.run{args=/"(?:^|\\s)&&\\s*\\/[A-Za-z0-9_:.-]+(?=\\s|$)"/}, skill.prompt, ui.open, ui.close, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.clock.after (via advance), $.command.register, $.command.run (via runStep), $.store.get, $.store.set (via setEnabled), $.tool.register, $.ui.log (via advance, cancel, runFirst, stop)

Reach L2, Claude'u yönlendirir: zincirlediğiniz slash komutlarını çalıştırır.

    1. Okur:     her slash komutunun argümanlarını, her skill prompt'unun adını, her pane'in id'sini ve focus'unu, ve her main-loop turn'ünün bitiş nedenini. Hiçbir dosyayı, prompt metnini ya da cevabı okumaz; bir `fail` çağrısının sebebini okur.
    2. Çalıştırır: bir zincirde ilkinden sonraki her komutu, bir kere, onun için yazdığınız argümanlarla; session başlangıcında bir tool tanımlar, `mcp__slash-chain__fail`
    3. Gönderir: modele, tool listesinde `fail` tool'unu ve zincirde arkasında adım olan bir skill ya da prompt adımının metninden sonra bir satır; network'e hiçbir şey
    4. Saklar:   $.store içinde on/off ayarını
    5. Düşman girdi: zincir yazdığınız metinden gelir; bir adım yalnız engine'in bildiği bir komutu kendi argümanlarıyla çalıştırır, ve bir komutun argümanlarında `&& /<ad>` taşıyan yapıştırılmış bir metin o komutu da çalıştırır

## Sınırlar

- `fail` tool'u zincir yokken de her session'ın tool listesinde durur, çünkü tanımlanmış bir tool geri alınamaz.
- İlkinden sonraki adımlar plugin olarak çalışır (`origin.kind: 'plugin'`), bu yüzden yalnız kişiye cevap veren bir komut orada reddeder. `/disk-janitor delete <path>` bunlardan biridir.
- Yerel bir komut throw etmediğinde başarılı sayılır. Engine başka bir hata işareti vermez, bu yüzden bir hata yazıp dönen bir komut bitmiş sayılır.
- Bir skill ya da prompt komutu, turn'ü `answer` ile bittiğinde ve model `fail` çağırmadığında başarılı sayılır. Tool'u çağırmadan başarısız olduğunu söyleyen bir model yine bitmiş sayılır: tool'dan önce 2.1.281 üzerinde ölçüldü, `/fail` komutu `I could not write CLAUDE.md.` cevabını verdiği hâlde `/fail && /exit` zinciri `/exit` komutunu çalıştırdı ve session kapandı. Esc ile durdurduğunuz bir turn ise zinciri durdurur: `/slow && /exit` zinciri `stopped after /slow: its turn ended with aborted; not run: /exit` ile durdu ve session açık kaldı.
- `/exit` sonraki bir adım olarak çalışır: engine onu bir plugin'den kabul eder ve session kapanır.
- Bilinmeyen bir ilk komut mod'a hiç ulaşmaz: engine `Unknown skill` cevabını verir, ve arkasındaki hiçbir şey çalışmaz. Bilinmeyen sonraki bir komut zinciri engine'in hatasıyla durdurur: `stopped after /x: it failed: $.command.run: no command named /x in this session`.
- Yalnız `&&` okunur. `||`, `;` ve `|` argümanlarda kalır.
- Focus alan bir pane, adımı sırasında açıldığında tanınır. Bir komutun sonradan, bir timer'dan açtığı bir pane beklenmez.
- Zincir yalnız interaktif bir session'da kontrol edildi. Headless bir session (`claude -p`) ölçülmedi.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
