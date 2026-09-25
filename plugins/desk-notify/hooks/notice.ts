/** Which desktop notification goes out for which moment of a session, and the command that shows it. */

/** The moments the mod can report; each is turned on and off on its own. */
export const EVENTS = ['ask', 'plan', 'stop'] as const
export type Event = (typeof EVENTS)[number]

/** The desktop the notification is shown on; each has its own command. */
export type Platform = 'darwin' | 'linux' | 'windows'

/** One notification: a title, a body and a small line under the title. */
export type Notice = { title: string; message: string; subtitle: string }

/** A failed turn names the first line of its error, cut to this many characters. */
export const SUMMARY_MAX_CHARS = 60

const SUBTITLE = 'Claude Code'

/** What each event is, as the status and the usage name it. */
const EVENT_TEXT: Record<Event, string> = {
  ask: 'a question waits for your answer',
  plan: 'a plan waits for your approval',
  stop: 'a turn ended or failed',
}

export const USAGE = 'expects nothing (the status), or ask, plan or stop followed by on or off'

/**
 * The platform `uname -s` names, with the Windows `OS` variable read first, because Windows has no uname.
 * Undefined for a system the mod has no notification command for.
 */
export function platformOf(osVar: string | undefined, uname: string | undefined): Platform | undefined {
  if (osVar === 'Windows_NT') return 'windows'
  const name = uname?.trim()
  if (name === 'Darwin') return 'darwin'
  if (name === 'Linux') return 'linux'
  return undefined
}

/** A string for an AppleScript double-quoted literal. */
export function escapeApplescript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** A string for a PowerShell single-quoted literal. */
export function escapePowershell(s: string): string {
  return s.replace(/'/g, "''")
}

function windowsScript(n: Notice): string {
  const title = escapePowershell(n.title)
  const body = escapePowershell(`${n.subtitle} - ${n.message}`)
  return (
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null; ' +
    '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); ' +
    "$t = $x.GetElementsByTagName('text'); " +
    `$t.Item(0).AppendChild($x.CreateTextNode('${title}')) > $null; ` +
    `$t.Item(1).AppendChild($x.CreateTextNode('${body}')) > $null; ` +
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')" +
    '.Show([Windows.UI.Notifications.ToastNotification]::new($x))'
  )
}

/**
 * The command that shows one notification and returns at once: `osascript` on macOS, `notify-send` on
 * Linux, which has no subtitle and takes it into the body, and a PowerShell toast on Windows, which never
 * waits on a click.
 */
export function argvFor(platform: Platform, n: Notice): string[] {
  if (platform === 'darwin') {
    return ['osascript', '-e', `display notification "${escapeApplescript(n.message)}" with title "${escapeApplescript(n.title)}" subtitle "${escapeApplescript(n.subtitle)}"`]
  }
  if (platform === 'linux') return ['notify-send', n.title, `${n.subtitle}\n${n.message}`]
  return ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', windowsScript(n)]
}

/** The first line of a text with its markdown marks taken off, cut to SUMMARY_MAX_CHARS; '' for none. */
export function summarize(text: unknown): string {
  if (typeof text !== 'string') return ''
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[#*\->| ]+/, '').trim().split(/\s+/).join(' ')
    if (line === '') continue
    return line.length > SUMMARY_MAX_CHARS ? `${line.slice(0, SUMMARY_MAX_CHARS - 1)}…` : line
  }
  return ''
}

/** The notification of a question the model put to the person. */
export function askNotice(project: string): Notice {
  return { title: 'Question awaiting your answer', message: project, subtitle: SUBTITLE }
}

/** The notification of a plan put up for approval. */
export function planNotice(project: string): Notice {
  return { title: 'Plan awaiting your approval', message: project, subtitle: SUBTITLE }
}

/** The notification of a turn that ended with an answer. */
export function stopNotice(project: string): Notice {
  return { title: 'Turn finished', message: project, subtitle: SUBTITLE }
}

/** The notification of a turn an API error ended: the error's first line, else the turn's last words. */
export function failNotice(project: string, error: unknown, lastMessage: unknown): Notice {
  const summary = summarize(error) || summarize(lastMessage)
  return { title: 'Turn failed', message: summary === '' ? project : `${project}: ${summary}`, subtitle: SUBTITLE }
}

/** The project name: the primary repository in a worktree too, else the git root, else the directory. */
export function projectNameOf(commonDir: string, top: string, cwd: string): string {
  const parts = commonDir.replace(/\/+$/, '').split('/')
  const last = parts.at(-1)
  if (last === '.git') return parts.at(-2) ?? cwd
  if (parts.at(-2) === 'worktrees' && parts.at(-3) === '.git') return parts.at(-4) ?? cwd
  return (top === '' ? cwd : top).replace(/\/+$/, '').split('/').at(-1) ?? cwd
}

/** The `/desk-notify` status: the platform and each event with its setting. */
export function statusText(platform: Platform | undefined, on: Record<Event, boolean>): string {
  const head = platform === undefined ? 'no notification command on this system; nothing is sent' : `notifications on ${platform}`
  return [head, ...EVENTS.map(ev => `${ev} ${on[ev] ? 'on' : 'off'}: ${EVENT_TEXT[ev]}`)].join('\n')
}

/** The event and setting a `/desk-notify <event> on|off` argument names, or undefined when it names none. */
export function settingOf(args: string): { event: Event; on: boolean } | undefined {
  const [word = '', value = '', ...rest] = args.trim().split(/\s+/)
  const event = EVENTS.find(ev => ev === word)
  if (event === undefined || rest.length > 0 || (value !== 'on' && value !== 'off')) return undefined
  return { event, on: value === 'on' }
}
