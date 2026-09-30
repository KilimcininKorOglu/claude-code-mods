/**
 * The hooks module's side of the daemon link: the Node check, the launcher's answer, the daemon's
 * reply envelope and the lines the person reads. Pure code; `register.tsx` makes every call.
 */
import type { EmbedState, Launch, Reply, SetupJob } from './shared/protocol.ts'

/** The Node the daemon needs: TypeScript type stripping by default (22.18) and `node:sqlite` without a flag (22.13). */
export const MIN_NODE = '22.18'

/** What `node -p NODE_PROBE` prints: the version, the type stripping mode, and whether `node:sqlite` loads. */
export const NODE_PROBE =
  "JSON.stringify({ version: process.version, typescript: (process.features && process.features.typescript) || false, sqlite: (() => { try { require('node:sqlite'); return true } catch { return false } })() })"

type NodeFacts = { version: string; typescript: string | false; sqlite: boolean }

/** Why this Node cannot run the daemon, or null when it can. */
export function nodeProblem(stdout: string): string | null {
  let facts: Partial<NodeFacts>
  try {
    facts = JSON.parse(stdout.trim()) as Partial<NodeFacts>
  } catch {
    return `node printed no facts: ${stdout.trim().slice(0, 120) || 'nothing'}`
  }
  const typed = facts.typescript === 'strip' || facts.typescript === 'transform'
  if (typed && facts.sqlite === true) return null
  return `needs Node.js ${MIN_NODE} or later with built-in TypeScript and node:sqlite; found ${facts.version ?? 'an unknown version'}`
}

/** The launcher's outcome from its stdout, whose last line is one `Launch` JSON. */
export function launchOf(stdout: string): Launch {
  const line = stdout.trim().split('\n').at(-1) ?? ''
  try {
    const parsed = JSON.parse(line) as Partial<Launch>
    if (parsed.ready === true || parsed.ready === false) return parsed as Launch
  } catch {
    // Not JSON: the launcher failed before it could print its line; the text says why.
  }
  return { ready: false, error: `the launcher printed no outcome: ${line.slice(0, 200) || 'nothing'}` }
}

/** The daemon's token from `server.json`. */
export function tokenOf(serverFile: string): string {
  const token = (JSON.parse(serverFile) as { token?: unknown }).token
  if (typeof token !== 'string' || token === '') throw new Error('server.json holds no token')
  return token
}

/** The value of a daemon reply, or an error naming the route and what the daemon said. */
export function valueOf<T>(path: string, status: number, text: string): T {
  let reply: Partial<Reply<T>>
  try {
    reply = JSON.parse(text) as Partial<Reply<T>>
  } catch {
    throw new Error(`${path} answered HTTP ${status} without JSON`)
  }
  if (reply.ok === true) return (reply as { value: T }).value
  throw new Error(`${path} answered HTTP ${status}: ${(reply as { error?: string }).error ?? 'no reason'}`)
}

/** The link as the person sees it. */
export type LinkView = { state: 'off' } | { state: 'starting' } | { state: 'ready'; pid: number; embedding: EmbedState; setup?: SetupJob } | { state: 'failed'; error: string }

type Tone = 'ok' | 'warn' | 'error' | 'dim' | 'info'
/** A piece of a line in its own colour. */
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

export const faint = (text: string): Part => ({ text, kind: 'dim' })

/** A line made of parts, its `text` their texts joined; `kind` colours the whole line in a sidebar older than 0.11.0, which draws no parts. */
export function partsLine(parts: Part[], kind: Tone): Line {
  return { text: parts.map(part => part.text).join(''), kind, parts }
}

/** A line whose one word says what happened, in that word's colour, the text around it faint. */
export function wordLine(before: string, word: string, kind: Tone, after: string): Line {
  return partsLine([faint(before), { text: word, kind }, faint(after)].filter(part => part.text !== ''), kind)
}

/** Coloured pieces separated by faint commas, the way a line lists several counts. */
export function listed(pieces: Part[]): Part[] {
  return pieces.flatMap((piece, i) => (i === 0 ? [piece] : [faint(', '), piece]))
}

