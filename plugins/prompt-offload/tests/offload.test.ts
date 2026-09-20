import { describe, expect, test, tier } from 'claude-code/testing'

import { DEFAULT_LIMIT, HEAD, MIN_LIMIT, fileName, head, isLong, limitOf, logText, offloadText } from '../hooks/offload.ts'

tier('user')

describe('offload', () => {
  test('keeps the start of the prompt and cuts it at a line break when there is one', async () => {
    expect(head('first line\nsecond line\n', 200)).toBe('first line\nsecond line')
    expect(head(`${'a'.repeat(150)}\n${'b'.repeat(200)}`)).toBe('a'.repeat(150))
    expect(head('x'.repeat(300))).toBe('x'.repeat(HEAD))
    expect(head(`${'a'.repeat(20)}\n${'b'.repeat(300)}`)).toBe(`${'a'.repeat(20)}\n${'b'.repeat(HEAD - 21)}`)
  })

  test('tells the model where the whole prompt is, and the person how much was written', async () => {
    const text = `paste\n${'x'.repeat(3000)}`
    expect(offloadText(text, '/tmp/p/ab.txt')).toBe(`paste\n${'x'.repeat(HEAD - 6)}\n\n[prompt-offload] The message was 3006 characters, so it was written to /tmp/p/ab.txt (2 line(s)) and this prompt holds its first 200. Read that file before you answer.`)
    expect(logText(text, '/tmp/p/ab.txt')).toBe('3006 characters written to /tmp/p/ab.txt; the model reads the first 200 here')
  })

  test('names the file by the prompt and the time', async () => {
    expect(fileName('a', 1)).toMatch(/^[0-9a-f]{8}\.txt$/)
    expect(fileName('a', 1)).not.toBe(fileName('a', 2))
    expect(fileName('a', 1)).not.toBe(fileName('b', 1))
  })

  test('takes a limit of at least the smallest one, and measures the prompt against it', async () => {
    expect(limitOf(String(MIN_LIMIT))).toBe(MIN_LIMIT)
    for (const arg of ['', '0', '499', '-1', '2e3', 'x', '2000.5']) expect(limitOf(arg), arg).toBe(undefined)
    expect(isLong('x'.repeat(DEFAULT_LIMIT), DEFAULT_LIMIT)).toBe(false)
    expect(isLong('x'.repeat(DEFAULT_LIMIT + 1), DEFAULT_LIMIT)).toBe(true)
  })
})
