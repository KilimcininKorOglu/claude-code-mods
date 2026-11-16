# sage-memory

Her başlangıçta bütünüyle yüklenen bir memory dosyası context'i dolduracak kadar büyür; düzenlediğiniz dosyayla ilgili tek not da onun ortasında bir yerde durur. Bu mod proje ve global kayıtları paylaşılan yerel bir daemon üzerinden SQLite'ta tutar, modele dosya tool çağrılarına, prompt'lara ve subagent görevlerine uyan kayıtları verir ve her ana loop turn'ünden sonra yeni kayıtları bir haiku consolidator ile kaydeder.

[memory-save](../memory-save) ile yan yana çalışır: memory-save session başında `MEMORY.md`'nin tamamını verir, sage-memory ise bir kaydı ilgili olduğu anda verir. Context'in zaten gösterdiği bir kayıt (`MEMORY.md`, `CLAUDE.md`, bir tool sonucu) yeniden verilmez.

## Ne yapar

1. **Bütün session'lar için tek daemon.** Session başında mod Node'u kontrol eder (22.18 ya da üstü, yerleşik TypeScript ve `node:sqlite` ile), sonra `node daemon/launch.ts`'i çalıştırır. Launcher `daemon/server.ts`'i ayrık başlatır ya da çalışanı bulur. Daemon bir Unix socket'i dinler, yalnız rastgele token'ını taşıyan isteğe cevap verir ve son isteğinden beş dakika sonra kapanır.
2. **İki depo.** `~/.claude/sage-memory/global.db` `user` kayıtlarını tutar. `~/.claude/sage-memory/<proje>/sage.db` bir repository'nin `project`, `session`, `file` ve `symbol` kayıtlarını tutar; linked worktree'ler aynı dosyayı paylaşır. Ad `<repository>-<git common dir'in 8 hex'i>` biçimindedir.
3. **Memory reminder'lar.** Bir reminder, modelin kayıtlı proje hafızası olarak okuduğu `<memory>` girdilerinden oluşan bir bloktur; system prompt'taki bir not bu bloğu tanıtır. Her girdi id'sini, kind'ını, scope'unu ve status'unu taşır; varsa önceliğini (importance 0.9'da `critical`, 0.75'te `high`), `permanent` persistence'ı, ilk anchor'ını (`about`) ve ilk üç tag'ini de taşır:
   - her dosya tool'unun sonucunda (Read, Grep, Glob, LSP, Edit, Write, NotebookEdit ve dosya adı taşıyan MCP tool'ları): o çağrının dokunduğu path'lere ya da onların üstündeki bir dizine bağlı ve devam eden görevlerle ilgili kayıtlar; context doldukça daha azı (%65'in altında 8, %82'ye kadar 3, %95'e kadar 1, üstünde hiç). Bloğun kalan yerine sığmayacak kadar uzun bir kayıt atlanır, ondan sonraki kısa kayıtlar yine gider. Önce dosyaya, içindeki bir symbol'e ya da erişim içindeki bir dizine bağlı kayıtlar gelir, sonra yalnız sorgunun bulduğu kayıtlar; her grup kendi içinde ilgi gücüne göre sıralanır, importance yalnız eşitlikte belirler. Model bunları o sonucun hemen ardından okur. Bir dosyanın iki kaydı (örneğin fonksiyon başına bir kayıt) ikisi de gider; paralel çağrıların ikisinin de bulduğu tek bir kayıt bunlardan biriyle gider. Bu yolla bulunan bir kayda `related` bağıyla bağlı kayıt da ortak bir anchor'ı olmasa bile gelir. Bir dizin, proje kökünün ne kadar altındaysa altındaki path'lere o kadar derine kadar hatırlatılır: `src`, `src/app.ts` için hatırlatılır ama `src/lib/db.ts` için hatırlatılmaz; `packages/api` ise iki seviye altına kadar hatırlatılır. Köke yakın bir dizin projenin çoğunu kapsar, bu yüzden onun kayıtları daha derindeki bir dosyaya yalnız sorgu ya da embeddings onları bulursa gelir; bu repository'de `plugins` dizinine bağlı 21 kayıt her mod'un her dosyasıyla geliyordu. Path sorguya proje köküne göre girer, bu yüzden kökün kendi kelimeleri (ev dizini, repository adı) hiçbir kayda uymaz;
   - yazdığınız bir prompt'la birlikte, ona uyan en fazla 8 kayıt; anlamı en yakın olan önce gelir. Embedding kuruluysa anlam karar verir: prompt'un bir kayıtla paylaştığı kelimeler, yalnız kaydın cosine değeri 0.40'ın üstündeyse sayılır. 0.40, alakasız bir sorunun İngilizce, Türkçe, Almanca, Rusça, Japonca ve Çincede ulaştığı en yüksek değerdir. Prompt'un adını verdiği bir dosya, symbol ya da komut tek başına sayılır. Importance yalnız 0.5'in altındaki kaydı durdurur. Embedding kurulu değilse ya da kaydın vektörü henüz doldurulmadıysa kanıt kelimelerdir ve skor geçidi kalır;
   - bir subagent'a, görevinin önünde: onun tipi ya da permission mode'u için yazılmış kayıtlar, sonra göreviyle ilgili kayıtlar.

   Bir `user` kaydı global bir kuraldır, bu yüzden ilgili olmayı beklemez: bütün aktif `user` kayıtları bir context'in ilk prompt'uyla, prompt ne sorarsa sorsun, sayı ve boyut sınırı olmadan gider; her subagent'ın görevinin önüne de konur. Compaction context'i yeniden başlatır, bu yüzden kayıtlar sonraki prompt'la ya da compaction turn'ün ortasında geldiyse ilk dosya tool'uyla yeniden gider. Bir context açıkken bu pencerede ya da başka bir pencerede yazılan veya yeniden yazılan bir kural, o context'in sonraki prompt'uyla tek başına gider; daemon cevabı o context için kaydettiklerinden verir, bu yüzden mod'un yeniden yüklenmesi context'in zaten aldığı kuralları yeniden göndermez. Tek bir audience için yazılmış ya da `never` policy'si verilmiş bir `user` kaydı kendi yolundan gider. Bir `project` kaydı yalnız ilgili olduğunda gider. Her kayıt bir context'te bir kez gider. Compaction yeni bir context başlatır, kayıt o zaman yeniden gidebilir. Hatırlatılan bir kaydı kullanan cevap bir kullanım sayılır. Global kurallar hiçbir kaydın hatırlatma sayısına eklenmez, çünkü context ne sorarsa sorsun giderler. Kullanımı sayılmamış bir hatırlatma hiçbir kaydın sırasını düşürmez ve inceleme açmaz, çünkü kullanım sayısı bir alt sınırdır (Sidebar bölümüne bakın).
