import type { EngineInterface, PluginOptions, Register } from 'claude-code'
import type { Gemini, GeminiChange, GeminiEnroll, GeminiPrepared, GeminiSettings, GeminiTier } from '../types/index.d.ts'
import { buildHttp, MODEL_ID, withThinking } from './api.ts'
import { parseKeys, readWithKeys, type KeyState } from './keys.ts'
import { consumersOf, FREE_WARNING, isThinking, isTier, KEYS, parseCommand, resolveConsumer, statusText, type ConsumerLine } from './settings.ts'

/**
 * The store and environment the methods of `$.gemini` run on. The validator
 * refuses `next(e)` at `engine.create` passed as an argument, so the hook wraps
 * the calls it needs.
 */
export type Host = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  envKey(): Promise<string | undefined>
}

/** `apiKeys` from the option, tried in order; empty when the option is unset. */
export type Config = { apiKeys: string[]; tier: GeminiTier }

const NO_KEY = 'no Gemini key: set GEMINI_API_KEY or the gemini-core apiKey option'

export function configFrom(options: PluginOptions): Config {
  return { apiKeys: parseKeys(typeof options.apiKey === 'string' ? options.apiKey : undefined), tier: isTier(options.tier) ? options.tier : 'free' }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The option's keys, or else the keys of GEMINI_API_KEY; both take a comma-separated list. */
async function apiKeys(host: Host, config: Config): Promise<string[]> {
  return config.apiKeys.length > 0 ? config.apiKeys : parseKeys(await host.envKey())
}

async function tierOf(host: Host, config: Config): Promise<GeminiTier> {
  const stored = await host.get(KEYS.tier)
  return isTier(stored) ? stored : config.tier
}

async function enrolled(host: Host): Promise<Record<string, string>> {
  return consumersOf(await host.get(KEYS.consumers))
}

async function settingsFor(host: Host, config: Config, consumer: string): Promise<GeminiSettings> {
  const defaultModel = (await enrolled(host))[consumer]
  if (defaultModel === undefined) throw new Error(`${consumer} has not enrolled with gemini-core`)
  const model = await host.get(KEYS.model(consumer))
  const thinking = await host.get(KEYS.thinking(consumer))
  const keys = (await apiKeys(host, config)).length
  return {
    hasKey: keys > 0,
    keys,
    tier: await tierOf(host, config),
    model: typeof model === 'string' && MODEL_ID.test(model) ? model : defaultModel,
    ...(isThinking(thinking) ? { thinking } : {}),
  }
}

async function enroll(host: Host, input: GeminiEnroll): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.consumer)) throw new Error(`enroll takes a plugin name, not ${JSON.stringify(input.consumer)}`)
  if (!MODEL_ID.test(input.defaultModel)) throw new Error(`enroll takes a Gemini model id, not ${JSON.stringify(input.defaultModel)}`)
  const mods = await enrolled(host)
  if (mods[input.consumer] !== input.defaultModel) await host.set(KEYS.consumers, { ...mods, [input.consumer]: input.defaultModel })
}

/** The request for a mod, with the key the last request succeeded or moved on with. */
async function request(host: Host, config: Config, state: KeyState, consumer: string, body: Record<string, unknown>): Promise<GeminiPrepared> {
  const keys = await apiKeys(host, config)
  const key = keys[state.preferred] ?? keys[0]
  if (key === undefined) return { error: NO_KEY }
  try {
    const s = await settingsFor(host, config, consumer)
    return { http: buildHttp(s.model, key, withThinking(body, s.thinking)), model: s.model, tier: s.tier }
  } catch (err) {
    return { error: errorText(err) }
  }
}

async function reset(host: Host): Promise<string> {
  await host.del(KEYS.tier)
  for (const consumer of Object.keys(await enrolled(host))) {
    await host.del(KEYS.model(consumer))
    await host.del(KEYS.thinking(consumer))
  }
  return 'settings reset: the plugin option tier, and each mod its default model and the model default thinking'
}

/** A model or thinking change for one mod, named in full or without `gemini-`. */
async function configureMod(host: Host, change: Extract<GeminiChange, { consumer: string }>): Promise<string> {
  const names = Object.keys(await enrolled(host))
  const consumer = resolveConsumer(change.consumer, names)
  if (consumer === undefined) throw new Error(`no Gemini mod named ${change.consumer}; enrolled: ${names.join(', ') || 'none'}`)
  if ('model' in change) {
    if (!MODEL_ID.test(change.model)) throw new Error(`${change.model} is not a Gemini model id`)
    await host.set(KEYS.model(consumer), change.model)
    return `${consumer}: model ${change.model}`
  }
  if (change.thinking === null) await host.del(KEYS.thinking(consumer))
  else await host.set(KEYS.thinking(consumer), change.thinking)
  return `${consumer}: thinking ${change.thinking ?? 'model default'}`
}

async function configure(host: Host, change: GeminiChange): Promise<string> {
  if ('reset' in change) return reset(host)
  if ('tier' in change) {
    await host.set(KEYS.tier, change.tier)
    return change.tier === 'free' ? FREE_WARNING : 'paid tier'
  }
  return configureMod(host, change)
}

/** `$.gemini`, on the nouns beneath it. */
export function createGemini(host: Host, config: Config): Gemini {
  const state: KeyState = { preferred: 0 }
  return {
    enroll: input => enroll(host, input),
    settings: ({ consumer }) => settingsFor(host, config, consumer),
    request: ({ consumer, body }) => request(host, config, state, consumer, body),
    read: async input => readWithKeys(input, await apiKeys(host, config), state),
    configure: change => configure(host, change),
  }
}

async function statusOf($: EngineInterface, config: Config): Promise<string> {
  const mods = Object.keys(consumersOf(await $.store.get(KEYS.consumers))).sort()
  const lines: ConsumerLine[] = []
  for (const consumer of mods) {
    const s = await $.gemini.settings({ consumer })
    lines.push({ consumer, model: s.model, ...(s.thinking === undefined ? {} : { thinking: s.thinking }) })
  }
  const tier = await $.store.get(KEYS.tier)
  const keys = config.apiKeys.length > 0 ? config.apiKeys : parseKeys(await $.env.get('GEMINI_API_KEY'))
  return statusText(isTier(tier) ? tier : config.tier, keys.length, lines)
}

async function runCommand($: EngineInterface, config: Config, args: string): Promise<string> {
  const command = parseCommand(args)
  if (command.kind === 'error') return command.text
  if (command.kind === 'status') return statusOf($, config)
  try {
    return await $.gemini.configure(command.change)
  } catch (err) {
    return errorText(err)
  }
}

export const register: Register = (on, options) => {
  const config = configFrom(options)

  on('engine.create', async (_, e, next) => {
    const below = await next(e)
    const host: Host = {
      get: key => below.store.get(key),
      set: (key, value) => below.store.set(key, value),
      del: key => below.store.delete(key),
      envKey: () => below.env.get('GEMINI_API_KEY'),
    }
    return { ...below, gemini: createGemini(host, config) }
  })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'gemini-core',
      description: 'Gemini settings of every Gemini mod: status, free, paid, model <mod> <id>, thinking <mod> <level|default>, reset (gemini-core)',
      argumentHint: '[free | paid | model <mod> <id> | thinking <mod> <level|default> | reset]',
    })
    return r
  })

  on('command.run', { command: 'gemini-core' }, async ($, e) => ({ text: await runCommand($, config, String(e.args ?? '')) }))
}
