import type { EngineInterface, PromptOrigin, Register } from 'claude-code'
import { BAND_SIZE, band, countsKey, fit, listText, mergeCounts, normalize, normalizePin, pinsKey, projectName, record, removeAt, type Counts } from './deck.ts'

/** The key the mod used before the counts were split per project. */
const LEGACY_KEY = 'counts'
const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the band), list, add <text>, remove <n>, clear, on or off'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

/** The deck of this project as last read or written, so a band draw reads no store. */
type State = { counts: Counts; pins: string[]; enabled: boolean; project: string }

/** The person's own prompts: typed at the terminal or sent from a phone. */
function isPersons(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

/** The project the session works in: the name of its git top level, else of its directory. */
async function resolveProject($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 10_000 })
  return projectName(r.exitCode === 0 ? r.stdout.trim() : cwd)
}

async function loadDeck($: EngineInterface, state: State): Promise<void> {
  state.counts = ((await $.store.get(countsKey(state.project))) as Counts | undefined) ?? {}
  state.pins = ((await $.store.get(pinsKey(state.project))) as string[] | undefined) ?? []
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
}

async function saveCounts($: EngineInterface, state: State, counts: Counts): Promise<void> {
  await $.store.set(countsKey(state.project), counts)
  state.counts = counts
  $.ui.invalidate('ui.render')
}

async function savePins($: EngineInterface, state: State, pins: string[]): Promise<void> {
  await $.store.set(pinsKey(state.project), pins)
  state.pins = pins
  $.ui.invalidate('ui.render')
}

/** `/prompt-deck add <text>`: pins a prompt of the person's own, drawn before the counted ones. */
async function addCommand($: EngineInterface, state: State, text: string): Promise<string> {
  const pin = normalizePin(text)
  if (pin === undefined) return 'add expects one line of text that does not start with /'
  if (state.pins.includes(pin)) return 'that prompt is already pinned'
  if (state.pins.length >= BAND_SIZE) return `the band holds ${BAND_SIZE} prompts and all of them are pinned; remove one first`
  await savePins($, state, [...state.pins, pin])
  return `pinned at ${state.pins.length} of ${BAND_SIZE}`
}

/**
 * Moves the counts of the one shared deck into this project, once. The first project that loads the mod
 * after the update takes them, because the mod cannot tell where each of them was typed.
 */
async function adoptLegacy($: EngineInterface, state: State): Promise<void> {
  const legacy = (await $.store.get(LEGACY_KEY)) as Counts | undefined
  if (legacy === undefined) return
  await saveCounts($, state, mergeCounts(state.counts, legacy))
  await $.store.delete(LEGACY_KEY)
  $.ui.log(`the shared deck of ${Object.keys(legacy).length} prompt(s) is now this project's (${state.project}); each project counts its own prompts from here on`)
}

/** Counts one use, from the stored counts, so another session of the same project is kept. */
async function countUse($: EngineInterface, state: State, text: string): Promise<void> {
  const stored = ((await $.store.get(countsKey(state.project))) as Counts | undefined) ?? {}
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
  const rest = removeAt(state.counts, state.pins, Number(arg))
  if (!/^\d+$/.test(arg) || rest === undefined) return `no prompt at ${arg || '?'}; /prompt-deck list names the numbers`
  if (rest.pins.length !== state.pins.length) await savePins($, state, rest.pins)
  await saveCounts($, state, rest.counts)
  return `removed; ${rest.pins.length + Object.keys(rest.counts).length} prompt(s) left`
}

async function clearCommand($: EngineInterface, state: State): Promise<string> {
  await savePins($, state, [])
  await saveCounts($, state, {})
  return 'cleared: no prompt is pinned or counted'
}

/** The `/prompt-deck` and `/prompt-deck list` answer: the setting, the project and every prompt of it. */
function statusText(state: State): string {
  return `${state.enabled ? 'on' : 'off'} · project ${state.project}\n${listText(state.counts, state.pins)}`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  await loadDeck($, state)
  const trimmed = args.trim()
  const [word = '', arg = ''] = trimmed.split(/\s+/)
  if (word === 'add') return addCommand($, state, trimmed.slice(word.length))
  if (word === 'remove') return removeCommand($, state, arg)
  if (word === 'clear') return clearCommand($, state)
  if (word === 'on' || word === 'off') return setEnabled($, state, word === 'on')
  return word === '' || word === 'list' ? statusText(state) : USAGE
}

function bandTree(els: Elements, prompts: readonly string[], columns: number, onPick: (text: string) => void) {
  const { Box, Button } = els
  return (
    <Box flexDirection="row" gap={2} marginTop={1}>
      {prompts.map((text, i) => (
        <Button key={`deck:${i + 1}`} plain dimColor hotkey={String(i + 1)} label={fit(text, prompts.length, columns)} onPress={() => onPick(text)} />
      ))}
    </Box>
  )
}

export const register: Register = on => {
  const state: State = { counts: {}, pins: [], enabled: true, project: '' }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'prompt-deck', description: 'Prompts you send often in this project, on the keys 1-5: list, add <text>, remove <n>, clear, on, off (prompt-deck)', argumentHint: '[list | add <text> | remove <n> | clear | on | off]' })
    state.project = await resolveProject($)
    await loadDeck($, state)
    await adoptLegacy($, state)
    $.ui.invalidate('ui.render')
    return r
  })

  // The engine prints the plugin name in front of command text, so the texts do not repeat it.
  on('command.run', { command: 'prompt-deck' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('prompt.submit', async ($, e, next) => {
    const text = normalize(e.text)
    if (state.enabled && text !== undefined && isPersons(e.origin)) await countUse($, state, text)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const prompts = state.enabled ? band(state.counts, state.pins) : []
    const p = e.props
    if (prompts.length === 0 || p.hasSurvey || p.isWorking || p.view.agentId !== undefined) return next(e)
    return bandTree($.ui.resolve(e), prompts, p.bodyColumns, text => void sendPressed($, state, text))
  })
}
