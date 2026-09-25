import type { EngineInterface, Register } from 'claude-code'
import type { Sidebar, SidebarSection } from '../types/index.d.ts'
import { clearLineOf, drawn, dropTurn, appendLog, isLogOf, logFileAt, logLineOf, projectOf, pushed, readLive, readLog, readSection, sectionId, tailText, type Board, type Drawn, type Kept, type Logged, type Row, EMPTY_TEXT, LOG_RESTORE, MAX_BOARD_LINES } from './board.ts'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

const PANE_ID = 'sidebar'

const PANE_TITLE = 'Sidebar'

const OPEN_KEY = 'open'

const USAGE = 'expects nothing (open or close), on, off, status or log'

/** Where the logs of every project live, under the person's own Claude directory, named after the mod. */
const LOG_DIR = '.claude/sidebar'

/**
 * The answer of the last button pressed: the command, and its first line of text, or the error of a
 * command that did not run.
 */
type Answer = { command: string; text: string; failed: boolean }

/**
 * The standing sections other mods wrote, the stream under them (newest first), the number that keeps
 * each stream entry's id its own, whether the pane is open, the last button's answer, and the log: the
 * directory of every project's logs and this project's name, read once at the session's start. The file
 * is picked by the day of each write, so a session that runs past midnight writes the new day's file, and
 * its lines are not held here: every write reads the file again, because another session writes it too.
 */
export type State = {
  board: Board
  stream: Kept[]
  written: number
  open: boolean
  message?: Answer
  dir: string
  project: string
}

function emptyState(): State {
  return { board: new Map(), stream: [], written: 0, open: false, dir: '', project: '' }
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
    state.message = { command, text: (r.text ?? 'ran').split('\n')[0] ?? 'ran', failed: false }
  } catch (err) {
    state.message = { command, text: errorText(err), failed: true }
  }
  $.ui.invalidate('ui.render')
}

async function openPane($: EngineInterface, state: State): Promise<void> {
  await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
  state.open = true
  // An open pane starts with what this project's log last held, because a closed sidebar keeps nothing.
  await restoreLog($, state)
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

/** Where this project's logs live, and the project's name, read before a Bash `cd` can move the directory. */
async function openLog($: EngineInterface, state: State): Promise<void> {
  const home = (await $.env.get('HOME')) ?? ''
  if (home === '') return
  state.dir = `${home}/${LOG_DIR}`
  state.project = projectOf(await $.session.cwd())
}

/** A file's text, or an empty string when it is missing or unreadable. */
async function readOrEmpty($: EngineInterface, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch {
    // The file is not written yet, or the person removed it.
    return ''
  }
}

/** This project's log files, newest day first. */
async function logFiles($: EngineInterface, state: State, project: string): Promise<string[]> {
  try {
    const names = (await $.fs.list(state.dir)).filter(e => e.kind === 'file' && isLogOf(project, e.name)).map(e => e.name)
    return names.sort().reverse()
  } catch {
    // No log directory yet.
    return []
  }
}

/**
 * Takes the newest entries of this project's log back into the stream, oldest first, each with the day
 * and time it was first written. An entry a later clear took down stays out, even when the clear sits in
 * a newer day's file. A restored entry is never written to the log again, because it is put into the
 * stream directly rather than through `$.sidebar.set`.
 */
async function restoreLog($: EngineInterface, state: State): Promise<void> {
  if (state.dir === '') return
  const project = state.project
  let text = ''
  let found: Logged[] = []
  for (const name of await logFiles($, state, project)) {
    text = `${await readOrEmpty($, `${state.dir}/${name}`)}\n${text}`
    found = readLive(text)
    if (found.length >= LOG_RESTORE) break
  }
  for (const one of found.slice(-LOG_RESTORE)) {
    const kept = readSection(one.section)
    if (typeof kept === 'string') continue
    state.stream = pushed(state.stream, { ...kept, id: `${kept.id}#${++state.written}`, at: one.at })
  }
  if (found.length > 0) $.ui.invalidate('ui.render')
}

/** The newest entries of this project's log of today, or why there is no log. */
async function logText($: EngineInterface, state: State): Promise<string> {
  const file = logFileAt(state.dir, state.project, await $.clock.now())
  return file === '' ? 'no log file: HOME was not read' : tailText(file, readLog(await readOrEmpty($, file)))
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') return setOpen($, state, word === 'on')
  if (word === 'log') return logText($, state)
  if (word === 'status') return state.open ? `on, ${state.board.size} section(s), ${state.stream.length} in the stream` : 'off'
  return word === '' ? setOpen($, state, !state.open) : USAGE
}

/**
 * The `$.sidebar` noun: what every other mod calls. A closed sidebar keeps nothing. `redraw` is the
 * engine call the `engine.create` hook closes over, because the validator refuses that engine as an
 * argument.
 */
export function createSidebar(redraw: () => void, now: () => Promise<number>, log: (line: string) => Promise<void>, state: State): Sidebar {
  return {
    set: async (section: SidebarSection) => {
      if (!state.open) return false
      const kept = readSection(section)
      if (typeof kept === 'string') throw new Error(kept)
      // A stream entry never replaces another, so the same key twice reads as two entries of a log.
      // It also carries the time it was written, which its heading draws; a standing section does not,
      // because that one is rewritten at every measure and its time would say nothing.
      if (kept.until === 'stream') {
        const entry = { ...kept, id: `${kept.id}#${++state.written}`, at: await now() }
        state.stream = pushed(state.stream, entry)
        await log(logLineOf(entry))
      } else state.board.set(kept.id, kept)
      redraw()
      return true
    },
    clear: async (input: { consumer: string; key: string }) => {
      const id = sectionId(input.consumer, input.key)
      const kept = state.stream.filter(s => !s.id.startsWith(`${id}#`))
      const dropped = kept.length < state.stream.length
      state.stream = kept
      // The log keeps the entries as history; this line keeps the next session from taking them back.
      if (dropped) await log(clearLineOf(input.consumer, input.key, await now()))
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
          {row.parts === undefined
            ? row.text
            : row.parts.map((part, j) => (
                <Text key={`${one.id}:${i}:${j}`} color={toneColor(part.tone)} dimColor={part.tone === 'dim'}>
                  {part.text}
                </Text>
              ))}
        </Text>
      ))}
      {one.buttons.map((b, i) => (
        // The label turns red under the pointer, because a button's own colour cannot be set.
        <Button key={`${one.id}:b${i}`} plain hover={{ color: 'red' }} {...(first + i < 9 ? { hotkey: String(first + i + 1) } : {})} label={`[ ${b.label} ]`} onPress={() => press(b.command, b.args)} />
      ))}
    </Box>
  )
}

