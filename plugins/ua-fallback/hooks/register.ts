import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { hasUserAgent, hostOf, isFetch, logText, noteText, sectionKey, sidebarLines, statusIn, statusText, urlOf } from './fetch.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/** The on/off setting and the hosts already reported, so one host speaks once per session. */
type State = { enabled: boolean; noted: Set<string> }

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line. The model's note is another channel and does not repeat this text.
 */
async function toPerson($: EngineInterface, url: string, status: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({
      consumer: 'ua-fallback',
      key: sectionKey(hostOf(url)),
      title: 'request filtered',
      lines: sidebarLines(url, status),
      until: 'stream',
    })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(logText(url, status))
}

/**
 * What a Bash call printed. An answered call carries its two streams in `result`; a call that exited
 * non-zero is an error result, whose `result` is the error text and never the tool's record, so its
 * output is read from `text`, the error as the model reads it.
 */
function outputOf(r: ToolCallResult<'Bash'>): string {
  if (r.isError === true) return r.text ?? (typeof r.result === 'string' ? r.result : '')
  const out = r.result as { stdout?: unknown; stderr?: unknown } | undefined
  const stdout = typeof out?.stdout === 'string' ? out.stdout : ''
  const stderr = typeof out?.stderr === 'string' ? out.stderr : ''
  return `${stdout}\n${stderr}`
}

/** Reads one finished fetch command and answers the model's note, if a bot filter refused it. */
async function measure($: EngineInterface, state: State, command: string, output: string): Promise<string | undefined> {
  if (!isFetch(command) || hasUserAgent(command)) return undefined
  const url = urlOf(command)
  if (url === undefined) return undefined
  const status = statusIn(output)
  if (status === undefined) return undefined
  const host = hostOf(url)
  if (state.noted.has(host)) return undefined
  state.noted.add(host)
  // The note goes to the model, the line to the person: neither reads the other's channel.
  await toPerson($, url, status)
  return noteText(url, status)
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const arg = args.trim()
  if (arg === 'on' || arg === 'off') {
    state.enabled = arg === 'on'
    await $.store.set(ENABLED_KEY, state.enabled)
    return state.enabled ? 'on: a filtered request brings the fallback User-Agent to the model' : 'off: requests are not read'
  }
  if (arg !== '' && arg !== 'status') return USAGE
  return statusText(state.enabled, [...state.noted])
}

export const register: Register = on => {
  const state: State = { enabled: true, noted: new Set() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    await $.command.register({
      name: 'ua-fallback',
      description: 'The fallback User-Agent after a curl or wget a filter refused: status, on, off (ua-fallback)',
      argumentHint: '[on | off]',
      immediate: true,
    })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'ua-fallback' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // A denied call fetched nothing. A failed one is still read, because `curl --fail` and `wget` exit
  // non-zero on a 403 and its status is exactly the finding. The note rides after the model's own error
  // text, which stays as it is.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (!state.enabled || r.deny !== undefined) return r
    const note = await measure($, state, e.command, outputOf(r))
    return note === undefined ? r : { ...r, context: [...(r.context ?? []), note] }
  })
}
