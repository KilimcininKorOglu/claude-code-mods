/** What a scan of one repository finds. The functions that run it take `$`, so they live in register.tsx. */
import type { Class } from './classify.ts'

/** An artifact directory, relative to the repository root. */
export type Found = { path: string; cls: Exclude<Class, 'data'> }

/** What one scan found: the artifacts with their sizes in KB, and the data directories it left alone. */
export type Scan = { root: string; found: Found[]; sizes: Map<string, number>; data: string[] }

/** No more directories than this are listed, so a huge monorepo stays quick. */
export const MAX_FOUND = 500
