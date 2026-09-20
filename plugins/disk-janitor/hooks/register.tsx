import type { EngineInterface, PromptOrigin, Register } from 'claude-code'
import { baseName, classOfRule, ignoredDirs, nameRule, parseDu, sizeText, statusText, statusTone, type Class } from './classify.ts'
import { carriedSelection, deletedShort, listText, reportText, rowText, totalKb, type Outcome } from './report.ts'
import { MAX_FOUND, type Found, type Scan } from './scan.ts'

const PANE_ID = 'disk-janitor'

/** A new measurement starts at most this often after a turn. */
const SCAN_EVERY_MS = 10 * 60 * 1000

const USAGE = 'expects nothing (the pane), list, rescan, or delete <path>'

const BUSY = 'a measurement or a deletion is running; try again when it ends'

/** Only a person may delete: the prompt's Enter or the bridge, never a plugin or the model. */
const PERSON: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge'])

type Elements = ReturnType<EngineInterface['ui']['resolve']>

/**
 * The last scan, the paths picked in the pane, whether the delete button was
 * pressed once, whether a scan or a deletion runs, the last background error,
 * and the directory the session started in. The repository is looked for under
 * that directory, not under `$.session.cwd()`, because a Bash `cd` moves the
 * session's directory and would point the scan at another repository.
 */
type State = { scan?: Scan; selected: Set<string>; confirm: boolean; busy: boolean; scannedAt: number; lastError?: string; cwd?: string; event?: string }

/** The section this mod owns in the shared sidebar. */
const SECTION = { consumer: 'disk-janitor', key: 'artifacts' }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The repository's top level, or undefined outside git. */
async function repoRoot($: EngineInterface, cwd: string): Promise<string | undefined> {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 10_000 })
  return r.exitCode === 0 ? r.stdout.trim() : undefined
}

async function hasAnyMarker($: EngineInterface, dir: string, markers: readonly string[]): Promise<boolean> {
  for (const m of markers) if (await $.fs.exists(`${dir}/${m}`)) return true
  return false
}

/** The class of a directory by its name and, for a certain name, its marker files. */
async function classOf($: EngineInterface, abs: string): Promise<Class | undefined> {
  const rule = nameRule(baseName(abs))
  if (rule === undefined) return undefined
  return classOfRule(rule, rule.markers.length > 0 && (await hasAnyMarker($, abs, rule.markers)))
}

/** The artifact directories one level inside a data directory (`training/.venv`); a data directory there is left alone. */
async function insideData($: EngineInterface, root: string, rel: string): Promise<Found[]> {
  const found: Found[] = []
  for (const entry of await $.fs.list(`${root}/${rel}`)) {
    if (entry.kind !== 'dir' || entry.isLink) continue
    const path = `${rel}/${entry.name}`
    const cls = await classOf($, `${root}/${path}`)
    if (cls !== undefined && cls !== 'data') found.push({ path, cls })
  }
  return found
}

