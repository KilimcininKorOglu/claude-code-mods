import { isProjectKey } from '../hooks/shared/layout.ts'
import { KINDS, SCOPES, STATUSES, type Kind, type Scope, type Status } from '../hooks/shared/model.ts'
import type { ProjectRef } from '../hooks/shared/protocol.ts'
import { refused } from './errors.ts'

/** Reading the fields of a request body; a field of the wrong type is refused with its name. */

export type Body = Record<string, unknown>

export function requiredString(body: Body, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') throw refused(`${key} must be a non-empty string`)
  return value
}

/** The field `key`, undefined while the body leaves it out; a value `is` refuses is refused as not `expected`. */
function given<T>(body: Body, key: string, is: (value: unknown) => value is T, expected: string): T | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (!is(value)) throw refused(`${key} must be ${expected}`)
  return value
}

const isString = (value: unknown): value is string => typeof value === 'string'

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

/** A string field; a null reads as left out too. */
export function optionalString(body: Body, key: string): string | undefined {
  return body[key] === null ? undefined : given(body, key, isString, 'a string')
}

/** True only for a literal `true`: a flag is never set by accident. */
export function flag(body: Body, key: string): boolean {
  return flagOr(body, key, false)
}

/** A flag that holds `fallback` while the body leaves it out. */
export function flagOr(body: Body, key: string, fallback: boolean): boolean {
  return given(body, key, isBoolean, 'true or false') ?? fallback
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
  const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
  return given(body, key, isCount, `a whole number from 1 to ${max}`)
}

/** A text field that may be empty, such as a query that lists everything. */
export function optionalText(body: Body, key: string): string {
  return optionalString(body, key) ?? ''
}

function oneOf<T extends string>(values: readonly T[], value: string, key: string): T {
  if (!(values as readonly string[]).includes(value)) throw refused(`${key} must be one of: ${values.join(', ')}`)
  return value as T
}

function optionalChoice<T extends string>(body: Body, key: string, values: readonly T[]): T | undefined {
  const value = optionalString(body, key)
  return value === undefined ? undefined : oneOf(values, value, key)
}

export function optionalScope(body: Body): Scope | undefined {
  return optionalChoice(body, 'scope', SCOPES)
}

export function optionalKind(body: Body): Kind | undefined {
  return optionalChoice(body, 'kind', KINDS)
}

/** A list of statuses, each a known one; absent answers the fallback. */
export function statusList(body: Body, key: string, fallback: readonly Status[]): Status[] {
  if (body[key] === undefined) return [...fallback]
  return stringList(body, key).map(status => oneOf(STATUSES, status, key))
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
