/**
 * The relevance benchmark's synthetic project: a fictional logistics app with eight topics of five
 * memories each, written in English as `remember` asks, and prompts in five languages. No text comes
 * from a real project. Each topic's first two memories are the targets the prompts ask about; the
 * other three are close neighbours on the same subject, so a ranking must pick within a topic.
 */
import type { Anchor } from '../../hooks/shared/model.ts'

export type Note = { key: string; topic: string; text: string; anchors?: Anchor[] }

export const NOTES: readonly Note[] = [
  { key: 'p1', topic: 'payments', text: 'Refunds go through `RefundQueue` in `src/payments/refund.ts`; a refund over 500 EUR waits for a second approver before it is sent to the provider.', anchors: [{ type: 'file', path: 'src/payments/refund.ts' }] },
  { key: 'p2', topic: 'payments', text: 'The payment provider webhook is verified with the `X-Harbor-Signature` header; an unsigned webhook is answered 401 and logged.' },
  { key: 'p3', topic: 'payments', text: "Card payments use the provider's test mode on staging; the test card 4111 1111 1111 1111 always succeeds there." },
  { key: 'p4', topic: 'payments', text: 'Invoices are numbered per tenant and a number is never reused, even after the invoice is cancelled.' },
  { key: 'p5', topic: 'payments', text: 'Currency amounts are stored as integer minor units (cents), never as floating point.' },
  { key: 'a1', topic: 'auth', text: 'Access tokens live 15 minutes and refresh tokens 30 days; `TOKEN_TTL_SECONDS` in `src/auth/config.ts` sets the first.', anchors: [{ type: 'file', path: 'src/auth/config.ts' }] },
  { key: 'a2', topic: 'auth', text: 'A user may hold sessions on at most three devices; logging in on a fourth ends the oldest session.' },
  { key: 'a3', topic: 'auth', text: 'Passwords are hashed with argon2id; never log a password or its hash.' },
  { key: 'a4', topic: 'auth', text: 'SSH access to the servers is key-only; password login is disabled in sshd.' },
  { key: 'a5', topic: 'auth', text: 'Admin accounts must use two-factor authentication; the login page refuses an admin without it.' },
  { key: 'd1', topic: 'deploy', text: 'Production deploys run only from the main branch after the full test suite passes; `make deploy` refuses a dirty tree.', anchors: [{ type: 'command', command: 'make deploy' }] },
  { key: 'd2', topic: 'deploy', text: 'Database migrations run before the new containers start, and a failed migration stops the deploy without touching the old containers.' },
  { key: 'd3', topic: 'deploy', text: 'Staging is redeployed automatically every night at 02:00 UTC from main.' },
  { key: 'd4', topic: 'deploy', text: 'Docker images build from the slim Debian base, not Alpine, because the PDF renderer needs glibc.' },
  { key: 'd5', topic: 'deploy', text: 'A rollback redeploys the previous image tag; it never reverts database migrations.' },
  { key: 'c1', topic: 'cache', text: 'The route cache lives in Redis with a TTL of one hour; `CACHE_TTL` in `src/cache/redis.ts` changes it.', anchors: [{ type: 'file', path: 'src/cache/redis.ts' }] },
  { key: 'c2', topic: 'cache', text: 'After a price change the product cache is purged by tag, not flushed whole, because a full flush once overloaded the database.' },
  { key: 'c3', topic: 'cache', text: 'Images are served through the CDN with immutable cache headers and a content hash in the file name.' },
  { key: 'c4', topic: 'cache', text: 'Session data is never cached in the CDN; responses with a session cookie carry `Cache-Control: private`.' },
  { key: 'c5', topic: 'cache', text: 'The search results cache is per user and expires after five minutes.' },
  { key: 's1', topic: 'search', text: 'Search needs at least three typed characters before it queries; shorter input shows the recent searches instead.' },
  { key: 's2', topic: 'search', text: 'The search index is rebuilt every Sunday at 03:00; `reindex.ts` can rebuild one tenant on demand.', anchors: [{ type: 'file', path: 'src/search/reindex.ts' }] },
  { key: 's3', topic: 'search', text: 'Search ranks exact SKU matches above name matches.' },
  { key: 's4', topic: 'search', text: 'Stop words are not removed from the search index, because product names contain them.' },
  { key: 's5', topic: 'search', text: 'Search queries are logged without the user id, for privacy.' },
  { key: 'e1', topic: 'email', text: "Notification emails leave the queue at most 100 per minute to stay under the provider's rate limit." },
  { key: 'e2', topic: 'email', text: 'Every email template exists in English and German; a missing translation falls back to English, never to an empty mail.' },
  { key: 'e3', topic: 'email', text: 'Bounce webhooks mark an address undeliverable after three hard bounces.' },
  { key: 'e4', topic: 'email', text: "Push notifications are not sent between 22:00 and 07:00 in the user's time zone." },
  { key: 'e5', topic: 'email', text: 'Marketing emails need an explicit opt-in; transactional emails do not.' },
  { key: 'l1', topic: 'logging', text: 'Application logs are kept for 90 days and then deleted automatically.' },
  { key: 'l2', topic: 'logging', text: 'An alert fires when disk usage on a server passes 85 percent.' },
  { key: 'l3', topic: 'logging', text: 'Every exception is logged with its request id, so a support ticket can quote it.' },
  { key: 'l4', topic: 'logging', text: 'Health checks answer on `/healthz` without authentication and never touch the database.' },
  { key: 'l5', topic: 'logging', text: 'Log lines are JSON, one object per line, with the time in UTC.' },
  { key: 'm1', topic: 'mobile', text: 'The Android app supports Android 10 and later; `minSdk` is 29 in `app/build.gradle`.', anchors: [{ type: 'file', path: 'app/build.gradle' }] },
  { key: 'm2', topic: 'mobile', text: 'The iOS app stores its tokens in the Keychain, never in UserDefaults.' },
  { key: 'm3', topic: 'mobile', text: 'Mobile builds are signed in CI; no developer machine holds the release key.' },
  { key: 'm4', topic: 'mobile', text: 'The app shows a forced update screen when the API answers 426.' },
  { key: 'm5', topic: 'mobile', text: 'Offline orders are queued on the device and sent when the network returns.' },
]

