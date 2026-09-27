import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { refused, RequestError } from './errors.ts'
import { codeOf } from './log.ts'

/** The real path of `path`, or of its nearest existing ancestor with the missing tail put back. */
function canonical(path: string): string {
  const missing: string[] = []
  let probe = resolve(path)
  for (;;) {
    try {
      return join(realpathSync(probe), ...missing)
    } catch (err) {
      const code = codeOf(err)
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err
    }
    const parent = dirname(probe)
    if (parent === probe) return resolve(path)
    missing.unshift(basename(probe))
    probe = parent
  }
}

function escapes(rel: string): boolean {
  return rel === '..' || rel.startsWith('../') || isAbsolute(rel)
}

/** Whether `target` is `root` or lies under it, compared as the two paths are written. */
export function isInside(root: string, target: string): boolean {
  return !escapes(relative(root, target))
}

/** One slash between segments. */
export function slashes(path: string): string {
  return path.replace(/\/+/g, '/')
}

/**
 * A path relative to the project root. Where the path leads, every link followed, must lie inside
 * the root, so a link out of the project is refused. The caller's own name is kept with its
 * directories resolved; a path named through a link from outside the project is kept as the
 * project path it leads to. The file need not exist: an anchor may name a file about to be written.
 */
export function projectPath(root: string, input: string): string {
  const realRoot = canonical(root)
  const raw = isAbsolute(input) ? resolve(input) : resolve(realRoot, input)
  const target = relative(realRoot, canonical(raw))
  if (escapes(target)) throw refused(`the path ${input} is outside the project root`)
  const named = relative(realRoot, join(canonical(dirname(raw)), basename(raw)))
  const rel = escapes(named) ? target : named
  return slashes(rel === '' ? '.' : rel)
}

/** The project path of `input`, or undefined when it leads outside the project root. */
export function projectPathIfInside(root: string, input: string): string | undefined {
  try {
    return projectPath(root, input)
  } catch (err) {
    if (err instanceof RequestError && err.status === 400) return undefined
    throw err
  }
}

/** `a/b/c` → `['a/b/c', 'a/b', 'a']`; the root is `['.']`. */
export function ancestorPaths(path: string): string[] {
  const normalized = slashes(path)
  if (normalized === '.') return ['.']
  const parts = normalized.split('/').filter(Boolean)
  return parts.map((_, i) => parts.slice(0, parts.length - i).join('/'))
}
