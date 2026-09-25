import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { planOf, type Install } from './parse.ts'
import { cratesInfo, FETCH_BODY_LIMIT, goInfo, goOldest, npmInfo, npmViewInfo, osvVulns, packagistInfo, pypiInfo, reachedFetchLimit, registryUrl, type Info } from './registry.ts'
import { checkedLog, denyText, doneLines, gateCheckedLog, gateText, isGuarded, lateReasonLog, missingReason, modeOf, openNote, registryReasons, sidebarLines, targetVersion, uncheckedLog, uncheckedNote, vulnReason, type Mode } from './rules.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** crates.io refuses a request without a User-Agent. */
const HEADERS = { 'User-Agent': 'dep-sentinel (Claude Code mod; github.com/KilimcininKorOglu/claude-code-mods)', Accept: 'application/json' }

/** A Go install names a package; its module is the path or one of its first few parents. */
const GO_PARENT_TRIES = 4

/** One package's check: reasons to stop it, or why it could not be checked. */
type Outcome = { reasons: string[]; failure?: string }

/**
 * The packages an earlier install could not check, each with the install it came from, so the check can
 * be run again: by a later install of the same package, by the gate itself and at each turn's end.
 * `owed` says the model is owed a note for the packages that were still open at the turn's end. A package
 * is keyed by its ecosystem and name (`openKey`), because npm and PyPI can each hold a package of one name.
 */
type State = { mode: Mode; open: Map<string, Install>; owed: boolean }

/** The key of an open package: two ecosystems' packages of one name are two findings. */
function openKey(p: Install): string {
  return `${p.ecosystem}:${p.name}`
}

/** The names of the packages still open, as the texts name them. */
function openNames(state: State): string[] {
  return [...state.open.values()].map(p => p.name)
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED_KEY)) !== false
}

/** GETs a URL and answers its status and body; a network failure throws. */
async function fetchText($: EngineInterface, url: string): Promise<{ status: number; text: string }> {
  const r = await $.http.fetch(url, { headers: HEADERS })
  if (r.status !== 404 && r.status !== 410 && !r.ok) throw new Error(`${/^https:\/\/([^/]+)/.exec(url)?.[1] ?? url} answered HTTP ${r.status}`)
  return { status: r.status, text: r.text }
}

/** A Go module: the path, else the nearest parent the proxy knows. */
async function goModule($: EngineInterface, p: Install): Promise<Info | undefined> {
  let path = p.name
  for (let i = 0; i < GO_PARENT_TRIES && path.includes('/'); i++) {
    const base = registryUrl({ ecosystem: 'Go', name: path }).replace(/@latest$/, '')
    const latest = await fetchText($, `${base}@latest`)
    if (latest.status === 200) {
      const list = (await fetchText($, `${base}@v/list`)).text
      const oldest = goOldest(list)
      const info = oldest === undefined ? undefined : JSON.parse((await fetchText($, `${base}@v/${oldest}.info`)).text) as unknown
      return goInfo(JSON.parse(latest.text), list, info)
    }
    path = path.slice(0, path.lastIndexOf('/'))
  }
  return undefined
}

/** How long `npm view` may take; it answers in about a second for next's 24 MiB document (measured). */
const NPM_VIEW_MS = 60_000

/** npm's own reading of a package whose registry document passed the fetch limit. */
async function npmView($: EngineInterface, p: Install): Promise<Info> {
  const r = await $.process.run(['npm', 'view', p.name, 'time.created', 'dist-tags.latest', 'versions', '--json'], { timeoutMs: NPM_VIEW_MS })
  if (r.exitCode !== 0) throw new Error(`npm view exited ${r.exitCode}: ${r.stderr.split('\n')[0] ?? ''}`)
  const info = npmViewInfo(JSON.parse(r.stdout))
  if (info === undefined) throw new Error(`npm view answered for ${p.name} in a shape dep-sentinel does not read`)
  return info
}

/**
 * The registry's answer for a package, or undefined when the registry does not know it. An npm document
 * cut at the fetch limit is read through `npm view`; another registry's cut document is named as such.
 */
