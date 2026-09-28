import { nextEpoch } from './contexts.ts'
import type { Embeddings } from './embeddings.ts'
import { opFor, placesOf } from './places.ts'
import { rankForPrompt, rankForSubagent, rankForTools, type Readers } from './remind.ts'
import { flag, optionalCount, optionalString, optionalText, requiredString, stringList, type Body } from './request.ts'
import type { Route, Routes } from './routes.ts'
import { transaction, type Stores } from './stores.ts'

/**
 * The routes a reminder is ranked through, and the one that starts a loop's context over. A
 * ranking writes nothing; `/memory/reminded` records what the hooks module then sent.
 */

/** How many memories a reminder may carry at most, whatever its budget. */
const MAX_REMINDER = 50

/** Both stores as a reminder reads them, with the vector of `query` while embeddings are on. */
async function readersOf(stores: Stores, embeddings: Embeddings, body: Body, query: string): Promise<Readers> {
  const places = placesOf(stores, body)
  return {
    project: opFor(places, places.project),
    user: opFor(places, places.global),
    sessionId: optionalString(body, 'sessionId'),
    loop: optionalString(body, 'loop'),
    semantic: await embeddings.semantic(query, [places.project, places.global]),
  }
}

export function remindRoutes(stores: Stores, embeddings: Embeddings): Routes {
  const post = (handle: (body: Body) => unknown): Route => ({ method: 'POST', auth: true, handle: ({ body }) => handle(body) })
  const readers = (body: Body, query: string): Promise<Readers> => readersOf(stores, embeddings, body, query)
  return {
    '/remind/tools': post(async body => {
      const request = { paths: stringList(body, 'paths'), query: optionalText(body, 'query'), mutation: flag(body, 'mutation'), limit: optionalCount(body, 'limit', MAX_REMINDER) ?? 8 }
      return rankForTools(await readers(body, request.query), request)
    }),
    '/remind/prompt': post(async body => {
      const request = { query: requiredString(body, 'query'), limit: optionalCount(body, 'limit', MAX_REMINDER) ?? 8 }
      return rankForPrompt(await readers(body, request.query), request)
    }),
    '/remind/subagent': post(async body => {
      const request = {
        role: optionalString(body, 'role'),
        mode: optionalString(body, 'mode'),
        task: optionalText(body, 'task'),
        audienceLimit: optionalCount(body, 'audienceLimit', 100) ?? 20,
        taskLimit: optionalCount(body, 'taskLimit', MAX_REMINDER) ?? 8,
      }
      return rankForSubagent(await readers(body, request.task), request)
    }),
    '/context/new': post(async body => {
      const places = placesOf(stores, body)
      const sessionId = requiredString(body, 'sessionId')
      const loop = requiredString(body, 'loop')
      return { epoch: await transaction(places.project, () => nextEpoch(opFor(places, places.project), sessionId, loop)) }
    }),
  }
}