export const LANGUAGES = ['en', 'tr', 'de', 'ru', 'ja'] as const
export type Language = (typeof LANGUAGES)[number]

/** Values are chosen on these languages; ru and ja only accept them. */
export const CHOOSE: ReadonlySet<Language> = new Set(['en', 'tr', 'de'])

/** One question per target and language, worded without the target's own key terms where the language allows. */
export const QUESTIONS: Readonly<Record<string, Readonly<Record<Language, string>>>> = {
  p1: { en: 'Who has to sign off when a customer gets a big amount of money back?', tr: 'Müşteriye büyük bir para iadesi yapılırken kimin onayı gerekiyor?', de: 'Wer muss zustimmen, wenn ein Kunde viel Geld zurückbekommt?', ru: 'Кто должен одобрить, когда клиенту возвращают крупную сумму?', ja: '顧客に大きな金額を返金するとき、誰の承認が必要ですか？' },
  p2: { en: 'How do we check that a call from the card company really came from them?', tr: 'Ödeme sağlayıcısından gelen çağrının gerçekten onlardan geldiğini nasıl doğruluyoruz?', de: 'Wie prüfen wir, dass ein Aufruf vom Zahlungsanbieter echt ist?', ru: 'Как мы проверяем, что вызов от платёжного провайдера действительно от него?', ja: '決済会社からの呼び出しが本物かどうか、どうやって確認していますか？' },
  a1: { en: 'How long does the permission from a sign-in stay valid?', tr: 'Oturum açtıktan sonra erişim izni kaç dakika geçerli?', de: 'Wie lange gilt die Zugangsberechtigung nach der Anmeldung?', ru: 'Сколько времени действует доступ после входа в систему?', ja: 'ログイン後、アクセス権は何分有効ですか？' },
  a2: { en: 'Can one person be signed in on several phones and laptops at once?', tr: 'Bir kullanıcı aynı anda kaç cihazda oturum açabilir?', de: 'Auf wie vielen Geräten darf ein Nutzer gleichzeitig angemeldet sein?', ru: 'На скольких устройствах пользователь может быть одновременно авторизован?', ja: '1人のユーザーは同時にいくつの端末でログインできますか？' },
  d1: { en: 'What has to be true before we ship a new version to live customers?', tr: 'Canlı ortama yeni sürüm çıkmadan önce hangi koşullar sağlanmalı?', de: 'Was muss erfüllt sein, bevor eine neue Version live geht?', ru: 'Какие условия нужны, чтобы выпустить новую версию в боевую среду?', ja: '本番環境に新しいバージョンを出す前に、何が必要ですか？' },
  d2: { en: 'Do schema changes go out before or after the new app version, and what if one breaks?', tr: 'Veritabanı şema değişiklikleri yeni sürümden önce mi sonra mı uygulanıyor, biri hata verirse ne oluyor?', de: 'Werden Schemaänderungen vor oder nach der neuen Version eingespielt, und was passiert bei einem Fehler?', ru: 'Изменения схемы базы данных применяются до или после новой версии, и что будет при ошибке?', ja: 'データベースのスキーマ変更は新しいバージョンの前に適用されますか？失敗したらどうなりますか？' },
  c1: { en: 'How long are stored page responses kept before they are thrown away?', tr: 'Sayfa yanıtları ne kadar süre saklandıktan sonra siliniyor?', de: 'Wie lange werden zwischengespeicherte Seitenantworten aufbewahrt?', ru: 'Сколько времени хранятся сохранённые ответы страниц?', ja: 'ページの応答はどれくらいの時間保存されますか？' },
  c2: { en: 'When a product gets a new price, how do we make sure nobody sees the old one?', tr: 'Bir ürünün fiyatı değişince eski fiyatın görünmemesini nasıl sağlıyoruz?', de: 'Wie sorgen wir nach einer Preisänderung dafür, dass niemand den alten Preis sieht?', ru: 'Как после смены цены товара мы делаем так, чтобы никто не видел старую цену?', ja: '商品の価格が変わったとき、古い価格が表示されないようにするにはどうしていますか？' },
  s1: { en: 'Why does nothing come back when I type just one letter in the lookup box?', tr: 'Arama kutusuna tek harf yazınca neden sonuç gelmiyor?', de: 'Warum kommt nichts, wenn ich nur einen Buchstaben ins Suchfeld tippe?', ru: 'Почему ничего не находится, если ввести в поиск одну букву?', ja: '検索欄に1文字だけ入力すると、なぜ結果が出ないのですか？' },
  s2: { en: 'When is the product lookup data rebuilt, and can I rebuild it for one customer?', tr: 'Arama verisi ne zaman yeniden oluşturuluyor, tek bir müşteri için elle yapılabilir mi?', de: 'Wann wird der Suchindex neu aufgebaut, und geht das auch für einen einzelnen Mandanten?', ru: 'Когда перестраивается поисковый индекс и можно ли сделать это для одного клиента?', ja: '検索インデックスはいつ再構築されますか？1つのテナントだけ再構築できますか？' },
  e1: { en: 'How fast can we send out notification mails without getting blocked?', tr: 'Bildirim e-postalarını engellenmeden ne hızda gönderebiliriz?', de: 'Wie schnell dürfen wir Benachrichtigungsmails verschicken, ohne gesperrt zu werden?', ru: 'С какой скоростью можно отправлять письма-уведомления, чтобы нас не заблокировали?', ja: 'ブロックされずに通知メールをどれくらいの速さで送れますか？' },
  e2: { en: 'What does a user get if a mail template has no version in their language?', tr: 'Bir e-posta şablonunun kullanıcının dilinde çevirisi yoksa ne gönderiliyor?', de: 'Was bekommt ein Nutzer, wenn eine Mailvorlage in seiner Sprache fehlt?', ru: 'Что получит пользователь, если у шаблона письма нет перевода на его язык?', ja: 'メールのテンプレートにユーザーの言語版がない場合、何が送られますか？' },
  l1: { en: 'How long do we keep the records of what the application did?', tr: 'Uygulama logları kaç gün saklanıyor?', de: 'Wie lange bewahren wir die Anwendungsprotokolle auf?', ru: 'Сколько дней хранятся журналы приложения?', ja: 'アプリケーションのログは何日間保存されますか？' },
  l2: { en: 'When do we get warned that a machine is running out of storage?', tr: 'Bir sunucunun diski dolmaya başlayınca ne zaman uyarı geliyor?', de: 'Ab wann werden wir gewarnt, dass auf einem Server der Speicherplatz knapp wird?', ru: 'Когда приходит предупреждение, что на сервере заканчивается место на диске?', ja: 'サーバーのディスク容量が少なくなったとき、いつ警告が来ますか？' },
  m1: { en: 'What is the oldest phone system version our app still runs on for Google phones?', tr: 'Uygulama en eski hangi Android sürümünde çalışıyor?', de: 'Welche älteste Android-Version unterstützt die App noch?', ru: 'Какая самая старая версия Android поддерживается приложением?', ja: 'アプリが動作する最も古いAndroidのバージョンは何ですか？' },
  m2: { en: 'Where does the iPhone app keep the login secrets on the device?', tr: 'iPhone uygulaması giriş bilgilerini cihazda nerede saklıyor?', de: 'Wo speichert die iPhone-App die Anmeldedaten auf dem Gerät?', ru: 'Где приложение для iPhone хранит данные для входа на устройстве?', ja: 'iPhoneアプリはログイン情報を端末のどこに保存していますか？' },
}

