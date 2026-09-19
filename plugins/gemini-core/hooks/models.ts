/** The Gemini models a key can use, as Google lists them, and the text /gemini-core prints of them. */
import { MODEL_ID } from './api.ts'

/** One model a mod can be set to. */
export type ModelInfo = { id: string; displayName: string; thinking: boolean; inputTokenLimit: number }

/** The model list request: every model on one page (58 on the checked key), the key in a header. */
export function modelsRequest(key: string): { url: string; init: { method: 'GET'; headers: Record<string, string> } } {
  return { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', init: { method: 'GET', headers: { 'x-goog-api-key': key } } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A text model: it takes generateContent, its id is a Gemini id, and its name marks no speech or image output. */
function modelOf(entry: unknown): ModelInfo | undefined {
  if (!isRecord(entry) || typeof entry.name !== 'string') return undefined
  const id = entry.name.replace(/^models\//, '')
  const methods = Array.isArray(entry.supportedGenerationMethods) ? entry.supportedGenerationMethods : []
  if (!methods.includes('generateContent') || !id.startsWith('gemini-') || !MODEL_ID.test(id) || /tts|image/.test(id)) return undefined
  return {
    id,
    displayName: typeof entry.displayName === 'string' ? entry.displayName : id,
    thinking: entry.thinking === true,
    inputTokenLimit: typeof entry.inputTokenLimit === 'number' ? entry.inputTokenLimit : 0,
  }
}

/** The text models of a models.list response, by id; an HTTP error or a body that is not the list throws. */
export function parseModels(status: number, ok: boolean, text: string): ModelInfo[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`the model list came back as no JSON (HTTP ${status})`)
  }
  if (!ok) {
    const error = isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string' ? value.error.message : 'no message'
    throw new Error(`the model list failed: Gemini HTTP ${status}: ${error.slice(0, 200)}`)
  }
  const models = isRecord(value) && Array.isArray(value.models) ? value.models : undefined
  if (models === undefined) throw new Error('the model list came back without models')
  return models.map(modelOf).filter((m): m is ModelInfo => m !== undefined).sort((a, b) => a.id.localeCompare(b.id))
}

function tokens(n: number): string {
  return n >= 1_000_000 ? `${Math.round(n / 1_048_576)}M` : `${Math.round(n / 1024)}k`
}

/** One line per model: `gemini-3.8-flash · thinking · 1M in`. */
export function modelsText(models: readonly ModelInfo[]): string {
  if (models.length === 0) return 'the key lists no Gemini text model'
  return models.map(m => `${m.id} · ${m.thinking ? 'thinking' : 'no thinking'} · ${tokens(m.inputTokenLimit)} in`).join('\n')
}

/** The number of single-character edits between two ids. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)))
    row = next
  }
  return row[b.length] ?? 0
}

/** Why an id is not taken, with the closest ids the key lists; undefined when it is listed. */
export function unknownModel(id: string, models: readonly ModelInfo[]): string | undefined {
  if (models.some(m => m.id === id)) return undefined
  const near = [...models].sort((a, b) => distance(id, a.id) - distance(id, b.id)).slice(0, 3).map(m => m.id)
  return `${id} is not a Gemini text model this key lists${near.length === 0 ? '' : `; closest: ${near.join(', ')}`}. /gemini-core models lists them.`
}
