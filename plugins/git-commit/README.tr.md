# git-commit

Bir commit skill'i modele nasıl commit atacağını söyler: path'ler tek tek yazılır, AI imzası eklenmez, kimsenin istemediği push yapılmaz. Model skill'i okur, sonra bazen onu hiç açmadan Bash'ten doğrudan `git commit` çalıştırır. Bu mod commit skill'ini kendi içinde taşır ve her Bash git komutunu ona bağlar. Skill açılmadan atılan commit, toptan bir `git add`, imza trailer'ı, secret, ignore edilmiş bir path ya da kimsenin istemediği push ve branch değişikliği git çalışmadan durdurulur. Model komutun hangi kuralı çiğnediğini okur ve komutu doğru biçimde yeniden çalıştırır.

## Ne yapar

1. Mod skill'i `git-commit:commit` adıyla taşır (`skills/commit/SKILL.md`). Model onu Skill tool'uyla açar ya da sen `/git-commit:commit` yazarsın; verdiğin seçenekler de yanında gider: `--all`, `--staged`, `--modified`, `--no-verify`, `--amend`, `--push`.
2. Skill açılınca mod metninin sonuna bir `Current repository state (git-commit)` bloğu ekler. Blokta branch, staged, unstaged, untracked ve conflicted dosyalar (her biri en fazla 40), skill'in açıldığı seçenekler, son 20 subject'in stili, son 10 subject ve adı credential taşıyan ya da bir ignore dosyasının adını verdiği her staged dosya için bir uyarı bulunur. Model önce `git status` ve `git log` çalıştırmak yerine bu bloktan başlar.
3. Skill, onu açan agent loop'u için o loop'un turn'ü bitene kadar açık sayılır. Ana loop ile her subagent ayrıdır: commit atacak bir subagent skill'i kendisi açar. Yeni bir turn'de skill yeniden açılır.
4. Git geçen her Bash komutu çalışmadan önce okunur. Mod komutu `&&`, `||`, `;`, `|`, `&`, parantez ve satır sonlarından böler, git'in önündeki `env`, `command`, `exec`, `time`, `nohup` ve değişken atamalarını atlar, `cd` ile `git -C`'yi izler. `add`, `rm`, `commit`, `push`, `merge`, `config`, `rebase`, `switch`, `branch` ve `checkout` argümanlarını git'in kendi option parser'ı gibi okur (`-am`, `-mtext`, `--message=text`, `--`), bir heredoc'u da taşıdığı mesaj olarak okur. Diğer git çağrıları okunmadan çalışır.
5. Bir commit'in neyi kaydedeceğini ölçmek için mod index'i geçici bir dosyaya kopyalar. Komutun kendi `git add` ve `git rm --cached` çağrılarını `GIT_INDEX_FILE` ile bu kopyada yeniden oynatır. `commit -a` tracked değişiklikleri kopyaya stage eder; pathspec verilen bir commit `HEAD`'i taşıyan yeni bir index'ten başlar. Gerçek index'e hiç yazılmaz, geçici dosyalar ölçümden sonra silinir.
6. Bir kural ya kesindir ya yumuşak. Varsayılan `deny` modunda kesin bir kuralı çiğneyen komut çalışmadan durur ve model şunu okur:

       git-commit: stopped before it ran, because it breaks the git-commit:commit skill:
       - A git commit runs only after the git-commit:commit skill was opened in this turn, by this agent. Call the Skill tool with skill "git-commit:commit" and, as args, the options the user gave (such as --push or --amend), follow its steps, then run the commit again.
       There is no way around this gate.

   `note` modunda komut çalışır, model çiğnenen kuralları komutun sonucundan sonra okur. Yumuşak bir kural hiçbir komutu durdurmaz: iki modda da notu sonuçtan sonra gelir.
7. Sen her kural için bir satır okursun. [sidebar](../sidebar) açıksa satırlar onun stream'ine `git command stopped` ya da `git command noted` başlığıyla düşer; kesin kural kırmızı, yumuşak kural sarıdır. Sidebar kapalıysa `git-commit: stopped: skill not opened` gibi tek bir transcript satırı düşer.
8. Mod açıkken engine'in commit attribution metni boştur, böylece modele `Co-Authored-By` trailer'ı eklemesi söylenmez.

