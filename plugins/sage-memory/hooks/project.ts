/**
 * Which project a session works in, and the key of its store directory. Pure string code; the hooks
 * module runs git and hashes the key's source with `crypto.subtle`.
 */

function trimSlashes(path: string): string {
  return path.replace(/\/+$/, '')
}

function baseName(path: string): string {
  return trimSlashes(path).split('/').at(-1) ?? ''
}

function parentOf(path: string): string {
  return trimSlashes(path).split('/').slice(0, -1).join('/')
}

/**
 * The primary repository's name from the git common dir, which names the main repository also
 * inside a linked worktree, or "" when the dir has neither shape.
 */
function nameFromCommonDir(commonDir: string): string {
  if (commonDir === '') return ''
  if (baseName(commonDir) === '.git') return baseName(parentOf(commonDir))
  const worktrees = parentOf(commonDir)
  if (baseName(worktrees) === 'worktrees' && baseName(parentOf(worktrees)) === '.git') return baseName(parentOf(parentOf(worktrees)))
  return ''
}

/** The project's name as memory-save names it: the primary repository, else the git top level, else the working directory. */
export function projectNameFrom(commonDir: string, topLevel: string, cwd: string): string {
  const fromCommon = nameFromCommonDir(commonDir.trim())
  if (fromCommon !== '') return fromCommon
  const top = topLevel.trim()
  return top !== '' ? baseName(top) : baseName(cwd)
}

/** The text the key's hash is taken of: the git common dir, so every worktree of one repository shares a store, else the directory. */
export function keySource(commonDir: string, cwd: string): string {
  const common = commonDir.trim()
  return common !== '' ? trimSlashes(common) : trimSlashes(cwd)
}

/** Lowercase hex of a digest. */
export function hexOf(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The store key: the name with every character outside `[A-Za-z0-9._-]` made a dash and no `..`, cut to 60
 * characters, then the first 8 hex digits of the source's SHA-256, so two checkouts named alike
 * keep two stores.
 */
export function projectKey(name: string, sha256Hex: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/\.{2,}/g, '.').replace(/^[^A-Za-z0-9]+/, '').slice(0, 60)
  return `${safe === '' ? 'project' : safe}-${sha256Hex.slice(0, 8)}`
}
