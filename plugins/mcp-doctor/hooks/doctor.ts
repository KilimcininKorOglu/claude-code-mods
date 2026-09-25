/** What the engine says about its MCP servers, and the texts this mod writes. */

/** One server that is not connected, and why, as far as the engine said. */
export type Failure = { name: string; reason: string }

/** The `failed_mcp_servers` rows of a ToolSearch result (measured on 2.1.280). */
type FailedRow = { name?: unknown; errorCode?: unknown; error?: unknown }

const FAILED_HEAD = 'The following MCP servers are configured but failed to connect'
const RECONNECTED = /available again \(MCP server reconnected[^)]*\):([^\n]*)/g
const PREFIX = /mcp__([A-Za-z0-9_-]+?)__\*/g

/** A claude.ai connector is the person's account, not this machine's config; the mod leaves it alone. */
export function isWatched(name: string): boolean {
  return !name.startsWith('claude.ai ')
}

/** The tool-name prefix the engine builds from a server name: every character but a letter, a digit or `-` turned into `_`. */
export function prefixOf(name: string): string {
  return name.replace(/[^A-Za-z0-9-]/g, '_')
}

function reasonOf(row: FailedRow): string {
  const code = typeof row.errorCode === 'string' ? row.errorCode : undefined
  const error = typeof row.error === 'string' ? row.error : undefined
  if (code !== undefined && error !== undefined) return `${code}: ${error}`
  return code ?? error ?? 'disconnected'
}

/** The watched servers a ToolSearch result names as failed. A server that dropped mid-session carries no error. */
export function failedOf(result: unknown): Failure[] {
  const rows = (result as { failed_mcp_servers?: unknown } | undefined)?.failed_mcp_servers
  if (!Array.isArray(rows)) return []
  return (rows as FailedRow[])
    .filter((r): r is FailedRow & { name: string } => typeof r.name === 'string' && isWatched(r.name))
    .map(r => ({ name: r.name, reason: reasonOf(r) }))
}

/** One `<name>` or `<name>: "<error>"` line of the failed block. */
function failureOfLine(line: string): Failure {
  const at = line.indexOf(': "')
  if (at < 0) return { name: line.trim(), reason: 'failed to connect' }
  return { name: line.slice(0, at).trim(), reason: line.slice(at + 3).replace(/"\s*$/, '') }
}

/** The servers the attachment names as failed: the lines after its head, up to the first empty line. */
function failedInDelta(text: string): Failure[] {
  const at = text.indexOf(FAILED_HEAD)
  if (at < 0) return []
  const body = text.slice(text.indexOf('\n', at) + 1)
  const end = body.indexOf('\n\n')
  return (end < 0 ? body : body.slice(0, end)).split('\n').filter(l => l.trim() !== '').map(failureOfLine).filter(f => isWatched(f.name))
}

/** The tool prefixes the attachment names as reconnected (`mcp__plugin_playwright_playwright__* (25)`). */
function reconnectedInDelta(text: string): string[] {
  return [...text.matchAll(RECONNECTED)].flatMap(m => [...(m[1] ?? '').matchAll(PREFIX)].map(p => p[1] ?? ''))
}

/** What one `deferred_tools_delta` attachment says: the servers that failed, and the tool prefixes that came back. */
export function deltaOf(text: string): { failed: Failure[]; reconnected: string[] } {
  return { failed: failedInDelta(text), reconnected: reconnectedInDelta(text) }
}

/** The line the person reads for a server that is not connected. The engine adds the mod name. */
export function failedText(f: Failure): string {
  return `${f.name}: not connected (${f.reason})`
}

export function backText(name: string): string {
  return `${name}: connected again`
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A sidebar line, as the sidebar mod's contract names it; `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** The failed server's line: the name default, `not connected` red, the reason faint. */
export function failedLines(f: Failure): Line[] {
  return [partsLine([part(`${f.name}: `, undefined), part('not connected', 'error'), part(` (${f.reason})`, 'dim')])]
}

/** The reconnected server's line: the name default, `connected again` green. */
export function backLines(name: string): Line[] {
  return [partsLine([part(`${name}: `, undefined), part('connected again', 'ok')])]
}

/** The reconnect button under a failed server: pressing it runs `/mcp-doctor reconnect <name>`. */
export function reconnectButton(name: string): { label: string; command: string; args: string } {
  return { label: `reconnect ${name}`, command: 'mcp-doctor', args: `reconnect ${name}` }
}

/** A sidebar section key: the subject cut to what the sidebar takes. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'server'
}

/** The `/mcp-doctor` answer: the setting and every server that is not connected. */
export function statusText(enabled: boolean, failed: readonly Failure[]): string {
  const head = enabled ? 'on' : 'off'
  if (failed.length === 0) return `${head} · every watched MCP server is connected`
  return `${head} · ${failed.map(failedText).join('; ')}`
}