async function lookUp($: EngineInterface, p: Install): Promise<Info | undefined> {
  if (p.ecosystem === 'Go') return goModule($, p)
  const r = await fetchText($, registryUrl(p))
  if (r.status !== 200) return undefined
  if (reachedFetchLimit(r.text)) {
    if (p.ecosystem === 'npm') return npmView($, p)
    throw new Error(`the ${p.ecosystem} document of ${p.name} passed the ${FETCH_BODY_LIMIT} bytes a fetch reads`)
  }
  const json = JSON.parse(r.text) as unknown
  const read = { npm: npmInfo, PyPI: pypiInfo, 'crates.io': cratesInfo, Packagist: (j: unknown) => packagistInfo(j, p.name) }[p.ecosystem]
  const info = read(json)
  if (info === undefined) throw new Error(`${p.ecosystem} answered for ${p.name} in a shape dep-sentinel does not read`)
  return info
}

async function osvCheck($: EngineInterface, p: Install, version: string): Promise<string | undefined> {
  const body = JSON.stringify({ version: version.replace(/^v(?=\d)/, p.ecosystem === 'Go' ? 'v' : ''), package: { name: p.name, ecosystem: p.ecosystem } })
  const r = await $.http.fetch('https://api.osv.dev/v1/query', { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body })
  if (!r.ok) throw new Error(`api.osv.dev answered HTTP ${r.status}`)
  return vulnReason(p, version, osvVulns(JSON.parse(r.text)))
}

async function checkOne($: EngineInterface, p: Install, now: number): Promise<Outcome> {
  try {
    const info = await lookUp($, p)
    if (info === undefined) return { reasons: [missingReason(p)] }
    const vuln = await osvCheck($, p, targetVersion(p, info))
    return { reasons: [...registryReasons(p, info, now), ...(vuln === undefined ? [] : [vuln])] }
  } catch (err) {
    return { reasons: [], failure: `${p.name} (${errorText(err)})` }
  }
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, key: string, title: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'dep-sentinel', key, title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Drops the sidebar entries of one finding, so a package that was checked leaves no warning behind. */
async function dropEntry($: EngineInterface, key: string): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'dep-sentinel', key })
  } catch {
    // The sidebar mod is not installed.
  }
}

/** The installs whose check finished. */
function checkedOf(installs: readonly Install[], outcomes: readonly Outcome[]): Install[] {
  return installs.filter((_, i) => outcomes[i]?.failure === undefined)
}

/** Closes the unchecked finding once every package it named was checked, and reports it. */
async function closeChecked($: EngineInterface, state: State, checked: readonly Install[]): Promise<void> {
  if (state.open.size === 0) return
  const named = openNames(state)
  for (const p of checked) state.open.delete(openKey(p))
  if (state.open.size > 0) return
  await dropEntry($, 'unchecked')
  await toPerson($, 'unchecked', 'packages checked after all', doneLines(named), checkedLog(named))
}

function withNote(r: ToolCallResult, note: string): ToolCallResult {
  if (r.deny !== undefined || r.isError === true) return r
  return { ...r, context: [...(r.context ?? []), note] }
}

/**
 * Runs the owed check again for every package still open, and closes the finding when the registry and
 * OSV.dev answer for all of them. A package they still do not answer for stays open. What a late answer
 * has to say is written as its own finding, because the install it belongs to already ran.
 */
async function recheckOpen($: EngineInterface, state: State, now: number): Promise<void> {
  if (state.open.size === 0) return
  const named = openNames(state)
  const reasons: string[] = []
  for (const [key, install] of [...state.open]) {
    const outcome = await checkOne($, install, now)
    if (outcome.failure !== undefined) continue
    state.open.delete(key)
    reasons.push(...outcome.reasons)
  }
  if (state.open.size > 0) return
  await dropEntry($, 'unchecked')
  await toPerson($, 'unchecked', 'packages checked after all', doneLines(named), gateCheckedLog(named))
  if (reasons.length > 0) await toPerson($, 'late', 'the late check has something to say', sidebarLines(reasons), lateReasonLog(reasons))
}

