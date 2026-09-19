import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'
import { adviceText, buildAdviceRequest, INPUT_SCHEMA, messageOf, retryDelay, SYSTEM_GUIDANCE, TOOL_NAME, toolDescription, usageText } from './advice.ts'
import { changeText, parseCommand, STORE_KEYS, statusText, storedValue, type Settings } from './command.ts'
import { configFrom, type Config } from './config.ts'
import { parseResponse, type Answer, type Request } from './gemini.ts'
import { renderTranscript } from './transcript.ts'

/** The last advice's usage line, for the status. */
type State = { last?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The plugin options with the settings /gemini-advisor stored on top. */
async function loadConfig($: EngineInterface, base: Config): Promise<Config> {
  const config: Config = { ...base }
  for (const key of Object.keys(STORE_KEYS) as (keyof Settings)[]) {
    const value = storedValue(key, await $.store.get(STORE_KEYS[key]))
    if (value !== undefined) Object.assign(config, { [key]: value })
  }
  return config
}

async function apiKey($: EngineInterface, config: Config): Promise<string | undefined> {
  if (config.apiKey !== undefined) return config.apiKey
  const fromEnv = (await $.env.get('GEMINI_API_KEY'))?.trim()
  return fromEnv === undefined || fromEnv === '' ? undefined : fromEnv
}

/** Declares the tool with the model's name in its description; again replaces it. */
async function registerTool($: EngineInterface, model: string): Promise<void> {
  await $.tool.register({ name: TOOL_NAME, description: toolDescription(model), inputSchema: INPUT_SCHEMA })
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

/** Sends the request, again after a 503 while the retry budget allows. */
async function fetchAnswer($: EngineInterface, request: Request): Promise<Answer> {
  const started = await $.clock.now()
  for (let attempt = 1; ; attempt++) {
    const response = await $.http.fetch(request.url, request.init)
    const delay = retryDelay(response.status, attempt, (await $.clock.now()) - started)
    if (delay === undefined) return parseResponse(response.status, response.ok, response.text)
    await $.clock.sleep(delay)
  }
}

async function advise($: EngineInterface, state: State, base: Config, e: ToolCallInput): Promise<ToolCallResult> {
  const config = await loadConfig($, base)
  if (!config.enabled) return { deny: 'gemini-advisor is off; the user can turn it on with /gemini-advisor on' }
  const key = await apiKey($, config)
  if (key === undefined) return { deny: 'gemini-advisor has no Gemini key; the user can set GEMINI_API_KEY or the plugin option' }
  try {
    const message = messageOf(e as Record<string, unknown>)
    const sent = await conversation($, config, e)
    const request = buildAdviceRequest(config.model, key, sent?.text, message, config.maxOutputTokens)
    const answer = await fetchAnswer($, request)
    const advice = adviceText(answer)
    state.last = usageText(config.model, sent?.count, answer)
    $.ui.toast(config.tier === 'free' ? `${state.last} · sent to Gemini free tier` : state.last, { timeoutMs: 10_000 })
    return { result: advice }
  } catch (err) {
    state.last = `failed: ${errorText(err)}`
    return { deny: `Gemini advisor failed: ${errorText(err)}` }
  }
}

async function runCommand($: EngineInterface, state: State, base: Config, args: string): Promise<string> {
  const command = parseCommand(args)
  if (command.kind === 'error') return command.text
  if (command.kind === 'reset') {
    for (const key of Object.values(STORE_KEYS)) await $.store.delete(key)
    await registerTool($, base.model)
    return 'settings reset to the plugin options'
  }
  if (command.kind === 'set') {
    for (const [key, value] of Object.entries(command.patch)) await $.store.set(STORE_KEYS[key as keyof Settings], value)
    if (command.patch.model !== undefined) await registerTool($, command.patch.model)
    return changeText(command.patch)
  }
  const config = await loadConfig($, base)
  return statusText(config, (await apiKey($, config)) !== undefined, state.last)
}

export const register: Register = (on, options) => {
  const base = configFrom(options)
  const state: State = {}

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'gemini-advisor',
      description: 'Gemini advisor: status, on, off, free, paid, model <id>, reset (gemini-advisor)',
      argumentHint: '[on | off | free | paid | model <id> | reset]',
    })
    await registerTool($, (await loadConfig($, base)).model)
    return r
  })

  on('command.run', { command: 'gemini-advisor' }, async ($, e) => ({ text: await runCommand($, state, base, String(e.args ?? '')) }))

  // The engine puts a plugin's tool behind ToolSearch, where the model sees
  // only its name and never the description that says when to call it
  // (measured on 2.1.277). The system prompt says it instead, at the end of
  // a section every session has; the text is stable, so the cache holds.
  on('prompt.section', { name: 'env_info_simple' }, async (_, e, next) => {
    const r = await next(e)
    return r.text === null ? r : { text: `${r.text}\n\n${SYSTEM_GUIDANCE}` }
  })

  // A literal, so the validator names the tool; it equals TOOL_ID.
  on('tool.call', { tool: 'mcp__gemini-advisor__advise' }, async ($, e) => advise($, state, base, e))
}
