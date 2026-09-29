/** The most rounds one hunt may run. */
export const MAX_ROUNDS = 25

export type Parsed =
  | { kind: 'start'; rounds: number; target: string }
  | { kind: 'collab'; paths: string[] }
  | { kind: 'stop' | 'status' | 'on' | 'off' }
  | { kind: 'error'; text: string }

const WORDS = new Set(['stop', 'status', 'on', 'off'])

export const USAGE = 'usage: /bughunt [--rounds 1..25] [target] | collab <paths> | stop | status | on | off'

/** Reads `/bughunt` arguments; `--rounds` may stand anywhere among them. */
export function parseArgs(raw: string): Parsed {
  const tokens = raw.trim().split(/\s+/).filter(t => t !== '')
  const first = tokens[0] ?? ''
  if (tokens.length === 1 && WORDS.has(first)) return { kind: first as 'stop' | 'status' | 'on' | 'off' }
  if (first === 'collab') return collabOf(tokens.slice(1))
  return startOf(tokens)
}

function collabOf(paths: string[]): Parsed {
  return paths.length === 0 ? { kind: 'error', text: 'usage: /bughunt collab <paths>' } : { kind: 'collab', paths }
}

function startOf(tokens: string[]): Parsed {
  const rest: string[] = []
  let value: string | undefined
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (t === '--rounds') {
      value = tokens[i + 1] ?? ''
      i += 1
    } else if (t.startsWith('--rounds=')) value = t.slice('--rounds='.length)
    else rest.push(t)
  }
  if (value === undefined) return { kind: 'start', rounds: 1, target: rest.join(' ') }
  const rounds = roundsOf(value)
  if (rounds === undefined) return { kind: 'error', text: `--rounds takes a whole number from 1 to ${MAX_ROUNDS}, not "${value}". ${USAGE}` }
  return { kind: 'start', rounds, target: rest.join(' ') }
}

function roundsOf(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const n = Number(value)
  return n >= 1 && n <= MAX_ROUNDS ? n : undefined
}
