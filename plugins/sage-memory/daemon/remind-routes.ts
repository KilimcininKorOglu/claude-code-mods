import { nextEpoch } from './contexts.ts'
import { opFor, placesOf } from './places.ts'
import { alwaysFor, rankForPrompt, rankForSubagent, rankForTools, type Readers } from './remind.ts'
import { flag, optionalCount, optionalString, optionalText, requiredString, stringList, type Body } from './request.ts'
import type { Route, Routes } from './routes.ts'
import { transaction, type Stores } from './stores.ts'

/**
 * The routes a reminder is ranked through, and the one that starts a loop's context over. A
 * ranking writes nothing; `/memory/reminded` records what the hooks module then sent.
 */

/** How many memories a reminder may carry at most, whatever its budget. */
const MAX_REMINDER = 50

function readersOf(stores: Stores, body: Body): Readers {
  const places = placesOf(stores, body)
  return { project: opFor(places, places.project), user: opFor(places, places.global), sessionId: optionalString(body, 'sessionId'), loop: optionalString(body, 'loop') }
}

export function remindRoutes(stores: Stores): Routes {
  const post = (handle: (body: Body) => unknown): Route => ({ method: 'POST', auth: true, handle: ({ body }) => handle(body) })
  return {
    '/remind/tools': post(body =>
      rankForTools(readersOf(stores, body), {
        paths: stringList(body, 'paths'),
        query: optionalText(body, 'query'),
        mutation: flag(body, 'mutation'),
        limit: optionalCount(body, 'limit', MAX_REMINDER) ?? 8,
      }),
    ),
    '/remind/prompt': post(body => rankForPrompt(readersOf(stores, body), { query: requiredString(body, 'query'), limit: optionalCount(body, 'limit', MAX_REMINDER) ?? 8 })),
    '/remind/subagent': post(body =>
      rankForSubagent(readersOf(stores, body), {
        role: optionalString(body, 'role'),
        mode: optionalString(body, 'mode'),
        task: optionalText(body, 'task'),
        audienceLimit: optionalCount(body, 'audienceLimit', 100) ?? 20,
        taskLimit: optionalCount(body, 'taskLimit', MAX_REMINDER) ?? 8,
      }),
    ),
    '/remind/always': post(body => alwaysFor(readersOf(stores, body), optionalCount(body, 'limit', 500) ?? 100)),
    '/context/new': post(async body => {
      const places = placesOf(stores, body)
      const sessionId = requiredString(body, 'sessionId')
      const loop = requiredString(body, 'loop')
      return { epoch: await transaction(places.project, () => nextEpoch(opFor(places, places.project), sessionId, loop)) }
    }),
  }
}