/** The last button's answer, faint; `did not run` is red, so a failed press stands out from a run one. */
function answerTree(els: Elements, answer: Answer) {
  const { Text } = els
  if (!answer.failed) return <Text dimColor>{`/${answer.command}: ${answer.text}`}</Text>
  return (
    <Text>
      <Text dimColor>{`/${answer.command} `}</Text>
      <Text color="red">did not run</Text>
      <Text dimColor>{`: ${answer.text}`}</Text>
    </Text>
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
        if (one.divider === true) {
          return (
            <Box key={one.id} marginBottom={1}>
              <Text dimColor>{one.head}</Text>
            </Box>
          )
        }
        const first = buttons
        buttons += one.buttons.length
        return sectionTree(els, one, press, first)
      })}
      {state.message === undefined ? null : answerTree(els, state.message)}
    </Box>
  )
}

export const register: Register = on => {
  const state: State = emptyState()

  on('engine.create', async (_, e, next) => {
    const below = await next(e)
    /**
     * Writes one line to this project's log of today: a stream entry a later session takes back, or a
     * clear. The file is read again first, so the lines another session of the project wrote stay; a
     * file that is there and cannot be read is not written over.
     */
    const log = async (line: string): Promise<void> => {
      const file = logFileAt(state.dir, state.project, await below.clock.now())
      if (file === '') return
      try {
        // Each call is spelled at its own site, because the engine refuses a noun of $ passed as a value.
        const disk = {
          exists: (path: string) => below.fs.exists(path),
          read: async (path: string) => String(await below.fs.read(path)),
          write: (path: string, text: string) => below.fs.write(path, text),
        }
        await appendLog(disk, file, line)
      } catch {
        // The log is a convenience; a write that fails must not break the pane.
      }
    }
    return { ...below, sidebar: createSidebar(() => below.ui.invalidate('ui.render'), () => below.clock.now(), log, state) }
  })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'sidebar', description: 'The shared sidebar pane every mod writes into: open or close it, on, off, status, log (sidebar)', argumentHint: '[on | off | status | log]' })
    await openLog($, state)
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
