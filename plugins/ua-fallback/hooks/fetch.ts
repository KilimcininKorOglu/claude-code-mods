/** Which fetch command a bot filter refused, and what to retry it with. */

/** A fetch command this mod reads. */
const FETCH = /(^|[\s;&|(])(curl|wget)\b/

/** The command already carries a User-Agent of its own, so the advice is spent. */
const HAS_UA = /(\s-A\s|\s--user-agent[=\s]|\s-U\s|-H\s*['"]?User-Agent|--header[=\s]['"]?User-Agent)/i

/** The first http or https URL of the command. */
const URL_IN = /https?:\/\/[^\s'"<>|)]+/

/** The status of a filtered request, as a command's own output names it. */
const STATUS: readonly { when: RegExp; status: '403' | '429' }[] = [
  { when: /HTTP\/[\d.]+\s+403\b/, status: '403' },
  { when: /HTTP\/[\d.]+\s+429\b/, status: '429' },
  { when: /\b403 Forbidden\b/i, status: '403' },
  { when: /\b429 Too Many Requests\b/i, status: '429' },
  { when: /error\s*:?\s*403\b/i, status: '403' },
  { when: /error\s*:?\s*429\b/i, status: '429' },
  { when: /\bstatus(?: code)?[":\s=]+403\b/i, status: '403' },
  { when: /\bstatus(?: code)?[":\s=]+429\b/i, status: '429' },
  { when: /\bRate limit\b/i, status: '429' },
]

/** The browser User-Agent the note offers first, a current desktop Chrome on macOS. */
export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

/** The three agent User-Agents the note offers after the browser one. */
export const AGENT_UAS = 'OpenAI File Downloader, XaiImageApiFetch/1.0, Claude-User'

export function isFetch(command: string): boolean {
  return FETCH.test(command)
}

export function hasUserAgent(command: string): boolean {
  return HAS_UA.test(command)
}

/** The URL the command fetched, or undefined when it names none. */
export function urlOf(command: string): string | undefined {
  return URL_IN.exec(command)?.[0]
}

/** The host of a URL, which is what one finding is kept per. */
export function hostOf(url: string): string {
  return /^https?:\/\/([^/?#]+)/.exec(url)?.[1] ?? url
}

/** The status a bot filter answered with, or undefined when the output names none. */
export function statusIn(text: string): '403' | '429' | undefined {
  return STATUS.find(s => s.when.test(text))?.status
}

/**
 * The note the model reads: the retry to try, then the two limits of the retry. A success with another
 * User-Agent is not proof the resource works for ordinary clients, and a request sent to test an
 * application's own access control must keep its real client, or the test measures the wrong thing.
 */
export function noteText(url: string, status: string): string {
  return [
    `ua-fallback: ${hostOf(url)} answered ${status}, which is an automated-client filter, not a broken URL.`,
    `Retry the same request once with a browser User-Agent: -A '${BROWSER_UA}'.`,
    `If that is refused too, one of ${AGENT_UAS} may pass.`,
    'Do not do this while testing an application, an API, an auth flow or a client of your own: a changed User-Agent hides the access-control or compatibility problem you are measuring.',
    'A reply you get with another User-Agent is not proof the resource works for ordinary clients, and it is never a way around authentication or a permission.',
  ].join(' ')
}

/** The transcript line the person reads: the finding alone, without the instruction. The engine adds the mod name. */
export function logText(url: string, status: string): string {
  return `${hostOf(url)} answered ${status}; a browser User-Agent may pass`
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/**
 * The sidebar lines of one finding: the host and status, the status yellow for a rate limit and red for
 * a refusal, and the retry faint; the limit of the retry faint under it.
 */
export function sidebarLines(url: string, status: string): Line[] {
  return [
    partsLine([part(`${hostOf(url)} answered `, undefined), part(status, status === '429' ? 'warn' : 'error'), part('; a browser User-Agent may pass', 'dim')]),
    { text: 'not while testing your own app, auth flow or client', kind: 'dim' },
  ]
}

/** A sidebar section key: the subject cut to what the sidebar takes. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'fetch'
}

/** The `/ua-fallback` answer: the setting and the hosts this session was refused by. */
export function statusText(enabled: boolean, hosts: readonly string[]): string {
  const seen = hosts.length === 0 ? 'no filtered request yet' : `filtered: ${hosts.join(' · ')}`
  return `${enabled ? 'on' : 'off'} · ${seen}`
}
