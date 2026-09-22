# sql-concat-watch

Bir edit'in query parameter'ı geçmek yerine string'leri birleştirerek SQL kurduğunu modele söyleyen bir Claude Code Mod'u. Not Edit'in sonucuyla gelir ve her satırı adlandırır, yani model query'yi aynı turda yeniden yazar. Varsayılan olarak hiçbir şey durmaz; `deny` modunda bir dosya hâlâ SQL birleştirirken commit, push ve merge durur.

## Ne yapar

1. Mod Edit ve Write tool'larını hook'lar. Bir kaynak dosyada (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.php`, `.go`, `.rb`, `.java`, `.kt`, `.cs`, `.rs`) başarılı bir çağrıdan sonra edit'in eklediği satırları okur: `new_string` içinde olup `old_string` içinde olmayanları ya da bir Write'ın her satırını.
2. Bir satır, SQL taşıyor ve içine bir değer birleştiriyorsa sayılır:

   | SQL | Birleştirme |
   |---|---|
   | Büyük harfli `SELECT … FROM`, `INSERT INTO`, `UPDATE … SET`, `DELETE FROM`, `WHERE`, `VALUES`, `ORDER BY`, `GROUP BY`, `JOIN` | `"…" + x` ve `x + "…"` (JS, Java, Go, C#, Kotlin) |
   | Herhangi bir yazımla `select *` ya da `select a, b from`, `insert into t (`, `delete from t where`, `update t set a =` | Python f-string'leri, `%` ve `.format(` |
   | | PHP `"… $var"` ve `"…" . $var`, Kotlin `"… $var"` |
   | | C# `$"… {x}"`, Ruby `"… #{x}"` |
   | | `fmt.Sprintf(`, `String.format(`, `format!(` |
   | | `${…}` taşıyan bir template literal, birkaç satıra yayılanı da |

   Değerleri parameter olarak geçen tag'li bir template literal dokunulmadan bırakılır: `` sql`…` ``, `` Prisma.sql`…` ``, `` prisma.$queryRaw`…` ``, `` $executeRaw`…` ``. `$queryRawUnsafe` böyle bir tag değildir. Yorum satırları ve İngilizce düz metin (`"select a file from the list: " + name`) sayılmaz.
3. Model bu notu Edit'in sonucundan sonra okur:

       sql-concat-watch: this edit builds SQL from strings: src/db.ts:14 · src/db.ts:22. Pass values as query parameters (?, $1, :name) instead of joining them into the SQL text.

   Satır numarası edit sonrası dosyadan gelir; bir Write kendi içeriğinden numaralandırılır. En fazla 8 yer adlandırılır, kalanı sayılır. Dosya okunamadığında path satırsız durur ve hata bir kere log'lanır. Dosya session'ın başladığı dizinin içindeyse path o dizine göre yazılır. O dizin session'ın başlangıcında bir kere okunur, çünkü bir Bash `cd` session'ın kendi dizinini taşır.
4. Aynı anda transcript'e bir satır yazılır, böylece modele ne söylendiğini görürsünüz. Bu satır yalnız yerleri taşır, talimat cümlesi olmadan:

       sql-concat-watch: SQL built from strings: src/db.ts:14 · src/db.ts:22

   Not ve satır ayrı iki kanaldır: model satırı hiç okumaz, siz notu hiç okumazsınız.
6. [sidebar](../sidebar) açıkken bu yerler oraya gider, her biri bir satır olarak, stream'inde bir entry halinde, ve transcript temiz kalır. Entry, yenileri pane'den itene kadar durur. Sidebar kapalıyken ya da o mod kurulu değilken transcript satırı yukarıdaki gibi yazılır.

7. Bir bulgu, dosya o satırları artık taşımayana kadar açık kalır. Sonraki bir Edit ya da Write'tan sonra mod her açık dosyayı yeniden okur ve satırlarının hepsi gitmiş bir dosya kapanır. Artık var olmayan bir dosya da kapanır, çünkü artık hiçbir satır taşımaz; var olan ama okunamayan bir dosya bulgusunu açık tutar, çünkü okunamayan bir dosya hiçbir şeyi kanıtlamaz:

       sql-concat-watch: the SQL built from strings is gone from src/db.ts: src/db.ts:14 · src/db.ts:22

   Sidebar kapalıyken aynı metin tek bir transcript satırıdır. Model bunun hiçbirini okumaz: query'yi kendisi yeniden yazdı.

8. Modelin kapatmadığı bir bulgu her ana döngü turunun sonunda yeniden ölçülür ve kalan, bir sonraki prompt'la modele tek bir not olarak ulaşır:

       sql-concat-watch: 2 place(s) still build SQL from strings: src/db.ts:14 · src/db.ts:22. Pass the values as query parameters (?, $1, :name), or take the lines out.

   Tur başına bir not, prompt başına değil. Bu olmasa bulgu bir kere, edit anında söylenir ve sonra model onu unutmuşken pane'de dururdu. Siz yeni bir şey okumazsınız: pane zaten aynı bulguyu taşıyor.

9. `deny` modunda mod ayrıca, bir dosya hâlâ string'lerden SQL kurarken `git commit`, `git push` ve `git merge` komutlarını durdurur. Bir komutu durdurmadan önce her açık dosyayı yeniden okur, yani modelin düzelttiği bir dosya gate'i kendisi açar. Bir `git commit` yalnız kendi dosyaları için cevap verir: mod index'i okur (`git diff --cached --name-only`) ve index açık dosyaların hiçbirini tutmuyorsa commit'in çalışmasına izin verir, size kaçının hâlâ durduğunu söyleyen bir satırla. Bir `push` ve bir `merge` okunacak index tutmaz, yani orada her bulgu durur. Kaçış yolu yok; gate'i yalnız kişi `/sql-concat-watch mode note` ile kapatır. `note` modu varsayılandır ve hiçbir şeyi durdurmaz.

Canlı kontrolde model bir dosyaya tek bir Edit ile `` db.query(`SELECT * FROM users WHERE id = ${id}`) `` koydu, `src/users.ts:3` adlandıran notu okudu ve cevabında parameterized biçimi adlandırdı.

## Komut

    /sql-concat-watch                 on ya da off, mod ve hâlâ SQL birleştiren dosyalar
    /sql-concat-watch on | off        varsayılan on
    /sql-concat-watch mode note       yalnız not; varsayılan
    /sql-concat-watch mode deny       bir dosya SQL birleştirirken commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sql-concat-watch@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.278 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=sql-concat-watch}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via fileText, gate, toPerson)

Reach L2, index'i okumak için git çalıştırır.

    1. Okur:     her Edit ve Write çağrısının metnini; Bash komut metnini; SQL birleştiren bir Edit sonrası edit edilen dosyayı, satır numaraları için, ve bulgu dururken her açık dosyayı yeniden
    2. Çalıştırır: deny modunda bir commit'te git rev-parse --show-toplevel ve git diff --cached --name-only, commit'in hangi dosyaları tuttuğunu okumak için
    3. Gönderir: SQL birleştiren bir edit'ten sonra modele bir not, bulgu dururken sonraki prompt'la bir tane daha ve transcript'e bir satır; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: edit edilen metin yalnız regular expression ile eşleştirilir ve file:line olarak yazılır, hiçbir zaman çalıştırılmaz

## Sınırlar

- Kontrol satır satır regular expression ile yapılır, bir parser ile değil. Birkaç ifadede bir değişkende kurulan bir query (`q = "SELECT …"; q += id`) görülmez.
- Bir parameter'ın duramayacağı bir table ya da column adına birleştirilen bir değer de bildirilir. Not orada bir gerekçe ister, hiçbir şeyi durdurmaz.
- Birleştirilmiş string taşıyan bir query builder çağrısı (`knex.raw`, `DB::raw`, `whereRaw`) yalnız string'in kendisi SQL keyword'leri taşıdığında görülür.
- Bash üzerinden yapılan bir edit kontrol edilmez.
- Bir bulgu, bildirilen satırlar dosyadan gittiğinde kapanır. Başka bir dosyaya taşınan bir satır bulguyu açık tutar.
- `deny` modunun kaçış yolu yoktur. Bir bulgu düzeltilemediğinde kişi gate'i `/sql-concat-watch mode note` ile kapatır.
- Gate komut metnini okur. `git commit`'i gizleyen bir script ya da alias üzerinden atılan commit durdurulmaz.
- Bir `git commit -a`, bir `-am` ve `--` sonrası pathspec taşıyan bir commit index'e göre daraltılmaz, çünkü bunlar index'in henüz tutmadığı dosyaları commit eder. Onlar için her açık bulgu durur.
- Index, komut çalışmadan önce okunur. Okuma ile çalışma arasında dosyaları değişen bir commit, okuma anındaki index'e göre ölçülür.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
