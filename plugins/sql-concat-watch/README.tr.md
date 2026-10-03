# sql-concat-watch

Model `` db.query(`SELECT * FROM users WHERE id = ${id}`) `` yazar, sorgu testte çalışır ve koda bir SQL injection açığı girer. Bu mod, bir edit query parameter geçmek yerine string'leri birleştirerek SQL kurduğunda bunu modele söyler. Not Edit'in sonucuyla birlikte gelir ve her satırı gösterir, böylece model sorguyu aynı turn'de yeniden yazar. Varsayılan olarak hiçbir şey durdurulmaz; `deny` modunda bir dosya hâlâ SQL birleştirdikçe commit, push ve merge durur.

## Ne yapar

1. Mod Edit ve Write tool'larını hook'lar. Bir kaynak dosyada (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.php`, `.go`, `.rb`, `.java`, `.kt`, `.cs`, `.rs`) başarılı bir çağrıdan sonra edit'in eklediği satırları okur: `new_string`'de olup `old_string`'de olmayanları, ya da bir Write'ın bütün satırlarını.
2. Bir satır SQL taşıyor ve içine bir değer birleştiriyorsa sayılır:

   | SQL | Birleştirme |
   |---|---|
   | Büyük harfli `SELECT … FROM`, `INSERT INTO`, `UPDATE … SET`, `DELETE FROM`, `WHERE`, `VALUES`, `ORDER BY`, `GROUP BY`, `JOIN` | `"…" + x` ve `x + "…"` (JS, Java, Go, C#, Kotlin) |
   | Herhangi bir yazımla `select *` ya da `select a, b from`, `insert into t (`, `delete from t where`, `update t set a =` | Python f-string'leri, `%` ve `.format(` |
   | | PHP `"… $var"` ve `"…" . $var`, Kotlin `"… $var"` |
   | | C# `$"… {x}"`, Ruby `"… #{x}"` |
   | | `fmt.Sprintf(`, `String.format(`, `format!(` |
   | | `${…}` taşıyan bir template literal, birkaç satıra yayılanı da |

   Değerleri parameter olarak geçen tag'li bir template literal'e dokunulmaz: `` sql`…` ``, `` Prisma.sql`…` ``, `` prisma.$queryRaw`…` ``, `` $executeRaw`…` ``. `$queryRawUnsafe` böyle bir tag değildir. Yorum satırları ve İngilizce düz metin (`"select a file from the list: " + name`) sayılmaz.
3. Model Edit'in sonucundan sonra şu notu okur:

       sql-concat-watch: this edit builds SQL from strings: src/db.ts:14 · src/db.ts:22. Pass values as query parameters (?, $1, :name) instead of joining them into the SQL text.

   Satır numarası edit'ten sonraki dosyadan gelir; bir Write kendi içeriğinden numaralanır. En fazla 8 yer adıyla yazılır, gerisi sayılır. Dosya okunamazsa path satırsız kalır ve hata bir kez yazılır. Dosya session'ın başladığı git repository'sinin içindeyse path o köke göre yazılır; yani `web/`'de açılan bir session `api/`'deki bir dosyayı `api/db.ts` diye yazar. Git repository'si dışında path session'ın başladığı dizine göre yazılır. Bu kök session başında bir kez okunur, çünkü bir Bash `cd`'si session'ın kendi dizinini değiştirir.
4. Aynı anda transcript'e tek bir satır düşer, böylece modele ne söylendiğini görürsün. Satırda talimat yoktur, yalnız yerler vardır:

       sql-concat-watch: SQL built from strings: src/db.ts:14 · src/db.ts:22

   Not ile satır ayrı kanallardır: model satırı, sen de notu hiç okumazsın.
5. [sidebar](../sidebar) açıksa bu yerler transcript yerine onun stream'ine bir kayıt olarak gider, her yer kırmızı bir satırda; sekizinciden sonraki yerler soluk tek bir sayıdır. Transcript temiz kalır. Kayıt, yenileri onu pane'den itene kadar durur. Sidebar kapalıysa ya da kurulu değilse satır yukarıdaki gibi transcript'e düşer.

6. Bulgu, dosya o satırları artık taşımayana kadar açık kalır. Mod açık her dosyayı sonraki her Edit ya da Write'tan sonra, her ana loop turn'ünün sonunda ve `deny` modunda korunan bir git komutundan önce yeniden okur; satırlarının hepsi gitmiş olan dosya kapanır. Bir satır artık string'lerden SQL kurmuyorsa gitmiş sayılır: çıkarılmıştır, parameter'larla yeniden yazılmıştır ya da yorum satırına alınmıştır. Satırlarının bir kısmını koruyan dosya yalnız onlarla, şu an durdukları satır numaralarıyla açık kalır; kayıt dosyanın şu an taşıdığıyla değiştirilir, önceki hâliyle hiçbir zaman birleştirilmez. Artık yerinde olmayan bir dosya da kapanır, çünkü hiçbir satır taşımaz; yerinde duran ama okunamayan bir dosya bulgusunu korur, çünkü okunmamış dosya hiçbir şey kanıtlamaz. Bunu yeşil bir kayıt söyler:

       sql-concat-watch: the SQL built from strings is gone from src/db.ts: src/db.ts:14 · src/db.ts:22

   Sidebar kapalıysa aynı metin tek bir transcript satırıdır. Model bunların hiçbirini okumaz: sorguyu kendisi yeniden yazdı.

7. Modelin kapatmadığı bir bulgu her ana loop turn'ünün sonunda yeniden ölçülür; geriye kalan, bir sonraki prompt'unla birlikte modele tek bir not olarak gider:

       sql-concat-watch: 2 place(s) still build SQL from strings: src/db.ts:14 · src/db.ts:22. Pass the values as query parameters (?, $1, :name), or take the lines out.

   Not her prompt'ta değil, her turn'de bir kez gelir. Bu not olmasa model bulguyu yalnız edit anında bir kez duyar ve sonra unuturdu; bulgu da pane'de öylece dururdu. Sana yeni bir satır düşmez, çünkü pane aynı bulguyu zaten gösteriyor.

8. `deny` modunda bir dosya hâlâ string'lerden SQL kurdukça mod `git commit`, `git push` ve `git merge`'ü de durdurur; `--dry-run`, `--help` ya da `-h` taşıyan bir komut durdurulmaz. Durdurmadan önce açık her dosyayı yeniden okur; böylece modelin düzelttiği bir dosya gate'i kendiliğinden açar. `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`), commit açık dosyaların hiçbirini içermiyorsa geçmesine izin verir ve kaç tanesinin hâlâ durduğunu tek satırla söyler. `push` ve `merge` için okunacak bir index yoktur, orada bütün bulgular geçerlidir. Gate'i aşmanın yolu yoktur; kapatmak yalnız sana kalır, `/sql-concat-watch mode note` ile. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz.

Canlı denemede model tek bir Edit'le bir dosyaya `` db.query(`SELECT * FROM users WHERE id = ${id}`) `` ekledi, `src/users.ts:3`'ü gösteren notu okudu ve cevabında parameter'lı biçimi yazdı.

## Komut

    /sql-concat-watch                 açık mı kapalı mı, mod ve hâlâ SQL birleştiren dosyalar
    /sql-concat-watch on | off        varsayılan açık
    /sql-concat-watch mode note       yalnız not verir; varsayılan budur
    /sql-concat-watch mode deny       bir dosya SQL birleştirdikçe commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sql-concat-watch@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=sql-concat-watch}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via fileText, gate, toPerson)

Reach L2: index'i okumak için git çalıştırır.

    1. Okur:     her Edit ve Write çağrısının metnini; Bash komut metnini; SQL birleştiren bir Edit'ten sonra satır numaraları için düzenlenen dosyayı, bir bulgu dururken de açık her dosyayı yeniden
    2. Çalıştırır: session başlangıcında bir kere git rev-parse --show-toplevel, path'leri repository köküne göre göstermek için; deny modunda bir commit'te git rev-parse --show-toplevel ve git diff --cached --name-only -z, commit'in hangi dosyaları tuttuğunu okumak için
    3. Gönderir: SQL birleştiren bir edit'ten sonra modele bir not, bulgu dururken sonraki prompt'la bir tane daha ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: düzenlenen metin yalnız regular expression'larla eşleştirilir ve dosya:satır olarak yazılır, hiçbir zaman çalıştırılmaz

## Sınırlar

- Kontrol bir parser değil, regular expression'larla satır satır yapılır. Birkaç ifadeye yayılarak bir değişkende kurulan bir sorgu (`q = "SELECT …"; q += id`) görülmez.
- Parameter'ın duramayacağı bir tablo ya da sütun adına birleştirilen bir değer de bildirilir. Not orada bir gerekçe ister, hiçbir şeyi durdurmaz.
- Birleştirilmiş bir string taşıyan bir query builder çağrısı (`knex.raw`, `DB::raw`, `whereRaw`), yalnız string'in kendisi SQL anahtar kelimeleri taşıyorsa görülür.
- Bash üzerinden yapılan bir edit kontrol edilmez.
- Bildirilen satırlar dosyadan gidince bulgu kapanır. Başka bir dosyaya taşınan bir satır bulguyu açık tutar.
- `deny` modunu aşmanın yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/sql-concat-watch mode note` ile sen kapatırsın.
- Gate komut metnini okur. `git commit`'i gizleyen bir script ya da alias üzerinden yapılan commit durdurulmaz.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit index'e göre daraltılmaz, çünkü index'te henüz olmayan dosyaları da commit'ler. Bunlarda açık bulguların hepsi geçerlidir.
- Index komut çalışmadan önce okunur. Okuma ile çalışma arasında dosyaları değişen bir commit, okuma anında index'in tuttuğuna göre ölçülür.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
