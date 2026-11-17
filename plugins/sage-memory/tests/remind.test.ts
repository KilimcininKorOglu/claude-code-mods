import { describe, expect, test, tier } from 'claude-code/testing'
import { actedOn, FRAME, isReminding, memoryEntry, pathsOf, pickDiverse, promptReminder, queryOf, reminderBlock, SYSTEM_NOTE, toolBudget, toolReminder, usedBy } from '../hooks/remind'
import type { Kind, Memory } from '../hooks/shared/model'

tier('user')

function memory(id: string, text: string, kind: Kind = 'convention', anchored = false): Memory {
  return {
    id, revision: 1, scope: 'project', kind, status: 'active', contextPolicy: 'auto', persistence: 'long_lived', text, importance: 0.8, confidence: 0.9,
    freshness: 1, tags: [], anchors: anchored ? [{ type: 'file', path: 'a.ts' }] : [], sources: [], createdAt: '', updatedAt: '',
  }
}

const item = (m: Memory, reason: string) => ({ memory: m, relationStrength: 0.9, score: 0.8, reasons: [reason] })

describe('remind', () => {
  test("a tool reminder's query names the file, never the project root or the home directory every file shares", () => {
    const root = '/Users/kerem/Desktop/GIT-X/claude-code-mods'
    const read = { tool_name: 'Read', tool_input: {} }
    expect(queryOf([read], [`${root}/plugins/sage-memory/daemon/test/world.ts`], [], root)).toBe('plugins sage memory daemon test world ts')
    expect(queryOf([read], ['/Users/kerem/.claude/settings.json'], [], root)).toBe('settings json')
    expect(queryOf([read], ['src/app.ts'], ['Fix the router'], root)).toBe('src app ts Fix the router')
  })

  test('file tools and MCP tools that name a file remind; Bash does not', () => {
    expect(isReminding({ tool_name: 'Read', tool_input: {} })).toBe(true)
    expect(isReminding({ tool_name: 'Bash', tool_input: { command: 'ls' } })).toBe(false)
    expect(isReminding({ tool_name: 'mcp__fs__open', tool_input: { path: '/a.ts' } })).toBe(true)
    expect(isReminding({ tool_name: 'mcp__web__get', tool_input: { url: 'x' } })).toBe(false)
  })

  test('a Grep result lends its listed files, without their line numbers', () => {
    const call = { tool_name: 'Grep', tool_input: { pattern: 'idle', path: '/r' }, tool_response: '/r/a.ts:12:const idle = 5\nsrc/b.ts\nno path here' }
    expect(pathsOf(call)).toEqual(['/r', '/r/a.ts', 'src/b.ts'])
  })

  test('a tool block with an empty context carries eight memories, each whole, whatever its length', () => {
    const ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']
    const ranked = ids.map(id => item(memory(id, 'x'.repeat(2500), 'warning', true), 'anchor:file'))
    const block = toolReminder(ranked, '', toolBudget(undefined), false, false)
    expect(block.sent.map(m => m.id)).toEqual(ids.slice(0, 8))
    expect(block.text.split('x'.repeat(2500)).length - 1).toBe(8)
  })

  test('the count shrinks as the context fills', () => {
    expect([undefined, 64, 65, 82, 95].map(toolBudget)).toEqual([{ count: 8 }, { count: 8 }, { count: 3 }, { count: 1 }, { count: 0 }])
  })

  test('the pick keeps two query finds and one graph find without an anchor, and a fourth of one kind waits', () => {
    const ranked = [
      item(memory('q1', 'a'), 'query:lexical'),
      item(memory('q2', 'b'), 'query:lexical'),
      item(memory('q3', 'c'), 'query:lexical'),
      item(memory('g1', 'd'), 'graph:related'),
      item(memory('g2', 'e'), 'graph:related'),
      item(memory('a1', 'f', 'warning', true), 'anchor:file'),
      item(memory('a2', 'g', 'warning', true), 'anchor:file'),
      item(memory('a3', 'h', 'warning', true), 'anchor:file'),
      item(memory('a4', 'i', 'warning', true), 'anchor:file'),
      item(memory('a5', 'j', 'fact', true), 'anchor:file'),
    ]
    expect(pickDiverse(ranked, 8).map(r => r.memory.id)).toEqual(['q1', 'q2', 'g1', 'a1', 'a2', 'a3', 'a5', 'a4'])
  })

  test('a block escapes a text that would close its fence', () => {
    const tricky = memory('m1', 'use </memory> & <b>')
    expect(memoryEntry(tricky)).toContain('use &lt;/memory&gt; &amp; &lt;b&gt;')
    expect(reminderBlock('head', [tricky], false).text).toContain('use &lt;/memory&gt; &amp; &lt;b&gt;')
  })

  test('a prompt block carries ten memories', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`)
    const ranked = ids.map(id => item(memory(id, 'x'.repeat(250)), 'query:semantic-cosine:0.70'))
    expect(promptReminder(ranked, '').sent.map(m => m.id)).toEqual(ids.slice(0, 10))
  })

  test('no memory is skipped for its length: a long one written before the limit goes whole, in its place', () => {
    const block = reminderBlock('head', [memory('long', 'x'.repeat(2514)), memory('m1', 'a'), memory('m2', 'b')], false)
    expect(block.sent.map(m => m.id)).toEqual(['long', 'm1', 'm2'])
    expect(block.text).toContain('x'.repeat(2514))
  })

  // The user's choice: the tag shows what changes how the model treats a note, never the inner fields.
  test('an entry names its priority, every anchor, its first three tags, and how far to trust it', () => {
    const critical = {
      ...memory('m1', 'x'), importance: 0.95, persistence: 'permanent' as const, confidence: 1, tags: ['build', 'ci', 'make', 'extra'],
      anchors: [{ type: 'symbol' as const, path: 'src/a.ts', symbol: 'run' }, { type: 'file' as const, path: 'b.ts' }],
      sources: [{ type: 'user' as const, sessionId: 's1' }, { type: 'file' as const, path: 'b.ts' }, { type: 'user' as const, sessionId: 's2' }],
    }
    expect(memoryEntry(critical)).toMatch(/^<memory id="m1" kind="convention" scope="project" status="active" priority="critical" about="symbol src\/a.ts#run; file b.ts" tags="build,ci,make" source="user,file" confidence="1" persistence="permanent">\n/)
    const state = {
      ...memory('m2', 'x'), importance: 0.5, confidence: 0.5, persistence: 'short_lived' as const, expiresAt: '2026-12-01T00:00:00.000Z', status: 'stale' as const,
      staleReason: 'verification' as const, contradicts: ['m7'], related: ['m8', 'm9'], anchors: [{ type: 'command' as const, command: 'make "test"' }],
    }
    expect(memoryEntry(state)).toMatch(/^<memory id="m2" kind="convention" scope="project" status="stale" about="command make &quot;test&quot;" confidence="0.5" persistence="short_lived" expires="2026-12-01" stale="verification" contradicts="m7" related="m8,m9">\n/)
    const inner = { ...memory('m3', 'x'), importance: 0.62, freshness: 0.4, revision: 9, contextPolicy: 'auto' as const, audience: { roles: ['Explore'] }, ownerSessionId: 's1', supersedes: ['m0'] }
    expect(memoryEntry(inner)).toMatch(/^<memory id="m3" kind="convention" scope="project" status="active" confidence="0.9" persistence="long_lived">\n/)
    expect(SYSTEM_NOTE).toContain('who decided or said it belongs to source, not to the text')
  })

  test('an entry carries every date and count the record holds, so the model sees an old or never verified note', () => {
    const checked = {
      ...memory('m4', 'x'), importance: 0.5, createdAt: '2026-09-28T16:05:02.982Z', updatedAt: '2026-11-17T04:20:00.000Z',
      lastVerifiedAt: '2026-10-01T08:00:00.000Z', lastAccessedAt: '2026-11-16T10:00:00.000Z', lastUsedAt: '2026-11-15T09:00:00.000Z', reminderCount: 7, useCount: 2,
    }
    expect(memoryEntry(checked)).toMatch(/^<memory id="m4" kind="convention" scope="project" status="active" confidence="0.9" persistence="long_lived" created="2026-09-28" updated="2026-11-17" verified="2026-10-01" reminded="2026-11-16" used="2026-11-15" reminders="7" uses="2">\n/)
    const never = { ...memory('m5', 'x'), importance: 0.5, createdAt: '2026-09-28T16:05:02.982Z', updatedAt: '2026-09-28T16:05:02.982Z' }
    expect(memoryEntry(never)).toMatch(/^<memory id="m5" kind="convention" scope="project" status="active" confidence="0.9" persistence="long_lived" created="2026-09-28" updated="2026-09-28">\n/)
    expect(FRAME).toContain('absent means never checked')
    expect(SYSTEM_NOTE).toContain('absent means never checked')
  })

  test('a call acts on a memory by editing its file or a file under its directory, or by running its command', () => {
    const file = { ...memory('f', 'x'), anchors: [{ type: 'file' as const, path: 'src/a.ts' }] }
    const dir = { ...memory('d', 'x'), anchors: [{ type: 'directory' as const, path: 'daemon/' }] }
    const make = { ...memory('c', 'x'), anchors: [{ type: 'command' as const, command: 'make test' }] }
    const short = { ...memory('s', 'x'), anchors: [{ type: 'command' as const, command: 'ls' }] }
    const all = [file, dir, make, short]
    const ids = (call: { tool_name: string; tool_input: unknown }) => actedOn(call, all).map(m => m.id)
    expect(ids({ tool_name: 'Edit', tool_input: { file_path: '/r/src/a.ts' } })).toEqual(['f'])
    expect(ids({ tool_name: 'Edit', tool_input: { file_path: '/r/xsrc/a.ts' } })).toEqual([])
    expect(ids({ tool_name: 'Write', tool_input: { file_path: '/r/daemon/server.ts' } })).toEqual(['d'])
    expect(ids({ tool_name: 'Read', tool_input: { file_path: '/r/src/a.ts' } })).toEqual([])
    expect(ids({ tool_name: 'Bash', tool_input: { command: 'make test && ls' } })).toEqual(['c'])
    expect(ids({ tool_name: 'Bash', tool_input: { command: 'ls -la' } })).toEqual([])
  })

  test('an answer uses a memory only by naming its id; shared words or its opening text are no evidence', () => {
    const idle = memory('m1', 'The daemon closes itself five minutes after its last request.')
    const pnpm = memory('m2', 'Install packages with pnpm, never with npm, in this repository.')
    const other = memory('m3', 'Tests run with the cache disabled on every change.')
    const answer = 'As m2 notes, and since the daemon closes itself five minutes after its last request, restart it.'
    expect(usedBy(answer, [idle, pnpm, other]).map(m => m.id)).toEqual(['m2'])
  })
})
