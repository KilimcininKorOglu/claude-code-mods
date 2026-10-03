# gemini-review

Model kod yazar, commit'ler ve diff'i kimse okumadan geçmişe yazılır: koda gömülü bir key, değişikliğin getirdiği bir bug ya da senin istemediğin bir değişiklik history'ye girer. Bu mod modelin attığı her commit'i Gemini'ye inceletir. Bir Bash `git commit`'i çalışmadan önce Gemini commit'in kaydedeceği değişikliği ve konuşmayı okur. Engelleyici bir bulgu commit'i durdurur ve model nedenini okur; minor bir bulgu commit'in çalışmasına izin verir, model de onu sonuçtan sonra okur.

## Ne yapar

1. Mod Bash tool'unu hook'lar. İçinde `git commit` geçen bir komut (`commit` skill'i dahil) çalışmadan önce incelenir; diğer her komut dokunulmadan çalışır.
2. Komutu shell olmadan okur. `cd <dizin>` ve `git -C <dizin>` dizini belirler. Aynı komutta commit'ten önce gelen `git add` neyin stage'leneceğini söyler. `commit -a`, `add -u` ve `add -A` tracked ya da untracked her değişikliğin gireceğini söyler. Commit'e doğrudan verilen path'ler (`git commit -m x -- a.ts`) git'in yalnız o path'leri working tree'den kaydedeceği anlamına gelir; inceleme de yalnız onları okur. Heredoc içindeki ya da tırnak içindeki bir commit mesajı komut olarak okunmaz. `git commit --help`, `-h` ve `--dry-run` hiçbir şey kaydetmez ve incelenmez.
   Commit'ten önce başka bir şey çalıştıran bir komut (`echo x >> f && git commit -am ...`) çalışmadan durdurulur; model commit'i ayrı bir Bash çağrısında yapması gerektiğini okur. İnceleme değişikliği komut çalışmadan önce okur, yani o adımların değiştirdiği şey incelemeye girmezdi: böyle bir commit boş bir diff'le, incelenmeden geçti (2.1.278 üzerinde ölçüldü). Commit'ten sonraki komutlara (`&& git push`) izin verilir.
3. Değişikliği git ile toplar; git argv ile, Bash tool'unun dizininde çalışır (`$.session.cwd()` bir Bash `cd`'sini izler, 2.1.278 üzerinde ölçüldü). Toplanan şeyler: index, komutun working tree'den stage'lediği bir path (index o path'in eski içeriğini `git add` çalışana kadar tutar) ve her yeni dosyanın tamamı, en fazla 200 dosya. Her git çağrısının 20 saniyesi vardır. Değişiklik boşsa commit incelemesiz ve satırsız çalışır.
4. Diff'i ve konuşmayı schema'lı tek bir `generateContent` isteğiyle gönderir. Cevap bir bulgu listesidir; her bulgu `blocker` ya da `minor`'dır ve bir dosya, bir satır ve bir mesaj taşır. Diff her zaman bütün gider. Konuşma `maxInputChars`'ı (varsayılan 2.000.000 karakter) aşarsa en uzun tool çıktıları ortak bir uzunluğa kısaltılır; her biri baş ve son kısmını korur. İsteği gemini-core kurar: `gemini-review` için tuttuğu key, model ve thinking seviyesiyle. Cevabı da o okur.
5. `blocker` şunlardan biridir: değişikliğin getirdiği bir bug, veri kaybı, bir güvenlik açığı, diff'teki bir secret ya da credential, ya da senin istediğine aykırı bir değişiklik. Geri kalan her şey `minor`'dır.
6. Karar:
   - blocker var: komut çalışmaz. Model her blocker'ı ve minor notları okur; talimat düzeltip yeniden commit'lemesi, bir bulgu yanlışsa da sana nedenini söyleyip aynı komutu başına `GEMINI_REVIEW_SKIP=1` koyarak çalıştırmasıdır;
   - yalnız minor bulgular: commit çalışır, model notları sonuçtan sonra okur;
   - hiç bulgu yok: commit çalışır, model incelemenin hiçbir şey bulmadığını söyleyen tek satırı okur.
7. İnceleme cevap veremezse commit çalışır, bir transcript satırı nedenini söyler ve model de nedeni okur. Nedenler: key yok, bir HTTP hatası, bozuk ya da çıktı sınırında kesilmiş bir cevap, bir git hatası, ya da 1.500.000 karakteri aşan bir diff.
8. Gemini arada bir HTTP 503 ("high demand") döner, çoğu zaman 10 saniye ya da daha uzun sürdükten sonra. Bu durumda mod, gemini-core'un bildirdiği gibi 1 sn, 2 sn ve 3 sn sonra yeniden sorar; toplam en fazla dört deneme olur. Beklemesi 60 sn'yi aşacak bir deneme başlamaz. Bir hook'un 10 saniyelik budget'ı `$.clock` beklemelerini sayar ama istekleri saymaz; bu yüzden beklemeler kısa tutulur. 429'dan ya da bir key hatasından sonra gemini-core, elinde başka bir key varsa isteği onunla yeniden gönderir.

2.1.278 üzerinde `gemini-3.8-flash` ile yapılan canlı denemede `sk_live_...` içeren bir dosyanın commit'i `sub/pay.ts:1: Hardcoded live Stripe secret key committed in source code` ile durduruldu. Düzeltmeden sonra `git add pay.ts sub.ts && git commit` çalıştı, `GEMINI_REVIEW_SKIP=1` ile atılan bir commit incelenmeden çalıştı, geçersiz bir key ise commit'i `Gemini HTTP 400: API key not valid` ile çalıştırdı. O session'daki sekiz incelemenin dördü cevap aldı (biri iki 503'ten sonra, toplam 42,5 saniyede); dördü yalnız 503 aldı ve commit'i çalıştırdı.

