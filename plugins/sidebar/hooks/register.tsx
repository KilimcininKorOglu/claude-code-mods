import type { EngineInterface, Register } from 'claude-code'
import type { Sidebar, SidebarSection } from '../types/index.d.ts'
import { drawn, dropTurn, pushed, readSection, sectionId, type Board, type Drawn, type Kept, type Row, EMPTY_TEXT, MAX_BOARD_LINES } from './board.ts'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

const PANE_ID = 'sidebar'

const PANE_TITLE = 'Sidebar'

const OPEN_KEY = 'open'

const USAGE = 'expects nothing (open or close), on, off or status'

/**
 * The standing sections other mods wrote, the stream under them (newest first), the number that keeps
 * each stream entry's id its own, whether the pane is open, and the last button's answer.
 */
export type State = { board: Board; stream: Kept[]; written: number; open: boolean; message?: string }

function emptyState(): State {
  return { board: new Map(), stream: [], written: 0, open: false }
}

/** Takes down every section and stream entry, because a closed sidebar keeps nothing. */
function forget(state: State): void {
  state.board.clear()
  state.stream = []
  state.message = undefined
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Runs the slash command a button names, as the person would. */
async function pressButton($: EngineInterface, state: State, command: string, args: string | undefined): Promise<void> {
  try {
    const r = await $.command.run({ command, ...(args === undefined ? {} : { args }) })
    state.message = `/${command}: ${(r.text ?? 'ran').split('\n')[0] ?? 'ran'}`
  } catch (err) {
    state.message = `/${command} did not run: ${errorText(err)}`
  }
  $.ui.invalidate('ui.render')
}

async function openPane($: EngineInterface, state: State): Promise<void> {
  await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
  state.open = true
}

async function closePane($: EngineInterface, state: State): Promise<void> {
  if ((await $.ui.panes()).some(p => p.id === PANE_ID)) await $.ui.close({ id: PANE_ID })
  state.open = false
  forget(state)
}

/** Turns the sidebar on or off and keeps the choice for the next session. */
async function setOpen($: EngineInterface, state: State, open: boolean): Promise<string> {
  await $.store.set(OPEN_KEY, open)
  if (open) {
    await openPane($, state)
    return 'on: the sidebar is open and every mod may write into it'
  }
  await closePane($, state)
  return 'off: the sidebar is closed and each mod shows its own lines again'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') return setOpen($, state, word === 'on')
  if (word === 'status') return state.open ? `on, ${state.board.size} section(s), ${state.stream.length} in the stream` : 'off'
  return word === '' ? setOpen($, state, !state.open) : USAGE
}

/**
 * The `$.sidebar` noun: what every other mod calls. A closed sidebar keeps nothing. `redraw` is the
 * engine call the `engine.create` hook closes over, because the validator refuses that engine as an
 * argument.
 */
export function createSidebar(redraw: () => void, now: () => Promise<number>, state: State): Sidebar {
  return {
    set: async (section: SidebarSection) => {
      if (!state.open) return false
      const kept = readSection(section)
      if (typeof kept === 'string') throw new Error(kept)
      // A stream entry never replaces another, so the same key twice reads as two entries of a log.
      // It also carries the time it was written, which its heading draws; a standing section does not,
      // because that one is rewritten at every measure and its time would say nothing.
      if (kept.until === 'stream') state.stream = pushed(state.stream, { ...kept, id: `${kept.id}#${++state.written}`, at: await now() })
      else state.board.set(kept.id, kept)
      redraw()
      return true
    },
    clear: async (input: { consumer: string; key: string }) => {
      const id = sectionId(input.consumer, input.key)
      const kept = state.stream.filter(s => !s.id.startsWith(`${id}#`))
      const dropped = kept.length < state.stream.length
      state.stream = kept
      if (state.board.delete(id) || dropped) redraw()
    },
    isOpen: async () => state.open,
  }
}

/** The colour of a line's tone; `dim` has none of its own and is drawn faint instead. */
function toneColor(tone: Row['tone']): string | undefined {
  return { ok: 'green', warn: 'yellow', error: 'red' }[tone as 'ok' | 'warn' | 'error']
}

function sectionTree(els: Elements, one: Drawn, press: (command: string, args?: string) => void, first: number) {
  const { Box, Button, Text } = els
  return (
    <Box key={one.id} flexDirection="column" marginBottom={1}>
      <Text bold>{one.head}</Text>
      {one.rows.map((row, i) => (
        <Text key={`${one.id}:${i}`} color={toneColor(row.tone)} dimColor={row.tone === 'dim'}>
          {row.text}
        </Text>
      ))}
      {one.buttons.map((b, i) => (
        // The label turns red under the pointer, because a button's own colour cannot be set.
        <Button key={`${one.id}:b${i}`} plain hover={{ color: 'red' }} {...(first + i < 9 ? { hotkey: String(first + i + 1) } : {})} label={`[ ${b.label} ]`} onPress={() => press(b.command, b.args)} />
      ))}
    </Box>
  )
}

function paneTree(els: Elements, state: State, columns: number, rows: number, press: (command: string, args?: string) => void) {
  const { Box, Text } = els
  const sections = drawn(state.board, state.stream, columns, rows)
  let buttons = 0
  return (
    <Box flexDirection="column">
      {sections.length === 0 ? <Text dimColor>{EMPTY_TEXT}</Text> : null}
      {sections.map(one => {
        const first = buttons
        buttons += one.buttons.length
        return sectionTree(els, one, press, first)
      })}
      {state.message === undefined ? null : <Text dimColor>{state.message}</Text>}
    </Box>
  )
}

export const register: Register = on => {
  const state: State = emptyState()

  on('engine.create', async (_, e, next) => {
    const below = await next(e)
    return { ...below, sidebar: createSidebar(() => below.ui.invalidate('ui.render'), () => below.clock.now(), state) }
  })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'sidebar', description: 'The shared sidebar pane every mod writes into: open or close it, on, off, status (sidebar)', argumentHint: '[on | off | status]' })
    if ((await $.store.get(OPEN_KEY)) === true) await openPane($, state)
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'sidebar' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    // The body's own rows are the stream's room; the button's answer takes the last one.
    const rows = (e.props.scroll.bodyRows || MAX_BOARD_LINES) - (state.message === undefined ? 0 : 1)
    return paneTree($.ui.resolve(e), state, e.props.bodyColumns, rows, (command, args) => void pressButton($, state, command, args))
  })

  // The person's close ends the session's sections; the stored choice follows, so it stays closed.
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE_ID) return next(e)
    const r = await next(e)
    state.open = false
    forget(state)
    if (e.origin.kind === 'person') await $.store.set(OPEN_KEY, false)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && dropTurn(state.board)) $.ui.invalidate('ui.render')
    return r
  })
}
