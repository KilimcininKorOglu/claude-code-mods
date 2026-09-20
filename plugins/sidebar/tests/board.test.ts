import { describe, expect, test, tier } from 'claude-code/testing'
import type { SidebarSection } from '../types/index.d.ts'

import { cut, drawn, dropTurn, MAX_BOARD_LINES, MAX_BUTTONS, MAX_SECTION_LINES, MAX_STREAM, MAX_STREAM_PER_CONSUMER, ordered, pushed, readSection, type Board, type Kept } from '../hooks/board.ts'
import { createSidebar, type State } from '../hooks/register.tsx'

tier('user')

const section = (over: Partial<SidebarSection> = {}): SidebarSection => ({
  consumer: 'edit-loop',
  key: 'note',
  title: 'the 5th edit',
  lines: [{ text: 'src/app.ts: 5 edits' }],
  until: 'turn',
  ...over,
})

function kept(input: SidebarSection): Kept {
  const r = readSection(input)
  if (typeof r === 'string') throw new Error(r)
  return r
}

function boardOf(...sections: SidebarSection[]): Board {
  const board: Board = new Map()
  for (const s of sections) {
    const one = kept(s)
    board.set(one.id, one)
  }
  return board
}

describe('readSection', () => {
  test('reads a section and keeps its defaults', () => {
    expect(kept(section())).toEqual({
      id: 'edit-loop:note', consumer: 'edit-loop', key: 'note', title: 'the 5th edit',
      lines: [{ text: 'src/app.ts: 5 edits' }], buttons: [], until: 'turn', order: 100, more: 0,
    })
  })

  test('names a consumer, a key and a title of another shape', () => {
    expect(readSection(section({ consumer: 'a mod' }))).toContain('consumer must be')
    expect(readSection(section({ key: '' }))).toContain('key must be')
    expect(readSection(section({ title: '  ' }))).toContain('title must be')
  })

  test('drops a line, a button and a field of another shape, and folds a multi-line text', () => {
    const r = kept(section({
      lines: [{ text: 'one\ntwo' }, { text: 'tone', kind: 'ok' }, { kind: 'warn' } as never, 'plain' as never],
      buttons: [{ label: 'stop', command: 'bg-tasks', args: 'stop 1' }, { label: '', command: 'x' }, { label: 'no command', command: 'a b' } as never],
      order: Number.NaN,
      until: 'forever' as never,
    }))
    expect(r.lines).toEqual([{ text: 'one two' }, { text: 'tone', kind: 'ok' }, { text: 'plain' }])
    expect(r.buttons).toEqual([{ label: 'stop', command: 'bg-tasks', args: 'stop 1' }])
    expect(r.order).toBe(100)
    expect(r.until).toBe('session')
  })

  test('cuts the lines and the buttons to the limits and counts what it left out', () => {
    const r = kept(section({
      lines: Array.from({ length: MAX_SECTION_LINES + 7 }, (_, i) => ({ text: `line ${i}` })),
      buttons: Array.from({ length: MAX_BUTTONS + 3 }, (_, i) => ({ label: `b${i}`, command: 'bg-tasks' })),
    }))
    expect(r.lines).toHaveLength(MAX_SECTION_LINES)
    expect(r.buttons).toHaveLength(MAX_BUTTONS)
    expect(r.more).toBe(7)
  })
})

describe('board', () => {
  test('orders by order, then by consumer and key', () => {
    const board = boardOf(
      section({ consumer: 'z-mod', key: 'a' }),
      section({ consumer: 'a-mod', key: 'b', order: 10 }),
      section({ consumer: 'a-mod', key: 'a' }),
    )
    expect(ordered(board).map(s => s.id)).toEqual(['a-mod:b', 'a-mod:a', 'z-mod:a'])
  })

  test("the session's sections stand above the turn's, whatever their order", () => {
    const board = boardOf(
      section({ consumer: 'a-mod', key: 'a', order: 1 }),
      section({ consumer: 'z-mod', key: 'b', order: 900, until: 'session' }),
      section({ consumer: 'm-mod', key: 'c', order: 500, until: 'session' }),
    )
    expect(ordered(board).map(s => s.id)).toEqual(['m-mod:c', 'z-mod:b', 'a-mod:a'])
  })

  test("drops the turn's sections and keeps the session's", () => {
    const board = boardOf(section({ key: 'a' }), section({ key: 'b', until: 'session' }))
    expect(dropTurn(board)).toBe(true)
    expect([...board.keys()]).toEqual(['edit-loop:b'])
    expect(dropTurn(board)).toBe(false)
  })

  test('cuts a line to the width', () => {
    expect(cut('abcdefghij', 40)).toBe('abcdefghij')
    expect(cut('abcdefghij', 5)).toBe('abcdefg…')
    expect(cut('abcdefghij', 9)).toBe('abcdefgh…')
  })

  test('draws the heading, the lines and the count of the lines left out', () => {
    const board = boardOf(section({ lines: Array.from({ length: MAX_SECTION_LINES + 2 }, () => ({ text: 'x' })) }))
    const [one] = drawn(board, [], 80, MAX_BOARD_LINES)
    expect(one?.head).toBe('edit-loop: the 5th edit')
    expect(one?.rows.at(-1)).toEqual({ text: '+2 more line(s)', tone: 'dim' })
  })

  test('keeps the whole pane under the board limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => section({ key: `k${i}`, lines: Array.from({ length: MAX_SECTION_LINES }, () => ({ text: 'x' })) }))
    const rows = drawn(boardOf(...many), [], 80, MAX_BOARD_LINES).reduce((n, one) => n + 1 + one.rows.length, 0)
    expect(rows).toBeLessThanOrEqual(MAX_BOARD_LINES)
  })
})

