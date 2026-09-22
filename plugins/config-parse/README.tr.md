# config-parse

Bir Edit ya da Write'ın dokunduğu her JSON, YAML, TOML ve `.env` dosyasını parse eden ve parse hatasını bir sonraki build'de değil, o anda not eden bir Claude Code Mod'u.

## Ne yapar

1. Engine'in çalıştırdığı her Edit ve Write'tan sonra mod path'i okur. `.json`, `.jsonc`, `.yml`, `.yaml`, `.toml`, `.env` ya da `.env.<name>` dosyası parse edilir; diğer her dosyaya dokunulmaz. Kendi tool'unun JSON with comments olarak okuduğu bir dosya (`.jsonc`, `tsconfig*.json`, `jsconfig*.json`, `.vscode/*.json`, `devcontainer.json`) `//` ve `/* */` yorumları ve sondaki virgülleri içerebilir; diğer her JSON dosyası strict okunur.
2. JSON'ı mod kendisi parse eder, `.env` dosyası satır satır okunur: boş olmayan, comment olmayan ve `KEY=value` olmayan bir satır bulgudur, numarasıyla birlikte.
3. YAML ve TOML `python3` ile parse edilir (güvenli bir loader ile `yaml.load_all` ve `tomllib.load`), dosya path'i tek bir argv değeri olarak. Bir `---` stream'inin her dokümanı okunur ve `!Ref` ya da `!vault` gibi bir uygulama tag'i kabul edilir, çünkü ikisi de geçerli YAML'dir. python ya da modül yoksa o tür session boyunca atlanır ve bir satır bunu söyler.
4. Parse edilmeyen bir dosya iki kanala yazılır: model dosyayı ve hatayı adlandıran bir `context` notu alır, kişi ortak sidebar'ın stream'inde kırmızı bir kayıt alır, sidebar kapalıyken bir transcript satırı. Dosya, session'ın başladığı git repository'sine göre adlandırılır; repository dışında session'ın dizinine göre. Bu kök session başlangıcında bir kere okunur, çünkü bir Bash `cd` session'ın kendi dizinini taşır.
5. Sonraki bir edit aynı dosyayı tekrar parse edilir hale getirdiğinde duran kayıt temizlenir ve bir yeşil satır bunu söyler. O satır yalnız kişiye gider, çünkü düzeltmeyi model kendisi yapmıştır. Bulgusu dururken silinen bir dosya sonraki ölçümde aynı şekilde `<file> is gone, and its parse error with it` ile kapanır. Var olan ama okunamayan bir dosya bulgusunu korur.
6. Mod hiçbir edit'i reddetmez. Dosya önce yazılır, sonra okunur.
7. Modelin kapatmadığı bir bulgu her main-loop turn sonunda tekrar ölçülür ve geriye kalan, bir sonraki prompt ile modele tek not olarak ulaşır:

       config-parse: 1 file(s) still do not parse: package.json. Fix them.

   Turn başına bir not, prompt başına değil. Bu olmasa bulgu bir kere, edit anında söylenir ve model onu unutmuşken pane'de dururdu. Siz yeni bir şey okumazsınız: pane zaten aynı bulguyu taşır.
8. `deny` modunda mod ayrıca, bir dosya parse edilmiyorken `git commit`, `git push` ve `git merge` komutlarını durdurur. Bir komutu durdurmadan önce her açık dosyayı tekrar parse eder, yani model onları düzelttiğinde komut kendiliğinden çalışır. Bir `git commit` yalnız kendi dosyalarından sorumludur: mod index'i okur (`git diff --cached --name-only`) ve commit açık dosyalardan hiçbirini tutmuyorsa çalışmasına izin verir, kaç bulgunun durduğunu söyleyen bir satırla. `push` ve `merge` hiçbir index okumaz, bu yüzden orada her bulgu durur. Kaçış yolu yoktur: `--dry-run`, `--help` ve diğer her komut geçer, ama bozuk bir dosyanın gerçek commit'i düzeltmeyi bekler. `note` varsayılandır ve hiçbir şeyi durdurmaz.

