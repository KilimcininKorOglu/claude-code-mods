import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { DEFAULT_MINUTES, minutesOf, pickedLine, pickedNote, picksOf, statusText, USAGE, waitsLine, type Line, type Question } from './pick.ts'

const ENABLED_KEY = 'enabled'
const MINUTES_KEY = 'minutes'

/** Off until the person turns it on, and the wait in minutes. */
type State = { enabled: boolean; minutes: number }

/** What the person reads: an entry in the shared sidebar's stream while it is open, else one transcript line. */
async function toPerson($: EngineInterface, key: string, line: Line): Promise<void> {
  try {
    if (await $.sidebar.set({ consumer: 'ask-autopick', key, title: 'question answered for you', lines: [line], until: 'stream' })) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line.text)
}

/**
 * The person's answer, or the recommended options once the wait ran out. The dialog waits in `pending`; a
 * pick answers the call in its place, and the engine closes the dialog and settles `pending` as rejected
 * (measured on 2.1.282).
 */
async function answerOrPick($: EngineInterface, state: State, questions: Question[], answers: Record<string, string>, pending: Promise<ToolCallResult>): Promise<ToolCallResult> {
  const minutes = state.minutes
  let timer: { cancel: () => void } | undefined
  const expired = new Promise<'expired'>(resolve => {
    timer = $.clock.after(minutes * 60_000, () => resolve('expired'))
  })
  const first = await Promise.race([pending, expired])
  if (first !== 'expired') {
    timer?.cancel()
    return first
  }
  // The abandoned dialog settles on its own; its result is not the call's any more.
  pending.catch(() => undefined)
  await toPerson($, 'picked', pickedLine(minutes, answers))
  return { result: { questions, answers, annotations: {} }, context: [pickedNote(minutes)] } as never
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const arg = args.trim()
  if (arg === 'on' || arg === 'off') {
    state.enabled = arg === 'on'
    await $.store.set(ENABLED_KEY, state.enabled)
  } else if (arg !== '') {
    const minutes = minutesOf(arg)
    if (minutes === undefined) return USAGE
    state.minutes = minutes
    await $.store.set(MINUTES_KEY, minutes)
  }
  return statusText(state.enabled, state.minutes)
}

export const register: Register = on => {
  const state: State = { enabled: false, minutes: DEFAULT_MINUTES }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // Only a stored true turns the mod on, so a fresh install answers nothing for the person.
    state.enabled = (await $.store.get(ENABLED_KEY)) === true
    const stored = await $.store.get(MINUTES_KEY)
    state.minutes = typeof stored === 'number' && minutesOf(String(stored)) !== undefined ? stored : DEFAULT_MINUTES
    await $.command.register({
      name: 'ask-autopick',
      description: 'Pick the recommended option of a question left unanswered: status, on, off, <minutes> (ask-autopick)',
      argumentHint: '[on | off | <minutes>]',
      immediate: true,
    })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'ask-autopick' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // A RegExp literal, because a headless /plugin-types lists no AskUserQuestion, so a string matcher does not type.
  on('tool.call', { tool: /^AskUserQuestion$/ }, async ($, e, next) => {
    if (!state.enabled) return next(e)
    const questions = (e as unknown as { questions?: Question[] }).questions ?? []
    const answers = picksOf(questions)
    if (answers === undefined) {
      await toPerson($, 'waits', waitsLine(state.minutes))
      return next(e)
    }
    return answerOrPick($, state, questions, answers, next(e))
  })
}
