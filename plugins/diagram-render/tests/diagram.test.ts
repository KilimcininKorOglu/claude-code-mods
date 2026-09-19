import { describe, expect, test, tier } from 'claude-code/testing'

import { blockHash, cells, failureLine, mermaidBlocks } from '../hooks/diagram.ts'

tier('user')

describe('diagram', () => {
  test('finds each closed mermaid block, not other fences or a block still streaming', async () => {
    const reply = 'Flow:\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n```ts\nconst x = 1\n```\n\n  ```mermaid\nsequenceDiagram\n  A->>B: hi\n  ```\n\n```mermaid\ngraph LR\n  C-->'
    expect(mermaidBlocks(reply)).toEqual(['graph TD\n  A-->B', 'sequenceDiagram\n  A->>B: hi'])
    expect(mermaidBlocks('no diagram')).toEqual([])
  })

  test('names a block by its source and sizes a picture in cells', async () => {
    expect(blockHash('graph TD\n  A-->B')).toMatch(/^[0-9a-f]{8}$/)
    expect(blockHash('graph TD\n  A-->B')).not.toBe(blockHash('graph TD\n  A-->C'))
    expect(cells({ width: 800, height: 400 }, 100)).toEqual({ columns: 100, rows: 25 })
    expect(cells({ width: 300, height: 900 }, 100)).toEqual({ columns: 20, rows: 30 })
  })

  test('shows the line of an mmdc failure that names the error', async () => {
    expect(failureLine('\nGenerating single mermaid chart\nError: Parse error on line 2:\n...')).toBe('Error: Parse error on line 2:')
    expect(failureLine('killed')).toBe('killed')
    expect(failureLine('')).toBe('no output')
  })
})
