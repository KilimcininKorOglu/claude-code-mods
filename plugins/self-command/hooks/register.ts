import type { EngineInterface, Register } from 'claude-code'
import { INPUT_SCHEMA, queuedText, reportText, requestOf, TOOL_DESCRIPTION, TOOL_NAME, type Request } from './commands.ts'

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Hands the model a report as a prompt of its own, through the send command, else as a plugin prompt. */
async function send($: EngineInterface, report: string): Promise<void> {
  try {
    await $.command.run({ command: 'self-command:send', args: report })
  } catch (err) {
    $.ui.log(`the report could not be sent (${messageOf(err)}), so it went as a plugin prompt`)
    await $.prompt.submit({ text: report })
  }
}

/**
 * Runs the command from a timer, because the engine runs a plugin's command once the session is idle and
 * refuses one from a hook the turn waits on; then reports its outcome to the model.
 */
function runLater($: EngineInterface, request: Request): void {
  $.clock.after(0, async () => {
    const outcome = await $.command.run(request).then(
      r => ({ text: r.text }),
      (err: unknown) => ({ error: messageOf(err) }),
    )
    await send($, reportText(request, outcome))
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // Declared once at the start, so the tool list the prompt cache holds does not change mid-session.
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA })
    return r
  })

  // A plugin's tool waits behind ToolSearch by default; this one is listed, so the model can call it at once.
  on('tool.describe', { tool: /^mcp__self-command__run$/ }, async (_, e, next) => ({ ...(await next(e)), isDeferred: false }))

  on('tool.call', { tool: /^mcp__self-command__run$/ }, async ($, e) => {
    const known = (await $.command.list()).map(c => c.name)
    const request = requestOf(e as Record<string, unknown>, known)
    if (typeof request === 'string') return { deny: request }
    runLater($, request)
    return { result: queuedText(request) }
  })
}
