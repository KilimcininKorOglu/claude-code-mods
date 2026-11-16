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
]

const SERVICES = ['shipping', 'warehouse', 'label printing', 'route planning', 'driver app', 'customs', 'pallet tracking', 'returns desk', 'fleet', 'dock booking', 'carrier sync', 'tariff']
const ACTIONS = ['retries a failed call', 'batches its writes', 'keeps a local copy of', 'rejects an unknown', 'rounds every', 'sorts each list of', 'locks the row of', 'archives the old', 'checks the size of', 'compresses each']
const OBJECTS = ['parcel ids', 'pallet weights', 'route stops', 'driver shifts', 'customs codes', 'dock slots', 'carrier quotes', 'tariff tables', 'label files', 'fleet positions']
const DETAILS = ['before it alerts the night team', 'once per hour', 'in groups of 50', 'and writes a warning to the audit table', 'with a two second pause between tries', 'only on weekdays', 'and keeps the result for one day', 'unless the tenant opted out']

/**
 * Filler memories for the larger stores: seeded and generated from parts that share no fact with a
 * target, so they add size and near-topic noise without a second right answer.
 */
export function filler(count: number, seed = 7): Note[] {
  let state = seed
  const next = (n: number): number => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state % n
  }
  const seen = new Set<string>()
  const notes: Note[] = []
  while (notes.length < count) {
    const text = `The ${SERVICES[next(SERVICES.length)]} service ${ACTIONS[next(ACTIONS.length)]} ${OBJECTS[next(OBJECTS.length)]} ${DETAILS[next(DETAILS.length)]}; run ${next(900) + 100}.`
    if (seen.has(text)) continue
    seen.add(text)
    notes.push({ key: `f${notes.length}`, topic: 'filler', text })
  }
  return notes
}