/** Prompts that name an identifier the target memory holds, in English and Turkish. */
export const NAMED: ReadonlyArray<{ want: string; lang: Language; text: string }> = [
  { want: 'p2', lang: 'en', text: 'What happens when X-Harbor-Signature is missing?' },
  { want: 'p2', lang: 'tr', text: "X-Harbor-Signature header'ı yoksa ne oluyor?" },
  { want: 'a1', lang: 'en', text: 'Where is TOKEN_TTL_SECONDS set?' },
  { want: 'a1', lang: 'tr', text: 'TOKEN_TTL_SECONDS nerede ayarlanıyor?' },
  { want: 'c1', lang: 'en', text: 'What does CACHE_TTL control?' },
  { want: 'c1', lang: 'tr', text: 'CACHE_TTL neyi belirliyor?' },
  { want: 'd1', lang: 'en', text: 'When does make deploy refuse to run?' },
  { want: 'd1', lang: 'tr', text: 'make deploy ne zaman çalışmayı reddediyor?' },
  { want: 's2', lang: 'en', text: 'What does reindex.ts do?' },
  { want: 's2', lang: 'tr', text: 'reindex.ts ne işe yarıyor?' },
  { want: 'm1', lang: 'en', text: 'Why is minSdk 29?' },
  { want: 'm1', lang: 'tr', text: 'minSdk neden 29?' },
]

