import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { unlessMissingAsync } from './files.ts'
import { messageOf } from './log.ts'
import { isInside } from './paths.ts'

/** The git blob hashes of files, by the absolute path an anchor names, and why git could not hash them. */
export type Blobs = { hashes: Map<string, string>; error?: string }

const HASH_TIMEOUT_MS = 30_000

/** The real path of a regular file inside the real root, or undefined. */
async function fileInside(realRoot: string, path: string): Promise<string | undefined> {
  const real = await unlessMissingAsync(() => realpath(path))
  if (real === undefined || !isInside(realRoot, real)) return undefined
  return (await stat(real)).isFile() ? real : undefined
}

function hashObjects(root: string, reals: readonly string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const options = { cwd: root, timeout: HASH_TIMEOUT_MS, env: { ...process.env, LC_ALL: 'C' } }
    const child = execFile('git', ['hash-object', '--stdin-paths'], options, (err, stdout, stderr) => {
      if (err) reject(new Error(`git hash-object failed: ${stderr.trim() || err.message}`))
      else resolve(stdout.split('\n').map(line => line.trim()))
    })
    child.stdin?.on('error', reject)
    child.stdin?.end(`${reals.join('\n')}\n`)
  })
}

/**
 * Hashes the files in one `git hash-object --stdin-paths` run in the root, each through its real
 * path, since git hashes a link itself. Only regular files inside the root are passed: git prints
 * no line for a path it cannot read, which would shift every line after it.
 */
export async function gitBlobs(root: string, realRoot: string, paths: readonly string[]): Promise<Blobs> {
  const blobs: Blobs = { hashes: new Map() }
  try {
    const files: Array<{ path: string; real: string }> = []
    for (const path of new Set(paths)) {
      const real = await fileInside(realRoot, path)
      if (real !== undefined) files.push({ path, real })
    }
    if (files.length === 0) return blobs
    const lines = await hashObjects(root, files.map(file => file.real))
    files.forEach((file, index) => {
      const hash = lines[index]
      if (hash) blobs.hashes.set(file.path, hash)
    })
  } catch (err) {
    blobs.error = messageOf(err)
  }
  return blobs
}
