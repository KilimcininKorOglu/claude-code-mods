# storage-guard

Model bir login token'ını en kısa yol olduğu için `localStorage`'a yazar. Bu durumda sayfadaki her script bu token'ı okuyabilir. Bu mod, bir düzenleme browser verisini cookie yerine `localStorage` ya da `sessionStorage` ile sakladığında bunu modele bildirir. Not, Edit çağrısının sonucuyla birlikte gelir ve her satırı gösterir. Böylece model veriyi aynı turn'de bir cookie'ye taşır. Varsayılan modda hiçbir işlem durdurulmaz. `deny` modunda bir dosya storage'ı kullandığı sürece commit, push ve merge durdurulur.

## Ne yapar

1. Mod Edit ve Write tool'larını izler. Bir JavaScript, TypeScript ya da component dosyasında (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`, `.astro`, `.html`) başarılı bir çağrıdan sonra düzenlemenin eklediği satırlar okunur: `new_string` içinde olup `old_string` içinde olmayan satırlar ya da bir Write çağrısının bütün satırları. Test dosyaları da okunur.
2. Bir satır, `localStorage` ya da `sessionStorage`'ı kod olarak kullanıyorsa sayılır:

   | Sayılır | Sayılmaz |
   |---|---|
   | `localStorage.setItem('token', token)` | `// localStorage.setItem(...)` ve `<!-- ... -->` yorum satırları |
   | `window.sessionStorage.getItem(key)` | `save(token) // not localStorage`, koddan sonraki bir yorum |
   | `window['localStorage']` | `"we never use localStorage"`, bir string içindeki kelime |
   | `const { sessionStorage } = window` | `` `localStorage is off` ``, bir template literal'in metnindeki kelime |
   | `` `saved: ${localStorage.getItem(key)}` ``, `${...}` kısmı | `myLocalStorage`, `indexedDB`, `document.cookie` |

