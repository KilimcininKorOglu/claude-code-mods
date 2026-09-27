import type { EmbedStatus, SetupJob } from '../hooks/shared/protocol.ts'
import type { Embeddings } from './embeddings.ts'
import type { Route, Routes } from './routes.ts'
import type { Setup } from './setup.ts'

/** The state of the embeddings and of the setup job, and the start of setup, which the hooks module then polls. */
export function embedRoutes(embeddings: Embeddings, setup: Setup): Routes {
  const post = (handle: () => unknown): Route => ({ method: 'POST', auth: true, handle })
  return {
    '/embed/status': post((): EmbedStatus => ({ embedding: embeddings.state(), setup: setup.job() })),
    '/embed/setup': post((): SetupJob => setup.start()),
  }
}