## Ne gösterir

Her incelemeden sonra 10 saniye duran bir toast çıkar; sonuncusunu `/gemini-review` gösterir:

    gemini-review: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out · sent to Gemini free tier

`sent to Gemini free tier` kısmı yalnız free tier'da çıkar. Her incelemeden sonra transcript'e bir satır düşer, böylece modele ne söylendiğini okursun. Satırda talimat yoktur, yalnız bulgular vardır:

    gemini-review: commit reviewed: 2 file(s), nothing to report
    gemini-review: commit reviewed with 1 minor note(s): pay.ts:12: Name the constant.
    gemini-review: commit stopped: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out
    gemini-review: commit ran without a review: the model used GEMINI_REVIEW_SKIP=1

Context ile satır ayrı kanallardır: model satırı, sen de context'i hiç okumazsın.

## Komut

    /gemini-review              on ya da off, gemini-core'un tuttuğu model, thinking seviyesi ve tier, key var mı, son inceleme
    /gemini-review on | off     off: commit'ler incelenmeden çalışır; gemini-core'da key yokken on reddedilir
    /gemini-review reset        yeniden off, varsayılan

İnceleme kurulumdan sonra kapalıdır; key'i ayarlayıp açana kadar Gemini'ye hiçbir şey gitmez.

Key, tier, model (varsayılan `gemini-3.8-flash`) ve thinking seviyesi gemini-core'a aittir:

    /gemini-core model review gemini-3.7-flash
    /gemini-core thinking review low
    /gemini-core paid

## Free tier mı paid tier mı

Her inceleme diff'i ve konuşmayı gönderir: prompt'larını, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini. Free tier'da Google bunları kullanabilir, insan denetçiler de okuyabilir; gemini-core README'si Gemini API Additional Terms'ten ilgili kısmı aktarır. Google'a göstermek istemediğin bir projede billing'i açık bir key kullan ve `/gemini-core paid` ayarla.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-review@kilimcininkoroglu-mods

