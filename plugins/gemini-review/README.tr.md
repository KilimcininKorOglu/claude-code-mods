# gemini-review

Model kod yazar ve commit eder. Diff'i kimse okumadan commit history'ye girer. Böylece koda yazılmış bir key, değişikliğin getirdiği bir bug ya da sizin istemediğiniz bir değişiklik history'ye girer. Bu mod, modelin yaptığı her commit'i Gemini'ye inceletir. Bir Bash `git commit` komutu çalışmadan önce Gemini, commit'in kaydedeceği değişikliği ve konuşmayı okur. Engelleyici bir bulgu commit'i durdurur ve model nedenini okur. Minor bir bulgu commit'in çalışmasına izin verir ve model bu bulguyu sonuçtan sonra okur.

## Ne yapar

1. Mod Bash tool'unu izler. İçinde `git commit` geçen bir komut (`commit` skill'i dahil) çalışmadan önce incelenir. Diğer bütün komutlar değiştirilmeden çalışır.
2. Mod komutu shell kullanmadan okur. `cd <dizin>` ve `git -C <dizin>` dizini belirler. Aynı komutta commit'ten önce gelen `git add`, neyin stage'leneceğini belirler. `commit -a`, `add -u` ve `add -A`, tracked ya da untracked her değişikliğin commit'e gireceğini belirler. Commit'e doğrudan verilen path'ler (`git commit -m x -- a.ts`) için git yalnız bu path'leri working tree'den kaydeder. İnceleme de yalnız bu path'leri okur. Heredoc ya da tırnak içindeki bir commit mesajı komut olarak okunmaz. `git commit --help`, `-h` ve `--dry-run` hiçbir şey kaydetmez ve incelenmez.
   Commit'ten önce başka bir şey çalıştıran bir komut (`echo x >> f && git commit -am ...`) çalışmadan önce durdurulur. Model, commit'i ayrı bir Bash çağrısında yapması gerektiğini okur. İnceleme değişikliği komut çalışmadan önce okur. Bu yüzden önceki adımların değiştirdikleri incelemeye girmezdi: böyle bir commit boş bir diff ile, incelenmeden geçti (2.1.278 üzerinde ölçüldü). Commit'ten sonra gelen komutlara (`&& git push`) izin verilir.
