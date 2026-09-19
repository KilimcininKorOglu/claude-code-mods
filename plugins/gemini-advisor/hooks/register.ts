import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'
import { adviceText, buildAdviceBody, INPUT_SCHEMA, messageOf, SYSTEM_GUIDANCE, TOOL_DESCRIPTION, TOOL_NAME, usageText, type Answer } from './advice.ts'
import { changeText, ENABLED_KEY, parseCommand, statusText } from './command.ts'
import { CONSUMER, configFrom, DEADLINE_MS, DEFAULT_MODEL, type Config } from './config.ts'
import { renderTranscript } from './transcript.ts'

/** The last advice's usage line, for the status. */
type State = { last?: string }

/** Gemini's answer, the model and the tier it went to, or why there is none. */
type Asked = { answer: Answer; model: string; tier: 'free' | 'paid' } | { error: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED_KEY)) !== false
}

/**
 * The conversation for Gemini and its message count. A subagent's call sends
 * none, because which transcript `$.session.messages()` answers there was not
 * verified.
 */
async function conversation($: EngineInterface, config: Config, e: ToolCallInput): Promise<{ text: string; count: number } | undefined> {
  if (e.agentId !== undefined) return undefined
  const messages = await $.session.messages()
  return { text: renderTranscript(messages, config.maxInputChars), count: messages.length }
}

/** gemini-core builds the request and reads each answer; the request is sent here, again after a 503 while it allows. */
async function askGemini($: EngineInterface, body: Record<string, unknown>): Promise<Asked> {
  const prepared = await $.gemini.request({ consumer: CONSUMER, body })
  if ('error' in prepared) return prepared
  const started = await $.clock.now()
  for (let attempt = 1; ; attempt++) {
    const r = await $.http.fetch(prepared.http.url, prepared.http.init)
    const read = await $.gemini.read({ status: r.status, ok: r.ok, text: r.text, attempt, elapsedMs: (await $.clock.now()) - started, deadlineMs: DEADLINE_MS })
    if ('answer' in read) return { answer: read.answer, model: prepared.model, tier: prepared.tier }
    if ('error' in read) return read
    await $.clock.sleep(read.retryInMs)
  }
}

async function advise($: EngineInterface, state: State, config: Config, e: ToolCallInput): Promise<ToolCallResult> {
  if (!(await isEnabled($))) return { deny: 'gemini-advisor is off; the user can turn it on with /gemini-advisor on' }
  try {
    const message = messageOf(e as Record<string, unknown>)
    const sent = await conversation($, config, e)
    const asked = await askGemini($, buildAdviceBody(sent?.text, message, config.maxOutputTokens))
    if ('error' in asked) throw new Error(asked.error)
    const advice = adviceText(asked.answer)
    state.last = usageText(asked.model, sent?.count, asked.answer)
    $.ui.toast(asked.tier === 'free' ? `${state.last} · sent to Gemini free tier` : state.last, { timeoutMs: 10_000 })
    return { result: advice }
  } catch (err) {
    state.last = `failed: ${errorText(err)}`
    return { deny: `Gemini advisor failed: ${errorText(err)}` }
  }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const command = parseCommand(args)
  if (command.kind === 'error') return command.text
  if (command.kind === 'reset') {
    await $.store.delete(ENABLED_KEY)
    return 'on: back to the default'
  }
  if (command.kind === 'set') {
    await $.store.set(ENABLED_KEY, command.enabled)
    return changeText(command.enabled)
  }
  return statusText(await isEnabled($), await $.gemini.settings({ consumer: CONSUMER }), state.last)
}

export const register: Register = (on, options) => {
  const config = configFrom(options)
  const state: State = {}

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.gemini.enroll({ consumer: CONSUMER, defaultModel: DEFAULT_MODEL })
    await $.command.register({
      name: 'gemini-advisor',
      description: 'Gemini advisor: status, on, off, reset; /gemini-core sets the model, thinking and tier (gemini-advisor)',
      argumentHint: '[on | off | reset]',
    })
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA })
    return r
  })

  on('command.run', { command: 'gemini-advisor' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // The engine puts a plugin's tool behind ToolSearch, where the model sees
  // only its name and never the description that says when to call it
  // (measured on 2.1.277). The system prompt says it instead, at the end of
  // a section every session has; the text is stable, so the cache holds.
  on('prompt.section', { name: 'env_info_simple' }, async (_, e, next) => {
    const r = await next(e)
    return r.text === null ? r : { text: `${r.text}\n\n${SYSTEM_GUIDANCE}` }
  })

  // A literal, so the validator names the tool; it equals TOOL_ID.
  on('tool.call', { tool: 'mcp__gemini-advisor__advise' }, async ($, e) => advise($, state, config, e))
}