Canlı testte sondaki virgülle bozulmuş bir JSON dosyası notu aldı (`Property name must be a string literal`), `a: 1: 2` ile bozulmuş bir YAML dosyası python hatasını aldı ve `a: 1` yazan sonraki Write bulguyu `parses as YAML again` ile kapattı.

## Komut

    /config-parse                 on ya da off, mod ve parse edilmeyen dosyalar
    /config-parse on | off        varsayılan on
    /config-parse mode note       sadece not; varsayılan
    /config-parse mode deny       bir dosya parse edilmiyorken commit, push ve merge de durur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install config-parse@kilimcininkoroglu-mods

Function hook'lar early access. Flag olmadan hiçbir şey yüklenmez. Flag'i kalıcı yapmak için `~/.claude/settings.json` dosyasına ekleyin:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## Kurulumdan sonra

1. YAML kontrolü için PyYAML ile `python3` kurun (`python3 -m pip install pyyaml`). TOML yalnız python 3.11 ya da üstünü ister. Bunlar olmadan o iki tür atlanır, JSON ve `.env` çalışmaya devam eder.
2. Claude Code'u yeniden başlatın.

## Nereye uzanır

Claude Code 2.1.280 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=config-parse}, tool.call{tool=Edit}, tool.call{tool=Write}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via pythonCheck, shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log

Reach L2, dosya okur ve process çalıştırır.

    1. Okur:     her Edit ve Write'ın path'ini, her Bash çağrısının komutunu, düzenlenen JSON ve .env dosyalarının metnini, ve turn sonunda her açık dosyayı tekrar
    2. Çalıştırır: python3 -c, argv ile, YAML ve TOML dosyalarında; session başlangıcında bir kere git rev-parse --show-toplevel, dosyaları repository köküne göre adlandırmak için; deny modunda bir commit anında git rev-parse --show-toplevel ve git diff --cached --name-only
    3. Gönderir: dosya adını ve parse hatasını modele, bulgu dururken bir sonraki prompt ile bir not daha; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu
    5. Düşman girdi: path tool çağrısından gelir ve python'a tek bir argv değeri olarak ulaşır, hiçbir zaman shell üzerinden geçmez; python programı sabit metindir ve sys.argv[1] okur

## Sınırlar

- Kontrol write'tan sonra çalışır, yani bozuk dosya bir sonraki edit onu düzeltene kadar durur. Hiçbir edit reddedilmez; `deny` modunda yalnız commit, push ve merge durur.
- `deny` modunun kaçış yolu yoktur. Bulgu düzeltilemiyorsa kişi gate'i `/config-parse mode note` ile kapatır.
- Bir wrapper, alias ya da script üzerinden çalışan ve mod'un `git commit|push|merge` olarak okuyamadığı bir git komutu gate'ten geçer.
- `git commit -a`, `-am` ve `--` sonrası pathspec taşıyan bir commit index'e göre daraltılmaz, çünkü bunlar index'in henüz tutmadığı dosyaları commit eder. Onlar için her açık bulgu durur.
- Index komut çalışmadan önce okunur. Dosyaları okuma ile çalışma arasında değişen bir commit, okuma anındaki index'e göre ölçülür.
- Bir `.env` satırı yalnız şekli için kontrol edilir. Yanlış bir değer, eksik bir tırnak ya da tekrarlanan bir key bulgu değildir.
- Modun JSON with comments olarak tanımadığı bir ad altında (1. adımdaki listenin dışındaki bir `.json` adı) comment taşıyan bir JSON dosyası bozuk raporlanır, çünkü o ad strict okunur.
- YAML ve TOML `python3` ister; o olmayan bir makinede bu dosyalar hiç kontrol edilmez.
- Edit ve Write dışında yapılan bir düzenleme, örneğin Bash `sed`, görülmez.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limiti 10, üstünde build'i düşürür
    make typecheck   # /plugin-types ile üretilen .claude/types/ gerekir
    make validate
    make test        # claude plugin test
