import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RememberInput } from '../../hooks/shared/model.ts'
import { ftsTerms } from '../fts.ts'
import { assessQuality, checkRemember, isEphemeral, isNearDuplicate, isPossiblyContradictory, normalizeAudience, rejectSecrets } from '../rules.ts'

/** The refusal `checkRemember` gives an input, or '' when it takes it. */
function message(input: Partial<RememberInput>): string {
  try {
    checkRemember({ text: 'Run the migrations with pnpm db:migrate', ...input } as RememberInput)
    return ''
  } catch (err) {
    return (err as Error).message
  }
}

describe('what remember refuses', () => {
  test('a secret or credential anywhere in the input refuses the whole write', () => {
    const secrets = [
      'deploy with ghp_abcdefghijklmnopqrstuvwxyz0123',
      'AKIAABCDEFGHIJKLMNOP is the key',
      '-----BEGIN RSA PRIVATE KEY-----',
      'password: correct-horse-battery-staple',
      'the key is sk-ant-abcdefghijklmnop1234',
    ]
    for (const text of secrets) assert.throws(() => rejectSecrets({ text }), /looks like it holds a secret/, text)
    assert.throws(() => rejectSecrets({ text: 'fine', tags: ['token=abcdefghijklmnop1234'] }), /secret/)
    assert.doesNotThrow(() => rejectSecrets({ text: 'Tokens expire after one hour; refresh them with the session cookie' }))
  })

  test('progress chatter is refused outside the session scope, and a WIP word as a subject is not chatter', () => {
    assert.equal(isEphemeral('TODO implement retries'), true)
    assert.equal(isEphemeral('still working on the parser'), true)
    assert.equal(isEphemeral('fixed the bug'), true)
    assert.equal(isEphemeral('Todo list items sync with the Kanban board'), false)
    assert.equal(isEphemeral('We decided to keep the WIP limit at three'), false)
    assert.match(message({ text: 'TODO implement retries' }), /progress chatter/)
    assert.equal(message({ text: 'TODO implement retries', scope: 'session', ownerSessionId: 's1' }), '')
  })

  test('the text is bounded, and a session memory names its session', () => {
    assert.match(message({ text: '   ' }), /the text is empty/)
    assert.match(message({ text: 'abc' }), /under 4 characters/)
    assert.match(message({ text: 'x'.repeat(20_001) }), /over 20000 characters/)
    assert.match(message({ scope: 'session' }), /needs ownerSessionId/)
  })

  test('a structural kind needs an anchor, and each anchor type needs its target', () => {
    assert.match(message({ kind: 'file_note' }), /file_note needs at least one anchor/)
    assert.equal(message({ kind: 'file_note', anchors: [{ type: 'file', path: 'src/app.ts' }] }), '')
    assert.match(message({ anchors: [{ type: 'command' }] }), /command anchor needs a command/)
    assert.match(message({ anchors: [{ type: 'agent', role: 'no spaces' }] }), /agent anchor needs a role/)
    assert.match(message({ anchors: [{ type: 'symbol', path: 'src/app.ts' }] }), /symbol anchor needs a symbol/)
    assert.match(message({ anchors: [{ type: 'directory' }] }), /directory anchor needs a path/)
    assert.match(message({ anchors: [{ type: 'url' as 'file', path: 'x' }] }), /anchor type must be one of/)
  })

  test('enums, lists, scores and times are checked', () => {
    assert.match(message({ scope: 'team' as 'project' }), /scope must be one of/)
    assert.match(message({ kind: 'rumor' as 'fact' }), /kind must be one of/)
    assert.match(message({ contextPolicy: 'sometimes' as 'auto' }), /contextPolicy must be one of/)
    assert.match(message({ tags: Array.from({ length: 129 }, (_, i) => `t${i}`) }), /more than 128 items/)
    assert.match(message({ importance: Number.NaN }), /importance must be a number/)
    assert.match(message({ expiresAt: 'next week' }), /ISO-8601/)
  })

  test('an audience takes roles and modes, lowercased, distinct and sorted', () => {
    assert.deepEqual(normalizeAudience({ roles: ['Reviewer', 'explore', 'reviewer'] }), { roles: ['explore', 'reviewer'] })
    assert.equal(normalizeAudience({}), undefined)
    assert.equal(normalizeAudience({ roles: [' '] }), undefined)
    assert.throws(() => normalizeAudience({ taskTypes: ['review'] }), /takes roles and modes only/)
  })
})

describe('score caps for defaulted scores', () => {
  const base = { kind: 'fact' as const, anchors: [], tags: [], scope: 'project' as const }

  test('an unanchored project memory is capped below an anchored one', () => {
    const caps = assessQuality({ ...base, text: 'Deploys go through the staging branch first' })
    assert.deepEqual([caps.confidence, caps.importance], [0.75, 0.7])
    const anchored = assessQuality({ ...base, text: 'Deploys go through the staging branch first', anchors: [{ type: 'file', path: 'deploy.sh' }] })
    assert.deepEqual([anchored.confidence, anchored.importance], [1, 1])
  })

  test('a user or session memory keeps its importance without an anchor', () => {
    const caps = assessQuality({ ...base, scope: 'user', text: 'Prefer pnpm over npm in every project' })
    assert.deepEqual([caps.confidence, caps.importance], [0.75, 1])
  })

  test('short texts, few terms and unanchored root causes are capped lower', () => {
    assert.equal(assessQuality({ ...base, text: 'use pnpm' }).confidence, 0.55)
    assert.equal(assessQuality({ ...base, kind: 'bug_root_cause', text: 'The cache key ignored the locale header value' }).confidence, 0.65)
  })
})

describe('text search terms', () => {
  test('every term is quoted, so an operator word or punctuation cannot change the query, and a repeat counts once', () => {
    assert.deepEqual(ftsTerms('NOT "x" OR near: Cache cache'), ['"not"*', '"or"*', '"near"*', '"cache"*'])
    assert.equal(ftsTerms(Array.from({ length: 100 }, (_, i) => `term${i}`).join(' ')).length, 64)
  })
})

describe('when two texts are one memory', () => {
  const fact = (text: string, anchors = [] as { type: 'file'; path: string }[]) => ({ text, kind: 'fact' as const, anchors })

  test('a paraphrase with the same terms merges, a different kind or a short text does not', () => {
    const a = fact('Run database migrations with pnpm before starting the dev server')
    const b = fact('Before starting the dev server run database migrations with pnpm')
    assert.equal(isNearDuplicate(a, b), true)
    assert.equal(isNearDuplicate(a, { ...b, kind: 'decision' }), false)
    assert.equal(isNearDuplicate(fact('use pnpm now'), fact('use pnpm now')), false)
  })

  test('a looser overlap merges only when both share an anchor', () => {
    const anchor = [{ type: 'file' as const, path: 'src/db.ts' }]
    const a = 'The connection pool uses twenty sockets per worker process'
    const b = 'The connection pool uses twenty sockets for each worker thread'
    assert.equal(isNearDuplicate(fact(a), fact(b)), false)
    assert.equal(isNearDuplicate(fact(a, anchor), fact(b, anchor)), true)
  })

  test('a claim and its negation are a contradiction, never a duplicate', () => {
    const a = 'The payment webhook handler is stable under concurrent retries'
    const b = 'The payment webhook handler is not stable under concurrent retries'
    assert.equal(isPossiblyContradictory(a, b), true)
    assert.equal(isPossiblyContradictory(a, `${a} from the queue`), false)
    assert.equal(isPossiblyContradictory('The webhook handler doesn\'t retry failed payment events', 'The webhook handler does retry failed payment events'), true)
  })
})
