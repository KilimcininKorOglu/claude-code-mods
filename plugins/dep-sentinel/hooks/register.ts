import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { planOf, type Install } from './parse.ts'
import { cratesInfo, goInfo, goOldest, npmInfo, osvVulns, packagistInfo, pypiInfo, registryUrl, type Info } from './registry.ts'
import { denyText, missingReason, registryReasons, targetVersion, uncheckedLog, uncheckedNote, vulnReason } from './rules.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/** crates.io refuses a request without a User-Agent. */
const HEADERS = { 'User-Agent': 'dep-sentinel (Claude Code mod; github.com/KilimcininKorOglu/claude-code-mods)', Accept: 'application/json' }

/** A Go install names a package; its module is the path or one of its first few parents. */
const GO_PARENT_TRIES = 4

/** One package's check: reasons to stop it, or why it could not be checked. */
type Outcome = { reasons: string[]; failure?: string }

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

/** The registry's answer for a package, or undefined when the registry does not know it. */
async function lookUp($: EngineInterface, p: Install): Promise<Info | undefined> {
  if (p.ecosystem === 'Go') return goModule($, p)
  const r = await fetchText($, registryUrl(p))
  if (r.status !== 200) return undefined
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

function withNote(r: ToolCallResult, note: string): ToolCallResult {
  if (r.deny !== undefined || r.isError === true) return r
  return { ...r, context: [...(r.context ?? []), note] }
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    return word === 'on' ? 'on: each install is checked against its registry and OSV.dev' : 'off: installs run unchecked'
  }
  return word === '' ? `${(await isEnabled($)) ? 'on' : 'off'}; npm, PyPI, Go, crates.io and Packagist installs are checked` : USAGE
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'dep-sentinel', description: 'Package installs checked before they run: status, on, off (dep-sentinel)', argumentHint: '[on | off]' })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'dep-sentinel' }, async ($, e) => ({ text: await runCommand($, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const plan = planOf(e.command)
    if (plan.installs.length === 0 || !(await isEnabled($))) return next(e)
    if (plan.skipped) {
      $.ui.log(`skipped on request: ${plan.installs.map(p => p.name).join(', ')}`)
      return next(e)
    }
    const now = await $.clock.now()
    const outcomes = await Promise.all(plan.installs.map(p => checkOne($, p, now)))
    const reasons = outcomes.flatMap(o => o.reasons)
    if (reasons.length > 0) return { deny: denyText(reasons) }
    const failures = outcomes.map(o => o.failure).filter((f): f is string => f !== undefined)
    const r = await next(e)
    if (failures.length === 0) return r
    // The note goes to the model, the log line to the person: neither reads the other's channel.
    $.ui.log(uncheckedLog(failures))
    return withNote(r, uncheckedNote(failures))
  })
}
