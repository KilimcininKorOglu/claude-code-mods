/** A chain of slash commands joined with `&&`, and the texts this mod writes. */

/** One command of the chain: its name without the slash, and its arguments as typed. */
export type Step = { command: string; args: string }

/** The command typed first keeps its own arguments (`head`); every `&& /<name>` after them starts a step. */
export type Chain = { head: string; rest: Step[] }

/**
 * `&&`, then a slash and a command name, as a word of its own. A `&&` that no `/<name>` follows is left in
 * the arguments, so `/commit a && b` keeps its text.
 */
const SEPARATOR = /(?:^|\s)&&\s*\/([A-Za-z0-9_:.-]+)(?=\s|$)/g

/** The arguments the engine handed the first command, split at each `&& /<name>`. */
export function parseChain(args: string): Chain {
  const marks = [...args.matchAll(SEPARATOR)]
  const first = marks[0]
  if (first === undefined) return { head: args, rest: [] }
  const rest = marks.map((m, i) => ({
    command: m[1] ?? '',
    args: args.slice(m.index + m[0].length, marks[i + 1]?.index ?? args.length).trim(),
  }))
  return { head: args.slice(0, first.index).trim(), rest }
}

/** How a step reads in the transcript: `/name args`. */
export function stepName(step: Step): string {
  return step.args === '' ? `/${step.command}` : `/${step.command} ${step.args}`
}

/** `; not run: /b, /c`, or nothing after the last step. */
function notRun(steps: readonly Step[]): string {
  return steps.length === 0 ? '' : `; not run: ${steps.map(s => `/${s.command}`).join(', ')}`
}

/** The line before a step runs: `2/3: /test2`. The engine adds the mod name. */
export function stepText(index: number, total: number, step: Step): string {
  return `${index}/${total}: ${stepName(step)}`
}

export function doneText(total: number): string {
  return `all ${total} command(s) ran`
}

/** Why a step stopped the chain: a command that threw, or a turn that ended without an answer. */
export function thrownWhy(err: unknown): string {
  // The engine names the calling plugin in front of its error, and it names the plugin in front of the line again.
  const message = (err instanceof Error ? err.message : String(err)).replace(/^slash-chain: /, '')
  return `it failed: ${message}`
}

export function turnWhy(reason: string): string {
  return `its turn ended with ${reason}`
}

export function stoppedText(step: Step, why: string, left: readonly Step[]): string {
  return `stopped after /${step.command}: ${why}${notRun(left)}`
}

export function cancelledText(left: readonly Step[]): string {
  return `cancelled${notRun(left)}`
}

/** What the chain waits for after its running step. */
export type Wait = 'run' | 'turn' | 'pane'

const WAITING: Record<Wait, string> = { run: 'running', turn: 'waiting for its turn', pane: 'waiting for its pane to close' }

/** The `/slash-chain` answer. */
export function statusText(enabled: boolean, running: { step: Step; index: number; total: number; wait: Wait } | undefined): string {
  const head = enabled ? 'on' : 'off'
  if (running === undefined) return `${head} · no chain runs`
  return `${head} · ${running.index}/${running.total} ${stepName(running.step)}, ${WAITING[running.wait]}`
}
