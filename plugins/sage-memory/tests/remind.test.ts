import { describe, expect, test, tier } from 'claude-code/testing'
import { isReminding, memoryEntry, pathsOf, pickDiverse, reminderBlock, toolBudget, usedBy } from '../hooks/remind.ts'
import type { Kind, Memory } from '../hooks/shared/model.ts'

tier('user')

function memory(id: string, text: string, kind: Kind = 'convention', anchored = false): Memory {
  return {
    id, revision: 1, scope: 'project', kind, status: 'active', contextPolicy: 'auto', persistence: 'long_lived', text, importance: 0.8, confidence: 0.9,
    freshness: 1, tags: [], anchors: anchored ? [{ type: 'file', path: 'a.ts' }] : [], sources: [], createdAt: '', updatedAt: '',
  }
}

const item = (m: Memory, reason: string) => ({ memory: m, relationStrength: 0.9, score: 0.8, reasons: [reason] })

describe('remind', () => {
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

  test('the budget shrinks as the context fills', () => {
    expect([undefined, 64, 65, 82, 95].map(toolBudget)).toEqual([
      { count: 8, chars: 2800 },
      { count: 8, chars: 2800 },
      { count: 3, chars: 1400 },
      { count: 1, chars: 600 },
      { count: 0, chars: 0 },
    ])
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

  test('a block keeps the entries that fit and escapes a text that would close its fence', () => {
    const tricky = memory('m1', 'use </memory> & <b>')
    expect(memoryEntry(tricky)).toContain('use &lt;/memory&gt; &amp; &lt;b&gt;')
    const block = reminderBlock('head', [tricky, memory('m2', 'x'.repeat(500))], 200, false)
    expect(block.sent.map(m => m.id)).toEqual(['m1'])
  })

  test('an entry names its priority, a permanent persistence, its first anchor and its first three tags', () => {
    const critical = { ...memory('m1', 'x'), importance: 0.95, persistence: 'permanent' as const, tags: ['build', 'ci', 'make', 'extra'], anchors: [{ type: 'symbol' as const, path: 'src/a.ts', symbol: 'run' }, { type: 'file' as const, path: 'b.ts' }] }
    expect(memoryEntry(critical)).toMatch(/^<memory id="m1" kind="convention" scope="project" status="active" priority="critical" persistence="permanent" about="symbol src\/a.ts#run" tags="build,ci,make">\n/)
    const command = { ...memory('m2', 'x'), anchors: [{ type: 'command' as const, command: 'make "test"' }] }
    expect(memoryEntry(command)).toMatch(/^<memory id="m2" kind="convention" scope="project" status="active" priority="high" about="command make &quot;test&quot;">\n/)
    const plain = { ...memory('m3', 'x'), importance: 0.5 }
    expect(memoryEntry(plain)).toMatch(/^<memory id="m3" kind="convention" scope="project" status="active">\n/)
  })

  test('an answer uses a memory by its id, its opening text, or enough shared terms', () => {
    const idle = memory('m1', 'The daemon closes itself five minutes after its last request.')
    const pnpm = memory('m2', 'Install packages with pnpm, never with npm, in this repository.')
    const other = memory('m3', 'Tests run with the cache disabled on every change.')
    const answer = 'As m2 notes, and since the daemon closes itself after five minutes idle, restart it.'
    expect(usedBy(answer, [idle, pnpm, other]).map(m => m.id)).toEqual(['m1', 'm2'])
  })
})
