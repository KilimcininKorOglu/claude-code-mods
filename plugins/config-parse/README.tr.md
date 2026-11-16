# config-parse

`package.json` dosyasında unutulan bir virgül ya da bir YAML dosyasında kayan bir girinti, yapıldığı anda hiçbir sorun çıkarmaz. Hata bir sonraki build'de ya da bir servis açılmadığında fark edilir. Bu çoğu zaman hatayı yapan düzenlemeden çok sonra olur. Bu mod, bir Edit ya da Write çağrısının değiştirdiği her JSON, YAML, TOML ya da `.env` dosyasını hemen parse eder. Bir parse hatası varsa modele bunu o anda bildirir.

## Ne yapar

1. Engine'in çalıştırdığı her Edit ya da Write çağrısından sonra mod dosyanın path'ine bakar. `.json`, `.jsonc`, `.yml`, `.yaml`, `.toml`, `.env` ya da `.env.<ad>` dosyaları parse edilir. Diğer dosyalara dokunulmaz. Kendi aracının yorumlu JSON olarak okuduğu dosyalarda (`.jsonc`, `tsconfig*.json`, `jsconfig*.json`, `.vscode/*.json`, `devcontainer.json`) `//` ve `/* */` yorumlarına ve sondaki virgüllere izin verilir. Diğer bütün JSON dosyaları katı kurallarla parse edilir.
2. JSON dosyalarını mod kendisi parse eder. `.env` dosyası satır satır okunur. Boş olmayan, yorum olmayan ve `KEY=value` biçiminde olmayan bir satır, satır numarasıyla birlikte bulgu olarak bildirilir. Satırın başındaki `export` kabul edilir.
3. YAML ve TOML dosyalarını `python3` parse eder (güvenli bir loader ile `yaml.load_all` ve `tomllib.load`). Dosya path'i tek bir argv öğesi olarak verilir. `---` ile ayrılmış bir akıştaki her doküman okunur. `!Ref` ya da `!vault` gibi uygulama tag'leri de kabul edilir, çünkü ikisi de geçerli YAML'dır. Python ya da modül yoksa o dosya türü session boyunca atlanır ve bu durum tek bir satırla bildirilir.
4. Parse edilemeyen bir dosya iki kanaldan bildirilir. Model, dosyanın adını ve hatayı içeren bir `context` notu alır. Siz [sidebar](../sidebar) stream'inde kırmızı bir kayıt görürsünüz: önce dosya, ardından hata. Parser'ın verdiği konum (örneğin `line 2` ya da `(line 3, column 5)`) sarı renktedir. Sidebar kapalıysa bir transcript satırı görürsünüz. Dosyanın path'i, session'ın başladığı git repository'sinin köküne göre yazılır. Repository dışında path, session'ın dizinine göre yazılır. Bu kök dizin session başında bir kez okunur, çünkü Bash'te çalışan bir `cd` session'ın dizinini değiştirir.
5. Sonraki bir düzenleme aynı dosyayı yeniden parse edilebilir hâle getirirse mevcut kayıt silinir ve bunu bildiren yeşil bir satır yazılır. Bu satır yalnız size gösterilir, çünkü dosyayı model kendisi düzeltmiştir. Bulgusu açıkken silinen bir dosyanın bulgusu da bir sonraki ölçümde aynı şekilde kapanır: `<dosya> is gone, and its parse error with it`. Yerinde duran ancak okunamayan bir dosyanın bulgusu açık kalır.
6. Mod hiçbir düzenlemeyi reddetmez. Dosya önce yazılır, ardından okunur.
7. Modelin kapatmadığı bir bulgu, her main loop turn'ünün sonunda yeniden ölçülür. Hâlâ açık olan bulgular, bir sonraki prompt'unuzla birlikte modele tek bir not olarak gönderilir:

       config-parse: 1 file(s) still do not parse: package.json. Fix them.

   Bu not her turn için bir kez gönderilir, her prompt için değil. Bu not olmasaydı bulgu yalnız düzenleme anında bir kez bildirilir, ardından pane'de kalır ve model onu unuturdu. Size yeni bir satır gösterilmez, çünkü pane aynı bulguyu zaten gösterir.
