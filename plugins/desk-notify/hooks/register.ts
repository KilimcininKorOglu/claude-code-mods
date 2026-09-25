import type { EngineInterface, Register } from 'claude-code'
import { argvFor, askNotice, EVENTS, failNotice, planNotice, platformOf, projectNameOf, settingOf, statusText, stopNotice, USAGE, type Event, type Notice, type Platform } from './notice.ts'

/** A notification command that runs longer than this is killed, so a hung daemon holds nothing up. */
const NOTIFY_TIMEOUT_MS = 5_000

/**
 * The desktop found at the session's start, the project the notifications name, each event's setting,
 * and the last failure reported, so a failure that repeats is written once.
 */
type State = { platform?: Platform; project: string; on: Record<Event, boolean>; lastError?: string }

/** Writes a failure of the notification command once, until another failure replaces it. */
function reportOnce($: EngineInterface, state: State, text: string): void {
  if (state.lastError === text) return
  state.lastError = text
  $.ui.log(text)
}

/** Shows one notification without waiting on it; a command that fails or is missing says so once. */
async function send($: EngineInterface, state: State, n: Notice): Promise<void> {
  if (state.platform === undefined) return
  const argv = argvFor(state.platform, n)
  try {
    const r = await $.process.run(argv, { timeoutMs: NOTIFY_TIMEOUT_MS })
    if (r.exitCode === 0) state.lastError = undefined
    else reportOnce($, state, `${argv[0]} exited ${r.exitCode}: ${r.stderr.trim()}`)
  } catch (err) {
    reportOnce($, state, `${argv[0]} did not run: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Sends the notification of one event while that event is on; the hook that calls it does not wait. */
function notifyOn($: EngineInterface, state: State, event: Event, n: Notice): void {
  if (state.on[event]) void send($, state, n)
}

/** The stdout of a git command, or '' where git fails or is missing. */
async function gitOut($: EngineInterface, cwd: string, args: string[]): Promise<string> {
  try {
    const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 3_000 })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    // git is missing: the next way of naming the project answers.
    return ''
  }
}

/** The project name, read once at the start, so a shell `cd` later does not rename it. */
async function readProject($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  const commonDir = await gitOut($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const top = commonDir === '' ? '' : await gitOut($, cwd, ['rev-parse', '--show-toplevel'])
  return projectNameOf(commonDir, top, cwd)
}

/** The desktop this session runs on; `uname` is asked only where the Windows variable is absent. */
async function readPlatform($: EngineInterface): Promise<Platform | undefined> {
  const osVar = await $.env.get('OS')
  if (osVar === 'Windows_NT') return platformOf(osVar, undefined)
  try {
    const r = await $.process.run(['uname', '-s'], { timeoutMs: 3_000 })
    return platformOf(osVar, r.exitCode === 0 ? r.stdout : undefined)
  } catch {
    return undefined
  }
}

async function readSettings($: EngineInterface, state: State): Promise<void> {
  for (const ev of EVENTS) state.on[ev] = (await $.store.get(ev)) !== false
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  if (args.trim() === '' || args.trim() === 'status') return statusText(state.platform, state.on)
  const setting = settingOf(args)
  if (setting === undefined) return USAGE
  state.on[setting.event] = setting.on
  await $.store.set(setting.event, setting.on)
  return statusText(state.platform, state.on)
}

export const register: Register = on => {
  const state: State = { project: '', on: { ask: true, plan: true, stop: true } }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await readSettings($, state)
    state.platform = await readPlatform($)
    state.project = await readProject($)
    await $.command.register({
      name: 'desk-notify',
      description: 'Desktop notifications for a question, a plan and a turn end: status, ask|plan|stop on|off (desk-notify)',
      argumentHint: '[ask | plan | stop] [on | off]',
      immediate: true,
    })
    if (state.platform === undefined) $.ui.log('no notification command on this system; nothing is sent')
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'desk-notify' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // The tool call runs before its question or approval blocks on the person, which is when the notice helps.
  // RegExp literals, because a headless /plugin-types lists neither tool, so a string matcher does not type.
  on('tool.call', { tool: /^AskUserQuestion$/ }, async ($, e, next) => {
    notifyOn($, state, 'ask', askNotice(state.project))
    return next(e)
  })

  on('tool.call', { tool: /^ExitPlanMode$/ }, async ($, e, next) => {
    notifyOn($, state, 'plan', planNotice(state.project))
    return next(e)
  })

  // The main loop's end; a subagent's end is SubagentStop, so it never lands here.
  on('classic.Stop', async ($, e, next) => {
    notifyOn($, state, 'stop', stopNotice(state.project))
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    notifyOn($, state, 'stop', failNotice(state.project, e.error_details ?? e.error, e.last_assistant_message))
    return next(e)
  })
}