/**
 * A project name many memories hold, as a real store's own name sits in many of its notes: these
 * keys end their text with it, so a name that singles out nothing can be tested.
 */
export const SHARED_NAME = 'harbor-api'
export const SHARED_NAME_KEYS: ReadonlySet<string> = new Set(['p3', 'p4', 'p5', 'a3', 'a4', 'a5', 'd3', 'd4', 'd5'])

/** A second anchor on a file name another note's anchor also holds, under another path. */
export const EXTRA_ANCHORS: Readonly<Record<string, Anchor[]>> = { m3: [{ type: 'file', path: 'app/config.ts' }] }

/** Prompts with a name several memories hold: `want` is one of them, `also` the others the name points at. */
export const SHARED: ReadonlyArray<{ want: string | undefined; also: readonly string[]; text: string }> = [
  { want: undefined, also: [...SHARED_NAME_KEYS], text: `What does ${SHARED_NAME} do on staging?` },
  { want: 'a1', also: ['m3'], text: 'What is set in config.ts?' },
]

/** Questions in a store's own language whose words carry a suffix or stand inside a run of Japanese text. */
export const IN_LANGUAGE: ReadonlyArray<{ store: 'tr' | 'ja'; want: string; text: string }> = [
  { store: 'tr', want: 'l1', text: 'logların saklanma süresi ne kadar?' },
  { store: 'tr', want: 'a3', text: 'parolaları nasıl saklıyoruz?' },
  { store: 'tr', want: 'd2', text: 'migrationlar ne zaman çalışıyor?' },
  { store: 'ja', want: 'l1', text: 'ログは何日間保存しますか' },
  { store: 'ja', want: 'l2', text: 'ディスク使用率のアラートはいつですか' },
]

/** A pasted log excerpt; alone it is a prompt with no question, which wants no note. */
export const LOG_LINES = Array.from({ length: 40 }, (_, i) => `2026-11-16T10:${String(i).padStart(2, '0')}:00Z worker-${i % 4} processed batch ${i * 17} in ${100 + i}ms`).join('\n')

/** Long pasted prompts: a log excerpt with a question at its end. */
export const LONG: ReadonlyArray<{ want: string; text: string }> = [
  { want: 'a1', text: `${LOG_LINES}\nSessions drop after a quarter of an hour. Is TOKEN_TTL_SECONDS too low?` },
  { want: 'm1', text: `${LOG_LINES}\nThe crash reports come from old phones. Why is minSdk 29?` },
  { want: 'p1', text: `${LOG_LINES}\nBu log’a göre büyük iadeler bekliyor. Büyük bir para iadesi için kimin onayı gerekiyor?` },
]

/** Tasks a subagent starts with. */
export const SUBAGENT_TASKS: ReadonlyArray<{ want: string; text: string }> = [
  { want: 'p1', text: 'Investigate why refunds above the limit wait before they reach the provider, and report what decides it.' },
  { want: 'p2', text: 'Ödeme sağlayıcısından gelen webhook çağrılarının nasıl doğrulandığını incele ve rapor ver.' },
  { want: 'a1', text: 'Find where TOKEN_TTL_SECONDS is set and change it to 20 minutes.' },
  { want: 'l2', text: 'サーバーのディスクが一杯になったときの警告の条件を調べてください。' },
]