/** The git-ignored directories of the repository, sorted into artifacts and data. */
async function findArtifacts($: EngineInterface, root: string): Promise<{ found: Found[]; data: string[] }> {
  const r = await $.process.run(['git', 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { cwd: root, timeoutMs: 20_000 })
  if (r.exitCode !== 0) throw new Error(`git ls-files failed: ${r.stderr.trim().slice(0, 200)}`)
  const found: Found[] = []
  const data: string[] = []
  for (const rel of ignoredDirs(r.stdout)) {
    if (found.length >= MAX_FOUND) break
    const cls = await classOf($, `${root}/${rel}`)
    if (cls === 'data') {
      data.push(rel)
      found.push(...(await insideData($, root, rel)))
    } else if (cls !== undefined) found.push({ path: rel, cls })
  }
  return { found: found.slice(0, MAX_FOUND), data }
}

/** Kilobytes per relative path; `du` exits 1 over an unreadable file and still prints the rest. */
async function measure($: EngineInterface, root: string, found: readonly Found[]): Promise<Map<string, number>> {
  if (found.length === 0) return new Map()
  const r = await $.process.run(['du', '-sk', '--', ...found.map(f => `${root}/${f.path}`)], { cwd: root, timeoutMs: 60_000 })
  if (r.exitCode !== 0 && r.stdout.trim() === '') throw new Error(`du failed: ${r.stderr.trim().slice(0, 200)}`)
  const byAbs = parseDu(r.stdout)
  return new Map(found.map(f => [f.path, byAbs.get(`${root}/${f.path}`) ?? 0]))
}

/** Finds and measures the artifacts of the repository at `root`. */
async function scanRepo($: EngineInterface, root: string): Promise<Scan> {
  const { found, data } = await findArtifacts($, root)
  return { root, found, data, sizes: await measure($, root, found) }
}

/**
 * Why a listed directory may no longer be deleted, or undefined when it may:
 * it must still be a real directory inside the repository, not a link, still
 * git-ignored, and still of the class it was listed with.
 */
async function staleReason($: EngineInterface, root: string, f: Found): Promise<string | undefined> {
  const abs = `${root}/${f.path}`
  const rootReal = (await $.fs.stat(root, { resolve: true })).realPath
  const st = await $.fs.stat(abs, { resolve: true })
  if (st.isLink || st.kind !== 'dir') return 'no longer a directory'
  if (rootReal === undefined || st.realPath?.startsWith(`${rootReal}/`) !== true) return 'outside the repository'
  const ignored = await $.process.run(['git', 'check-ignore', '-q', '--', f.path], { cwd: root, timeoutMs: 10_000 })
  if (ignored.exitCode !== 0) return 'no longer git-ignored'
  return (await classOf($, abs)) === f.cls ? undefined : 'its contents changed'
}

/** Deletes one directory by argv, no shell; answers the error, or undefined. */
async function removeDir($: EngineInterface, root: string, f: Found): Promise<string | undefined> {
  const r = await $.process.run(['rm', '-rf', '--', `${root}/${f.path}`], { cwd: root, timeoutMs: 300_000 })
  return r.exitCode === 0 ? undefined : r.stderr.trim().slice(0, 200) || `rm exited ${r.exitCode}`
}

/**
 * Writes the total into the shared sidebar and answers whether it took it. Under 5 GB there is
 * nothing to show and the section goes down. The section carries the last deletion under the total,
 * faint. A closed sidebar, and a sidebar mod that is not installed, both answer false, so the status
 * line is drawn instead.
 */
async function toSidebar($: EngineInterface, state: State, text: string | undefined, kb: number): Promise<boolean> {
  try {
    if (text === undefined) {
      await $.sidebar.clear(SECTION)
      return await $.sidebar.isOpen()
    }
    const lines = [{ text, kind: statusTone(kb) }, ...(state.event === undefined ? [] : [{ text: state.event, kind: 'dim' as const }])]
    return await $.sidebar.set({ ...SECTION, title: 'build artifacts', lines, until: 'session', order: 20 })
  } catch {
    // The sidebar mod is not installed.
    return false
  }
}

/** Shows the measured total on the one channel that takes it. */
async function showTotal($: EngineInterface, state: State): Promise<void> {
  const kb = state.scan === undefined ? 0 : totalKb(state.scan)
  const text = state.scan === undefined ? undefined : statusText(kb)
  $.ui.status((await toSidebar($, state, text, kb)) ? undefined : text)
}

/** Measures the session's repository, shows the total and redraws the pane; a running measurement or deletion is left to finish. */
async function refresh($: EngineInterface, state: State): Promise<void> {
  if (state.busy) return
  state.busy = true
  try {
    const root = await repoRoot($, state.cwd ?? (await $.session.cwd()))
    const before = state.scan
    state.scan = root === undefined ? undefined : await scanRepo($, root)
    // Stamped after the measurement, so a failed one is tried again at the next turn.
    state.scannedAt = await $.clock.now()
    state.selected = carriedSelection(before?.root === state.scan?.root ? before : undefined, state.selected, state.scan)
    state.confirm = false
    await showTotal($, state)
  } finally {
    state.busy = false
    $.ui.invalidate('ui.render')
  }
}

/** A background scan has no hook to fail, so its error is logged; the same error once. */
function refreshInBackground($: EngineInterface, state: State): void {
  refresh($, state).then(
    () => {
      state.lastError = undefined
    },
    (err: unknown) => {
      const text = errorText(err)
      if (text !== state.lastError) $.ui.log(`cannot measure the artifacts: ${text}`)
      state.lastError = text
    },
  )
}

/** Deletes each picked directory that still passes every check, and answers what went and what stayed. */
async function deletePicked($: EngineInterface, state: State, picked: readonly Found[]): Promise<string> {
  const scan = state.scan
  if (scan === undefined) return 'nothing measured yet'
  if (state.busy) return BUSY
  state.busy = true
  const o: Outcome = { deleted: [], skipped: [], failed: [], freedKb: 0 }
  try {
    for (const f of picked) await deleteOne($, scan, f, o)
  } finally {
    state.busy = false
  }
  // The measurement that follows redraws the section, so the line is kept before it starts.
  state.event = deletedShort(o)
  refreshInBackground($, state)
  return reportText(o, scan.data)
}

async function deleteOne($: EngineInterface, scan: Scan, f: Found, o: Outcome): Promise<void> {
  const reason = await staleReason($, scan.root, f)
  if (reason !== undefined) {
    o.skipped.push(`${f.path} (${reason})`)
    return
  }
  const error = await removeDir($, scan.root, f)
  if (error !== undefined) {
    o.failed.push(`${f.path} (${error})`)
    return
  }
  const kb = scan.sizes.get(f.path) ?? 0
  o.freedKb += kb
  o.deleted.push(`${f.path} (${sizeText(kb)})`)
}

/** The first press arms the button, the second deletes. */
function pressDelete($: EngineInterface, state: State): void {
  const picked = state.scan?.found.filter(f => state.selected.has(f.path)) ?? []
  if (picked.length === 0) return
  if (!state.confirm) {
    state.confirm = true
    $.ui.invalidate('ui.render')
    return
  }
  deletePicked($, state, picked).then(
    text => $.ui.log(text),
    (err: unknown) => $.ui.log(`delete stopped: ${errorText(err)}`),
  )
}

function toggle($: EngineInterface, state: State, path: string): void {
  if (!state.selected.delete(path)) state.selected.add(path)
  state.confirm = false
  $.ui.invalidate('ui.render')
}

/** `/disk-janitor delete <path>`, for a surface without the pane; the path must be one the last scan listed. */
async function deleteByCommand($: EngineInterface, state: State, path: string, origin: PromptOrigin): Promise<string> {
  if (!PERSON.has(origin.kind)) return 'refused: only you can delete, from the prompt or the pane'
  const f = state.scan?.found.find(x => x.path === path.replace(/\/+$/, ''))
  if (f === undefined) return `not listed: ${path}; /disk-janitor list shows what can be deleted`
  return deletePicked($, state, [f])
}

async function openPane($: EngineInterface, state: State): Promise<string> {
  if ((await $.ui.panes()).some(p => p.id === PANE_ID)) {
    await $.ui.close({ id: PANE_ID })
    return 'pane closed'
  }
  refreshInBackground($, state)
  const rows = Math.min((state.scan?.found.length ?? 0) + 5, 24)
  await $.ui.open({ id: PANE_ID, title: 'Build artifacts', focus: true, closeOnEscape: true, holdToasts: true, rows })
  return 'pane open: Enter picks a row, the delete button asks twice, Esc closes'
}

async function runCommand($: EngineInterface, state: State, args: string, origin: PromptOrigin): Promise<string> {
  const [word = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (word === '') return openPane($, state)
  if (word === 'list') return listText(state.scan)
  if (word === 'rescan') {
    if (state.busy) return BUSY
    await refresh($, state)
    return listText(state.scan)
  }
  return word === 'delete' && rest.length > 0 ? deleteByCommand($, state, rest.join(' '), origin) : USAGE
}

function paneTree(els: Elements, state: State, onToggle: (path: string) => void, onDelete: () => void) {
  const { Box, Button, Text } = els
  const scan = state.scan
  if (scan === undefined) return <Text dimColor>{state.busy ? 'measuring…' : 'not in a git repository, or not measured yet'}</Text>
  const picked = scan.found.filter(f => state.selected.has(f.path))
  const pickedKb = picked.reduce((sum, f) => sum + (scan.sizes.get(f.path) ?? 0), 0)
  const label = state.confirm ? `Press again to delete ${picked.length} dir(s), ${sizeText(pickedKb)}` : `Delete selected (${sizeText(pickedKb)})`
  return (
    <Box flexDirection="column">
      <Text dimColor>{`${scan.root} · ${sizeText(totalKb(scan))}${state.busy ? ' · working…' : ''}`}</Text>
      {scan.found.map((f, i) => (
        <Button key={`row:${f.path}`} plain {...(i === 0 ? { autoFocus: true as const } : {})} label={`${state.selected.has(f.path) ? '[x]' : '[ ]'} ${rowText(scan, f)}`} onPress={() => onToggle(f.path)} />
      ))}
      {scan.found.length === 0 ? <Text>No build artifact found.</Text> : <Button key="delete" label={label} onPress={onDelete} />}
      {scan.data.length === 0 ? null : <Text dimColor>{`kept, data: ${scan.data.join(', ')}`}</Text>}
    </Box>
  )
}

export const register: Register = on => {
  const state: State = { selected: new Set(), confirm: false, busy: false, scannedAt: -Infinity }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.cwd = e.cwd
    await $.command.register({
      name: 'disk-janitor',
      description: 'Build artifacts of this repository: the pane, list, rescan, delete <path> (disk-janitor)',
      argumentHint: '[list | rescan | delete <path>]',
    })
    refreshInBackground($, state)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && (await $.clock.now()) - state.scannedAt >= SCAN_EVERY_MS) refreshInBackground($, state)
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'disk-janitor' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? ''), e.origin) }))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    return paneTree($.ui.resolve(e), state, path => toggle($, state, path), () => pressDelete($, state))
  })

  on('ui.close', async (_, e, next) => {
    if (e.id === PANE_ID) state.confirm = false
    return next(e)
  })
}
