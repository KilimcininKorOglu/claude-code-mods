import { log, messageOf } from './log.ts'
import { startServer } from './server.ts'
import { pluginVersion, requiredArg } from './version.ts'

/** SAGE's idle time: the daemon closes five minutes after its last request. */
const IDLE_MS = 5 * 60_000

function idleMsOf(raw: string | undefined): number {
  if (raw === undefined || raw === '') return IDLE_MS
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`SAGE_MEMORY_IDLE_MS is not a whole number of milliseconds: ${JSON.stringify(raw)}`)
  return value
}

async function main(): Promise<void> {
  const dir = requiredArg(process.argv.slice(2), '--dir')
  const started = await startServer({ dir, version: pluginVersion(), idleMs: idleMsOf(process.env.SAGE_MEMORY_IDLE_MS) })
  if (!started.owned) {
    log(`the daemon of pid ${started.hello.pid} answers on the socket, so this one exits`)
    return
  }
  process.once('SIGTERM', () => void started.close('SIGTERM'))
  process.once('SIGINT', () => void started.close('SIGINT'))
  await started.closed
}

main().catch((err: unknown) => {
  log(`failed: ${messageOf(err)}`)
  process.exitCode = 1
})