`gemini-core`'a bağlıdır; `claude plugin install` onu da kurar. Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da, onun [After installing](../gemini-core/README.md#after-installing) bölümünde anlatıldığı gibi ayarla, sonra Claude Code'u yeniden başlat.
2. `/gemini-review on` çalıştır. Key yoksa `still off: gemini-core has no Gemini key` cevabını verir ve kapalı kalır.
3. `/gemini-review` çalıştır. İlk satır `on · <model> · thinking ... · <tier> tier · key set` olmalı.
4. Bir commit `commit ran without a review: Gemini HTTP 429` ile çalışırsa key'inde o model için kota yok demektir. `/gemini-core model review` ile başka bir model seç.

0.1.x'ten güncelliyorsan: `claude plugin update` gemini-core'u eklemez (2.1.278 üzerinde ölçüldü), bu yüzden bir kez `claude plugin install gemini-core@kilimcininkoroglu-mods` çalıştır. 0.2.0 key'i, tier'ı ve modeli gemini-core'a taşıdı; `apiKey`, `tier` ve `model` option'ları ile daha önce `/gemini-review free|paid|model` ile saklanan ayarlar artık okunmuyor, onları gemini-core'da yeniden ayarla. 0.3.0 incelemeyi varsayılan olarak kapattı: daha eski bir sürümden güncellediysen ve önceden `/gemini-review on` çalıştırmadıysan inceleme kapalıdır; bir kez `/gemini-review on` çalıştır.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `2000000` | Gönderilen konuşmanın en fazla karakter sayısı, 10.000 ile 4.000.000 arası; diff her zaman bütün gider |

Aralık dışındaki ya da tam sayı olmayan bir değerin yerine varsayılan kullanılır.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-review}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via review, runCommand, storeEnabled), $.http.fetch (via askGemini), $.process.run (via collectDiff, git), $.session.cwd (via review), $.session.messages (via review), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.ui.log, $.ui.toast (via verdictOf)

Reach L3: network'e çıkar.

    1. Okur:     her Bash komutunu; bir commit anında git üzerinden repository'nin diff'ini ve yeni dosyalarını, ayrıca konuşmayı (mesajlar, tool input'ları ve output'ları); kendi $.store dosyasını; gemini-core'dan key'i taşıyan isteği
    2. Çalıştırır: salt okuma git komutlarını argv ile, shell yok: rev-parse, diff, ls-files; en fazla 200 yeni dosya okunur
    3. Gönderir: diff'i ve konuşmayı, commit başına bir istek (503 sonrası en fazla dört, 429 ya da key hatası sonrası ek key başına bir tane daha), gemini-core'un kurduğu URL'ye (generativelanguage.googleapis.com), key x-goog-api-key header'ında, hiçbir zaman URL'de değil
    4. Saklar:   $.store içinde on/off ayarını; son inceleme satırı bellekte yaşar
    5. Düşman girdi: bir diff ya da bir konuşma Gemini'nin bulgularını yönlendirebilir, yani düşman bir değişiklik geçebilir ya da sağlam bir değişiklik durdurulabilir; model bulguları bir ret ya da bir not olarak okur ve yanlış olanı atlayabilir; komuttan gelen path'ler git'e `--` sonrası argv olarak ulaşır, hiçbir zaman shell üzerinden geçmez

## Sınırlar

- Bir inceleme bir modelin görüşüdür. Bir sorunu kaçırabilir; yanlış bir blocker ise skip ön ekiyle geçilir, bunu da model kendi kararıyla kullanır.
- Yalnız modelin Bash commit'leri incelenir. Senin terminalinden, modelin çalıştırdığı bir script'ten, bir alias'tan ya da başka bir tool üzerinden atılan commit incelenmez.
- Komut okuma yaygın biçimleri kapsar. Bir subshell içindeki `cd`, path'lerdeki değişkenler ve git'in genişlettiği glob'lar çözülmez.
- Bir subagent'ın commit'i yalnız diff'i gönderir, çünkü `$.session.messages()`'ın subagent içinde hangi transcript'i verdiği doğrulanmadı.
- Her inceleme bütün konuşmayı gönderir; session uzadıkça her inceleme büyür ve yavaşlar. `$.session.messages()` en yeni 4096 mesajı verir.
- Canlı denemede Bash hook'u 42,5 saniye sınıra takılmadan çalıştı. Daha uzun bir süre ölçülmedi.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
