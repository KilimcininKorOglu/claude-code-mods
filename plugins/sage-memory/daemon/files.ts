import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { codeOf } from './log.ts'

/** Writes a file through a temporary file and a rename, readable by the owner alone. */
export function writeAtomic(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, text, { mode: 0o600 })
  renameSync(temp, path)
}

/** What `read` answers, or undefined when it failed because the file does not exist. */
export function unlessMissing<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return undefined
    throw err
  }
}

/** The codes that mean nothing is at a path: it does not exist, or a part of it is a file. */
const MISSING = new Set(['ENOENT', 'ENOTDIR'])

/** What `probe` resolves to, or undefined when it failed because nothing is at the path it reads. */
export async function unlessMissingAsync<T>(probe: () => Promise<T>): Promise<T | undefined> {
  try {
    return await probe()
  } catch (err) {
    if (MISSING.has(codeOf(err) ?? '')) return undefined
    throw err
  }
}

/** A file's text, or undefined when the file does not exist. */
export function readIfExists(path: string): string | undefined {
  return unlessMissing(() => readFileSync(path, 'utf8'))
}

/** A file's inode, or undefined when the file does not exist. */
export function inodeOf(path: string): number | undefined {
  return unlessMissing(() => statSync(path).ino)
}

/** A file's size in bytes, or undefined when the file does not exist. */
export function sizeOf(path: string): number | undefined {
  return unlessMissing(() => statSync(path).size)
}
