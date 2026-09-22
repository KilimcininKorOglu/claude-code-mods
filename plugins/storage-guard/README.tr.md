# storage-guard

Bir edit'in tarayıcı verisini cookie yerine `localStorage` ya da `sessionStorage` ile sakladığını modele söyleyen bir Claude Code Mod'u. Not Edit'in sonucuyla gelir ve her satırı adlandırır, yani model veriyi aynı turda bir cookie'ye taşır. Varsayılan olarak hiçbir şey durmaz; `deny` modunda bir dosya storage'ı hâlâ kullanırken commit, push ve merge durur.

## Ne yapar

1. Mod Edit ve Write tool'larını hook'lar. Bir JavaScript, TypeScript ya da component dosyasında (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`, `.astro`, `.html`) başarılı bir çağrıdan sonra edit'in eklediği satırları okur: `new_string` içinde olup `old_string` içinde olmayanları ya da bir Write'ın her satırını. Test dosyaları da okunur.
2. Bir satır, `localStorage` ya da `sessionStorage`'ı kod olarak kullanıyorsa sayılır:

   | Sayılır | Sayılmaz |
   |---|---|
   | `localStorage.setItem('token', token)` | `// localStorage.setItem(...)` ve `<!-- ... -->` yorum satırları |
   | `window.sessionStorage.getItem(key)` | `save(token) // not localStorage`, koddan sonraki bir yorum |
   | `window['localStorage']` | `"we never use localStorage"`, bir string içindeki kelime |
   | `const { sessionStorage } = window` | `` `localStorage is off` ``, bir template literal'in metnindeki kelime |
   | `` `saved: ${localStorage.getItem(key)}` ``, `${...}` kısmı | `myLocalStorage`, `indexedDB`, `document.cookie` |

3. Model bu notu Edit'in sonucundan sonra okur:

       storage-guard: this edit stores data in the browser with localStorage or sessionStorage: src/auth.ts:12. Store it in a cookie instead (document.cookie, or the server's Set-Cookie).

   Satır numarası edit sonrası dosyadan gelir; bir Write kendi içeriğinden numaralandırılır. En fazla 8 yer adlandırılır, kalanı sayılır. Dosya okunamadığında path satırsız durur ve hata bir kere log'lanır. Dosya session'ın başladığı git repository'sinin içindeyse path o köke göre yazılır. Yani `api/` içinde açılan bir session, `web/` içindeki bir dosyayı `web/auth.ts` olarak adlandırır. Git repository'si dışında path session'ın başladığı dizine göre yazılır. Bu kök session'ın başlangıcında bir kere okunur, çünkü bir Bash `cd` session'ın kendi dizinini taşır.
4. Aynı anda transcript'e bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır yalnız yerleri taşır, talimat cümlesi olmadan:

       storage-guard: browser storage instead of a cookie: src/auth.ts:12

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
5. [sidebar](../sidebar) açıkken bu yerler oraya gider, her biri bir satır olarak, stream'inde kırmızı bir entry halinde, ve transcript temiz kalır. Entry, yenileri pane'den itene kadar durur. Sidebar kapalıyken ya da o mod kurulu değilken transcript satırı yukarıdaki gibi yazılır.

6. Bir bulgu dosya hakkında bir iddiadır, hiçbir zaman hatırlanmış bir cevap değildir. Sonraki her Edit ya da Write'tan sonra mod her açık dosyayı yeniden okur ve her ölçüm bulguyu dosyanın şu an tuttuğu hâliyle değiştirir: bildirilen satırlardan storage'ı hâlâ kullananlar, güncel satır numaralarıyla. Gitmiş ya da yoruma çevrilmiş bir satır artık sayılmaz. Kısmi bir düzeltme bulguyu kalan yerlerle açık tutar. Satırlarının hepsi gitmiş bir dosya kapanır, artık var olmayan bir dosya da; var olan ama okunamayan bir dosya bulgusunu açık tutar, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz. Kapanış entry'si yeşildir:

       storage-guard: the browser storage is gone from src/auth.ts: src/auth.ts:12

   Sidebar kapalıyken aynı metin tek bir transcript satırıdır. Model bunun hiçbirini okumaz: veriyi kendisi taşıdı.

7. Modelin kapatmadığı bir bulgu her ana döngü turunun sonunda yeniden ölçülür ve kalan, bir sonraki prompt'la modele tek bir not olarak ulaşır:

       storage-guard: 1 place(s) still store data in localStorage or sessionStorage: src/auth.ts:12. Move the data to a cookie, or take the lines out.

   Tur başına bir not, prompt başına değil. Bu olmasa bulgu bir kere, edit anında söylenir ve sonra model onu unutmuşken pane'de dururdu. Siz yeni bir şey okumazsınız: pane zaten aynı bulguyu taşıyor.

8. `deny` modunda mod ayrıca, bir dosya storage'ı hâlâ kullanırken `git commit`, `git push` ve `git merge` komutlarını durdurur. Bir komutu durdurmadan önce her açık dosyayı yeniden okur, yani modelin düzelttiği bir dosya gate'i kendisi açar. Bir `git commit` yalnız kendi dosyaları için cevap verir: mod index'i okur (`git diff --cached --name-only`) ve index açık dosyaların hiçbirini tutmuyorsa commit'in çalışmasına izin verir, size kaçının hâlâ durduğunu söyleyen bir satırla. Bir `push` ve bir `merge` okunacak index tutmaz, yani orada her bulgu durur. Kaçış yolu yok; gate'i yalnız kişi `/storage-guard mode note` ile kapatır. `note` modu varsayılandır ve hiçbir şeyi durdurmaz.

Canlı kontrolde model tek bir Edit ile bir dosyaya `localStorage.setItem('token', token)` ekledi ve `app.ts:2` adlandıran notu kelimesi kelimesine alıntıladı. Sonraki prompt'ta turn sonu notunu alıntıladı, satırı `document.cookie` ile yeniden yazdı, ve o Edit'in ardından `the browser storage is gone from app.ts: app.ts:2` kapanış satırı geldi.

## Komut

    /storage-guard                 on ya da off, mod ve storage'ı hâlâ kullanan dosyalar
    /storage-guard on | off        varsayılan on
    /storage-guard mode note       yalnız not; varsayılan
    /storage-guard mode deny       bir dosya storage'ı kullanırken commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install storage-guard@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=storage-guard}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via fileText, gate, toPerson)

Reach L2, index'i okumak için git çalıştırır.

    1. Okur:     her Edit ve Write çağrısının metnini; Bash komut metnini; storage ekleyen bir Edit sonrası edit edilen dosyayı, satır numaraları için, ve bulgu dururken her açık dosyayı yeniden
    2. Çalıştırır: session başlangıcında bir kere git rev-parse --show-toplevel, path'leri repository köküne göre göstermek için; deny modunda bir commit'te git rev-parse --show-toplevel ve git diff --cached --name-only, commit'in hangi dosyaları tuttuğunu okumak için
    3. Gönderir: storage ekleyen bir edit'ten sonra modele bir not, bulgu dururken sonraki prompt'la bir tane daha ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: edit edilen metin yalnız regular expression ile eşleştirilir ve file:line olarak yazılır, hiçbir zaman çalıştırılmaz

## Sınırlar

- Kontrol satır satır regular expression ile yapılır, bir parser ile değil. Birkaç satıra yayılan bir string ya da yorum satır satır okunur, yani içindeki bir kullanım sayılabilir.
- Tırnak içindeki bir HTML ya da component attribute'u (`onclick="localStorage.clear()"`) string olarak okunur ve sayılmaz.
- Başka bir adla ulaşılan bir storage (`const s = window[name]`, bir wrapper kütüphane, `indexedDB`) görülmez.
- Bash üzerinden yapılan bir edit kontrol edilmez.
- Bir bulgu, bildirilen satırlar dosyadan gittiğinde ya da yoruma çevrildiğinde kapanır. Başka bir dosyaya taşınan bir satır bulguyu açık tutar.
- `deny` modunun kaçış yolu yoktur. Bir bulgu düzeltilemediğinde kişi gate'i `/storage-guard mode note` ile kapatır.
- Gate komut metnini okur. `git commit`'i gizleyen bir script ya da alias üzerinden atılan commit durdurulmaz.
- Bir `git commit -a`, bir `-am` ve `--` sonrası pathspec taşıyan bir commit index'e göre daraltılmaz, çünkü bunlar index'in henüz tutmadığı dosyaları commit eder. Onlar için her açık bulgu durur.
- Index, komut çalışmadan önce okunur. Okuma ile çalışma arasında dosyaları değişen bir commit, okuma anındaki index'e göre ölçülür.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
