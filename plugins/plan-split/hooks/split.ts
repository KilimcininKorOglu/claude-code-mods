/** The models a fresh install routes to: plan mode on Fable, every other mode on Opus. */
export const DEFAULT_PLAN = 'fable'
export const DEFAULT_CODE = 'opus'

/** The aliases Claude Code resolves through `ANTHROPIC_DEFAULT_<ALIAS>_MODEL`. */
export const ALIASES = ['fable', 'opus', 'sonnet', 'haiku'] as const

/** The environment variable that names the model behind an alias. */
export const envName = (alias: string): string => `ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`

const MODEL_NAME = /^[a-z0-9][a-z0-9.\-[\]]{0,99}$/i

/** The model a `/plan-split plan|code <model>` names, or an error text when it is not a model name. */
export function parseModel(text: string): { model: string } | { error: string } {
  const model = text.trim()
  if (model === '') return { error: 'expects a model: an alias (fable, opus, sonnet, haiku) or a model id' }
  if (!MODEL_NAME.test(model)) return { error: `"${model.slice(0, 40)}" is not a model name` }
  return { model }
}

/** A stored model setting: a model name, else the default. */
export function storedModel(value: unknown, fallback: string): string {
  return typeof value === 'string' && MODEL_NAME.test(value) ? value : fallback
}

/** Settings the turn.step hook routes from, as the last read of the store and the environment left them. */
export type Route = { plan: string; code: string; env: Readonly<Record<string, string | undefined>> }

/** The model id behind a setting: an alias with its environment variable set reads as that id. */
export function resolved(model: string, env: Route['env']): string {
  const lower = model.toLowerCase()
  if (!(ALIASES as readonly string[]).includes(lower)) return model
  return env[envName(lower)] ?? lower
}

/**
 * The model a main-loop request goes to in a permission mode: the plan model in `plan`, the code model
 * in any other mode, and undefined while no mode is known, so the request keeps the session's model.
 */
export function routeFor(mode: string | undefined, route: Route): string | undefined {
  if (mode === undefined) return undefined
  return resolved(mode === 'plan' ? route.plan : route.code, route.env)
}

/** The permission mode a classic hook input carries for the main loop; a subagent's input names none. */
export function mainLoopMode(input: { permission_mode?: string; agent_id?: string }): string | undefined {
  return input.agent_id === undefined ? input.permission_mode : undefined
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

/** The section: which model each side names, and which one the main loop runs on now. */
export function sectionLines(route: Route, mode: string | undefined, model: string | undefined): Line[] {
  const sides: Line = { text: `plan ${route.plan} · code ${route.code}`, kind: 'dim' }
  if (mode === undefined || model === undefined) return [{ text: 'waiting for the first prompt', kind: 'dim' }, sides]
  const side = mode === 'plan' ? 'plan' : 'code'
  const parts: Part[] = [{ text: `${side} · ` }, { text: model, kind: 'ok' }]
  return [{ text: parts.map(p => p.text).join(''), parts }, sides]
}

/** The transcript line a switch writes while the sidebar is closed. */
export const switchText = (mode: string, model: string): string => `${mode} mode: the main loop runs on ${model}`