describe('stream', () => {
  const entry = (n: number, consumer = 'edit-loop'): Kept => kept(section({ consumer, key: `k${n}`, title: `t${n}`, until: 'stream' }))

  test('the stream draws under the standing sections, newest first', () => {
    const board = boardOf(section({ consumer: 'cache-warm', key: 'window', until: 'session' }))
    const stream = [entry(3), entry(2), entry(1)]
    expect(drawn(board, stream, 80, MAX_BOARD_LINES).map(d => d.head)).toEqual([
      'cache-warm: the 5th edit', 'edit-loop: t3', 'edit-loop: t2', 'edit-loop: t1',
    ])
  })

  test("the pane's rows cut the oldest entries off the end", () => {
    const stream = [entry(3), entry(2), entry(1)]
    // Each entry draws a heading and one line, so four rows take two entries.
    expect(drawn(new Map(), stream, 80, 4).map(d => d.head)).toEqual(['edit-loop: t3', 'edit-loop: t2'])
  })

  test('a consumer over its count drops its own oldest entry, never another mod one', () => {
    let stream: Kept[] = [entry(0, 'env-sync')]
    for (let i = 1; i <= MAX_STREAM_PER_CONSUMER + 10; i++) stream = pushed(stream, entry(i))
    expect(stream.filter(s => s.consumer === 'edit-loop')).toHaveLength(MAX_STREAM_PER_CONSUMER)
    expect(stream.filter(s => s.consumer === 'env-sync')).toHaveLength(1)
    expect(stream[0]?.title).toBe(`t${MAX_STREAM_PER_CONSUMER + 10}`)
  })

  test('the stream keeps at most MAX_STREAM entries, the newest', () => {
    let stream: Kept[] = []
    for (let c = 0; c < 6; c++) for (let i = 0; i < MAX_STREAM_PER_CONSUMER; i++) stream = pushed(stream, entry(i, `mod-${c}`))
    expect(stream).toHaveLength(MAX_STREAM)
    expect(stream[0]?.consumer).toBe('mod-5')
  })

  test('two consumers share the rows, so the older mod entry still draws', () => {
    const stream = [entry(6, 'sql-concat-watch'), entry(5, 'sql-concat-watch'), entry(4, 'sql-concat-watch'), entry(3, 'sql-concat-watch'), entry(2, 'sql-concat-watch'), entry(1, 'env-sync')]
    expect(drawn(new Map(), stream, 80, 8).map(d => d.head)).toEqual([
      'sql-concat-watch: t6', 'sql-concat-watch: t5', 'sql-concat-watch: t4', 'env-sync: t1',
    ])
  })

  test('one consumer writing alone takes the whole area', () => {
    const stream = [entry(6), entry(5), entry(4), entry(3), entry(2), entry(1)]
    expect(drawn(new Map(), stream, 80, 8).map(d => d.head)).toEqual(['edit-loop: t6', 'edit-loop: t5', 'edit-loop: t4', 'edit-loop: t3'])
  })
})

describe('$.sidebar', () => {
  const stateOf = (open: boolean): State => ({ board: new Map(), stream: [], written: 0, open })

  test('keeps nothing while the sidebar is closed', async () => {
    const state = stateOf(false)
    let draws = 0
    const bar = createSidebar(() => { draws += 1 }, state)
    expect(await bar.set(section())).toBe(false)
    expect(await bar.isOpen()).toBe(false)
    expect(state.board.size).toBe(0)
    expect(draws).toBe(0)
  })

  test('writes, replaces and clears a section while it is open', async () => {
    const state = stateOf(true)
    let draws = 0
    const bar = createSidebar(() => { draws += 1 }, state)
    expect(await bar.set(section())).toBe(true)
    expect(await bar.set(section({ title: 'again' }))).toBe(true)
    expect(state.board.size).toBe(1)
    expect(state.board.get('edit-loop:note')?.title).toBe('again')
    await bar.clear({ consumer: 'edit-loop', key: 'note' })
    await bar.clear({ consumer: 'edit-loop', key: 'gone' })
    expect(state.board.size).toBe(0)
    expect(draws).toBe(3)
  })

  test('a stream section adds an entry instead of replacing one, and clear drops every entry of that key', async () => {
    const state = stateOf(true)
    const bar = createSidebar(() => {}, state)
    await bar.set(section({ until: 'stream' }))
    await bar.set(section({ until: 'stream', title: 'again' }))
    await bar.set(section({ until: 'stream', key: 'other' }))
    expect(state.stream.map(s => s.title)).toEqual(['the 5th edit', 'again', 'the 5th edit'])
    expect(state.board.size).toBe(0)
    await bar.clear({ consumer: 'edit-loop', key: 'note' })
    expect(state.stream.map(s => s.key)).toEqual(['other'])
  })

  test('refuses a section of another shape', async () => {
    const bar = createSidebar(() => {}, stateOf(true))
    await expect(bar.set(section({ key: 'a key' }))).rejects.toThrow('key must be')
  })
})
