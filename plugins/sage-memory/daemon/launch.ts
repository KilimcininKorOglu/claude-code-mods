import { PROTOCOL, type Launch } from '../hooks/shared/protocol.ts'
import { launch } from './launcher.ts'
import { messageOf } from './log.ts'
import { pluginVersion, requiredArg } from './version.ts'

/** Prints one `Launch` line for `--dir <dir>`, and exits with 1 when no daemon is ready. */
async function main(): Promise<void> {
  const outcome = await launch(requiredArg(process.argv.slice(2), '--dir'), { version: pluginVersion(), protocol: PROTOCOL })
  process.stdout.write(`${JSON.stringify(outcome)}\n`)
  if (!outcome.ready) process.exitCode = 1
}

main().catch((err: unknown) => {
  const outcome: Launch = { ready: false, error: messageOf(err) }
  process.stdout.write(`${JSON.stringify(outcome)}\n`)
  process.exitCode = 1
})
