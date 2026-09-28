# config-parse

`package.json`'da unutulan bir virgül ya da bir YAML dosyasında kayan bir girinti o anda hiçbir sorun çıkarmaz. Bunu bir sonraki build'de ya da bir servis açılmayı reddettiğinde fark edersin, çoğu zaman da hatayı yapan edit'ten çok uzakta. Bu mod bir Edit ya da Write'ın dokunduğu her JSON, YAML, TOML veya `.env` dosyasını hemen parse eder ve bir parse hatası varsa modele o anda söyler.

## Ne yapar

1. Engine'in çalıştırdığı her Edit ya da Write'tan sonra yola bakar. `.json`, `.jsonc`, `.yml`, `.yaml`, `.toml`, `.env` ya da `.env.<ad>` dosyası parse edilir, geri kalan dosyalara dokunulmaz. Kendi aracının yorumlu JSON olarak okuduğu dosyalarda (`.jsonc`, `tsconfig*.json`, `jsconfig*.json`, `.vscode/*.json`, `devcontainer.json`) `//` ve `/* */` yorumları ile sondaki virgüller serbesttir. Diğer bütün JSON dosyaları katı kurallarla parse edilir.
2. JSON'u mod kendisi parse eder. `.env` dosyası satır satır okunur: boş olmayan, yorum olmayan ve `KEY=value` biçiminde olmayan bir satır (başındaki `export` sorun değildir) satır numarasıyla birlikte bulgu olur.
3. YAML ve TOML'u `python3` parse eder (güvenli bir loader'la `yaml.load_all` ve `tomllib.load`); dosya yolu tek bir argv öğesi olarak geçer. `---` ile ayrılmış bir akıştaki her doküman okunur; `!Ref` ya da `!vault` gibi uygulama tag'leri de kabul edilir, çünkü ikisi de geçerli YAML'dır. Python ya da modül yoksa o tür session boyunca atlanır ve tek bir satır bunu haber verir.
4. Parse edilemeyen dosya iki kanala gider. Model dosyayı ve hatayı söyleyen bir `context` notu alır. Sen [sidebar](../sidebar) stream'inde kırmızı bir kayıt görürsün: önce dosya, sonra hata; parser'ın verdiği konum, örneğin `line 2` ya da `(line 3, column 5)`, sarı yazılır. Sidebar kapalıysa bir transcript satırı görürsün. Dosyanın yolu, session'ın başladığı git repository'sinin köküne göre yazılır; repository dışındaysan session'ın dizinine göre. Bu kök session başlarken bir kez okunur, çünkü Bash'teki bir `cd` session'ın dizinini değiştirir.
5. Sonraki bir edit aynı dosyayı yeniden parse edilebilir hâle getirirse duran kayıt silinir ve yeşil bir satır bunu söyler. Bu satır yalnız sana gider, çünkü dosyayı model kendisi düzeltti. Bulgusu açıkken silinen bir dosya da bir sonraki ölçümde aynı şekilde kapanır: `<dosya> is gone, and its parse error with it`. Yerinde duran ama okunamayan dosyanın bulgusu açık kalır.
6. Hiçbir edit'i reddetmez. Dosya önce yazılır, sonra okunur.
7. Modelin kapatmadığı bir bulgu her ana loop turn'ünün sonunda yeniden ölçülür; geriye kalan, bir sonraki prompt'unla birlikte modele tek bir not olarak gider:

       config-parse: 1 file(s) still do not parse: package.json. Fix them.

   Not her prompt'ta değil, her turn'de bir kez gelir. Bu not olmasa model bulguyu yalnız edit anında bir kez duyar ve sonra unuturdu; bulgu da pane'de öylece dururdu. Sana yeni bir satır düşmez, çünkü pane aynı bulguyu zaten gösteriyor.
8. `deny` modunda bir dosya parse edilemediği sürece `git commit`, `git push` ve `git merge` komutlarını da durdurur. Durdurmadan önce açık dosyaların hepsini yeniden parse eder; model onları düzelttiyse komut kendiliğinden geçer. `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only -z`), commit açık dosyaların hiçbirini içermiyorsa geçmesine izin verir ve kaç bulgunun hâlâ durduğunu tek satırla söyler. `push` ve `merge` için okunacak bir index yoktur, orada bütün bulgular geçerlidir. Gate'i aşmanın yolu yoktur: `--dry-run`, `--help` ve `-h` geçer, ama bozuk bir dosyanın gerçek commit'i düzeltmeyi bekler. Varsayılan `note` modudur ve hiçbir şeyi durdurmaz.