/** Questions about something the project's memories do not cover. */
export const UNRELATED: Readonly<Record<Language, readonly string[]>> = {
  en: ['What is a good recipe for lentil soup?', 'Who won the football match last night?', 'Will it rain in Berlin tomorrow?', 'Write a short poem about the sea.', 'When was the Roman Empire founded?', 'How do I teach my dog to sit?', 'What is the capital of Australia?', 'How many calories are in a banana?'],
  tr: ['Mercimek çorbası nasıl yapılır?', 'Dün akşamki maçı kim kazandı?', 'Yarın İstanbul’da yağmur yağacak mı?', 'Deniz hakkında kısa bir şiir yaz.', 'Osmanlı Devleti ne zaman kuruldu?', 'Köpeğime oturmayı nasıl öğretirim?', 'Avustralya’nın başkenti neresi?', 'Bir muzda kaç kalori var?'],
  de: ['Wie koche ich eine Linsensuppe?', 'Wer hat gestern das Fußballspiel gewonnen?', 'Regnet es morgen in Hamburg?', 'Schreib ein kurzes Gedicht über das Meer.', 'Wann wurde das Römische Reich gegründet?', 'Wie bringe ich meinem Hund Sitz bei?', 'Was ist die Hauptstadt von Australien?', 'Wie viele Kalorien hat eine Banane?'],
  ru: ['Как приготовить чечевичный суп?', 'Кто вчера выиграл футбольный матч?', 'Будет ли завтра дождь в Москве?', 'Напиши короткое стихотворение о море.', 'Когда была основана Римская империя?', 'Как научить собаку команде «сидеть»?', 'Какая столица у Австралии?', 'Сколько калорий в банане?'],
  ja: ['レンズ豆のスープの作り方を教えてください。', '昨夜のサッカーの試合はどちらが勝ちましたか？', '明日の大阪は雨が降りますか？', '海についての短い詩を書いてください。', 'ローマ帝国はいつ建国されましたか？', '犬にお座りを教えるにはどうすればいいですか？', 'オーストラリアの首都はどこですか？', 'バナナ1本は何カロリーですか？'],
}

/** Messages with no topic of their own, which no memory should answer. */
export const TOPICLESS: Readonly<Record<Language, readonly string[]>> = {
  en: ['continue', 'what happened?', 'why did you stop?', 'did it work?', 'do it', 'stop!', "I don't understand", 'check it again'],
  tr: ['devam et', 'ne oldu?', 'neden durdun?', 'çalıştı mı?', 'yap bunu', 'dur!', 'anlamadım', 'tekrar kontrol et'],
  de: ['mach weiter', 'was ist passiert?', 'warum hast du aufgehört?', 'hat es funktioniert?', 'mach es', 'stopp!', 'ich verstehe das nicht', 'prüf es noch einmal'],
  ru: ['продолжай', 'что случилось?', 'почему ты остановился?', 'получилось?', 'сделай это', 'стоп!', 'я не понимаю', 'проверь ещё раз'],
  ja: ['続けて', '何が起きたの？', 'なぜ止まったの？', 'うまくいった？', 'やって', '止まって！', 'わからない', 'もう一度確認して'],
}

/** File tool paths: those of an anchored target, and one no memory names. */
export const TOOL_PATHS: ReadonlyArray<{ path: string; want: string | undefined }> = [
  { path: 'src/payments/refund.ts', want: 'p1' },
  { path: 'src/auth/config.ts', want: 'a1' },
  { path: 'src/cache/redis.ts', want: 'c1' },
  { path: 'src/search/reindex.ts', want: 's2' },
  { path: 'app/build.gradle', want: 'm1' },
  { path: 'src/orders/cart.ts', want: undefined },
  // No memory is anchored here: only the meaning of the path's words can find s3.
  { path: 'src/search/sku-ranking.ts', want: 's3' },
]

/** The tags a consolidator gives a topic's memories, the same in every store language. */
export const TOPIC_TAGS: Readonly<Record<string, readonly string[]>> = {
  payments: ['payments', 'billing'],
  auth: ['auth', 'security'],
  deploy: ['deploy', 'release'],
  cache: ['cache', 'performance'],
  search: ['search'],
  email: ['email', 'notifications'],
  logging: ['logging', 'monitoring'],
  mobile: ['mobile'],
}

/**
 * Sentences put before a target's fact in the English store, so the fact a question asks about
 * stands in a later sentence of a long memory, as in a consolidated note.
 */
export const LONG_LEAD: Readonly<Record<string, string>> = {
  p1: 'The payments module was split out of the order service in the spring. Its jobs run in their own worker pool and report to the finance dashboard. ',
  d2: 'Deploys are driven by the release pipeline and post their progress to the team channel. Each step writes its duration to the build log. ',
  e2: 'Templates live in the mail service and are rendered with the same layout for every brand. Previews are available on staging for each template. ',
  l2: 'Monitoring runs on a separate host so that it survives an outage of the app servers. Dashboards show CPU, memory and request rates per service. ',
}

export type StoreLanguage = 'en' | 'tr' | 'ja'

