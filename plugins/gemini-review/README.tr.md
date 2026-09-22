# gemini-review

Modelin attığı her commit'i Gemini'ye inceleten bir Claude Code Mod'u. Bir Bash `git commit` çalışmadan önce Gemini, commit'in kaydedeceği değişikliği ve konuşmayı okur. Engelleyici bir bulgu commit'i durdurur ve model sebebini okur; minor bir bulgu commit'in çalışmasına izin verir ve model onu sonuçtan sonra okur.

## Ne yapar

1. Mod Bash tool'unu hook'lar. İçinde `git commit` geçen bir komut (`commit` skill'i dahil) çalışmadan önce incelenir; diğer her komut dokunulmadan çalışır.
2. Komutu shell'siz okur: `cd <dir>` ve `git -C <dir>` dizini belirler, aynı komutta commit'ten önceki `git add` neyin stage'leneceğini söyler, `commit -a`, `add -u` ve `add -A` ise her tracked ya da untracked değişikliğin gireceğini söyler. Heredoc ya da tırnak içindeki bir commit mesajı komut olarak okunmaz. `git commit --help` ve `--dry-run` hiçbir şey kaydetmez ve incelenmez.
   Commit'ten önce başka bir şey çalıştıran bir komut (`echo x >> f && git commit -am ...`) çalışmadan önce durdurulur ve model, commit'i kendi Bash çağrısında atması gerektiğini okur. İnceleme değişikliği komut çalışmadan önce okur, yani o adımların değiştireceği şey incelemede olmazdı: böyle bir commit boş bir diff ile ve incelemesiz geçti (2.1.278 üzerinde ölçüldü). Commit'ten sonraki komutlara (`&& git push`) izin verilir.
3. Değişikliği git ile toplar, Bash tool'unun dizininde argv ile çalıştırarak (`$.session.cwd()` bir Bash `cd` komutunu izler, 2.1.278 üzerinde ölçüldü): index'i, komutun working tree'den stage'lediği bir path'i (index, `git add` çalışana kadar eski içeriği tutar) ve her yeni dosyayı bütün olarak.
4. Diff'i ve konuşmayı tek bir `generateContent` isteğinde bir schema ile gönderir: bulguların listesi, her biri `blocker` ya da `minor`, bir dosya, bir satır ve bir mesajla. İsteği gemini-core kurar: `gemini-review` için tuttuğu key, model ve thinking seviyesi ile; cevabı da o okur.
5. `blocker`, değişikliğin getirdiği bir bug, veri kaybı, bir güvenlik açığı, diff içinde bir secret ya da credential, veya kullanıcının istediğine aykırı bir değişiklik demektir. Diğer her şey `minor`'dır.
6. Karar:
   - bir blocker: komut çalışmaz; model her blocker'ı ve minor notları okur; talimat, düzeltip tekrar commit etmesi ya da bulgu yanlışsa kullanıcıya sebebini söyleyip aynı komutu başına `GEMINI_REVIEW_SKIP=1` koyarak çalıştırmasıdır;
   - yalnız minor bulgular: commit çalışır ve model notları sonuçtan sonra okur;
   - hiç bulgu yok: commit çalışır ve model, incelemenin bir şey bulmadığını söyleyen tek satırı okur.
7. İnceleme cevap veremediğinde (key yok, bir HTTP hatası, bozuk bir cevap, bir git hatası, 1.500.000 karakteri aşan bir diff) commit çalışır, bir transcript satırı sebebini söyler ve model sebebi okur.
8. Gemini arada bir HTTP 503 ("high demand") döner, çoğu zaman 10 saniye ya da daha fazlasından sonra. gemini-core bunu okuduğu şekliyle mod 1 sn, 2 sn ve 3 sn sonra tekrar sorar, en fazla dört kere, ve 60 saniye geçtikten sonra yeni deneme başlatmaz. Bir hook'un 10 saniyelik bütçesi `$.clock` beklemelerini sayar ama isteklerini saymaz, yani beklemeler kısa kalır.

2.1.278 üzerinde `gemini-3.8-flash` ile yapılan canlı testte `sk_live_...` içeren bir dosyanın commit'i `sub/pay.ts:1: Hardcoded live Stripe secret key committed in source code` ile durduruldu, düzeltmeden sonraki `git add pay.ts sub.ts && git commit` çalıştı, `GEMINI_REVIEW_SKIP=1` ile atılan bir commit incelemesiz çalıştı ve geçersiz bir key commit'in `Gemini HTTP 400: API key not valid` ile çalışmasına izin verdi. O session'daki sekiz incelemenin dördü cevap aldı (biri iki 503'ten sonra, toplam 42,5 saniye) ve dördü yalnız 503 aldı ve commit'in çalışmasına izin verdi.

## Ne gösterir

Her incelemeden sonra bir toast ve `/gemini-review` içinde sonuncusu:

    gemini-review: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out · sent to Gemini free tier

Her incelemeden sonra bir transcript satırı, böylece modele ne söylendiğini okursunuz. Bu satır talimat cümlesi olmadan yalnız bulguları taşır:

    gemini-review: commit reviewed: 2 file(s), nothing to report
    gemini-review: commit reviewed with 1 minor note(s): pay.ts:12: Name the constant.
    gemini-review: commit stopped: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out
    gemini-review: commit ran without a review: the model used GEMINI_REVIEW_SKIP=1

Context ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz context'i hiç okumazsınız.