Canlı denemede sondaki bir virgülle bozulan JSON dosyası notu aldı (`Property name must be a string literal`), `a: 1: 2` ile bozulan YAML dosyası python hatasını aldı ve sonraki `a: 1` Write'ı bulguyu `parses as YAML again` ile kapattı.

## Komut

    /config-parse                 açık mı kapalı mı, mod ve parse edilemeyen dosyalar
    /config-parse on | off        varsayılan açık
    /config-parse mode note       yalnız not verir; varsayılan budur
    /config-parse mode deny       bir dosya parse edilemediği sürece commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install config-parse@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında ve flag olmadan hiçbir mod yüklenmiyor. Flag'i kalıcı açmak için `~/.claude/settings.json` dosyasına şunu ekle:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. YAML kontrolü için `python3` ve PyYAML kur (`python3 -m pip install pyyaml`). TOML için python 3.11 veya üstü yeterli. Bunlar olmadan bu iki tür atlanır; JSON ve `.env` yine çalışır.
2. Claude Code'u yeniden başlat.

## Nereye uzanır

Claude Code 2.1.283 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=config-parse}, tool.call{tool=Edit}, tool.call{tool=Write}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via pythonCheck, shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log

Reach L2: dosya okur ve bir process çalıştırır.

    1. Okur:     her Edit ve Write'ın yolunu, her Bash çağrısının komutunu, düzenlenen JSON ve .env dosyalarının metnini, turn sonunda da açık her dosyayı yeniden
    2. Çalıştırır: YAML ve TOML dosyaları için argv ile python3 -c; dosyaları repository köküne göre göstermek için session başında bir kez git rev-parse --show-toplevel; deny modunda bir commit anında git rev-parse --show-toplevel ve git diff --cached --name-only -z
    3. Gönderir: modele dosya adını ve parse hatasını, bulgu durdukça bir sonraki prompt'la bir not daha; makineden dışarı bir şey çıkmaz
    4. Saklar:   $.store içinde açık/kapalı ayarını ve modu
    5. Düşman girdi: yol tool çağrısından gelir ve python'a hiçbir zaman shell üzerinden değil, tek bir argv öğesi olarak ulaşır; python programı sabit bir metindir ve sys.argv[1]'i okur

## Sınırlar

- Kontrol yazmadan sonra çalışır; bozuk dosya bir sonraki edit onu düzeltene kadar diskte durur. Hiçbir edit reddedilmez; `deny` modunda yalnız commit, push ve merge durur.
- `deny` modunu aşmanın yolu yoktur. Bir bulgu düzeltilemiyorsa gate'i `/config-parse mode note` ile sen kapatırsın.
- Mod'un `git commit|push|merge` olarak okuyamadığı bir wrapper, alias ya da script üzerinden çalışan git komutu gate'ten geçer.
- `git commit -a`, `-am` ve `--` sonrasında pathspec verilen commit index'e göre daraltılmaz, çünkü index'te henüz olmayan dosyaları da commit'ler. Bunlarda açık bulguların hepsi geçerlidir.
- Index komut çalışmadan önce okunur. Dosyaları bu okumayla çalıştırma arasında değişen bir commit, okuma anındaki index'e göre ölçülür.
- `.env` satırının yalnız biçimine bakılır. Yanlış bir değer, eksik bir tırnak ya da tekrarlanan bir key bulgu sayılmaz.
- Mod'un yorumlu JSON olarak tanımadığı bir adla (1. maddedeki listenin dışındaki bir `.json` adı) duran yorumlu JSON dosyası bozuk bildirilir, çünkü o ad katı kurallarla okunur.
- YAML ve TOML için `python3` gerekir; onun olmadığı bir makinede bu dosyalar hiç kontrol edilmez.
- Edit ve Write dışında yapılan bir düzenleme, örneğin Bash'teki bir `sed`, görülmez.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
