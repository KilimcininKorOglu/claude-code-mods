import type { EngineInterface, PromptOrigin, Register } from 'claude-code'
import { BAND_SIZE, band, countsKey, fit, listText, mergeCounts, normalize, normalizePin, pinsKey, projectName, readsAsChain, record, removeAt, type Counts } from './deck.ts'

/** The key the mod used before the counts were split per project. */
const LEGACY_KEY = 'counts'
const ENABLED_KEY = 'enabled'

/** The mod's markdown command (`commands/send.md`), whose body is its arguments alone. */
const SEND_COMMAND = 'prompt-deck:send'

const USAGE = 'expects nothing (the band), list, add <text>, remove <n>, clear, on or off'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

/**
 * The deck of this project as last read or written, so a band draw reads no store; the project's name
 * the person reads, and its root path, which keys the store, so two checkouts of one name keep two decks.
 */
type State = { counts: Counts; pins: string[]; enabled: boolean; project: string; root: string }

/** The person's own prompts: typed at the terminal or sent from a phone. */
function isPersons(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

/** The root of the project the session works in: its git top level, else its directory. */
async function resolveRoot($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  try {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 10_000 })
    return r.exitCode === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : cwd
  } catch {
    // git is missing, or the command did not run: the session's directory is the project.
    return cwd
  }
}

async function loadDeck($: EngineInterface, state: State): Promise<void> {
  state.counts = ((await $.store.get(countsKey(state.root))) as Counts | undefined) ?? {}
  state.pins = ((await $.store.get(pinsKey(state.root))) as string[] | undefined) ?? []
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
}

async function saveCounts($: EngineInterface, state: State, counts: Counts): Promise<void> {
  await $.store.set(countsKey(state.root), counts)
  state.counts = counts
  $.ui.invalidate('ui.render')
}

async function savePins($: EngineInterface, state: State, pins: string[]): Promise<void> {
  await $.store.set(pinsKey(state.root), pins)
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

/**
 * Moves the deck kept under the project's name alone (up to 0.4) to the key of its root, once. The first
 * checkout of that name that loads the mod takes it, because the mod cannot tell which checkout it came
 * from; counts already under the root key are joined with it, and pins already there stay.
 */
async function adoptNamed($: EngineInterface, state: State): Promise<void> {
  const counts = (await $.store.get(countsKey(state.project))) as Counts | undefined
  const pins = (await $.store.get(pinsKey(state.project))) as string[] | undefined
  if (counts === undefined && pins === undefined) return
  if (counts !== undefined) await saveCounts($, state, mergeCounts(state.counts, counts))
  if (pins !== undefined && state.pins.length === 0) await savePins($, state, pins)
  await $.store.delete(countsKey(state.project))
  await $.store.delete(pinsKey(state.project))
  $.ui.log(`the deck of ${state.project} is now kept for ${state.root}; another checkout named ${state.project} starts its own`)
}

/** Counts one use, from the stored counts, so another session of the same project is kept. */
async function countUse($: EngineInterface, state: State, text: string): Promise<void> {
  const stored = ((await $.store.get(countsKey(state.root))) as Counts | undefined) ?? {}
  await saveCounts($, state, record(stored, text, await $.clock.now()))
}

/** A prompt the model reads inside a `The prompt-deck plugin sent a message:` frame. */
function submitPrompt($: EngineInterface, text: string): void {
  $.prompt.submit({ text }).catch((err: unknown) => $.ui.log(`the prompt was not sent: ${String(err)}`))
}

/**
 * Sends a prompt through the mod's own `send` command, so the model reads the text alone, as the person
 * would type it. The command runs from a timer, because the engine refuses `$.command.run` inside a hook
 * the turn waits on. A prompt that reads as a command chain, and a run the engine refuses, go out as a
 * plugin prompt instead.
 */
function sendPrompt($: EngineInterface, text: string): void {
  if (readsAsChain(text)) return submitPrompt($, text)
  $.clock.after(0, () => {
    $.command.run({ command: SEND_COMMAND, args: text }).catch((err: unknown) => {
      $.ui.log(`the send command did not run, the prompt goes out as a plugin prompt: ${String(err)}`)
      submitPrompt($, text)
    })
  })
}

/**
 * Sends a pressed prompt and counts the press here, because the engine passes the plugin's own
 * `$.command.run` through every hook but this plugin's (measured on 2.1.282).
 */
async function sendPressed($: EngineInterface, state: State, text: string): Promise<void> {
  await countUse($, state, text)
  sendPrompt($, text)
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
  const state: State = { counts: {}, pins: [], enabled: true, project: '', root: '' }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'prompt-deck', description: 'Prompts you send often in this project, on the keys 1-5: list, add <text>, remove <n>, clear, on, off (prompt-deck)', argumentHint: '[list | add <text> | remove <n> | clear | on | off]' })
    state.root = await resolveRoot($)
    state.project = projectName(state.root)
    await loadDeck($, state)
    await adoptNamed($, state)
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
