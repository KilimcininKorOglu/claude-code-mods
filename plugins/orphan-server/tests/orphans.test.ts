import { describe, expect, test, tier } from 'claude-code/testing'

import { callsOf, etimeMs, isSame, labelOf, listenersOf, matchOf, patternsOf, procsOf, tailOf, type Proc } from '../hooks/orphans.ts'

tier('user')

const PYTHON = '/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python'

/** The Bash call that left `python3 -m http.server 8787` running, as this project's transcript holds it. */
const USE = JSON.stringify({
  type: 'assistant', timestamp: '2026-09-22T10:16:36.587Z', sessionId: '450600b2-a839-4d4e-a452-cbea4c4731d0',
  message: { content: [{ type: 'tool_use', id: 'toolu_01A7PcuwJju4BGXKziZfcMjs', name: 'Bash', input: { command: 'cd /Users/kerem/Desktop/GIT-KilimcininKorOglu/claude-code-mods/site && (python3 -m http.server 8787 >/dev/null 2>&1 &) && sleep 1 && curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:8787/index.html' } }] },
})
const RESULT = JSON.stringify({ type: 'user', timestamp: '2026-09-22T10:16:37.762Z', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01A7PcuwJju4BGXKziZfcMjs', content: '200' }] } })

/** A later call whose command names the same server: it ran after the server started. */
const LATER = JSON.stringify({
  type: 'assistant', timestamp: '2026-09-22T10:20:02.000Z', sessionId: '450600b2-a839-4d4e-a452-cbea4c4731d0',
  message: { content: [{ type: 'tool_use', id: 'toolu_later', name: 'Bash', input: { command: 'pgrep -f "http.server 8787"' } }] },
})

const STARTED = Date.parse('2026-09-22T10:16:36Z')
const server: Proc = { pid: 3214, ppid: 1, startedAt: STARTED, args: `${PYTHON} -m http.server 8787` }

describe('orphans', () => {
  test('lsof, ps and etime read as the host prints them', () => {
    expect(listenersOf('p41462\nf4\nn*:8797\np500\nf5\nn127.0.0.1:5432\nf6\nn[::1]:5432\n')).toEqual(new Map([[41462, [8797]], [500, [5432]]]))
    expect(etimeMs('00:01')).toBe(1000)
    expect(etimeMs('1:02:03')).toBe(3_723_000)
    expect(etimeMs('05-20:46:04')).toBe((((5 * 24 + 20) * 60 + 46) * 60 + 4) * 1000)
    expect(etimeMs('nonsense')).toBeUndefined()
    expect(procsOf(`41462     1 00:01 ${PYTHON} -m http.server 8797\n`, 10_000)).toEqual([{ pid: 41462, ppid: 1, startedAt: 9000, args: `${PYTHON} -m http.server 8797` }])
  })

  test('the tail drops the argv0 the shell resolved, and the label keeps its name', () => {
    expect(tailOf(server.args)).toBe('-m http.server 8787')
    expect(labelOf(server.args)).toBe('Python -m http.server 8787')
    expect(tailOf('/usr/local/bin/redis-server')).toBe('redis-server')
  })

  test('the Bash call that ran while the server started is its match, and a later one naming it is not', () => {
    const calls = callsOf([USE, RESULT, LATER, '{"type":"assistant","timestamp":"2026-09-22T10:1'].join('\n'))
    expect(calls.uses.map(c => c.id)).toEqual(['toolu_01A7PcuwJju4BGXKziZfcMjs', 'toolu_later'])
    expect(matchOf(server, calls)?.id).toBe('toolu_01A7PcuwJju4BGXKziZfcMjs')
    // Started an hour later: no call ran then.
    expect(matchOf({ ...server, startedAt: STARTED + 3_600_000 }, calls)).toBeUndefined()
    // Another program on the same port was not typed in any call.
    expect(matchOf({ ...server, args: '/usr/bin/nc -l 8787' }, calls)).toBeUndefined()
  })

  test('the transcript minutes read reach back over the longest call', () => {
    const patterns = patternsOf([server])
    expect(patterns).toContain('"timestamp":"2026-09-22T10:16')
    expect(patterns).toContain('"timestamp":"2026-09-22T10:06')
    expect(patterns).toContain('"timestamp":"2026-09-22T10:17')
    expect(patterns).not.toContain('"timestamp":"2026-09-22T10:18')
  })

  test('a pid read again is the listed server only with the same parent, arguments and start', () => {
    expect(isSame(server, { ...server, startedAt: STARTED + 1000 })).toBe(true)
    expect(isSame(server, { ...server, args: '/bin/sleep 100' })).toBe(false)
    expect(isSame(server, { ...server, startedAt: STARTED + 60_000 })).toBe(false)
    expect(isSame(server, { ...server, ppid: 400 })).toBe(false)
    expect(isSame(server, undefined)).toBe(false)
  })
})
