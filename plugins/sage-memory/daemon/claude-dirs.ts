import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { messageOf } from './log.ts'
import type { Places } from './places.ts'
import type { Store } from './stores.ts'
import type { VerifyScope } from './verify.ts'

/**
 * What Claude Code keeps beside the daemon's own directory (`<config dir>/sage-memory`) that the
 * daemon reads: the user's agent files and the session transcripts.
 */

/** Where a store's anchors are read from: a project's root and its `.claude/agents`, and the user's `agents` directory. */
export function verifyScopeOf(dir: string, places: Places, store: Store): VerifyScope {
  const userAgents = join(dirname(dir), 'agents')
  if (store === places.global) return { root: undefined, agentDirs: [userAgents] }
  return { root: places.root, agentDirs: [join(places.root, '.claude', 'agents'), userAgents] }
}

export function transcriptsDirOf(dir: string): string {
  return join(dirname(dir), 'projects')
}

/**
 * The sessions whose transcripts Claude Code still keeps: `<session id>.jsonl` in a project
 * directory under `projects`. A directory that cannot be read answers the error, so that no
 * session is taken for gone.
 */
export async function keptTranscripts(projectsDir: string): Promise<{ ids: Set<string> } | { error: string }> {
  try {
    const ids = new Set<string>()
    for (const project of await readdir(projectsDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      for (const name of await readdir(join(projectsDir, project.name))) {
        if (name.endsWith('.jsonl')) ids.add(name.slice(0, -'.jsonl'.length))
      }
    }
    return { ids }
  } catch (err) {
    return { error: `the transcripts could not be read: ${messageOf(err)}` }
  }
}
