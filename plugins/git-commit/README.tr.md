# git-commit

Bir commit skill'i modele nasıl commit yapacağını söyler: path'ler tek tek yazılır, AI imzası eklenmez, kimsenin istemediği bir push yapılmaz. Model skill'i okur. Ancak bazen skill'i hiç açmadan Bash'te doğrudan `git commit` çalıştırır. Bu mod commit skill'ini kendi içinde taşır ve her Bash git komutunu bu skill'in kurallarına bağlar. Şu komutlar git çalışmadan önce durdurulur: skill açılmadan yapılan bir commit, toplu bir `git add`, bir imza trailer'ı, bir secret, ignore edilmiş bir path ya da kimsenin istemediği bir push veya branch değişikliği. Model, komutun hangi kuralı ihlal ettiğini okur ve komutu doğru biçimde yeniden çalıştırır.

## Ne yapar

1. Mod skill'i `git-commit:commit` adıyla taşır (`skills/commit/SKILL.md`). Model skill'i Skill tool'uyla açar ya da siz `/git-commit:commit` yazarsınız. Verdiğiniz seçenekler de skill'e iletilir: `--all`, `--staged`, `--modified`, `--no-verify`, `--amend`, `--push`.
2. Skill açıldığında mod, skill metninin sonuna bir `Current repository state (git-commit)` bloğu ekler. Blok şunları içerir: branch; staged, unstaged, untracked ve conflicted dosyalar (her biri için en fazla 40); skill'in açıldığı seçenekler; son 20 subject'in stili; son 10 subject; adı credential içeren ya da bir ignore dosyasında adı geçen her staged dosya için bir uyarı. Model önce `git status` ve `git log` çalıştırmak yerine bu bloktan başlar.
3. Skill, onu açan agent loop'u için, o loop'un turn'ü bitene kadar açık sayılır. Ana loop ve her subagent ayrıdır: commit yapacak bir subagent skill'i kendisi açar. Yeni bir turn'de skill yeniden açılır.
4. Git içeren her Bash komutu çalışmadan önce okunur. Mod komutu `&&`, `||`, `;`, `|`, `&`, parantez ve satır sonlarından böler. Git'in önündeki `env`, `command`, `exec`, `time`, `nohup` ve değişken atamalarını atlar. `cd` ve `git -C` değerlerini izler. `add`, `rm`, `commit`, `push`, `merge`, `config`, `rebase`, `switch`, `branch` ve `checkout` argümanlarını git'in kendi option parser'ı gibi okur (`-am`, `-mtext`, `--message=text`, `--`). Bir heredoc'u, içerdiği mesaj olarak okur. Diğer git çağrıları okunmadan çalışır.
5. Bir commit'in neyi kaydedeceğini ölçmek için mod index'i geçici bir dosyaya kopyalar. Komutun kendi `git add` ve `git rm --cached` çağrılarını `GIT_INDEX_FILE` ile bu kopyada yeniden çalıştırır. `commit -a`, tracked değişiklikleri kopyaya stage'ler. Pathspec verilen bir commit, `HEAD` içeriğini taşıyan yeni bir index'ten başlar. Gerçek index'e hiçbir zaman yazılmaz. Geçici dosyalar ölçümden sonra silinir.
6. Bir kural ya kesin ya da yumuşaktır. Varsayılan `deny` modunda kesin bir kuralı ihlal eden bir komut çalışmadan önce durdurulur ve model şu metni okur:

       git-commit: stopped before it ran, because it breaks the git-commit:commit skill:
       - A git commit runs only after the git-commit:commit skill was opened in this turn, by this agent. Call the Skill tool with skill "git-commit:commit" and, as args, the options the user gave (such as --push or --amend), follow its steps, then run the commit again.
       There is no way around this gate.

   `note` modunda komut çalışır ve model ihlal edilen kuralları komutun sonucundan sonra okur. Yumuşak bir kural hiçbir komutu durdurmaz: iki modda da notu sonuçtan sonra gelir.
7. Her kural için size bir satır gösterilir. [sidebar](../sidebar) açıksa satırlar sidebar'ın stream'ine `git command stopped` ya da `git command noted` başlığıyla yazılır. Kesin bir kural kırmızı, yumuşak bir kural sarı renktedir. Sidebar kapalıysa transcript'e `git-commit: stopped: skill not opened` gibi tek bir satır yazılır.
8. Mod açıkken engine'in commit attribution metni boştur. Böylece modele bir `Co-Authored-By` trailer'ı eklemesi söylenmez.

