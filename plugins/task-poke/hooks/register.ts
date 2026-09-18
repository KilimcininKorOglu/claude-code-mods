import type { Register } from 'claude-code'
import { asksUser, taskState, unfinishedCount } from './tasks.ts'

const MAX_POKES = 5
const ENABLED_KEY = 'enabled'
const USER_ORIGINS: readonly string[] = ['composer', 'bridge', 'sdk']
const POKE_TEXT =
  'The task list still has unfinished tasks. Continue with the next pending or in-progress task. ' +
  'If a task is blocked or needs a decision from me, say so and stop.'

type Decision = { kind: 'idle' } | { kind: 'poke'; open: number } | { kind: 'limit' }

/** Decides what to do after a main-loop turn. `pokes` counts the pokes sent since the last user prompt. */
export function decide(open: number, askedUser: boolean, pokes: number): Decision {
  if (open === 0 || askedUser) return { kind: 'idle' }
  if (pokes >= MAX_POKES) return { kind: 'limit' }
  return { kind: 'poke', open }
}

export const register: Register = on => {
  let enabled = true
  let pokes = 0
  let limitLogged = false

  const resetCount = (): void => {
    pokes = 0
    limitLogged = false
  }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    enabled = (await $.store.get(ENABLED_KEY)) !== false
    resetCount()
    await $.command.register({
      name: 'task-poke',
      description: 'Continue automatically while the task list has unfinished tasks: on, off or status (task-poke)',
      argumentHint: '[on | off | status]',
      immediate: true,
    })
    return r
  })

  on('command.run', { command: 'task-poke' }, async ($, e) => {
    const arg = String(e.args ?? '').trim()
    if (arg === 'on' || arg === 'off') {
      enabled = arg === 'on'
      await $.store.set(ENABLED_KEY, enabled)
      resetCount()
    }
    return { text: `task-poke is ${enabled ? 'on' : 'off'}, ${pokes}/${MAX_POKES} pokes since your last prompt` }
  })

  // Only the origin is read. The prompt text passes through untouched. This hook never sees its own pokes.
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    if (USER_ORIGINS.includes(e.origin.kind)) resetCount()
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!enabled || e.agentId !== undefined || e.reason !== 'answer') return r
    const messages = await $.session.messages()
    const decision = decide(unfinishedCount(taskState(messages)), asksUser(messages), pokes)
    if (decision.kind === 'poke') {
      pokes += 1
      $.ui.log(`task-poke: ${decision.open} unfinished tasks, poke ${pokes}/${MAX_POKES}`)
      // A plugin prompt runs once the session is idle, so the hook does not wait for it.
      void $.prompt.submit({ text: POKE_TEXT }).then(
        res => {
          if (res.drop !== undefined) $.ui.log(`task-poke: the poke was dropped: ${res.drop}`)
        },
        (err: unknown) => {
          $.ui.log(`task-poke: the poke was not submitted: ${String(err)}`)
        },
      )
    } else if (decision.kind === 'limit' && !limitLogged) {
      limitLogged = true
      $.ui.log(`task-poke: stopped after ${MAX_POKES} pokes with unfinished tasks. Send a prompt to reset the count.`)
    }
    return r
  })
}