/** The same memories written in Turkish and Japanese, for the stores where notes and questions share a language. */
export const TRANSLATED: Readonly<Record<Exclude<StoreLanguage, 'en'>, Readonly<Record<string, string>>>> = {
  tr: {
    p1: 'İadeler `src/payments/refund.ts` içindeki `RefundQueue` üzerinden geçer; 500 EUR üstündeki bir iade, sağlayıcıya gönderilmeden önce ikinci bir onaylayıcıyı bekler.',
    p2: 'Ödeme sağlayıcısının webhook çağrısı `X-Harbor-Signature` header ile doğrulanır; imzasız bir webhook 401 ile cevaplanır ve kaydedilir.',
    p3: 'Staging ortamında kart ödemeleri sağlayıcının test modunu kullanır; 4111 1111 1111 1111 test kartı orada her zaman başarılı olur.',
    p4: 'Faturalar her kiracı için ayrı numaralanır ve bir numara, fatura iptal edilse bile tekrar kullanılmaz.',
    p5: 'Para tutarları kayan noktalı sayı olarak değil, tam sayı alt birim (kuruş) olarak saklanır.',
    a1: 'Erişim token’ları 15 dakika, yenileme token’ları 30 gün yaşar; ilkini `src/auth/config.ts` içindeki `TOKEN_TTL_SECONDS` belirler.',
    a2: 'Bir kullanıcı en fazla üç cihazda oturum açabilir; dördüncü cihazda giriş yapınca en eski oturum kapanır.',
    a3: 'Parolalar argon2id ile hash’lenir; bir parola ya da hash’i asla log’a yazılmaz.',
    a4: 'Sunuculara SSH erişimi yalnız key ile yapılır; sshd’de parola ile giriş kapalıdır.',
    a5: 'Yönetici hesapları iki adımlı doğrulama kullanmak zorundadır; giriş sayfası bunu kullanmayan bir yöneticiyi reddeder.',
    d1: 'Canlı ortama deploy yalnız main dalından ve bütün testler geçtikten sonra yapılır; `make deploy` temiz olmayan bir çalışma ağacını reddeder.',
    d2: 'Veritabanı migration’ları yeni container’lar başlamadan önce çalışır; başarısız bir migration, eski container’lara dokunmadan deploy’u durdurur.',
    d3: 'Staging her gece 02:00 UTC’de main dalından otomatik olarak yeniden kurulur.',
    d4: 'Docker imajları Alpine’den değil, ince Debian tabanından derlenir, çünkü PDF oluşturucu glibc ister.',
    d5: 'Geri alma önceki imaj etiketini yeniden deploy eder; veritabanı migration’larını asla geri almaz.',
    c1: 'Rota cache’i Redis’te bir saatlik TTL ile tutulur; bunu `src/cache/redis.ts` içindeki `CACHE_TTL` değiştirir.',
    c2: 'Bir fiyat değişince ürün cache’i bütünüyle boşaltılmaz, etikete göre temizlenir, çünkü tam boşaltma bir kez veritabanını aşırı yükledi.',
    c3: 'Görseller CDN üzerinden değişmez cache header’larıyla ve dosya adında içerik hash’iyle sunulur.',
    c4: 'Oturum verisi CDN’de asla cache’lenmez; oturum cookie’si taşıyan yanıtlar `Cache-Control: private` taşır.',
    c5: 'Arama sonuçları cache’i kullanıcıya özeldir ve beş dakika sonra sona erer.',
    s1: 'Arama, sorgu atmadan önce en az üç yazılmış karakter ister; daha kısa girişte son aramalar gösterilir.',
    s2: 'Arama indeksi her pazar 03:00’te yeniden kurulur; `reindex.ts` tek bir kiracıyı istendiğinde yeniden kurabilir.',
    s3: 'Arama, tam SKU eşleşmelerini ad eşleşmelerinin üstüne koyar.',
    s4: 'Ürün adları bunları içerdiği için yaygın kelimeler arama indeksinden çıkarılmaz.',
    s5: 'Arama sorguları gizlilik için kullanıcı kimliği olmadan kaydedilir.',
    e1: 'Bildirim e-postaları, sağlayıcının hız sınırının altında kalmak için kuyruktan dakikada en fazla 100 adet çıkar.',
    e2: 'Her e-posta şablonu İngilizce ve Almanca vardır; eksik bir çeviri boş bir postaya değil, İngilizceye düşer.',
    e3: 'Geri dönen posta webhook’ları, üç kalıcı geri dönüşten sonra bir adresi teslim edilemez olarak işaretler.',
    e4: 'Anlık bildirimler kullanıcının saat diliminde 22:00 ile 07:00 arasında gönderilmez.',
    e5: 'Pazarlama e-postaları açık bir izin ister; işlem e-postaları istemez.',
    l1: 'Uygulama log’ları 90 gün saklanır ve sonra otomatik olarak silinir.',
    l2: 'Bir sunucuda disk kullanımı yüzde 85’i geçince bir alarm tetiklenir.',
    l3: 'Her istisna kendi istek kimliğiyle kaydedilir, böylece bir destek kaydı onu anabilir.',
    l4: 'Sağlık kontrolleri `/healthz` üzerinde kimlik doğrulamasız cevap verir ve veritabanına asla dokunmaz.',
    l5: 'Log satırları JSON’dur, her satırda bir nesne vardır ve zaman UTC’dir.',
    m1: 'Android uygulaması Android 10 ve sonrasını destekler; `app/build.gradle` içinde `minSdk` 29’dur.',
    m2: 'iOS uygulaması token’larını UserDefaults’ta değil, Keychain’de saklar.',
    m3: 'Mobil derlemeler CI’da imzalanır; hiçbir geliştirici makinesi yayın key’ini tutmaz.',
    m4: 'API 426 ile cevap verince uygulama zorunlu güncelleme ekranı gösterir.',
    m5: 'Çevrimdışı siparişler cihazda kuyruğa alınır ve ağ geri gelince gönderilir.',
  },
  ja: {
    p1: '返金は `src/payments/refund.ts` の `RefundQueue` を通ります。500 EUR を超える返金は、プロバイダーに送る前に2人目の承認者を待ちます。',
    p2: '決済プロバイダーの webhook は `X-Harbor-Signature` ヘッダーで検証します。署名のない webhook には 401 を返し、ログに残します。',
    p3: 'ステージングではカード決済にプロバイダーのテストモードを使います。テストカード 4111 1111 1111 1111 はそこで必ず成功します。',
    p4: '請求書の番号はテナントごとに振られ、請求書を取り消しても番号は再利用しません。',
    p5: '金額は浮動小数点ではなく、整数の最小単位（セント）で保存します。',
    a1: 'アクセストークンの有効期間は15分、リフレッシュトークンは30日です。前者は `src/auth/config.ts` の `TOKEN_TTL_SECONDS` で設定します。',
    a2: '1人のユーザーがセッションを持てる端末は最大3台です。4台目でログインすると最も古いセッションが終了します。',
    a3: 'パスワードは argon2id でハッシュ化します。パスワードやそのハッシュは決してログに出しません。',
    a4: 'サーバーへの SSH はキーのみで、sshd ではパスワードでのログインを無効にしています。',
    a5: '管理者アカウントは二要素認証が必須で、それがない管理者はログイン画面で拒否されます。',
    d1: '本番へのデプロイは main ブランチから、全テストが通った後にだけ行います。`make deploy` は未コミットの変更がある作業ツリーを拒否します。',
    d2: 'データベースのマイグレーションは新しいコンテナの起動前に実行し、失敗したマイグレーションは古いコンテナに触れずにデプロイを止めます。',
    d3: 'ステージングは毎晩 02:00 UTC に main から自動で再デプロイされます。',
    d4: 'PDF 生成に glibc が必要なため、Docker イメージは Alpine ではなく軽量な Debian ベースでビルドします。',
    d5: 'ロールバックは前のイメージタグを再デプロイするだけで、データベースのマイグレーションは元に戻しません。',
    c1: 'ルートキャッシュは Redis に TTL 1時間で保持します。`src/cache/redis.ts` の `CACHE_TTL` で変更します。',
    c2: '価格が変わったとき、商品キャッシュは全消去せずタグ単位で削除します。以前、全消去でデータベースが過負荷になったためです。',
    c3: '画像は CDN から不変のキャッシュヘッダーと、ファイル名に含めたコンテンツハッシュ付きで配信します。',
    c4: 'セッションデータは CDN にキャッシュしません。セッション cookie を持つ応答には `Cache-Control: private` を付けます。',
    c5: '検索結果のキャッシュはユーザーごとで、5分で期限切れになります。',
    s1: '検索は3文字以上入力されるまでクエリを送らず、それより短い入力では最近の検索を表示します。',
    s2: '検索インデックスは毎週日曜 03:00 に再構築します。`reindex.ts` で1つのテナントだけを随時再構築できます。',
    s3: '検索では SKU の完全一致を名前の一致より上位にします。',
    s4: '商品名に含まれるため、ストップワードは検索インデックスから除きません。',
    s5: '検索クエリはプライバシーのため、ユーザー ID なしで記録します。',
    e1: '通知メールはプロバイダーのレート制限を超えないよう、キューから1分あたり最大100通まで送信します。',
    e2: 'すべてのメールテンプレートに英語版とドイツ語版があり、翻訳がない場合は空のメールではなく英語版を送ります。',
    e3: 'バウンスの webhook は、ハードバウンスが3回あったアドレスを配信不能にします。',
    e4: 'プッシュ通知は、ユーザーのタイムゾーンで 22:00 から 07:00 の間は送りません。',
    e5: 'マーケティングメールには明示的な同意が必要ですが、取引メールには不要です。',
    l1: 'アプリケーションのログは90日間保存した後、自動で削除します。',
    l2: 'サーバーのディスク使用率が85パーセントを超えるとアラートが出ます。',
    l3: 'すべての例外はリクエスト ID と一緒に記録し、サポートのチケットで引用できるようにします。',
    l4: 'ヘルスチェックは `/healthz` で認証なしに応答し、データベースには一切触れません。',
    l5: 'ログは1行に1つの JSON オブジェクトで、時刻は UTC です。',
    m1: 'Android アプリは Android 10 以降に対応し、`app/build.gradle` の `minSdk` は 29 です。',
    m2: 'iOS アプリはトークンを UserDefaults ではなく Keychain に保存します。',
    m3: 'モバイルのビルドは CI で署名し、開発者のマシンはリリース用のキーを持ちません。',
    m4: 'API が 426 を返すと、アプリは強制アップデート画面を表示します。',
    m5: 'オフラインの注文は端末のキューに入れ、ネットワークが戻ったときに送信します。',
  },
}