8. `deny` modunda bir dosya parse edilemediği sürece `git commit`, `git push` ve `git merge` komutları da durdurulur. Mod bir komutu durdurmadan önce açık bütün dosyaları yeniden parse eder. Model dosyaları düzelttiyse komut kendiliğinden çalışır. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`). Commit açık dosyaların hiçbirini içermiyorsa çalışır ve kaç bulgunun hâlâ açık olduğu tek bir satırla bildirilir. `push` ve `merge` için okunacak bir index yoktur. Bu yüzden bu komutlarda bütün bulgular geçerlidir. Bu kontrolü atlamanın bir yolu yoktur: `--dry-run`, `--help` ve `-h` çalışır, ancak bozuk bir dosyanın gerçek commit'i dosya düzeltilene kadar bekler. Varsayılan mod `note` modudur ve hiçbir işlemi durdurmaz.

Canlı denemede sonunda fazladan bir virgül bulunan JSON dosyası için not gönderildi (`Property name must be a string literal`). `a: 1: 2` ile bozulan YAML dosyası için python hatası bildirildi. Ardından yapılan `a: 1` Write çağrısı bulguyu `parses as YAML again` ile kapattı.

## Komut

    /config-parse                 açık mı kapalı mı, mod ve parse edilemeyen dosyalar
    /config-parse on | off        varsayılan açık
    /config-parse mode note       yalnız not verir; varsayılan
    /config-parse mode deny       bir dosya parse edilemediği sürece commit, push ve merge de durdurulur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install config-parse@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. YAML kontrolü için `python3` ve PyYAML yükleyin (`python3 -m pip install pyyaml`). TOML için python 3.11 ya da sonrası yeterlidir. Bunlar olmadan bu iki dosya türü atlanır. JSON ve `.env` kontrolleri yine çalışır.
2. Claude Code'u yeniden başlatın.

## Nelere erişir

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=config-parse}, tool.call{tool=Edit}, tool.call{tool=Write}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via pythonCheck, shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log

Reach L2: dosya okur ve bir process çalıştırır.

    1. Okur:         her Edit ve Write çağrısının path'ini, her Bash çağrısının komutunu, düzenlenen JSON ve .env dosyalarının metnini; turn sonunda açık her dosyayı yeniden
    2. Çalıştırır:   YAML ve TOML dosyaları için argv ile python3 -c; dosyaları repository köküne göre göstermek için session başında bir kez git rev-parse --show-toplevel; deny modunda bir commit sırasında git rev-parse --show-toplevel ve git diff --cached --name-only -z
    3. Gönderir:     modele dosya adını ve parse hatasını; bulgu açık kaldığı sürece bir sonraki prompt'la bir not daha; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde
    5. Düşman girdi: path tool çağrısından gelir ve python'a hiçbir zaman bir shell üzerinden değil, tek bir argv öğesi olarak verilir; python programı sabit bir metindir ve sys.argv[1] değerini okur

## Sınırlar

- Kontrol, yazma işleminden sonra çalışır. Bu yüzden bozuk dosya, bir sonraki düzenleme onu düzeltene kadar diskte kalır. Hiçbir düzenleme reddedilmez. `deny` modunda yalnız commit, push ve merge durdurulur.
- `deny` modunu atlamanın bir yolu yoktur. Bir bulgu düzeltilemiyorsa kontrolü `/config-parse mode note` ile siz kapatırsınız.
- Modun `git commit|push|merge` olarak tanıyamadığı bir wrapper, alias ya da script ile çalıştırılan bir git komutu kontrolden geçer.
- `git commit -a`, `-am` ve `--` işaretinden sonra pathspec verilen commit'ler index'e göre daraltılmaz, çünkü bu komutlar index'te henüz olmayan dosyaları da commit eder. Bu commit'lerde açık bulguların hepsi geçerlidir.
- Index, komut çalışmadan önce okunur. Dosyaları bu okuma ile komutun çalışması arasında değişen bir commit, okuma anındaki index'e göre ölçülür.
- `.env` satırının yalnız biçimi kontrol edilir. Yanlış bir değer, eksik bir tırnak ya da tekrarlanan bir key bulgu sayılmaz.
- Modun yorumlu JSON olarak tanımadığı bir adla kaydedilmiş yorumlu bir JSON dosyası (1. maddedeki listenin dışındaki bir `.json` adı) bozuk olarak bildirilir, çünkü bu dosya katı kurallarla okunur.
- YAML ve TOML için `python3` gerekir. `python3` olmayan bir bilgisayarda bu dosyalar hiçbir zaman kontrol edilmez.
- Edit ve Write dışında yapılan bir düzenleme, örneğin Bash'te çalışan bir `sed`, fark edilmez.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