Claude Code 2.1.284 üzerindeki canlı denemede gate şunları durdurdu: skill açılmadan çalıştırılan bir `git commit`, bir `git add .`, `.gitignore`'un adını verdiği bir dosyaya `git add -f`, `Co-Authored-By: Claude` satırı taşıyan bir commit ve prompt'un istemediği bir `git push`. Model `git-commit:commit`'i açınca durum bloğunu okudu ve aynı commit geçti. `note` modunda `git add .` çalıştı; model çiğnenen kuralı ve stage edilen üç yeni dosyayı okudu.

## Kurallar

Kesin kurallar (`deny` modu komutu durdurur):

| Komut | Durduğu durum |
|---|---|
| `git commit` | skill bu turn'de bu agent tarafından açılmadı |
| `git commit` | skill `--no-verify` ile açılmadan `--no-verify` ya da `-n`; `--amend` ile açılmadan `--amend`; `--all` ya da `--modified` ile açılmadan `-a` |
| `git commit` | `--allow-empty`, `--allow-empty-message`, `--interactive`, `-p` |
| `git commit`, `git add` | bu değişikliğin dosyalarının ötesine uzanan bir pathspec: `.`, `..`, `*`, glob, `:` pathspec'i, dizin (submodule burada dosya sayılır); skill'in `--all` seçeneği bunlara izin verir |
| `git add` | `--all` olmadan `-A`; `--all` ya da `--modified` olmadan `-u`; `-i`, `-p`, `-e`, `--pathspec-from-file` |
| `git add -f` | bir ignore dosyasının adını verdiği path |
| `git commit` | commit, bir ignore dosyasının adını verdiği bir path taşıyor: projenin `.gitignore` dosyaları, `.git/info/exclude` ve global excludes dosyası; `git check-ignore -v` ne diyorsa, dosyası ve satırıyla |
| `git commit` | commit adı credential taşıyan bir dosya içeriyor (example dosyaları dışında `.env` ve `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `id_rsa` ve öteki `id_*` key'leri, `credentials.json`, `.netrc`, `.pgpass`) ya da private key, AWS, Google, GitHub, Slack, Stripe, npm, Hugging Face ya da `sk-` key'i, JSON Web Token ya da `api_key`, `secret`, `token`, `password` sonrasında harf ve rakam taşıyan, 16 karakter ya da daha uzun, tırnaklı bir değer gibi görünen bir satır ekliyor; not dosyayı, satırı ve türü yazar, değeri hiçbir zaman yazmaz |
| `git commit` | mesaj bir AI imzası taşıyor: bir AI tool'unun adını veren `Co-authored-by:` satırı, bir AI tool'unun adını veren `Generated with` ya da `Created by` satırı, `noreply@anthropic.com` ya da 🤖. Bir insan için yazılmış `Co-authored-by:` satırı geçer |
| `git commit` | subject boş, 72 karakterden uzun ya da noktayla bitiyor |
| `git commit` | repository conventional subject yazıyor (son 20 subject'in yarısından fazlası, en az 3 subject'ten) ve subject `type(scope): subject` biçiminde değil ya da type skill'in listesinde yok |
| `git commit`, `git push`, `git merge` | `-c core.hooksPath=...`; skill `--no-verify` ile açılmadan `HUSKY=0`, `HUSKY_SKIP_HOOKS`, `SKIP` ya da `LEFTHOOK=0` |
| `git push` | son prompt'unda `push` geçmiyor ve skill `--push` ile açılmadı; skill `--no-verify` ile açılmadan `--no-verify`. `--dry-run` geçer |
| `git switch`, `git branch <ad>`, `git branch -d/-m/-c`, `git checkout -b/-B/--orphan/--detach`, `git checkout <ad>` | son prompt'unda `branch`, `checkout` ya da `switch` geçmiyor. `--` taşıyan, iki ya da daha fazla operand alan ya da tek operand'ı var olan bir path olan `git checkout` dosya geri yükler ve geçer |
| `git config` | bir ayar yazıyor; `--get`, `--list` ve öteki okumalar geçer |
| `git rebase` | `-i` |

Yumuşak kurallar (iki modda da not):

- Commit 100 satırdan fazlasını değiştiriyor.
- Commit birden fazla alana dokunuyor; alan path'in ilk iki parçasıdır (`plugins/a` ve `plugins/b`).
- Subject'in ilk kelimesi `-ed` ya da `-ing` ile bitiyor (`added`, `adding`).
- Subject'in `type(scope): ` sonrasındaki harf durumu son subject'lerinkinden farklı.
- `git add` untracked dosyaları stage ediyor; not onları adıyla yazar.
- Mod mesajı okuyamadı (shell mesajı çalışma anında kuruyor, mesaj başka bir commit'ten geliyor ya da git bir editör açıyor) ya da commit'in neyi taşıdığını ölçemedi (`cd -`, `cd ~` ya da `$` taşıyan bir path'e `cd` sonrasında, ya da git komutun staging'ini yeniden oynatamadığında).

`git commit --dry-run`, `--short`, `--porcelain`, `--long` ya da `--help` hiçbir şey kaydetmez ve okunmaz.

## Komut

    /git-commit                   açık mı kapalı mı, ve mod
    /git-commit on | off          varsayılan açık; off engine'e commit attribution metnini de geri verir
    /git-commit mode deny         kesin bir kuralı çiğneyen komut durur; varsayılan budur
    /git-commit mode note         her komut çalışır, model çiğnenen kuralları sonradan okur

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install git-commit@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlat.
2. Skill'le commit atmak için `/git-commit:commit` yaz. `/commit` bir plugin skill'ini açmaz.
3. Kendine ait bir commit skill'in varsa (`~/.claude/skills/commit`), onu kaldır. Mod yalnız `git-commit:commit`'i skill sayar; kendi skill'inden sonra atılan commit durur ve model aynı şeyi söyleyen iki skill okur.
4. `CLAUDE.md` dosyan modele commit'i bir skill üzerinden atmasını söylüyorsa, orada skill'in adını `git-commit:commit` yap.

## Nereye uzanır

Claude Code 2.1.284 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.ts hooks: session.start, command.run{command=git-commit}, turn.start, prompt.submit, tool.call{tool=Skill}, skill.prompt{skill=git-commit:commit}, attribution.text{kind=commit}, tool.call{tool=Bash}, turn.complete
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via directoryFindings, judgeCheckout, scratchIndex), $.fs.read (via messageCheck), $.fs.stat (via directoryFindings), $.process.run (via dropTemps, git, scratchIndex), $.session.cwd (via judge, repoBlock), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via dropTemps, toPerson)

Reach L2: git, `cp` ve `rm` çalıştırır.

    1. Okur:     git geçen her Bash çağrısının komut metnini; prompt'larını, sonuncusunu bellekte tutar; Skill tool'unun argümanlarını; bir -F mesaj dosyasını; repository'yi git üzerinden
    2. Çalıştırır: LC_ALL=C ile git: rev-parse, status, log -20, diff --cached, check-ignore, ls-files, ayrıca GIT_INDEX_FILE ile geçici bir index'e read-tree, add ve rm --cached; index'i kopyalamak için cp; geçici index dosyalarını silmek için rm -f
    3. Gönderir: modele bir deny metni ya da not, skill metninin sonuna bir repository durum bloğu, sana bir sidebar kaydı ya da transcript satırı, engine'e boş bir commit attribution metni; makineden hiçbir şey çıkmaz
    4. Saklar:   $.store içinde on/off ayarını ve modu; tek bir komut süresince .git/index'in yanında geçici index dosyalarını
    5. Düşman girdi: komut metni parse edilir, mod onu hiçbir zaman bir shell'de çalıştırmaz; komutun kendi git add argümanları geçici bir index'e argv olarak yeniden oynatılır; bir secret dosya, satır ve türüyle adlandırılır, değeriyle hiçbir zaman

## Sınırlar

- Gate Bash komut metnini okur. `sh -c`, bir script, bir `make` target'ı, bir git alias'ı, `git commit-tree` ya da bir MCP git tool'u üzerinden atılan commit okunmaz.
- Push ve branch kontrolü son prompt'unda bir kelime arar. "push etme" cümlesi push isteği gibi okunur.
- Shell'in komut çalışırken kurduğu bir mesaj (`$VAR`, backtick, `cat <<'EOF'` dışında bir `$(...)`) kontrol edilmez; model onun yerine bir not okur.
- Stil kuralları son 20 subject'e bakar. 3'ten az subject varsa ya da yarısından azı conventional ise yalnız uzunluk, nokta ve imza kuralları uygulanır.
- Secret kontrolü dosya adlarını ve eklenen satırları regular expression'larla eşleştirir. Başka biçimde bir key görülmez.
- Kip kontrolü ilk kelimenin dil bilgisine değil, sonuna bakar.
- `git merge` yalnız atlanan hook'lar için kontrol edilir.
- `deny` modunu aşmanın yolu yoktur. Kesin bir kural karşılanamıyorsa gate'i `/git-commit mode note` ile sen kapatırsın.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # /plugin-types çıktısı olan .claude/types/ gerekir
    make validate
    make test        # claude plugin test