/**
 * The gate of the `deny` mode. The owed check is run again first, in both modes, so a package the
 * registry did not answer for earlier closes its own finding instead of waiting for another install.
 * A package they still do not answer for stops the command.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<string | undefined> {
  if (state.open.size === 0 || !isGuarded(command) || !(await isEnabled($))) return undefined
  await recheckOpen($, state, await $.clock.now())
  if (state.mode !== 'deny' || state.open.size === 0) return undefined
  return gateText(openNames(state))
}

async function setMode($: EngineInterface, state: State, word: string): Promise<string> {
  const mode = modeOf(word)
  if (mode === undefined) return 'mode expects note or deny'
  await $.store.set(MODE_KEY, mode)
  state.mode = mode
  return mode === 'deny' ? 'mode deny: git commit, push and merge stop while a package stayed unchecked' : 'mode note: an unchecked package is only reported'
}

async function statusText($: EngineInterface, state: State): Promise<string> {
  const open = state.open.size === 0 ? 'no package is open' : `${state.open.size} package(s) still unchecked`
  return `${(await isEnabled($)) ? 'on' : 'off'} · mode ${state.mode} · ${open}; npm, PyPI, Go, crates.io and Packagist installs are checked`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    return word === 'on' ? 'on: each install is checked against its registry and OSV.dev' : 'off: installs run unchecked'
  }
  if (word.startsWith('mode')) return setMode($, state, word.slice(4).trim())
  return word === '' ? statusText($, state) : USAGE
}

export const register: Register = on => {
  const state: State = { mode: 'note', open: new Map(), owed: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'dep-sentinel', description: 'Package installs checked before they run: status, on, off, mode (dep-sentinel)', argumentHint: '[on | off | mode note | deny]' })
    state.mode = (await $.store.get(MODE_KEY)) === 'deny' ? 'deny' : 'note'
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'dep-sentinel' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  /*
   * The turn's end runs the owed check again and owes the model a note for the packages that are still
   * open, because a finding it did not close would otherwise stand in the pane and reach it never again.
   * The check asks the registry and OSV.dev, once per open package, and a package they answer for closes.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || state.open.size === 0 || !(await isEnabled($))) return r
    await recheckOpen($, state, await $.clock.now())
    state.owed = state.open.size > 0
    return r
  })

  // The note goes to the model alone; the person reads the pane, which carries the same finding.
  on('prompt.submit', async (_, e, next) => {
    if (!state.owed || state.open.size === 0) return next(e)
    state.owed = false
    return next({ ...e, context: [...(e.context ?? []), openNote(openNames(state))] })
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const stop = await gate($, state, e.command)
    if (stop !== undefined) return { deny: stop }
    const plan = planOf(e.command)
    if (plan.installs.length === 0 || !(await isEnabled($))) return next(e)
    if (plan.skipped) {
      const names = plan.installs.map(p => p.name)
      await toPerson($, 'skipped', 'installs skipped on request', sidebarLines(names), `skipped on request: ${names.join(', ')}`)
      return next(e)
    }
    const now = await $.clock.now()
    const outcomes = await Promise.all(plan.installs.map(p => checkOne($, p, now)))
    await closeChecked($, state, checkedOf(plan.installs, outcomes))
    const reasons = outcomes.flatMap(o => o.reasons)
    if (reasons.length > 0) return { deny: denyText(reasons) }
    const failures = outcomes.map(o => o.failure).filter((f): f is string => f !== undefined)
    const r = await next(e)
    if (failures.length === 0) return r
    plan.installs.forEach((p, i) => { if (outcomes[i]?.failure !== undefined) state.open.set(openKey(p), p) })
    // The note goes to the model, the finding to the person: neither reads the other's channel.
    await toPerson($, 'unchecked', 'packages the install did not check', sidebarLines(failures), uncheckedLog(failures))
    return withNote(r, uncheckedNote(failures))
  })
}