## Komut

    /gemini-review              on ya da off, gemini-core'un tuttuğu model, thinking seviyesi ve tier, key var mı, son inceleme
    /gemini-review on | off     off: commit'ler incelenmeden çalışır; gemini-core'da key yokken on reddedilir
    /gemini-review reset        tekrar off, varsayılan

İnceleme kurulumdan sonra kapalıdır, yani siz bir key ayarlayıp açana kadar Gemini'ye hiçbir şey gönderilmez.

Key, tier, model (varsayılan `gemini-3.8-flash`) ve thinking seviyesi gemini-core'a aittir:

    /gemini-core model review gemini-3.7-flash
    /gemini-core thinking review low
    /gemini-core paid

## Free tier ya da paid tier

Her inceleme diff'i ve konuşmayı gönderir: prompt'larınızı, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini. Free tier'da Google bunları kullanabilir ve insan denetçiler okuyabilir; gemini-core README'si Gemini API Additional Terms'ten alıntılar. Google'a göstermeyeceğiniz bir projede billing açık bir key kullanın ve `/gemini-core paid` ayarlayın.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-review@kilimcininkoroglu-mods

`gemini-core`'a bağlıdır; `claude plugin install` onu da ekler. Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da ayarlayın, onun [After installing](../gemini-core/README.md#after-installing) bölümünde yazdığı gibi, sonra Claude Code'u yeniden başlatın.
2. `/gemini-review on` çalıştırın. Key olmadan `still off: gemini-core has no Gemini key` cevabını verir ve kapalı kalır.
3. `/gemini-review` çalıştırın. İlk satır `on · <model> · thinking ... · <tier> tier · key set` demelidir.
4. Bir commit `commit ran without a review: Gemini HTTP 429` ile çalışıyorsa key'inizde o model için kota yok demektir. `/gemini-core model review` ile başka bir model seçin.

0.1.x'ten güncellemeden sonra: `claude plugin update` gemini-core'u eklemez (2.1.278 üzerinde ölçüldü), bu yüzden bir kere `claude plugin install gemini-core@kilimcininkoroglu-mods` çalıştırın. 0.2.0 sürümü key, tier ve model'i gemini-core'a taşıdı; daha önce saklanan `apiKey`, `tier` ve `model` option'ları ile `/gemini-review free|paid|model` ayarları artık okunmuyor, onları gemini-core'da yeniden ayarlayın. 0.3.0 sürümü incelemeyi varsayılan olarak kapattı: daha eski bir sürümden güncellediyseniz, daha önce `/gemini-review on` çalıştırmadıysanız kapalıdır; bir kere `/gemini-review on` çalıştırın.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `2000000` | En fazla kaç karakter konuşma gönderilir |

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-review}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via review, runCommand, storeEnabled), $.http.fetch (via askGemini), $.process.run (via collectDiff, git), $.session.cwd (via review), $.session.messages (via review), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.ui.log, $.ui.toast (via verdictOf)

Reach L3, network'e çıkar.

    1. Okur:     her Bash komutunu; bir commit anında repository'nin diff'ini ve yeni dosyalarını git üzerinden, ve konuşmayı (mesajlar, tool input'ları ve output'ları); kendi $.store dosyasını; gemini-core'dan key'i taşıyan isteği
    2. Çalıştırır: salt okuma git komutlarını argv ile, shell yok: rev-parse, diff, ls-files; en fazla 200 yeni dosya okunur
    3. Gönderir: diff'i ve konuşmayı, commit başına bir istek (503 sonrası en fazla dört, 429 ya da key hatası sonrası ek key başına bir tane daha), gemini-core'un kurduğu URL'ye (generativelanguage.googleapis.com), key x-goog-api-key header'ında, hiçbir zaman URL'de değil
    4. Saklar:   $.store içinde on/off ayarını; son inceleme satırı bellekte yaşar
    5. Düşman girdi: bir diff ya da bir konuşma Gemini'nin bulgularını yönlendirebilir, yani düşman bir değişiklik geçebilir ya da sağlam bir değişiklik durdurulabilir; model bulguları bir ret ya da bir not olarak okur ve yanlış olanı atlayabilir; komuttan gelen path'ler git'e `--` sonrası argv olarak ulaşır, hiçbir zaman shell üzerinden geçmez

## Sınırlar

- Bir inceleme bir modelin görüşüdür. Bir sorunu kaçırabilir; yanlış bir blocker, modelin kendi kararıyla kullandığı skip ön eki ile geçilir.
- Yalnız modelin Bash commit'leri incelenir. Sizin terminalinizden, modelin çalıştırdığı bir script'ten, bir alias'tan ya da başka bir tool üzerinden atılan commit incelenmez.
- Komut okuma alışılmış biçimleri kapsar. Bir subshell içindeki `cd`, path'lerdeki değişkenler ve git'in genişlettiği glob'lar çözülmez.
- Bir subagent'ın commit'i yalnız diff'i gönderir, çünkü subagent içinde `$.session.messages()` hangi transcript'i cevaplar, doğrulanmadı.
- Her inceleme tüm konuşmayı gönderir, yani uzun bir session her incelemeyi daha büyük ve daha yavaş yapar. `$.session.messages()` en yeni 4096 mesajı cevaplar.
- Bash hook'u canlı testte sınır olmadan 42,5 saniye çalıştı. Daha uzun bir sınır ölçülmedi.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