3. Model, Edit çağrısının sonucundan sonra şu notu okur:

       storage-guard: this edit stores data in the browser with localStorage or sessionStorage: src/auth.ts:12. Store it in a cookie instead (document.cookie, or the server's Set-Cookie).

   Satır numarası, düzenlemeden sonraki dosyadan alınır. Bir Write çağrısında numaralar çağrının kendi içeriğinden alınır. En fazla 8 yer adıyla yazılır, geri kalanı sayı olarak verilir. Dosya okunamazsa path satır numarası olmadan yazılır ve hata bir kez log'a yazılır. Dosya, session'ın başladığı git repository'sinin içindeyse path o repository'nin köküne göre yazılır. Örneğin `api/` içinde açılan bir session, `web/` altındaki bir dosyayı `web/auth.ts` olarak yazar. Git repository'si dışında path, session'ın başladığı dizine göre yazılır. Bu kök dizin session başında bir kez okunur, çünkü Bash'te çalışan bir `cd` session'ın dizinini değiştirir.
4. Aynı anda transcript'e tek bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır talimat içermez, yalnız yerleri içerir:

       storage-guard: browser storage instead of a cookie: src/auth.ts:12

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz.
5. [sidebar](../sidebar) açıksa bu yerler transcript yerine sidebar'ın stream'ine bir kayıt olarak yazılır. Her yer kırmızı bir satırdadır. Sekizinci yerden sonrakiler soluk tek bir sayı olarak gösterilir. Transcript temiz kalır. Kayıt, yeni kayıtlar onu pane'den çıkarana kadar görünür. Sidebar kapalıysa ya da yüklü değilse satır yukarıdaki gibi transcript'e yazılır.

6. Bulgu dosya hakkında bir iddiadır, hiçbir zaman bellekte tutulan bir cevap değildir. Mod açık her dosyayı şu anlarda yeniden okur: sonraki her Edit ya da Write çağrısından sonra, her ana loop turn'ünün sonunda ve `deny` modunda korunan bir git komutundan önce. Her ölçüm bulguyu dosyanın o anki durumuyla değiştirir: bildirilen satırlardan storage'ı hâlâ kullananlar, güncel satır numaralarıyla. Silinen ya da yorum satırına alınan bir satır artık sayılmaz. Kısmi bir düzeltmede bulgu, kalan yerlerle açık kalır. Bütün satırları silinen bir dosyanın bulgusu kapanır. Artık yerinde olmayan bir dosyanın bulgusu da kapanır. Yerinde duran ancak okunamayan bir dosyanın bulgusu açık kalır, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz. Kapanış kaydı yeşil renktedir:

       storage-guard: the browser storage is gone from src/auth.ts: src/auth.ts:12

   Sidebar kapalıysa aynı metin transcript'e tek bir satır olarak yazılır. Model bunların hiçbirini okumaz, çünkü veriyi kendisi taşımıştır.

7. Modelin kapatmadığı bir bulgu, her ana loop turn'ünün sonunda yeniden ölçülür. Hâlâ açık olan bulgular, bir sonraki prompt'unuzla birlikte modele tek bir not olarak gönderilir:

       storage-guard: 1 place(s) still store data in localStorage or sessionStorage: src/auth.ts:12. Move the data to a cookie, or take the lines out.

   Bu not her turn için bir kez gönderilir, her prompt için değil. Bu not olmasaydı model bulguyu yalnız düzenleme anında bir kez duyar ve ardından unuturdu. Bulgu da pane'de kalırdı. Size yeni bir satır gösterilmez, çünkü pane aynı bulguyu zaten gösterir.

8. `deny` modunda bir dosya storage'ı kullandığı sürece mod `git commit`, `git push` ve `git merge` komutlarını da durdurur. `--dry-run`, `--help` ya da `-h` içeren bir komut durdurulmaz. Mod bir komutu durdurmadan önce açık her dosyayı yeniden okur. Böylece modelin düzelttiği bir dosya gate'i kendiliğinden açar. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`). Commit açık dosyaların hiçbirini içermiyorsa çalışır ve kaç bulgunun hâlâ açık olduğu size tek bir satırla bildirilir. `push` ve `merge` için okunacak bir index yoktur. Bu yüzden bu komutlarda bütün bulgular geçerlidir. Gate'i atlamanın bir yolu yoktur. Gate'i yalnız siz `/storage-guard mode note` ile kapatabilirsiniz. Varsayılan mod `note` modudur ve hiçbir işlemi durdurmaz.

Canlı denemede model tek bir Edit çağrısıyla bir dosyaya `localStorage.setItem('token', token)` ekledi ve `app.ts:2` satırını gösteren notu kelimesi kelimesine aktardı. Bir sonraki prompt'ta turn sonu notunu aktardı ve satırı `document.cookie` ile yeniden yazdı. Bu Edit çağrısından sonra `the browser storage is gone from app.ts: app.ts:2` kapanış satırı geldi.

## Komut

    /storage-guard                 açık mı kapalı mı, mod ve storage'ı hâlâ kullanan dosyalar
    /storage-guard on | off        varsayılan açık
    /storage-guard mode note       yalnız not verir; varsayılan
    /storage-guard mode deny       bir dosya storage'ı kullandığı sürece commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install storage-guard@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=storage-guard}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via fileText, gate, toPerson)

Reach L2: index'i okumak için git çalıştırır.

    1. Okur:         her Edit ve Write çağrısının metnini; Bash komutunun metnini; storage ekleyen bir Edit çağrısından sonra satır numaraları için düzenlenen dosyayı; bir bulgu açık kaldığı sürece açık her dosyayı yeniden
    2. Çalıştırır:   path'leri repository köküne göre göstermek için session başında bir kez git rev-parse --show-toplevel; deny modunda bir commit sırasında, commit'in hangi dosyaları içerdiğini okumak için git rev-parse --show-toplevel ve git diff --cached --name-only -z
    3. Gönderir:     storage ekleyen bir düzenlemeden sonra modele bir not; bulgu açık kaldığı sürece bir sonraki prompt'la bir not daha; transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde
    5. Düşman girdi: düzenlenen metin yalnız regular expression'larla karşılaştırılır ve dosya:satır olarak yazılır, hiçbir zaman çalıştırılmaz

## Sınırlar

- Kontrol bir parser ile değil, regular expression'larla satır satır yapılır. Birden çok satıra yayılan bir string ya da yorum satır satır okunur. Bu yüzden içindeki bir kullanım sayılabilir.
- Tırnak içindeki bir HTML ya da component attribute'u (`onclick="localStorage.clear()"`) string olarak okunur ve sayılmaz.
- Başka bir adla erişilen bir storage (`const s = window[name]`, bir wrapper kütüphane, `indexedDB`) fark edilmez.
- Bash ile yapılan bir düzenleme kontrol edilmez.
- Bildirilen satırlar dosyadan silindiğinde ya da yorum satırına alındığında bulgu kapanır. Başka bir dosyaya taşınan bir satır bulguyu açık tutar.
- `deny` modunu atlamanın bir yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/storage-guard mode note` ile siz kapatırsınız.
- Gate komutun metnini okur. `git commit` komutunu gizleyen bir script ya da alias ile yapılan bir commit durdurulmaz.
- `git commit -a`, `-am` ve `--` işaretinden sonra pathspec verilen commit'ler index'e göre daraltılmaz, çünkü bu komutlar index'te henüz olmayan dosyaları da commit eder. Bu commit'lerde açık bulguların hepsi geçerlidir.
- Index, komut çalışmadan önce okunur. Dosyaları bu okuma ile komutun çalışması arasında değişen bir commit, okuma anındaki index'e göre ölçülür.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
