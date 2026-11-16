# sql-concat-watch

Model `` db.query(`SELECT * FROM users WHERE id = ${id}`) `` yazar. Sorgu testte çalışır, ancak koda bir SQL injection açığı girer. Bu mod, bir düzenleme query parameter kullanmak yerine string'leri birleştirerek SQL oluşturduğunda bunu modele bildirir. Not, Edit çağrısının sonucuyla birlikte gelir ve her satırı gösterir. Böylece model sorguyu aynı turn'de yeniden yazar. Varsayılan modda hiçbir işlem durdurulmaz. `deny` modunda bir dosya hâlâ SQL birleştirdiği sürece commit, push ve merge durdurulur.

## Ne yapar

1. Mod Edit ve Write tool'larını izler. Bir kaynak dosyada (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.php`, `.go`, `.rb`, `.java`, `.kt`, `.cs`, `.rs`) başarılı bir çağrıdan sonra düzenlemenin eklediği satırlar okunur: `new_string` içinde olup `old_string` içinde olmayan satırlar ya da bir Write çağrısının bütün satırları.
2. Bir satır, SQL içeriyorsa ve bu SQL'e bir değer birleştiriyorsa sayılır:

   | SQL | Birleştirme |
   |---|---|
   | Büyük harfli `SELECT … FROM`, `INSERT INTO`, `UPDATE … SET`, `DELETE FROM`, `WHERE`, `VALUES`, `ORDER BY`, `GROUP BY`, `JOIN` | `"…" + x` ve `x + "…"` (JS, Java, Go, C#, Kotlin) |
   | Herhangi bir harf biçimiyle `select *` ya da `select a, b from`, `insert into t (`, `delete from t where`, `update t set a =` | Python f-string'leri, `%` ve `.format(` |
   | | PHP `"… $var"` ve `"…" . $var`, Kotlin `"… $var"` |
   | | C# `$"… {x}"`, Ruby `"… #{x}"` |
   | | `fmt.Sprintf(`, `String.format(`, `format!(` |
   | | `${…}` içeren bir template literal, birden çok satıra yayılanlar da |

   Değerleri parameter olarak geçen tag'li bir template literal'e dokunulmaz: `` sql`…` ``, `` Prisma.sql`…` ``, `` prisma.$queryRaw`…` ``, `` $executeRaw`…` ``. `$queryRawUnsafe` böyle bir tag değildir. Yorum satırları ve İngilizce düz metin (`"select a file from the list: " + name`) sayılmaz.
3. Model, Edit çağrısının sonucundan sonra şu notu okur:

       sql-concat-watch: this edit builds SQL from strings: src/db.ts:14 · src/db.ts:22. Pass values as query parameters (?, $1, :name) instead of joining them into the SQL text.

   Satır numarası, düzenlemeden sonraki dosyadan alınır. Bir Write çağrısında numaralar çağrının kendi içeriğinden alınır. En fazla 8 yer adıyla yazılır, geri kalanı sayı olarak verilir. Dosya okunamazsa path satır numarası olmadan yazılır ve hata bir kez log'a yazılır. Dosya, session'ın başladığı git repository'sinin içindeyse path o repository'nin köküne göre yazılır. Örneğin `web/` içinde açılan bir session, `api/` altındaki bir dosyayı `api/db.ts` olarak yazar. Git repository'si dışında path, session'ın başladığı dizine göre yazılır. Bu kök dizin session başında bir kez okunur, çünkü Bash'te çalışan bir `cd` session'ın dizinini değiştirir.
4. Aynı anda transcript'e tek bir satır yazılır. Bu sayede modele ne söylendiğini görürsünüz. Satır talimat içermez, yalnız yerleri içerir:

       sql-concat-watch: SQL built from strings: src/db.ts:14 · src/db.ts:22

   Not ve satır ayrı kanallardan gider: model satırı, siz de notu hiçbir zaman görmezsiniz.
5. [sidebar](../sidebar) açıksa bu yerler transcript yerine sidebar'ın stream'ine bir kayıt olarak yazılır. Her yer kırmızı bir satırdadır. Sekizinci yerden sonrakiler soluk tek bir sayı olarak gösterilir. Transcript temiz kalır. Kayıt, yeni kayıtlar onu pane'den çıkarana kadar görünür. Sidebar kapalıysa ya da yüklü değilse satır yukarıdaki gibi transcript'e yazılır.

6. Bulgu, dosya bu satırları artık içermeyene kadar açık kalır. Mod açık her dosyayı şu anlarda yeniden okur: sonraki her Edit ya da Write çağrısından sonra, her ana loop turn'ünün sonunda ve `deny` modunda korunan bir git komutundan önce. Bütün satırları kaldırılmış bir dosyanın bulgusu kapanır. Bir satır artık string'lerden SQL oluşturmuyorsa kaldırılmış sayılır: silinmiştir, parameter'larla yeniden yazılmıştır ya da yorum satırına alınmıştır. Satırlarının bir kısmını hâlâ içeren bir dosya yalnız bu satırlarla, şu anki satır numaralarıyla açık kalır. Kayıt, dosyanın o anki içeriğiyle değiştirilir ve hiçbir zaman önceki hâliyle birleştirilmez. Artık yerinde olmayan bir dosyanın bulgusu da kapanır, çünkü bu dosya hiçbir satır içermez. Yerinde duran ancak okunamayan bir dosyanın bulgusu açık kalır, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz. Bunu yeşil bir kayıt bildirir:

       sql-concat-watch: the SQL built from strings is gone from src/db.ts: src/db.ts:14 · src/db.ts:22

   Sidebar kapalıysa aynı metin transcript'e tek bir satır olarak yazılır. Model bunların hiçbirini okumaz, çünkü sorguyu kendisi yeniden yazmıştır.

7. Modelin kapatmadığı bir bulgu, her ana loop turn'ünün sonunda yeniden ölçülür. Hâlâ açık olan bulgular, bir sonraki prompt'unuzla birlikte modele tek bir not olarak gönderilir:

       sql-concat-watch: 2 place(s) still build SQL from strings: src/db.ts:14 · src/db.ts:22. Pass the values as query parameters (?, $1, :name), or take the lines out.

   Bu not her turn için bir kez gönderilir, her prompt için değil. Bu not olmasaydı model bulguyu yalnız düzenleme anında bir kez duyar ve ardından unuturdu. Bulgu da pane'de kalırdı. Size yeni bir satır gösterilmez, çünkü pane aynı bulguyu zaten gösterir.

8. `deny` modunda bir dosya hâlâ string'lerden SQL oluşturduğu sürece mod `git commit`, `git push` ve `git merge` komutlarını da durdurur. `--dry-run`, `--help` ya da `-h` içeren bir komut durdurulmaz. Mod bir komutu durdurmadan önce açık her dosyayı yeniden okur. Böylece modelin düzelttiği bir dosya gate'i kendiliğinden açar. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`). Commit açık dosyaların hiçbirini içermiyorsa çalışır ve kaç bulgunun hâlâ açık olduğu size tek bir satırla bildirilir. `push` ve `merge` için okunacak bir index yoktur. Bu yüzden bu komutlarda bütün bulgular geçerlidir. Gate'i atlamanın bir yolu yoktur. Gate'i yalnız siz `/sql-concat-watch mode note` ile kapatabilirsiniz. Varsayılan mod `note` modudur ve hiçbir işlemi durdurmaz.

Canlı denemede model tek bir Edit çağrısıyla bir dosyaya `` db.query(`SELECT * FROM users WHERE id = ${id}`) `` ekledi. Ardından `src/users.ts:3` satırını gösteren notu okudu ve cevabında sorgunun parameter'lı biçimini yazdı.

## Komut

    /sql-concat-watch                 açık mı kapalı mı, mod ve hâlâ SQL birleştiren dosyalar
    /sql-concat-watch on | off        varsayılan açık
    /sql-concat-watch mode note       yalnız not verir; varsayılan
    /sql-concat-watch mode deny       bir dosya SQL birleştirdiği sürece commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sql-concat-watch@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=sql-concat-watch}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via fileText, gate, toPerson)

Reach L2: index'i okumak için git çalıştırır.

    1. Okur:         her Edit ve Write çağrısının metnini; Bash komutunun metnini; SQL birleştiren bir Edit çağrısından sonra satır numaraları için düzenlenen dosyayı; bir bulgu açık kaldığı sürece açık her dosyayı yeniden
    2. Çalıştırır:   path'leri repository köküne göre göstermek için session başında bir kez git rev-parse --show-toplevel; deny modunda bir commit sırasında, commit'in hangi dosyaları içerdiğini okumak için git rev-parse --show-toplevel ve git diff --cached --name-only -z
    3. Gönderir:     SQL birleştiren bir düzenlemeden sonra modele bir not; bulgu açık kaldığı sürece bir sonraki prompt'la bir not daha; transcript'e bir satır; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde
    5. Düşman girdi: düzenlenen metin yalnız regular expression'larla karşılaştırılır ve dosya:satır olarak yazılır, hiçbir zaman çalıştırılmaz

## Sınırlar

- Kontrol bir parser ile değil, regular expression'larla satır satır yapılır. Bir değişkende birden çok ifadeyle oluşturulan bir sorgu (`q = "SELECT …"; q += id`) fark edilmez.
- Parameter kullanılamayan bir tablo ya da sütun adına birleştirilen bir değer de bildirilir. Not bu durumda bir gerekçe ister ve hiçbir işlemi durdurmaz.
- Birleştirilmiş bir string içeren bir query builder çağrısı (`knex.raw`, `DB::raw`, `whereRaw`), yalnız string'in kendisi SQL anahtar kelimeleri içeriyorsa fark edilir.
- Bash ile yapılan bir düzenleme kontrol edilmez.
- Bildirilen satırlar dosyadan kaldırıldığında bulgu kapanır. Başka bir dosyaya taşınan bir satır bulguyu açık tutar.
- `deny` modunu atlamanın bir yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/sql-concat-watch mode note` ile siz kapatırsınız.
- Gate komutun metnini okur. `git commit` komutunu gizleyen bir script ya da alias ile yapılan bir commit durdurulmaz.
- `git commit -a`, `-am` ve `--` işaretinden sonra pathspec verilen commit'ler index'e göre daraltılmaz, çünkü bu komutlar index'te henüz olmayan dosyaları da commit eder. Bu commit'lerde açık bulguların hepsi geçerlidir.
- Index, komut çalışmadan önce okunur. Dosyaları bu okuma ile komutun çalışması arasında değişen bir commit, okuma anındaki index'e göre ölçülür.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