/** Each topic's parts for filler memories: what a sibling note talks about, never a target's fact. */
const TOPIC_PARTS: Readonly<Record<string, { subjects: readonly string[]; facts: readonly string[] }>> = {
  payments: { subjects: ['The payout report', 'The tax export', 'The chargeback list', 'The settlement job'], facts: ['is generated every {d} at {h}:00', 'covers tenant group {n}', 'is kept in the finance bucket for {n} months', 'is checked by the finance team on {d}'] },
  auth: { subjects: ['The audit of role changes', 'The invite link', 'The API key rotation', 'The login rate limit'], facts: ['runs every {d} at {h}:00', 'applies to tenant group {n}', 'allows {n} attempts per hour', 'is reported to the security team on {d}'] },
  deploy: { subjects: ['The canary stage', 'The build cache', 'The release notes job', 'The preview environment'], facts: ['runs every {d} at {h}:00', 'keeps the last {n} builds', 'is created for branch group {n}', 'is cleaned up on {d}'] },
  cache: { subjects: ['The warm-up job', 'The edge rule', 'The fragment cache', 'The thumbnail cache'], facts: ['runs every {d} at {h}:00', 'covers region group {n}', 'holds at most {n} thousand entries', 'is reviewed on {d}'] },
  search: { subjects: ['The synonym list', 'The autocomplete feed', 'The facet counter', 'The typo dictionary'], facts: ['is refreshed every {d} at {h}:00', 'covers catalog group {n}', 'keeps the top {n} entries', 'is reviewed by the catalog team on {d}'] },
  email: { subjects: ['The digest mail', 'The receipt mail', 'The unsubscribe report', 'The domain warm-up'], facts: ['goes out every {d} at {h}:00', 'is sent to segment {n}', 'is capped at {n} thousand mails a day', 'is reviewed on {d}'] },
  logging: { subjects: ['The error budget report', 'The trace sampler', 'The uptime report', 'The slow query digest'], facts: ['is sent every {d} at {h}:00', 'covers service group {n}', 'samples {n} percent of requests', 'is reviewed on {d}'] },
  mobile: { subjects: ['The crash report digest', 'The beta channel', 'The screenshot test run', 'The store listing update'], facts: ['runs every {d} at {h}:00', 'covers device group {n}', 'keeps the last {n} builds', 'is published on {d}'] },
}
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Filler memories for the larger stores, seeded and spread over the eight topics: each states a
 * fact about some other part of a topic, so a larger store holds more near neighbours of every
 * target without a second right answer.
 */
export function filler(count: number, seed = 7): Note[] {
  // mulberry32 in 32-bit integer steps: a float multiply above 2^53 drops the low bits, and a
  // remainder of those then took 3 of 8 values, so the loop never found enough new texts.
  let state = seed >>> 0
  const next = (n: number): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) % n
  }
  const topics = Object.keys(TOPIC_PARTS)
  const seen = new Set<string>()
  const notes: Note[] = []
  for (let tries = 0; notes.length < count; tries++) {
    if (tries > count * 20) throw new Error(`filler found only ${notes.length} distinct memories of ${count}`)
    const topic = topics[next(topics.length)]!
    const parts = TOPIC_PARTS[topic]!
    const fact = parts.facts[next(parts.facts.length)]!.replace('{d}', DAYS[next(DAYS.length)]!).replace('{h}', String(next(24)).padStart(2, '0')).replace('{n}', String(next(97) + 2))
    const text = `${parts.subjects[next(parts.subjects.length)]} ${fact}.`
    if (seen.has(text)) continue
    seen.add(text)
    notes.push({ key: `f${notes.length}`, topic: `filler-${topic}`, text })
  }
  return notes
}
