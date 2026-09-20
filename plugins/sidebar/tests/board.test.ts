import { describe, expect, test, tier } from 'claude-code/testing'
import type { SidebarSection } from '../types/index.d.ts'

import { cut, drawn, dropTurn, MAX_BOARD_LINES, MAX_BUTTONS, MAX_SECTION_LINES, ordered, readSection, type Board, type Kept } from '../hooks/board.ts'
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
    const [one] = drawn(board, 80)
    expect(one?.head).toBe('edit-loop: the 5th edit')
    expect(one?.rows.at(-1)).toEqual({ text: '+2 more line(s)', tone: 'dim' })
  })

  test('keeps the whole pane under the board limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => section({ key: `k${i}`, lines: Array.from({ length: MAX_SECTION_LINES }, () => ({ text: 'x' })) }))
    const rows = drawn(boardOf(...many), 80).reduce((n, one) => n + 1 + one.rows.length, 0)
    expect(rows).toBeLessThanOrEqual(MAX_BOARD_LINES)
  })
})

describe('$.sidebar', () => {
  const stateOf = (open: boolean): State => ({ board: new Map(), open })

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

  test('refuses a section of another shape', async () => {
    const bar = createSidebar(() => {}, stateOf(true))
    await expect(bar.set(section({ key: 'a key' }))).rejects.toThrow('key must be')
  })
})
