# storage-guard

Model bir login token'ını en kısa yol o olduğu için `localStorage`'a koyar; artık sayfadaki her script onu okuyabilir. Bu mod, bir edit tarayıcı verisini cookie yerine `localStorage` ya da `sessionStorage` ile sakladığında bunu modele söyler. Not Edit'in sonucuyla birlikte gelir ve her satırı gösterir, böylece model veriyi aynı turn'de bir cookie'ye taşır. Varsayılan olarak hiçbir şey durdurulmaz; `deny` modunda bir dosya storage'ı kullandıkça commit, push ve merge durur.

## Ne yapar

1. Mod Edit ve Write tool'larını hook'lar. Bir JavaScript, TypeScript ya da component dosyasında (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`, `.astro`, `.html`) başarılı bir çağrıdan sonra edit'in eklediği satırları okur: `new_string`'de olup `old_string`'de olmayanları, ya da bir Write'ın bütün satırlarını. Test dosyaları da okunur.
2. Bir satır `localStorage` ya da `sessionStorage`'ı kod olarak kullanıyorsa sayılır:

   | Sayılır | Sayılmaz |
   |---|---|
   | `localStorage.setItem('token', token)` | `// localStorage.setItem(...)` ve `<!-- ... -->` yorum satırları |
   | `window.sessionStorage.getItem(key)` | `save(token) // not localStorage`, koddan sonraki bir yorum |
   | `window['localStorage']` | `"we never use localStorage"`, bir string içindeki kelime |
   | `const { sessionStorage } = window` | `` `localStorage is off` ``, bir template literal'in metnindeki kelime |
   | `` `saved: ${localStorage.getItem(key)}` ``, `${...}` kısmı | `myLocalStorage`, `indexedDB`, `document.cookie` |

3. Model Edit'in sonucundan sonra şu notu okur:

       storage-guard: this edit stores data in the browser with localStorage or sessionStorage: src/auth.ts:12. Store it in a cookie instead (document.cookie, or the server's Set-Cookie).

   Satır numarası edit'ten sonraki dosyadan gelir; bir Write kendi içeriğinden numaralanır. En fazla 8 yer adıyla yazılır, gerisi sayılır. Dosya okunamazsa path satırsız kalır ve hata bir kez yazılır. Dosya session'ın başladığı git repository'sinin içindeyse path o köke göre yazılır; yani `api/`'de açılan bir session `web/`'deki bir dosyayı `web/auth.ts` diye yazar. Git repository'si dışında path session'ın başladığı dizine göre yazılır. Bu kök session başında bir kez okunur, çünkü bir Bash `cd`'si session'ın kendi dizinini değiştirir.
4. Aynı anda transcript'e tek bir satır düşer, böylece modele ne söylendiğini görürsün. Satırda talimat yoktur, yalnız yerler vardır:

       storage-guard: browser storage instead of a cookie: src/auth.ts:12

   Not ile satır ayrı kanallardır: model satırı, sen de notu hiç okumazsın.
5. [sidebar](../sidebar) açıksa bu yerler transcript yerine onun stream'ine bir kayıt olarak gider, her yer kırmızı bir satırda; sekizinciden sonraki yerler soluk tek bir sayıdır. Transcript temiz kalır. Kayıt, yenileri onu pane'den itene kadar durur. Sidebar kapalıysa ya da kurulu değilse satır yukarıdaki gibi transcript'e düşer.

6. Bulgu dosya hakkında bir iddiadır, hiçbir zaman hatırlanmış bir cevap değildir. Mod açık her dosyayı sonraki her Edit ya da Write'tan sonra, her ana loop turn'ünün sonunda ve `deny` modunda korunan bir git komutundan önce yeniden okur; her ölçüm bulguyu dosyanın şu an taşıdığıyla değiştirir: bildirilen satırlardan storage'ı hâlâ kullananlar, şimdiki satır numaralarıyla. Gitmiş ya da yorum satırına alınmış bir satır artık sayılmaz. Kısmi bir düzeltme bulguyu kalan yerlerle açık tutar. Satırlarının hepsi gitmiş dosya kapanır, artık yerinde olmayan bir dosya da; yerinde duran ama okunamayan bir dosya bulgusunu korur, çünkü okunmamış dosya hiçbir şey kanıtlamaz. Kapanış kaydı yeşildir:

       storage-guard: the browser storage is gone from src/auth.ts: src/auth.ts:12

   Sidebar kapalıysa aynı metin tek bir transcript satırıdır. Model bunların hiçbirini okumaz: veriyi kendisi taşıdı.

7. Modelin kapatmadığı bir bulgu her ana loop turn'ünün sonunda yeniden ölçülür; geriye kalan, bir sonraki prompt'unla birlikte modele tek bir not olarak gider:

       storage-guard: 1 place(s) still store data in localStorage or sessionStorage: src/auth.ts:12. Move the data to a cookie, or take the lines out.

   Not her prompt'ta değil, her turn'de bir kez gelir. Bu not olmasa model bulguyu yalnız edit anında bir kez duyar ve sonra unuturdu; bulgu da pane'de öylece dururdu. Sana yeni bir satır düşmez, çünkü pane aynı bulguyu zaten gösteriyor.

8. `deny` modunda bir dosya storage'ı kullandıkça mod `git commit`, `git push` ve `git merge`'ü de durdurur; `--dry-run`, `--help` ya da `-h` taşıyan bir komut durdurulmaz. Durdurmadan önce açık her dosyayı yeniden okur; böylece modelin düzelttiği bir dosya gate'i kendiliğinden açar. `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`), commit açık dosyaların hiçbirini içermiyorsa geçmesine izin verir ve kaç tanesinin hâlâ durduğunu tek satırla söyler. `push` ve `merge` için okunacak bir index yoktur, orada bütün bulgular geçerlidir. Gate'i aşmanın yolu yoktur; kapatmak yalnız sana kalır, `/storage-guard mode note` ile. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz.

Canlı denemede model tek bir Edit'le bir dosyaya `localStorage.setItem('token', token)` ekledi ve `app.ts:2`'yi gösteren notu kelimesi kelimesine aktardı. Sonraki prompt'ta turn sonu notunu aktardı, satırı `document.cookie` ile yeniden yazdı ve o Edit'in ardından `the browser storage is gone from app.ts: app.ts:2` kapanış satırı geldi.

## Komut

    /storage-guard                 açık mı kapalı mı, mod ve storage'ı hâlâ kullanan dosyalar
    /storage-guard on | off        varsayılan açık
    /storage-guard mode note       yalnız not verir; varsayılan budur
    /storage-guard mode deny       bir dosya storage'ı kullandıkça commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install storage-guard@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir şey yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=storage-guard}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via fileText, gate, toPerson)

Reach L2: index'i okumak için git çalıştırır.

    1. Okur:     her Edit ve Write çağrısının metnini; Bash komut metnini; storage ekleyen bir Edit'ten sonra satır numaraları için düzenlenen dosyayı, bir bulgu dururken de açık her dosyayı yeniden
    2. Çalıştırır: session başlangıcında bir kere git rev-parse --show-toplevel, path'leri repository köküne göre göstermek için; deny modunda bir commit'te git rev-parse --show-toplevel ve git diff --cached --name-only -z, commit'in hangi dosyaları tuttuğunu okumak için
    3. Gönderir: storage ekleyen bir edit'ten sonra modele bir not, bulgu dururken sonraki prompt'la bir tane daha ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: düzenlenen metin yalnız regular expression'larla eşleştirilir ve dosya:satır olarak yazılır, hiçbir zaman çalıştırılmaz

## Sınırlar

- Kontrol bir parser değil, regular expression'larla satır satır yapılır. Birkaç satıra yayılan bir string ya da yorum satır satır okunur; yani içindeki bir kullanım sayılabilir.
- Tırnak içindeki bir HTML ya da component attribute'u (`onclick="localStorage.clear()"`) string olarak okunur ve sayılmaz.
- Başka bir adla ulaşılan bir storage (`const s = window[name]`, bir wrapper kütüphane, `indexedDB`) görülmez.
- Bash üzerinden yapılan bir edit kontrol edilmez.
- Bildirilen satırlar dosyadan gidince ya da yorum satırına alınınca bulgu kapanır. Başka bir dosyaya taşınan bir satır bulguyu açık tutar.
- `deny` modunu aşmanın yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/storage-guard mode note` ile sen kapatırsın.
- Gate komut metnini okur. `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit durdurulmaz.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit index'e göre daraltılmaz, çünkü index'te henüz olmayan dosyaları da commit'ler. Bunlarda açık bulguların hepsi geçerlidir.
- Index komut çalışmadan önce okunur. Okuma ile çalışma arasında dosyaları değişen bir commit, okuma anında index'in tuttuğuna göre ölçülür.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