3. Mod değişikliği git ile toplar. Git, argv ile ve Bash tool'unun dizininde çalışır (`$.session.cwd()` Bash'te çalışan bir `cd` komutunu izler, 2.1.278 üzerinde ölçüldü). Toplanan veriler şunlardır: index, komutun working tree'den stage'lediği bir path (index, `git add` çalışana kadar bu path'in eski içeriğini tutar) ve her yeni dosyanın tamamı, en fazla 200 dosya. Her git çağrısının 20 saniye süresi vardır. Değişiklik boşsa commit incelenmeden ve satır yazılmadan çalışır.
4. Mod diff'i ve konuşmayı, schema'lı tek bir `generateContent` isteğiyle gönderir. Cevap bir bulgu listesidir. Her bulgu `blocker` ya da `minor` olarak işaretlenir ve bir dosya, bir satır ve bir mesaj içerir. Diff her zaman tamamıyla gönderilir. Konuşma `maxInputChars` sınırını (varsayılan 2.000.000 karakter) aşarsa en uzun tool çıktıları ortak bir uzunluğa kısaltılır. Her çıktının başı ve sonu korunur. İsteği gemini-core oluşturur: `gemini-review` için tuttuğu key, model ve thinking seviyesiyle. Cevabı da gemini-core okur.
5. `blocker` şunlardan biridir: değişikliğin getirdiği bir bug, veri kaybı, bir güvenlik açığı, diff'teki bir secret ya da credential ya da sizin isteğinize aykırı bir değişiklik. Diğer her şey `minor` olarak işaretlenir.
6. Karar şöyle verilir:
   - Bir blocker varsa komut çalışmaz. Model her blocker'ı ve minor notları okur. Talimat, modelden sorunu düzeltip yeniden commit etmesini ister. Bir bulgu yanlışsa modelden nedenini size söylemesini ve aynı komutu başına `GEMINI_REVIEW_SKIP=1` ekleyerek çalıştırmasını ister.
   - Yalnız minor bulgular varsa commit çalışır ve model notları sonuçtan sonra okur.
   - Hiç bulgu yoksa commit çalışır ve model, incelemenin hiçbir şey bulmadığını bildiren tek bir satırı okur.
7. İnceleme cevap veremezse commit çalışır. Bir transcript satırı nedeni bildirir ve model de nedeni okur. Olası nedenler: key yok, bir HTTP hatası, bozuk ya da çıktı sınırında kesilmiş bir cevap, bir git hatası ya da 1.500.000 karakteri aşan bir diff.
8. Gemini zaman zaman HTTP 503 ("high demand") döndürür. Bu cevap çoğu zaman 10 saniye ya da daha uzun bir süreden sonra gelir. Bu durumda mod, gemini-core'un bildirdiği gibi 1, 2 ve 3 saniye sonra yeniden sorar. Toplam en fazla dört deneme yapılır. Beklemesi 60 saniyeyi aşacak bir deneme başlatılmaz. Bir hook'un 10 saniyelik süre sınırı `$.clock` beklemelerini sayar, ancak istekleri saymaz. Bu yüzden beklemeler kısa tutulur. Bir 429 ya da key hatasından sonra gemini-core, başka bir key'i varsa isteği o key ile yeniden gönderir.

2.1.278 üzerinde `gemini-3.8-flash` ile yapılan canlı denemede `sk_live_...` içeren bir dosyanın commit'i `sub/pay.ts:1: Hardcoded live Stripe secret key committed in source code` ile durduruldu. Düzeltmeden sonra `git add pay.ts sub.ts && git commit` çalıştı. `GEMINI_REVIEW_SKIP=1` ile yapılan bir commit incelenmeden çalıştı. Geçersiz bir key ile commit, `Gemini HTTP 400: API key not valid` ile çalıştı. O session'daki sekiz incelemenin dördü cevap aldı (biri iki 503'ten sonra, toplam 42,5 saniyede). Diğer dördü yalnız 503 aldı ve commit çalıştı.

## Ne gösterir

Her incelemeden sonra 10 saniye görünen bir toast çıkar. `/gemini-review` son incelemeyi gösterir:

    gemini-review: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out · sent to Gemini free tier

`sent to Gemini free tier` kısmı yalnız free tier'da görünür. Her incelemeden sonra transcript'e bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır talimat içermez, yalnız bulguları içerir:

    gemini-review: commit reviewed: 2 file(s), nothing to report
    gemini-review: commit reviewed with 1 minor note(s): pay.ts:12: Name the constant.
    gemini-review: commit stopped: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out
    gemini-review: commit ran without a review: the model used GEMINI_REVIEW_SKIP=1

Context ve satır ayrı kanallardan gider: model satırı, siz de context'i hiçbir zaman görmezsiniz.

## Komut

    /gemini-review              açık mı kapalı mı, gemini-core'un tuttuğu model, thinking seviyesi ve tier, key var mı, son inceleme
    /gemini-review on | off     off: commit'ler incelenmeden çalışır; gemini-core'da key yokken on reddedilir
    /gemini-review reset        yeniden kapalı, varsayılan

İnceleme yüklendikten sonra kapalıdır. Key'i ayarlayıp incelemeyi açana kadar Gemini'ye hiçbir şey gönderilmez.

Key, tier, model (varsayılan `gemini-3.8-flash`) ve thinking seviyesi gemini-core'da tutulur:

    /gemini-core model review gemini-3.7-flash
    /gemini-core thinking review low
    /gemini-core paid

## Free tier mı, paid tier mı

Her inceleme diff'i ve konuşmayı gönderir: prompt'larınızı, modelin çalıştırdığı komutları ve okuduğu dosyaların içeriğini. Free tier'da Google bu verileri kullanabilir ve insan denetçiler de okuyabilir. gemini-core README'si, Gemini API Additional Terms belgesinin ilgili kısmını aktarır. Google'a göstermek istemediğiniz bir projede billing'i açık bir key kullanın ve `/gemini-core paid` ayarını yapın.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-review@kilimcininkoroglu-mods

Mod `gemini-core`'a bağlıdır ve `claude plugin install` onu da yükler. Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Gemini key'ini ve tier'ı gemini-core'da, gemini-core'un [Kurulumdan sonra](../gemini-core/README.tr.md#kurulumdan-sonra) bölümünde anlatıldığı gibi ayarlayın. Ardından Claude Code'u yeniden başlatın.
2. `/gemini-review on` komutunu çalıştırın. Key yoksa komut `still off: gemini-core has no Gemini key` cevabını verir ve inceleme kapalı kalır.
3. `/gemini-review` komutunu çalıştırın. İlk satır `on · <model> · thinking ... · <tier> tier · key set` olmalıdır.
4. Bir commit `commit ran without a review: Gemini HTTP 429` ile çalışırsa key'inizde bu model için kota yoktur. `/gemini-core model review` ile başka bir model seçin.

0.1.x sürümünden güncelliyorsanız: `claude plugin update` gemini-core'u eklemez (2.1.278 üzerinde ölçüldü). Bu yüzden bir kez `claude plugin install gemini-core@kilimcininkoroglu-mods` komutunu çalıştırın. 0.2.0 sürümü key'i, tier'ı ve modeli gemini-core'a taşıdı. `apiKey`, `tier` ve `model` option'ları ile daha önce `/gemini-review free|paid|model` ile saklanan ayarlar artık okunmaz. Bu ayarları gemini-core'da yeniden yapın. 0.3.0 sürümü incelemeyi varsayılan olarak kapattı. Daha eski bir sürümden güncellediyseniz ve daha önce `/gemini-review on` çalıştırmadıysanız inceleme kapalıdır. Bir kez `/gemini-review on` komutunu çalıştırın.

## Option'lar

| Option | Varsayılan | Ne ayarlar |
|---|---|---|
| `maxInputChars` | `2000000` | Gönderilen konuşmanın en fazla karakter sayısı, 10.000 ile 4.000.000 arası; diff her zaman tamamıyla gönderilir |

Aralık dışındaki ya da tam sayı olmayan bir değerin yerine varsayılan değer kullanılır.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-review}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via review, runCommand, storeEnabled), $.http.fetch (via askGemini), $.process.run (via collectDiff, git), $.session.cwd (via review), $.session.messages (via review), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.ui.log, $.ui.toast (via verdictOf)

