import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { isProjectKey } from '../hooks/shared/layout.ts'
import type { ProjectRef } from '../hooks/shared/protocol.ts'

/**
 * The project stores a session reads besides its own: those whose root is a folder above the
 * session's root or below it (the user's choice), so a session in `app/client-ios` with its own git
 * repository still sees the notes of `app`, and one in `app` sees those of `app/client-ios`. A
 * sibling folder's store is not read. The home directory and every folder above it are no project:
 * a store rooted there would reach every project, and a session there would read every store.
 * Writes still go to the session's own store.
 */

/** The projects whose stores are on disk, from the `project.json` each store directory holds. */
export function projectRefs(dir: string): ProjectRef[] {
  if (!existsSync(dir)) return []
  const refs: ProjectRef[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name, 'project.json')
    if (!entry.isDirectory() || !isProjectKey(entry.name) || !existsSync(file)) continue
    const ref = JSON.parse(readFileSync(file, 'utf8')) as Partial<ProjectRef>
    if (ref.key !== entry.name || typeof ref.root !== 'string' || typeof ref.name !== 'string' || typeof ref.commonDir !== 'string') {
      throw new Error(`${file} does not describe the project store it sits in`)
    }
    refs.push({ key: ref.key, name: ref.name, root: ref.root, commonDir: ref.commonDir })
  }
  return refs
}

/** A folder as the file system names it (`/tmp` is `/private/tmp` on macOS), without a trailing slash; a folder that is gone keeps its name. */
export function canonical(path: string): string {
  const trimmed = path.replace(/\/+$/, '') || '/'
  // A removed folder has no real path; its recorded name is the only one left to compare.
  return existsSync(trimmed) ? realpathSync.native(trimmed) : trimmed
}

/** Whether `inner` is `outer` or a folder below it, compared by whole path segments. */
function within(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(outer === '/' ? '/' : `${outer}/`)
}

/** Whether a folder is the home directory or above it, which is no project. */
export function isAboveProjects(root: string, home: string): boolean {
  return within(home, root)
}

/**
 * An anchor path written from one store's root, as the session names it from its own root: a path
 * inside the session's root becomes relative to it (`Sources/App.swift` of `app/client-ios` is
 * `client-ios/Sources/App.swift` from `app`), a path outside it stays absolute.
 */
export function rebase(path: string, from: string, to: string): string {
  const absolute = isAbsolute(path) ? path : join(from, path)
  const rel = relative(to, absolute)
  if (rel === '') return '.'
  return rel.startsWith('..') || isAbsolute(rel) ? absolute : rel
}

/** The stores of `refs` whose roots lie above or below `session`'s root, never its own store, nor a root at or above `home`. */
export function nestedRefs(session: ProjectRef, refs: readonly ProjectRef[], home: string = canonical(homedir())): ProjectRef[] {
  const root = canonical(session.root)
  if (isAboveProjects(root, home)) return []
  return refs.filter(ref => {
    if (ref.key === session.key) return false
    const other = canonical(ref.root)
    if (other === root || isAboveProjects(other, home)) return false
    return within(root, other) || within(other, root)
  })
}