Claude Code 2.1.284 üzerindeki canlı denemede gate şu komutları durdurdu: skill açılmadan çalıştırılan bir `git commit`, bir `git add .`, `.gitignore` dosyasında adı geçen bir dosya için `git add -f`, `Co-Authored-By: Claude` satırı içeren bir commit ve prompt'un istemediği bir `git push`. Model `git-commit:commit` skill'ini açtığında durum bloğunu okudu ve aynı commit çalıştı. `note` modunda `git add .` çalıştı. Model ihlal edilen kuralı ve stage'lenen üç yeni dosyayı okudu.

## Kurallar

Kesin kurallar (`deny` modunda komut durdurulur):

| Komut | Durdurulduğu durum |
|---|---|
| `git commit` | skill bu turn'de bu agent tarafından açılmadı |
| `git commit` | skill `--no-verify` ile açılmadan `--no-verify` ya da `-n`; `--amend` ile açılmadan `--amend`; `--all` ya da `--modified` ile açılmadan `-a` |
| `git commit` | `--allow-empty`, `--allow-empty-message`, `--interactive`, `-p` |
| `git commit`, `git add` | bu değişikliğin dosyalarının dışına çıkan bir pathspec: `.`, `..`, `*`, bir glob, bir `:` pathspec'i, bir dizin (bir submodule burada dosya sayılır); skill'in `--all` seçeneği bunlara izin verir |
| `git add` | `--all` olmadan `-A`; `--all` ya da `--modified` olmadan `-u`; `-i`, `-p`, `-e`, `--pathspec-from-file` |
| `git add -f` | bir ignore dosyasında adı geçen bir path |
| `git commit` | commit, bir ignore dosyasında adı geçen bir path içeriyor: projenin `.gitignore` dosyaları, `.git/info/exclude` ve global excludes dosyası; `git check-ignore -v` ne bildiriyorsa, dosyası ve satırıyla |
| `git commit` | commit, adı credential içeren bir dosya içeriyor (example dosyaları dışında `.env` ve `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `id_rsa` ve diğer `id_*` key'leri, `credentials.json`, `.netrc`, `.pgpass`) ya da şuna benzeyen bir satır ekliyor: bir private key; bir AWS, Google, GitHub, Slack, Stripe, npm, Hugging Face ya da `sk-` key'i; bir JSON Web Token; `api_key`, `secret`, `token` ya da `password` sonrasında harf ve rakam içeren, 16 karakter ya da daha uzun, tırnak içinde bir değer. Not dosyayı, satırı ve türü yazar, değeri hiçbir zaman yazmaz |
| `git commit` | mesaj bir AI imzası içeriyor: bir AI tool'unun adını veren bir `Co-authored-by:` satırı, bir AI tool'unun adını veren bir `Generated with` ya da `Created by` satırı, `noreply@anthropic.com` ya da 🤖. Bir insan için yazılmış bir `Co-authored-by:` satırı kabul edilir |
| `git commit` | subject boş, 72 karakterden uzun ya da noktayla bitiyor |
| `git commit` | repository conventional subject kullanıyor (son 20 subject'in yarısından fazlası, en az 3 subject'ten) ve subject `type(scope): subject` biçiminde değil ya da type skill'in listesinde yok |
| `git commit`, `git push`, `git merge` | `-c core.hooksPath=...`; skill `--no-verify` ile açılmadan `HUSKY=0`, `HUSKY_SKIP_HOOKS`, `SKIP` ya da `LEFTHOOK=0` |
| `git push` | son prompt'unuzda `push` geçmiyor ve skill `--push` ile açılmadı; skill `--no-verify` ile açılmadan `--no-verify`. `--dry-run` kabul edilir |
| `git switch`, `git branch <ad>`, `git branch -d/-m/-c`, `git checkout -b/-B/--orphan/--detach`, `git checkout <ad>` | son prompt'unuzda `branch`, `checkout` ya da `switch` geçmiyor. `--` içeren, iki ya da daha fazla operand alan ya da tek operand'ı var olan bir path olan bir `git checkout` dosyaları geri yükler ve kabul edilir |
| `git config` | bir ayar yazıyor; `--get`, `--list` ve diğer okumalar kabul edilir |
| `git rebase` | `-i` |

Yumuşak kurallar (iki modda da not):

- Commit 100 satırdan fazlasını değiştiriyor.
- Commit birden çok alana dokunuyor. Alan, path'in ilk iki parçasıdır (`plugins/a` ve `plugins/b`).
- Subject'in ilk kelimesi `-ed` ya da `-ing` ile bitiyor (`added`, `adding`).
- Subject'in `type(scope): ` kısmından sonraki büyük/küçük harf kullanımı son subject'lerinkinden farklı.
- `git add` untracked dosyaları stage'liyor. Not bu dosyaları adlarıyla yazar.
- Mod mesajı okuyamadı (shell mesajı çalışma anında oluşturuyor, mesaj başka bir commit'ten geliyor ya da git bir editör açıyor) ya da commit'in neyi içerdiğini ölçemedi (`cd -`, `cd ~` ya da `$` içeren bir path'e `cd` sonrasında ya da git komutun staging adımlarını yeniden çalıştıramadığında).

`git commit --dry-run`, `--short`, `--porcelain`, `--long` ya da `--help` hiçbir şey kaydetmez ve okunmaz.

## Komut

    /git-commit                   açık mı kapalı mı ve mod
    /git-commit on | off          varsayılan açık; off, engine'in commit attribution metnini de geri verir
    /git-commit mode deny         kesin bir kuralı ihlal eden komut durdurulur; varsayılan
    /git-commit mode note         her komut çalışır, model ihlal edilen kuralları sonradan okur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install git-commit@kilimcininkoroglu-mods

Function hook'lar early access aşamasında. Claude Code 2.1.288 ve sonrası onları varsayılan olarak yükler, bu yüzden açmanız gereken bir ayar yoktur.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. Skill ile commit yapmak için `/git-commit:commit` yazın. `/commit` bir plugin skill'ini açmaz.
3. Kendi commit skill'iniz varsa (`~/.claude/skills/commit`), onu kaldırın. Mod yalnız `git-commit:commit` skill'ini kabul eder. Kendi skill'inizden sonra yapılan bir commit durdurulur ve model aynı şeyi söyleyen iki skill okur.
4. `CLAUDE.md` dosyanız modelden commit'i bir skill ile yapmasını istiyorsa, orada skill'in adını `git-commit:commit` olarak yazın.

## Nelere erişir

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=git-commit}, turn.start, prompt.submit, tool.call{tool=Skill}, skill.prompt{skill=git-commit:commit}, attribution.text{kind=commit}, tool.call{tool=Bash}, turn.complete
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via directoryFindings, judgeCheckout, scratchIndex), $.fs.read (via messageCheck), $.fs.stat (via directoryFindings), $.process.run (via dropTemps, git, scratchIndex), $.session.cwd (via judge, repoBlock), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via dropTemps, toPerson)

Reach L2: git, `cp` ve `rm` çalıştırır.

    1. Okur:         git içeren her Bash çağrısının komut metnini; prompt'larınızı, sonuncusunu bellekte tutar; Skill tool'unun argümanlarını; bir -F mesaj dosyasını; git ile repository'yi
    2. Çalıştırır:   LC_ALL=C ile git: rev-parse, status, log -20, diff --cached, check-ignore, ls-files; ayrıca GIT_INDEX_FILE ile geçici bir index'e read-tree, add ve rm --cached; index'i kopyalamak için cp; geçici index dosyalarını silmek için rm -f
    3. Gönderir:     modele bir deny metni ya da not; skill metninin sonuna bir repository durum bloğu; size bir sidebar kaydı ya da transcript satırı; engine'e boş bir commit attribution metni; makineden dışarı hiçbir şey çıkmaz
    4. Saklar:       açık/kapalı ayarını ve modu $.store içinde; tek bir komut süresince .git/index'in yanında geçici index dosyalarını
    5. Düşman girdi: komut metni parse edilir, mod onu hiçbir zaman bir shell'de çalıştırmaz; komutun kendi git add argümanları geçici bir index'te argv olarak yeniden çalıştırılır; bir secret dosyası, satırı ve türüyle yazılır, değeri hiçbir zaman yazılmaz

## Sınırlar

- Gate, Bash komutunun metnini okur. `sh -c`, bir script, bir `make` target'ı, bir git alias'ı, `git commit-tree` ya da bir MCP git tool'u ile yapılan bir commit okunmaz.
- Push ve branch kontrolü, son prompt'unuzda bir kelime arar. "push etme" cümlesi bir push isteği olarak okunur.
- Shell'in komut çalışırken oluşturduğu bir mesaj (`$VAR`, backtick, `cat <<'EOF'` dışında bir `$(...)`) kontrol edilmez. Model bunun yerine bir not okur.
- Stil kuralları son 20 subject'e bakar. 3'ten az subject varsa ya da subject'lerin yarısından azı conventional ise yalnız uzunluk, nokta ve imza kuralları uygulanır.
- Secret kontrolü, dosya adlarını ve eklenen satırları regular expression'larla karşılaştırır. Başka biçimdeki bir key fark edilmez.
- Kip kontrolü, ilk kelimenin dil bilgisine değil, yalnız sonuna bakar.
- `git merge` yalnız atlanan hook'lar için kontrol edilir.
- `deny` modunu atlamanın bir yolu yoktur. Kesin bir kural karşılanamıyorsa gate'i `/git-commit mode note` ile siz kapatırsınız.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build başarısız olur
    make validate
    make test        # claude plugin test
