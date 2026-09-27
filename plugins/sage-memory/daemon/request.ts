import { isProjectKey } from '../hooks/shared/layout.ts'
import type { ProjectRef } from '../hooks/shared/protocol.ts'
import { refused } from './errors.ts'

/** Reading the fields of a request body; a field of the wrong type is refused with its name. */

export type Body = Record<string, unknown>

export function requiredString(body: Body, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') throw refused(`${key} must be a non-empty string`)
  return value
}

export function optionalString(body: Body, key: string): string | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw refused(`${key} must be a string`)
  return value
}

/** True only for a literal `true`: a flag is never set by accident. */
export function flag(body: Body, key: string): boolean {
  const value = body[key]
  if (value !== undefined && typeof value !== 'boolean') throw refused(`${key} must be true or false`)
  return value === true
}

export function requiredObject<T>(body: Body, key: string): T {
  const value = body[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw refused(`${key} must be an object`)
  return value as T
}

export function optionalObject<T>(body: Body, key: string): T | undefined {
  return body[key] === undefined ? undefined : requiredObject<T>(body, key)
}

export function stringList(body: Body, key: string): string[] {
  const value = body[key]
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw refused(`${key} must be an array of strings`)
  return value as string[]
}

export function optionalCount(body: Body, key: string, max: number): number | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) throw refused(`${key} must be a whole number from 1 to ${max}`)
  return value
}

/** The project a request is about; its key names the store directory and its root anchors paths. */
export function projectOf(body: Body): ProjectRef {
  const project = requiredObject<Partial<ProjectRef>>(body, 'project')
  const key = requiredString(project as Body, 'key')
  if (!isProjectKey(key)) throw refused(`project.key is not a project key: ${JSON.stringify(key)}`)
  const root = requiredString(project as Body, 'root')
  if (!root.startsWith('/')) throw refused('project.root must be an absolute path')
  return { key, root, name: requiredString(project as Body, 'name'), commonDir: requiredString(project as Body, 'commonDir') }
}
