import type { EngineInterface, PromptOrigin, Register } from 'claude-code'
import { band, fit, listText, normalize, record, removeAt, type Counts } from './deck.ts'

const COUNTS_KEY = 'counts'
const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the band), list, remove <n>, clear, on or off'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

/** The counts as last read or written, so a band draw reads no store. */
type State = { counts: Counts; enabled: boolean }

/** The person's own prompts: typed at the terminal or sent from a phone. */
function isPersons(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

async function loadDeck($: EngineInterface, state: State): Promise<void> {
  state.counts = ((await $.store.get(COUNTS_KEY)) as Counts | undefined) ?? {}
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
}

async function saveCounts($: EngineInterface, state: State, counts: Counts): Promise<void> {
  await $.store.set(COUNTS_KEY, counts)
  state.counts = counts
  $.ui.invalidate('ui.render')
}

/** Counts one use, from the stored counts, so another session's uses are kept. */
async function countUse($: EngineInterface, state: State, text: string): Promise<void> {
  const stored = ((await $.store.get(COUNTS_KEY)) as Counts | undefined) ?? {}
  await saveCounts($, state, record(stored, text, await $.clock.now()))
}

/**
 * Sends a pressed prompt and counts the press here, because the engine passes the plugin's own
 * `$.prompt.submit` through every hook but this plugin's (measured on 2.1.278).
 */
async function sendPressed($: EngineInterface, state: State, text: string): Promise<void> {
  await countUse($, state, text)
  await $.prompt.submit({ text })
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  await $.store.set(ENABLED_KEY, on)
  state.enabled = on
  $.ui.invalidate('ui.render')
  return on ? 'on: prompts are counted and the band shows the top 5' : 'off: nothing is counted or drawn; the counts stay'
}

async function removeCommand($: EngineInterface, state: State, arg: string): Promise<string> {
  const rest = removeAt(state.counts, Number(arg))
  if (!/^\d+$/.test(arg) || rest === undefined) return `no prompt at ${arg || '?'}; /deck list names the numbers`
  await saveCounts($, state, rest)
  return `removed; ${Object.keys(rest).length} prompt(s) left`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  await loadDeck($, state)
  const [word = '', arg = ''] = args.trim().split(/\s+/)
  if (word === '' || word === 'list') return `${state.enabled ? 'on' : 'off'}\n${listText(state.counts)}`
  if (word === 'on' || word === 'off') return setEnabled($, state, word === 'on')
  if (word === 'remove') return removeCommand($, state, arg)
  if (word !== 'clear') return USAGE
  await saveCounts($, state, {})
  return 'cleared: no prompt is counted'
}

function bandTree(els: Elements, prompts: readonly string[], columns: number, onPick: (text: string) => void) {
  const { Box, Button } = els
  return (
    <Box flexDirection="row" gap={2}>
      {prompts.map((text, i) => (
        <Button key={`deck:${i + 1}`} plain dimColor hotkey={String(i + 1)} label={fit(text, prompts.length, columns)} onPress={() => onPick(text)} />
      ))}
    </Box>
  )
}

export const register: Register = on => {
  const state: State = { counts: {}, enabled: true }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'deck', description: 'Prompts you send often, on the keys 1-5: list, remove <n>, clear, on, off (prompt-deck)', argumentHint: '[list | remove <n> | clear | on | off]' })
    await loadDeck($, state)
    $.ui.invalidate('ui.render')
    return r
  })

  // The engine prints the plugin name in front of command text, so the texts do not repeat it.
  on('command.run', { command: 'deck' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('prompt.submit', async ($, e, next) => {
    const text = normalize(e.text)
    if (state.enabled && text !== undefined && isPersons(e.origin)) await countUse($, state, text)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const prompts = state.enabled ? band(state.counts) : []
    const p = e.props
    if (prompts.length === 0 || p.hasSurvey || p.isWorking || p.view.agentId !== undefined) return next(e)
    return bandTree($.ui.resolve(e), prompts, p.bodyColumns, text => void sendPressed($, state, text))
  })
}