/** The opening words of a memory, which a stream line shows of it. */
export function openingOf(text: string): string {
  return text.split(/\s+/).slice(0, 10).join(' ')
}

/** A scope as a stream line names it: `user` memories live in the global store, which the section calls global. */
export function scopeLabel(scope: string): string {
  return scope === 'user' ? 'global' : scope
}

function embeddingText(e: EmbedState, setup: SetupJob | undefined): string {
  if (setup?.state === 'running') return `setup: ${setup.step} ${setup.detail}`.trim()
  if (e.state === 'off') return 'embeddings off · /sage-memory setup'
  if (e.state === 'failed') return `embeddings failed: ${e.error}`
  return e.state === 'ready' ? `embeddings ${e.modelId}` : `embeddings ${e.state}`
}

/** The sidebar's first line: whether the mod is on and the daemon answers, and the embeddings. */
export function stateLine(link: LinkView, project: string): Line {
  if (link.state === 'off') return { text: 'off · /sage-memory on turns it on', kind: 'dim' }
  if (link.state === 'starting') return { text: `starting the daemon · ${project}`, kind: 'dim' }
  if (link.state === 'failed') return { text: `daemon failed: ${link.error}`, kind: 'error' }
  return { text: `daemon ready · ${project} · ${embeddingText(link.embedding, link.setup)}`, kind: link.embedding.state === 'failed' ? 'warn' : 'ok' }
}

function embeddingKind(e: EmbedState): Tone {
  if (e.state === 'failed') return 'warn'
  return e.state === 'ready' ? 'ok' : 'dim'
}

/** The sidebar's first lines: the daemon and the project on one, the embeddings under it once the daemon is ready. */
export function stateLines(link: LinkView, project: string): Line[] {
  if (link.state !== 'ready') return [stateLine(link, project)]
  return [
    { text: `daemon ready · ${project}`, kind: 'ok' },
    { text: embeddingText(link.embedding, link.setup), kind: embeddingKind(link.embedding) },
  ]
}

/** The `/sage-memory` status answer. */
export function statusText(enabled: boolean, link: LinkView, project: string): string {
  return `${enabled ? 'on' : 'off'} · ${stateLine(link, project).text}`
}

/** The answer to a setup job's step, once it ended or while it runs. */
export function setupText(job: SetupJob): string {
  if (job.state === 'running') return `setup running: ${job.step} ${job.detail}`.trim()
  if (job.state === 'done') return `setup done: ${job.indexed} memories embedded`
  if (job.state === 'failed') return `setup failed at ${job.step}: ${job.error}`
  return 'setup has not run'
}

/**
 * What this session did with the memories: reminded by relevance, sent as global rules to every
 * context whatever it asked, used, added.
 */
export type SessionCounts = { reminded: number; rules: number; used: number; added: number }

/** The active memories of this project's store and of the global store, whose `user` memories every project is reminded of. */
export type StoredCounts = { project: number; global: number }

/** The sidebar's line of what the stores hold, once the daemon has answered it. */
export function storedLine(stored: StoredCounts): Line {
  return partsLine([
    faint('this project: '),
    { text: `${stored.project} active`, kind: 'ok' },
    faint(' · global: '),
    { text: `${stored.global} active`, kind: 'info' },
  ], 'dim')
}

/** The words the section shows while a job after the turn works on `count` memories: `saving 2 memories…`. */
export function jobText(verb: 'saving' | 'curating', count: number): string {
  return `${verb} ${count} ${count === 1 ? 'memory' : 'memories'}…`
}

/** The line of the job under way after the turn; the section drops it when the job ends. */
export function workingLine(text: string): Line {
  return { text, kind: 'info' }
}

/** The sidebar's last line while the daemon answers: this session's counts. */
export function countsLine(counts: SessionCounts): Line {
  return partsLine([
    faint('this session: '),
    { text: `reminded ${counts.reminded}`, kind: 'info' },
    faint(` · rules ${counts.rules} · `),
    { text: `used ${counts.used}`, kind: 'warn' },
    faint(' · '),
    { text: `added ${counts.added}`, kind: 'ok' },
  ], 'dim')
}