Reach L3: network'e erişir.

    1. Okur:         her Bash komutunu; bir commit sırasında git ile repository'nin diff'ini ve yeni dosyalarını; konuşmayı (mesajlar, tool input'ları ve output'ları); kendi $.store dosyasını; gemini-core'dan key'i içeren isteği
    2. Çalıştırır:   argv ile, shell kullanmadan salt okunur git komutları: rev-parse, diff, ls-files; en fazla 200 yeni dosya okunur
    3. Gönderir:     diff'i ve konuşmayı, her commit için bir istekle (bir 503 sonrasında en fazla dört, bir 429 ya da key hatası sonrasında her ek key için bir istek daha), gemini-core'un oluşturduğu URL'ye (generativelanguage.googleapis.com); key x-goog-api-key header'ında gönderilir, hiçbir zaman URL'de değil
    4. Saklar:       açık/kapalı ayarını $.store içinde; son inceleme satırı bellekte tutulur
    5. Düşman girdi: bir diff ya da bir konuşma Gemini'nin bulgularını yönlendirebilir; bu yüzden düşmanca bir değişiklik geçebilir ya da sağlam bir değişiklik durdurulabilir; model bulguları bir ret ya da bir not olarak okur ve yanlış bir bulguyu atlayabilir; komuttan gelen path'ler git'e `--` işaretinden sonra argv olarak verilir, hiçbir zaman bir shell üzerinden geçmez

## Sınırlar

- Bir inceleme, bir modelin görüşüdür. Bir sorunu kaçırabilir. Yanlış bir blocker skip ön ekiyle geçilir ve model bu ön eki kendi kararıyla kullanır.
- Yalnız modelin Bash ile yaptığı commit'ler incelenir. Sizin terminalinizden, modelin çalıştırdığı bir script'ten, bir alias'tan ya da başka bir tool ile yapılan bir commit incelenmez.
- Komut okuma yaygın biçimleri kapsar. Bir subshell içindeki `cd`, path'lerdeki değişkenler ve git'in genişlettiği glob'lar çözülmez.
- Bir subagent'ın commit'i yalnız diff'i gönderir, çünkü `$.session.messages()`'ın bir subagent içinde hangi transcript'i döndürdüğü doğrulanmadı.
- Her inceleme bütün konuşmayı gönderir. Bu yüzden session uzadıkça her inceleme büyür ve yavaşlar. `$.session.messages()` en yeni 4096 mesajı döndürür.
- Canlı denemede Bash hook'u bir sınıra takılmadan 42,5 saniye çalıştı. Daha uzun bir süre ölçülmedi.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
