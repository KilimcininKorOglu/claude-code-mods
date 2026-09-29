/** The directory a round keeps its proof in, relative to the working directory. */
export function proofDir(id: string): string {
  return `.temp_files/bughunt/${id}`
}

/** A path relative to `cwd` when it lies under it, `./` and trailing `/` removed. */
export function relativeTo(cwd: string, path: string): string {
  const base = cwd.replace(/\/+$/, '')
  const inside = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
  return inside.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
}

/** Whether `path` is `dir` or lies under it. */
export function under(path: string, dir: string): boolean {
  const d = dir.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
  return d === '' || path === d || path.startsWith(`${d}/`)
}

const TEST_PATH = [/(^|\/)(tests?|__tests__|specs?)\//, /\.(test|spec)\.[^/]+$/, /_test\.[^/]+$/, /(^|\/)test_[^/]+\.py$/]

/** Whether the path looks like a test file. */
export function isTestPath(path: string): boolean {
  return TEST_PATH.some(r => r.test(path))
}

/** Whether the path lies in the hunt's target; an empty target is the whole project. */
export function inScope(path: string, target: string): boolean {
  const parts = target.split(/\s+/).filter(t => t !== '')
  return parts.length === 0 || parts.some(t => under(path, t))
}

export type EditGate = { skill: boolean; failed: boolean; target: string; dir: string }
export type EditRule = 'skill' | 'proof' | 'scope'

/** The rule an edit of `path` breaks in a running round, or undefined. */
export function editRule(path: string, gate: EditGate): EditRule | undefined {
  if (!gate.skill) return 'skill'
  if (under(path, gate.dir)) return undefined
  if (!gate.failed) return 'proof'
  if (isTestPath(path)) return undefined
  return inScope(path, gate.target) ? undefined : 'scope'
}