4. **Öğrenme.** Prompt'unuz ya da bir tool çağrısı olan her ana loop turn'ünden sonra bir consolidator (varsayılan haiku) son consolidation'dan beri yazdıklarınızı (son 3 prompt'unuz), cevabı, turn'ün okuduğu ve yazdığı dosyaları, son 10 Bash komutunu ve tamamlanan görevleri okur, saklamaya değer olanı İngilizce ekler: bir karar ve gerekçesi, bir hatanın nedeni, bir sınır, açık kalan bir eksik, kalıcı bir tercih ya da yapılması gereken bir adım. Önce her adayı etiketler ve yalnız keep diye işaretlediklerini yazar; bu yüzden turn'ün yaptığı işin raporu, bir plan, bir durum satırı ya da kodun zaten gösterdiği bir bilgi kaydedilmez. Turn'ü en fazla 30 mevcut kayıtla karşılaştırır: turn'ün dokunduğu dosyalarla ilgili kayıtlar, turn'deki kelimelerin bulduğu kayıtlar, sonra iki deponun her birinden en ağır beş kayıt. Kelimeler 500 karakterlik parçalar hâlinde aranır; önce cevap aranır ve en fazla 4000 karaktere kadar gidilir. Yalnız ilk 500 karakteri arayan tek bir arama, 2196 karakterlik bir turn'ün sonunda yeniden söylenen kayıtlı bir kaydı bulamamıştı; consolidator da onun yanına ikinci bir kayıt yazmıştı. Bunlardan birini değiştiren bir bilgi o kaydın yerine geçer (`supersedes`); böylece bir konu, eskisinin yanına yeni bir kayıt eklenmeden tek kayıt olarak kalır. Bugün geçerli olup değişecek bir bilgi (bir sunucunun çalıştırdığı sürüm, çökmüş bir servis, bir düzeltme gelene kadarki geçici çözüm) durum olarak kaydedilir: `short_lived` olur ve bitmesi beklenen tarihi taşır; turn bir tarih vermediyse bu tarih bugünden 30 gün sonrasıdır. Her kayıt bilginin nereden geldiğini de söyler (`source`): siz, bir dosya, bir test, bir komut, bir tool sonucu ya da bir talimat dosyası. Evidence'ı 20 yola ulaşan bir turn, turn'ün sonunu beklemeden ortasında bir kez consolidate olur; turn sonu yine bütün turn'ü kapsar. Proje deposunda 20'den az kayıt olduğu sürece consolidator, temel prompt'un kodun gösterdiği bilgi sayarak düşürdüğü ilk tarama bilgisini de saklar (stack, dizin düzeni, tool'lar, konvansiyonlar); system note modeli bu tür olguları turn'ün ortasında kendisi kaydetmeye çağırır. Yeni bir kayıt kendi scope'undaki en fazla üç mevcut kaydı `related` olarak adlandırabilir: aynı karar, aynı hata ya da aynı kuralın başka bir yüzü; yalnız aynı dosya yetmez. SAGE'den farklı olarak her cevabın session özetini yazmaz: triage'ın gürültü olarak bulduğu kayıtların çoğu bu özetlerdi. Consolidator ayrıca son consolidation'dan beri ana loop'a ilgiye göre hatırlatılan kayıtları da okur (en fazla 20, global kurallar hariç) ve turn'ün hangilerine göre davrandığını söyler; kaydın ya da cevabın dili fark etmez. Şimdilik bu karar yalnız audit log'a gider (`memory.judged`) ve kullanım sayılmaz; önce gerçek turn'lerde ölçülecek. Dosya yazan bir turn'den sonra bir curator o dosyaların kayıtlarını turn'ün değiştirdiklerine göre gözden geçirir: değeri değişen bir kaydı yeniden yazar (15'ten 20'ye çıkan bir sınır gibi), turn'ün yanlış hâle getirdiği ya da gösterilen başka bir kaydın çeliştiği kaydı siler, birleştirir ya da böler, puanları yeniden ayarlar ve gösterilen kayıtlardan ikisini birbirine bağlar ya da bağı kaldırır. Bağ tek bir deponun içinde kalır; kayıtlardan biri silinince bağ da kalkar. Permanent bir kayıt da, importance değeri 0.9 ya da daha yüksek bir kayıt da hiçbir zaman yeniden yazılmaz ya da silinmez.
5. **Düzeltme.** Yanlış bir kayıt tutulmaz, silinir: artık doğru olmayan bir kayıt sonraki her session'ı yanıltmaya devam eder. System prompt notu modele, yanlış bulduğu bir kaydı hemen düzeltmesini söyler: güncel bilgiyi biliyorsa `update` ile, bilmiyorsa `delete` ile. Her düzeltme stream'de bir satırdır. Silinen bir kayıt `recover` ile geri alınabilir.
6. **Doğrulama.** Bir edit, değişen dosyaya bağlı kayıtları yeniden kontrol eder (path, content hash, symbol, komut, agent, git blob); anchor'ı artık tutmayan kayıt stale olur. Bir `mv`, `git mv` ya da `Move-Item` taşıma diskte gerçekleşince anchor'ları dosyayla birlikte taşır. Session sonunda daemon hygiene'i arka planda, depo başına saatte en fazla bir kez çalıştırır: doğrulama, metni birebir aynı kopyaların birleştirilmesi, vector'ü olmayan kayıtların embedding'inin çıkarılması, çelişkiler (bkz. Kopyalar ve çelişkiler), inceleme önerileri ve transcript'i silinmiş session'ların session kayıtlarının silinmesi.
7. **Arama.** Tam metin arama (FTS5) her zaman vardır; iki harfli bir kelime yalnız kendisiyle eşleşir, daha uzun bir kelime onunla başlayan kelimelerle de eşleşir. `/sage-memory setup`'tan sonra ayrıca çok dilli bir embedding modeli (`Xenova/paraphrase-multilingual-mpnet-base-v2`) offline çalışır; böylece bir soru başka dildeki bir kaydı bulabilir. Yalnız bu kanaldan gelen bir sonuç 0.55 cosine ister; bunun altında kalan bir yeniden ifade tam metin aramasına ve anchor'lara kalır (bu modelde ölçüldü: `deploy.sh betiği nerede` sorusu `Deploys go through the deploy.sh script...` kaydını 0.68 ile buldu, `gemini key'ini nereye yazayım?` kendi kaydına karşı 0.41'de kaldı).

## Kopyalar ve çelişkiler

Soru sorulmadan yalnız metni birebir aynı olan kayıt birleşir. Aynı scope, audience ve sahipteki canlı bir kayda yakın olan bir `remember` yazılmaz. Yakınlık kelimeyle (terimlerin çoğu ortak) ya da `/sage-memory setup`'tan sonra anlamla ölçülür: yeni metnin embedding'i, kayıtlı kaydın tüm metniyle ya da cümlelerinden biriyle 0.72 cosine'a ulaşır. Cevap bu kayıtlardan en fazla üçünü adıyla verir; yazan taraf ya bunlardan birini günceller ya da `distinct: true` ile (komutta `--distinct`) yeniden yazar. Hiçbir cosine tek başına birleştirmez, çünkü birbirinin tersi olan iki tercih ("Prefer tabs over spaces" ve "Prefer spaces over tabs") 0.96'ya ulaştı.

Consolidator tutulan bir kaydı kendi modeline sorarak çözer: kayıtlı kayıt yenisinin söylediği her şeyi zaten söylüyor mu? Söylüyorsa hiçbir şey yazılmaz. Yeni metin kayıtlı olanın söylediği her şeyi ve fazlasını söylüyorsa yazılır ve kayıtlı olanın yerine geçer; eski kayıt geri getirilebilir kalır. Kalıcı (`permanent`) ya da importance'ı 0.9 ve üstü olan bir kaydın yerine hiçbir zaman geçilmez; yeni metin onun yanına yazılır. Bunların dışında yeni kayıt ayrı bir kayıt olarak yazılır. Bir import, tutulan maddeyi hiçbir yere yazmaz ve raporunda adıyla verir.

İki ya da daha fazla cümlelik bir kayıt, tüm metninin vector'ünün yanında her cümlesi için ayrı bir vector tutar. Bunun nedeni şu ölçüm: tek bir bilgi, onu söyleyen uzun kaydın tamamına karşı yalnız 0,26 ile 0,70 arasında kaldı, o kaydın en yakın cümlesine karşı 0,49 ile 0,86 arasına çıktı (mpnet, 194 gerçek kayıt). Arama ve reminder'lar da tüm metnin ve cümlelerin en yükseğini kullanır.

Triage, embedding'in yakın bulduğu çiftleri (tüm metin ve cümleler üzerinden aynı 0.72 eşiği, aynı scope, audience ve sahip içinde) bir anchor'ı ya da üç tag'i ortak olan çiftlerle birlikte karşılaştırır. Yakın bir çiftte iki yönde de bir kaydın diğerini tamamen söyleyip söylemediğini sorar; tamamen söylenen kayıt diğerine karşı kaybeder. İkisi de diğerini tamamen söylemiyorsa ikisinin birlikte doğru olup olamayacağını sorar; cevap hayırsa yeni kayıt için kararı size bırakan bir inceleme açılır. Hygiene yalnız birebir aynı kopyaları birleştirir. Kelime kuralıyla (terimlerinin çoğu ortak iki metinde farklı sayılar ya da bir olumsuzluk) çelişki işaretlemesini yalnız embedding kurulu değilken yapar, çünkü gerçek bir depoda bu kural 59 yakın cümle çiftinin 40'ını işaretledi ve hiçbiri çelişki değildi.

## Kind'lar, ömürler ve kaynaklar

`remember` tool'u, consolidator ve `--kind` aynı 16 kind'ı anlamlarıyla birlikte sunar:

| Kind | Anlamı |
|---|---|
| `fact` | proje ya da ortamı hakkında kalıcı, doğrulanmış bir bilgi |
| `decision` | verilmiş bir karar ve gerekçesi |
| `convention` | bu projedeki her değişikliğin uyduğu bir standart |
| `preference` | kullanıcının bir işin nasıl yapılmasını istediği |
| `warning` | yanlış yapıldığında zarara ya da hataya yol açan şey |
| `anti_pattern` | başarısız olmuş ve tekrarlanmaması gereken bir yaklaşım, nedeniyle |
| `workflow` | tekrar eden bir işin sıralı adımları |
| `bug_root_cause` | bir hatanın doğrulanmış nedeni ve belirtisi |
| `file_note` | bir dosyanın ya da dizinin görevi veya sözleşmesi; file ya da directory anchor'ı ister |
| `symbol_note` | bir fonksiyonun, sınıfın ya da başka bir symbol'ün sözleşmesi; symbol anchor'ı ister |
| `command_note` | bir komutun ne yaptığı ya da neyi doğruladığı; command anchor'ı ister |
| `tool_outcome` | bir komutun başarılı çıktısının gösterdiği |
| `error_pattern` | bir hata mesajı ve bu projede ne anlama geldiği |
| `role_operational` | yalnız bir subagent tipinin bilmesi gereken bilgi; `audience.roles` ister |
| `security_signal` | bir güvenlik bulgusu: açığa çıkmış bir secret, güvensiz bir kalıp ya da açık bir risk |
| `fleet_convention` | çok ajanlı bir ekipteki her ajanın uyduğu bir kural |

`session_digest`, `summary` ve `task_outcome` kind'ları kaldırıldı, çünkü onları hiçbir şey yazmıyordu. Hâlâ böyle bir kayıt tutan bir depoyu daemon açarken bu kayıtları `fact` yapar.

Bir kayıt `permanent` (hiçbir otomatik geçişin silmediği bir değişmez), `long_lived` (varsayılan) ya da `short_lived` olur. `short_lived` bir kayıt bitiş tarihi (`expiresAt`) olan bir durumdur. Triage bir durumu bu tarihe kadar tutar, tarih geçince siler. Alanları birbirine uymayan bir kaydı daemon reddeder ve ret mesajında neyin değişmesi gerektiğini söyler. Reddedilen durumlar şunlardır: bitiş tarihi olmayan bir `short_lived` kayıt, kalıcı bir kayıtta bitiş tarihi, file anchor'ı olmayan bir `file` scope'u, symbol anchor'ı olmayan bir `symbol` scope'u, kendi anchor'ı olmayan bir `file_note`, `symbol_note` ya da `command_note`, ve `audience.roles` taşımayan bir `role_operational` kaydı.

`source` bir bilginin nereden geldiğini söyler: `user` (siz söylediniz), `file`, `test`, `command`, `tool_result` ya da `project_instruction` (`CLAUDE.md` ya da başka bir talimat dosyası). Modelin kendi çıkardığı bir bilginin kaynağı kendi `session`'ıdır. `importance` 0.3'ten (nadiren gerekir) 0.6'ya (varsayılan) ve 0.9 ve üstüne (çiğnenirse zarar verir) kadar gider; `confidence` 0.5'ten (çıkarım) 0.8'e (varsayılan) ve 1'e (kodda ya da çıktıda doğrulandı) kadar gider.

## Sidebar

[sidebar](../sidebar) açıkken mod orada tek bir `memory` section'ı tutar; section'daki `manage` tuşu pane'i açar:

    sage-memory: memory
    daemon ready · my-app
    embeddings off · /sage-memory setup
    this project: 2031 active · global: 12 active
    this session: reminded 4 · added 2 · used 1 · global rules 40
    [ manage ]

İlk satır daemon'un cevap verdiğini söyler ve projeyi adlandırır; ikinci satır embeddings modelini adlandırır, model başarısız olduysa sarıdır. Model kurulu ama henüz yüklenmemişse satırda `embeddings available` yazar: daemon modeli ilk aramada ya da ilk yazımda yükler, sonraki çizim model adını gösterir. Üçüncü satır bu projenin deposundaki ve global depodaki aktif kayıtları sayar; section her çizildiğinde sayılar daemon'dan okunur. Etkileşimli bir session 60 sn'de bir embeddings durumunu ve sayıları yeniden okur ve section'ı yeniden çizer; böylece başka bir pencerenin yüklediği model ve başka bir session'ın ya da projenin kaydettiği kayıt, bu session boştayken de görünür. Bu okuma bir istektir, bu yüzden etkileşimli bir session açık kaldıkça daemon kapanmaz. Global depo `user` kayıtlarını tutar ve bu kayıtlar her projede hatırlatılır; proje sayısı yeşil, global sayı mavidir. Dördüncü satır bu session'ın yaptıklarını sayar: ilgiye göre hatırlatılan kayıtlar, modelin ya da consolidator'ın ekledikleri, kullanılanlar ve context'lerine gönderilen global kurallar. Kurallar ayrı sayılır, çünkü context ne sorarsa sorsun giderler. Her sayı kendi renginde çizilir: reminded mavi, added yeşil, used sarı, rules soluk. Hatırlatılan bir kayıt bir kez kullanılmış sayılır: cevap id'sini anarsa; veya sonraki başarılı bir tool çağrısı anchor'ına dokunursa: dosyasının ya da dizinindeki bir dosyanın edit'i, ya da anchor'daki komutu (4 karakter veya daha uzun) içeren bir Bash komutu. Cevabın bir kayıtla paylaştığı kelimeler sayılmaz: bu kelimeler ikisinin yazıldığı dile bağlıdır ve bir kaydın yanlış olduğunu söyleyen cevap da onları paylaşır. Okuma sayılmaz, çünkü kayıtları getiren zaten dosyanın okunmasıdır. Sayı bir alt sınırdır: modelin id'sini anmadan ya da anchor'ına dokunmadan uyduğu bir kayıt sayılmaz.

Ana döngü turn'ünden sonraki işler sürerken mavi beşinci satır o anki işi adlandırır: consolidator'ın modeli cevap verirken `consolidating…`, tuttuklarını yazarken `saving 2 memories…`, curator turn'ün yazdığı dosyaların kayıtlarını denetlerken `curating 3 memories…`. İşler bitince satır kalkar.

Altındaki stream her reminder'ı soluk gösterir; yalnız `reminded` kelimesi mavidir. Bir kayıttaki her değişiklik de bir satırdır; değişikliği model, consolidator, curator ya da bir kontrol yapmış olabilir. Satırda yalnız ne olduğunu söyleyen kelime renklidir: eklenen yeşil, değişen sarı (güncellenen, birleştirilen, stale olan, taşınan), silinen kırmızı. Bir hata kırmızı bir satırdır; boş bir model yanıtı, o satır yazılmadan önce bir kez token bütçesi ikiye katlanarak denenir; çünkü thinking yapan bir job model bütün bütçeyi akıl yürütmeye harcayıp metin bırakmayabilir. Sidebar kapalıyken ilk satır status line'a, stream satırları transcript'e gider.

## Pane

`/sage-memory pane` ya da `manage` tuşu memory yöneticisini açar, ikinci kez çalıştırmak kapatır. Bir arama alanı, bir scope filtresi ve bir status filtresi vardır; kayıtlar 30'luk sayfalarla listelenir (`next`, `previous`). Bir satırda Enter kaydı tuşlarıyla gösterir: `mark stale`, `make active`, `archive`, `permanent`, `delete` (ikinci basış ister) ve silinmiş bir kayıt için `recover`. `candidates` bekleyen önerileri listeler: yeni bir kaydı accept ya da reject edebilir, bir incelemeyi `delete`, `archive` ya da `keep` ile çözebilirsiniz.

## Komut

    /sage-memory                          durum
    /sage-memory on | off                 mod'u her pencerede açar ya da kapatır
    /sage-memory setup                    embedding runtime'ını ve modelini kurar, her kaydı embed eder
    /sage-memory pane                     memory yöneticisi
    /sage-memory show <id> | search <sorgu> | file <yol> | graph <id|sorgu> | audit [n] | stats
    /sage-memory remember [flag'ler] <metin>  bir kayıt yazar; `--scope session` bu session'a aittir
    /sage-memory update <id> [flag'ler] [metin]  `--scope project|user` kaydı o depoya taşır
    /sage-memory delete <id> | forget <sorgu> | recover <id>
    /sage-memory audience remember --role <tip> <metin> | clear <id> | transfer <eski> <yeni>
    /sage-memory hygiene | verify [id] | candidates [list|accept|reject|resolve]
    /sage-memory triage [apply]           bütün kayıtların her değişikliği listeleyen incelemesi; `apply` olmadan kuru çalışır
    /sage-memory compact [apply]          kısaltma ve birleştirme önerisi; `apply` yazar
    /sage-memory import <yol> [--section <başlık>] [--kind <kind>] [--scope project|user] [--policy auto|never] [--tag <tag'ler>] [--importance <n>] [--confidence <n>]
    /sage-memory model [ad]               consolidator, curator, triage ve compact'ın modeli (haiku)
    /sage-memory remind tools|prompt|subagent [on|off]
    /sage-memory consolidate|curate [on|off]
    /sage-memory daily [on|off]           her proje için günde bir hygiene ve uygulanan bir triage, bir başlangıçtan bir saat sonra (açık)
    /sage-memory capture outcomes|errors [on|off]   Bash sonuçlarını kaydeder (kapalı)

Flag'ler: `--kind --scope --status --persistence --expires <ISO tarih> --policy --tag --anchor --directory --symbol path#Name --command --agent --role --mode --importance --confidence --freshness --supersedes --contradicts`; ayrıca yakın kayıtların tuttuğu bir kaydı yazmak için `--distinct` (değer almaz).

`triage` arka planda çalışır: komut hemen döner, modele aynı anda dört soru gider ve iş bitince rapor transcript'e yazılır. Raporda modelin cevapsız bıraktığı soruların sayısı ve her birinin nedeni de yer alır. Triage her kaydı kurallara, bir değer puanına ve modelin verdiği bir puana göre ayırır, sonra `apply`'ın yazacağı her şeyi listeler: gerekçesiyle her silme, her birleştirme, her puan değişikliği ve importance'ı 0.9 ya da üstü olan bir kayıt için bir inceleme; böyle bir kaydı hiçbir zaman silmez. Modelin 1 ya da 2 verdiği kayıt ve kuralların ya da puanın bulduğu döküntü (bir `wip:` notu, süresi dolmuş bir kayıt) silinir. SAGE bir cevabın kullandığı her kaydı da tutuyordu; bu kural kalktı, çünkü bir kaydın yanlış olduğunu söylemek için onu anan cevap da bir kullanım sayılıyor. Bir durum bitiş tarihine kadar tutulur, çünkü model geçici bir durumu döküntü diye puanlar. Önce embedding'in yakın bulduğu çiftleri içerme ve çelişki sorularıyla karşılaştırır (bkz. Kopyalar ve çelişkiler), sonra bir anchor'ı ya da üç tag'i ortak olan kayıtları birleştirme sorusuyla; böyle beşten fazla kayıtlı bir grupta yalnız metinleri en az yarı yarıya örtüşen çiftler sorulur. Günlük çalışma sınırlı sayıda kaydı puanlar ve hangilerini puanladığını kaydeder. Ertesi gün önce hiç puanlanmamış kayıtlarla, sonra en uzun süredir puanlanmamış olanlarla başlar; böylece her kayda sırayla ulaşılır.

`import` bir markdown dosyasının ya da bir başlığın altındaki bölümün her maddesini, kaynağı o dosya olan sıradan bir kayıt olarak yazar. Başka bir dosyada tutulan notları bir kez depoya taşır; içe alınan kayıtlar sonra diğerleri gibi ilgiye göre hatırlatılır. Başlığında "retired" geçen bir bölüm alt bölümleriyle birlikte atlanır. İçe alınan bir kayıt importance 0.8 ve confidence 0.9 ile başlar, çünkü elle tutulmuş bir kuraldır: `remember`'ın varsayılanlarıyla (0.6 ve 0.75) bir sorunun andığı içe alınmış not, prompt reminder eşiğinin hemen altında kaldı. Rapor daemon'un her maddeyle ne yaptığını sayar (eklendi, zaten vardı, yakın bir kayıt yüzünden tutuldu, reddedildi) ve tutulan ya da reddedilen her maddeyi adıyla yazar, çünkü ikisi de yazılmadı.

## memory-save'den import

`import` tek dosya alır ve session'ın başlatıldığı projenin deposuna yazar. Bir memory-save dizininin tamamını taşımak için projenin kök dizininde `claude`'u açın ve aşağıdaki prompt'u yapıştırın. Prompt, modelin slash komutu çalıştırmasını sağlayan `self-command` mod'unu ister. Model her turn'de bir import çalıştırır; her import'un çıktısı sonraki prompt olarak döner, böylece zincir son dosyaya kadar siz dokunmadan ilerler. Aynı prompt her projede değişmeden çalışır.

    sage-memory'ye bu projenin eski memory-save dosyalarını import et. Dizin: ~/.cli-tweaks/memory/<git root dizininin adı>/. Önce MEMORY.md, sonra dizindeki diğer bütün .md dosyaları, alfabetik sırayla. MEMORY.pre-migration.md, " 2.md" ile biten dosyaları ve .txt dosyalarını atla. Her dosya için mcp__self-command__run ile `sage-memory` komutunu `import "<tam path>"` argümanıyla çalıştır. Bir turn'de yalnız bir komut çalıştır ve turn'ü bitir. Çıktı sonraki prompt olarak geldiğinde bir sonraki dosyaya geç. Dizin yoksa ya da boşsa bunu söyle ve dur. Sonunda her dosyanın eklenen, zaten var olan, tutulan ve reddedilen sayılarını bir tablo olarak ver.

Her dosya bir turn sürer; 20 topic dosyalı bir proje 20 turn alır. Dizin adı `claude`'u açtığınız dizinden değil, git root'tan gelir. Bir memory-save dizininin adı repository'sinin adından farklıysa model dizinin olmadığını söyler ve durur; o durumda path'i prompt'a kendiniz yazın.

## Modelin çağırabildiği tool'lar

On beş tool, `mcp__sage-memory__<ad>`: `remember`, `search`, `search_explain`, `for_file`, `for_path`, `graph`, `gather`, `update`, `delete`, `forget`, `recover`, `backfill_recoverable`, `verify`, `hygiene`, `candidates`. `remember`, `search`, `for_file`, `update` ve `delete` hemen listelenir, diğerleri ToolSearch arkasında bekler. System prompt'taki plugin notu modele şunları söyler: daha fazlasına `search` ve `for_file` ile baksın, yanlış bir notu `update` ya da `delete` ile düzeltsin, kalıcı bir kuralı, kararı, uyarıyı ya da kök nedeni turn'ün bitmesini beklemeden `remember` ile hemen kaydetsin: repository ile ilgili bir bilgiyi `project` scope ve bir anchor ile, her projede geçerli bir tercihi `user` scope ile ve anchor olmadan. Not ayrıca scope'u kuralın gerekçesine göre seçmesini söyler, sizin ne kadar sert söylediğinize göre değil. Canlı bir kayda yakın bir `remember` yazmaz, o kaydı cevap olarak verir (bkz. Kopyalar ve çelişkiler). `scope` verilen `update` bir project kaydını aynı id ile user deposuna taşır ya da geri getirir; ayrıldığı depoda kopya kalmaz. `user`'a taşıma path anchor'larını düşürür; anchor'suz kalan bir `file_note` ya da `symbol_note` aynı çağrıda başka bir kind ister. Session kaydı taşınmaz. Şemasında olmayan bir alan taşıyan tool çağrısı, tool'un alanlarının listesiyle reddedilir; böylece yanlış bir çağrı başarılı görünmez. Hiçbiri onay sormaz: her biri yalnız mod'un kendi depolarına yazar. Bir session kaydı onu yazan session'a aittir.

## Kurulum

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sage-memory@kilimcininkoroglu-mods

Function hook'lar henüz early access aşamasında. Claude Code 2.1.288 ve üzerinde varsayılan olarak yüklenir, açılacak bir ayar yok.

## Kurulumdan sonra

1. Claude Code'u yeniden başlatın.
2. `PATH`'te `node` olarak Node.js 22.18 ya da üstü bulunmalı. Daha eski bir Node `daemon failed: needs Node.js 22.18 or later ...` gösterir ve mod başka hiçbir şey yapmaz.
3. İsteğe bağlı: embedding araması için `/sage-memory setup`'ı bir kez çalıştırın. `@huggingface/transformers` 4.3.0'ı `~/.claude/sage-memory/runtime` altına `npm install` ile kurar ve modeli indirir: diskte toplam 760 MB, bunun 289 MB'ı model (ölçüldü). Modeli yükleyen bir process 1,2 GB resident bellek tuttu (bir kez ölçüldü). Kurulmazsa arama yalnız tam metindir. Önceki bir setup'ın modeli `~/.claude/sage-memory/runtime/models/Xenova/` altında kalır; bir arama cevap verdikten sonra silinebilir.
4. İsteğe bağlı: bir markdown dosyasındaki notları `/sage-memory import` ile içe alın (Komut bölümüne bakın).
5. Bütün kayıtları silmek için hiçbir session çalışmıyorken `~/.claude/sage-memory`'yi silin.

## Nereye uzanır

Claude Code 2.1.325 üzerinde `claude plugin validate` ile doğrulandı:

    ❯ ./register.tsx hooks: session.start, tool.describe{tool=/"^mcp__sage-memory__"/}, tool.check{tool=/"^mcp__sage-memory__"/}, tool.call{tool=/"^mcp__sage-memory__"/}, prompt.section{name=env_info_simple}, classic.SessionStart, session.compact, prompt.context, prompt.attachment, classic.PostToolBatch, tool.call{tool=/"^(Read|Grep|Glob|LSP|Edit|Write|NotebookEdit|MultiEdit|mcp__(?!sage-memory__).+)$"/}, prompt.submit, agent.spawn, turn.complete, tool.call{tool=/"^(Edit|Write|NotebookEdit|MultiEdit)$"/}, tool.call{tool=Bash}, session.end, command.run{command=sage-memory}, ui.render{component=Pane} (default matcher key: plugin), ui.close, turn.start
    ❯ ./register.tsx calls: $.clock.after (via afterAnswer, noteBatch, scheduleDaily, triageCommand, within), $.clock.every, $.clock.now (via captureOutcome, consolidate, dailyRun, fileProposals, scheduleDaily, triageReport), $.command.register, $.env.get (via layoutFor), $.fs.read (via importCommand, launch), $.http.fetch (via send), $.model.complete (via answerOf, completeWithRetry, proposeCompact), $.process.run (via checkNode, git, launch), $.session.cwd, $.session.id (via afterCall, captureOutcome, consolidate, countUse, curate, globalRules, importCommand, newContext, promptRelated, record, remapMoved, rememberCommand, send, serveTool, subagentRanking, verifyChanged), $.session.usage (via budgetOf)
    ❯ ./register.tsx calls: $.sidebar.set (via toPerson, toStream), $.store.get (via afterCall, captureOutcome, consolidate, curate, dailyRun, isDailyOn, jobModel, onByDefault, promptRelated, readEnabled, scheduleDaily, subagentRanking, toggle, triageRun), $.store.set (via dailyRun, modelCommand, onByDefault, setEnabled, toggle, triageRun), $.tool.call (via taskList), $.tool.register (via declareTools), $.ui.close (via openPane), $.ui.invalidate (via paneHandlers, paneWork), $.ui.log (via pollSetup, toStream, triageJob), $.ui.open (via openPane), $.ui.panes (via openPane), $.ui.resolve, $.ui.status (via toPerson)
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: CLAUDE_CONFIG_DIR, HOME

Reach L3: uzun yaşayan yerel bir process başlatır, turn'leri bir modele gönderir, `/sage-memory setup`'ta paket ve model indirir.

    1. Okur:     session'ın cevaplarını, prompt'larını, subagent görevlerini ve dosya tool çağrılarını; bir kaydın bağlı olduğu dosyaları; bir turn'ün edit ettiği dosyaları, edit'lerin düştüğü fonksiyonları adlandırmak için; içe aldığınız markdown dosyasını; biten session'ları bulmak için transcript dizinini
    2. Çalıştırır: node (sürüm kontrolü, launcher, daemon), git rev-parse ve git hash-object, setup'ta npm install; hepsi argv ile, shell yok
    3. Gönderir: consolidate edilen her turn'ü, curate edilen dosya kümesini, triage ve compact isteklerini seçtiğiniz modele (varsayılan haiku); setup'ta npm registry'ye ve Hugging Face'e istekler; daemon yalnız ~/.claude/sage-memory içindeki bir Unix socket'i dinler
    4. Saklar:   kayıtları, graflarını, audit log'u ve reminder defterini ~/.claude/sage-memory altında SQLite'ta; ayarları mod'un $.store'unda
    5. Düşman girdi: bir kayıt, bir modelin ya da tool'un yazdığı metindir ve escape edilmiş bir <memory> fence'i içinde geri verilir; secret'a benzeyen bir metin yazılırken reddedilir; bir kayıt yalnız her isteğin token'ını kontrol eden daemon üzerinden değişir

## Ölçümler

**Tool reminder'ın yeri.** Claude Code 2.1.283'te (Sonnet 5), kayıt bir `/clear`'dan önce yazılmış ve prompt reminder kapalıyken, her biçim için 10 çalıştırma: bütün tool batch'inden sonra eklendiğinde model kaydı 4 kez şüpheli bir talimat ya da prompt injection saydı; dosya tool'unun kendi sonucuna bağlandığında 1 kez. Kaydın bilgisini iki biçimde de aynı sıklıkta kullandı (kaydın doğru olduğu senaryoda 5'te 4). 0.2.0 sürümü reminder'ı sonuca taşıdı.

Claude Code 2.1.283, macOS, Node 24.18 üzerinde: socket üzerinden bir daemon isteği 3 ile 9 ms sürdü (`/status` 7.0 ms, `/memory/remember` 9.3 ms, `/remind/prompt` 2.9 ile 3.7 ms, `/remind/tools` 3.5 ms); setup kurulumdan sonra 24 kaydı 19 s'de embed etti. Art arda çalışan bütün probe session'larına tek bir daemon hizmet verdi.

**Consolidator neyi saklıyor.** Gerçek session'lardan etiketlenmiş 17 turn, her biri haiku'ya 10 kez gönderildi: SAGE'in prompt'uyla kalıcı bilgi taşımayan 7 turn'ün (turn'ün yaptığı işin raporu, bir plan, bir durum satırı) her çalıştırması en az bir kayıt yazdı (70 çalıştırmanın 0'ı temiz), kalıcı bir bilgi taşıyan 10 turn'ün 100 çalıştırmasının 99'u o bilgiyi sakladı. 0.2.1'in aday etiketleriyle 70 çalıştırmanın 62'si temiz kaldı, 100 çalıştırmanın 97'si bilgiyi sakladı. Bir consolidation ortalama 2.482 girdi ve 438 çıktı token'ı harcadı; haiku fiyatıyla yaklaşık $0,005. Bu turn'lerden ikisinde, bir iş raporunda ve bir planda, Opus 5.5 SAGE'in prompt'uyla 10 çalıştırmanın 10'unda hiçbir şey yazmadı; bir çağrı $0,005 ile $0,012 arası tuttu.

**Yerine geçme ve tarihleme.** Elle yazılmış 9 turn haiku'ya 10'ar kez gönderildi. Consolidator'ın bir kaydın yerine geçebilmesinden ve bir durumu tarihleyebilmesinden önceki ve sonraki sonuçlar şöyle: mevcut bir kaydı değiştiren turn o kaydı 10 çalıştırmanın 10'unda `supersedes` ile andı (önce 0); bir durumu anlatan turn onu 10'da 10 kez bitiş tarihli `short_lived` kayıt olarak sakladı (önce 0). Rapor, plan ve durum turn'leri 30 çalıştırmanın 30'unda temiz kaldı; kısıt, hata nedeni, tercih ya da karar taşıyan turn'ler bilgiyi 40'ta 40 kez sakladı. İkisi de öncekiyle aynı.

**Vector floor, model değişiminde yeniden ölçüldü.** 2.174 gerçek kayıt, 15 hedefli ve 15 alakasız Türkçe soru üzerinde 0.46 floor'unda mpnet modeli 15 hedefli sorunun 11'ini kendi kaydıyla buldu, 1 alakasız soru orada bir kayıt buldu; yerini aldığı MiniLM modeli aynı floor'da alakasızların 4'ünü geçiriyordu. multilingual-e5 ailesi bu mutlak ölçekte hiç ayrışmıyor: alakasız soruların en iyi hit'leri 0,72-0,81 bandında, hedefli soruların kendi kayıt cosine'ları 0,76-0,86'da; model bu yüzden e5 değil mpnet.

**Cümleyle arama ve hatırlatma.** Arama ve hatırlatma bir kaydı, kaydın tüm metninin ve her cümlesinin en yüksek cosine değeriyle puanlar. 333 gerçek kayıt üzerinde ölçüldü: bir kaydın sonraki bir cümlesini soran 30, bir kaydın konusunu soran 20 ve alakasız 30 Türkçe soru. Yalnızca tüm metin vektörü, eski 0.46 floor'unda soruların 30'da 11'ini ve 20'de 11'ini kendi kaydıyla buldu; alakasız 30 sorunun 5'i bir kayıt buldu. Tüm metin ve cümlenin en yükseği, yeni 0.55 floor'unda 30'da 20'sini ve 20'de 15'ini buldu; alakasız sorulardan yalnızca 1'i bir kayıt buldu. Kendi kayıt 30 sorunun 20'sinde ve 20 sorunun 13'ünde ilk sırada geldi; tüm metin vektörüyle bu sayılar 30'da 4 ve 20'de 6'ydı.

**Kopya ve çelişki soruları.** Haiku ile, metinlerin tamamı üzerinde ölçüldü. Birleştirme sorusu, uzun bir kaydın tek cümlesinde geçen bir bilgiye 12 çiftin 11'inde OVERLAP dedi; consolidator bu yüzden onun yerine içerme sorusunu sorar. İçerme sorusu, yeni metnin bir bilgi eklediği, bir sayıyı değiştirdiği ya da tersini söylediği 36 çiftin 36'sında NO, yeni metnin uzun kayıt olduğu 18 çiftin 18'inde NO, uzun kaydın söylediği 36 bilginin 24'ünde YES dedi (her çift 3 kez). Kaçan 12 durumun 9'unda bilgi, kayıtta olmayan bir ayrıntı ekliyordu; kaçan bir bilgi ayrı bir kayıt olarak yazılır. Çelişki sorusu değiştirilmiş ya da tersine çevrilmiş 20 bilginin 20'sinde YES, birlikte doğru olabilen 122 yakın çiftin 109'unda NO dedi (her çift 2 kez).

## Sınırlar

- Yalnız macOS ve Linux: daemon bir Unix socket kullanır ve yaklaşık 100 byte'ı aşan bir socket path'i mod'u durdurur.
- Anchor'sız ve varsayılan puanlı bir kayıt nadiren hatırlatılır: reminder kapısı 0.65 puan ister.
- Embedding olmadan bir dildeki soru başka dildeki bir kaydı yalnız ortak terimlerle bulur.
- Model bir metnin ilk 512 token'ını okur; bu yüzden bundan uzun tek bir cümle yalnız başıyla ve kelimeleriyle bulunur.
- Bir olumsuzluk, olumsuzladığı cümleye karşı 0,49 ile 0,73 arasında kalır; bu yüzden olumsuzlanmış bir bilgi 0.72 eşiğinin altında kalıp soru sorulmadan yazılabilir.
- Claude Code'un LSP tool'unda rename yoktur; yeniden adlandırılan bir symbol anchor'ını taşımaz.

## Geliştirme

    make install     # eslint, typescript-eslint, typescript, @types/node
    make lint        # complexity sınırı 10; aşılırsa build kırılır
    make typecheck   # daemon (Node tipleri)
    make validate
    make test        # claude plugin test, sonra daemon için node --test
