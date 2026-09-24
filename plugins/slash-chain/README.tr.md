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

Model bu mod'dan not almaz.

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

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=slash-chain}, command.run{args=/"(?:^|\\s)&&\\s*\\/[A-Za-z0-9_:.-]+(?=\\s|$)"/}, skill.prompt, ui.open, ui.close, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.clock.after (via advance), $.command.register, $.command.run (via runStep), $.store.get, $.store.set (via setEnabled), $.ui.log (via advance, cancel, runFirst, stop)

Reach L2, Claude'u yönlendirir: zincirlediğiniz slash komutlarını çalıştırır.

    1. Okur:     her slash komutunun argümanlarını, her skill prompt'unun adını, her pane'in id'sini ve focus'unu, ve her main-loop turn'ünün bitiş nedenini. Hiçbir dosyayı, prompt metnini ya da cevabı okumaz.
    2. Çalıştırır: bir zincirde ilkinden sonraki her komutu, bir kere, onun için yazdığınız argümanlarla
    3. Gönderir: modele ve network'e hiçbir şey
    4. Saklar:   $.store içinde on/off ayarını
    5. Düşman girdi: zincir yazdığınız metinden gelir; bir adım yalnız engine'in bildiği bir komutu kendi argümanlarıyla çalıştırır, ve bir komutun argümanlarında `&& /<ad>` taşıyan yapıştırılmış bir metin o komutu da çalıştırır

## Sınırlar

- İlkinden sonraki adımlar plugin olarak çalışır (`origin.kind: 'plugin'`), bu yüzden yalnız kişiye cevap veren bir komut orada reddeder. `/disk-janitor delete <path>` bunlardan biridir.
- Yerel bir komut throw etmediğinde başarılı sayılır. Engine başka bir hata işareti vermez, bu yüzden bir hata yazıp dönen bir komut bitmiş sayılır.
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
