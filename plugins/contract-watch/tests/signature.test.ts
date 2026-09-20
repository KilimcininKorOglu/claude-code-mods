import { describe, expect, test, tier } from 'claude-code/testing'

import { blockingLine, changedSignatures, denyText, isBlocking, isGuarded, modeOf, noteText, parseCheck, signaturesIn } from '../hooks/signature.ts'

tier('user')

describe('signatures', () => {
  test('reads a one-line definition in each supported language', async () => {
    const text = [
      'func (s *Srv) Parse(a int) error {',
      'export async function load(path: string): Promise<void> {',
      'export const add = (a: number, b: number): number => a + b',
      'async def fetch(url, timeout=3):',
      'pub fn build<T>(cfg: &Config) -> T {',
      '    public static List<String> names(int limit) throws IOException {',
      '  private render(e: Event): void {',
      '    public function save(array $row): bool',
      '  if (ready) {',
    ].join('\n')
    expect([...signaturesIn(text)]).toEqual([
      ['Parse', 'a int'],
      ['load', 'path: string'],
      ['add', 'a: number, b: number'],
      ['fetch', 'url, timeout=3'],
      ['build', 'cfg: &Config'],
      ['names', 'int limit'],
      ['render', 'e: Event'],
      ['save', 'array $row'],
    ])
  })

  test('only a function both texts define with other parameters is changed', async () => {
    expect(changedSignatures('func parse(a int) int {', 'func parse(a int, b int) int {')).toEqual(['parse'])
    expect(changedSignatures('func parse(a  int) {', 'func parse(a int) {\n\treturn')).toEqual([])
    expect(changedSignatures('x := 1', 'func fresh(a int) {')).toEqual([])
    expect(changedSignatures('def a(x):', 'def b(x):')).toEqual([])
  })
})

const OUTPUT = '<!-- legend -->\n<edit-check sym="parse" t="fn" p="main.go:3" status="contract-change" params_was="1" params_now="2" callers="2" incompatible="0"><c n="main" p="main.go:5"/><c n="other" p="main.go:9"/></edit-check>'

describe('edit-check', () => {
  test('reads the output and names every caller of a changed contract', async () => {
    const check = parseCheck(OUTPUT)
    expect(check).toEqual({ sym: 'parse', status: 'contract-change', paramsWas: 1, paramsNow: 2, incompatible: 0, callers: [{ name: 'main', at: 'main.go:5' }, { name: 'other', at: 'main.go:9' }] })
    if (check === undefined) throw new Error('parsed')
    expect(noteText(check)).toBe('contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; check each caller: main (main.go:5), other (main.go:9).')
  })

  test('says nothing for an unchanged contract, no callers, or no edit-check element', async () => {
    expect(noteText({ sym: 'a', status: 'unchanged', incompatible: 0, callers: [{ name: 'b', at: 'x:1' }] })).toBe(undefined)
    expect(noteText({ sym: 'a', status: 'contract-change', incompatible: 0, callers: [] })).toBe(undefined)
    expect(parseCheck('ripwire: no symbol a')).toBe(undefined)
    const many = { sym: 'a', status: 'contract-change', paramsWas: 2, paramsNow: 2, incompatible: 0, callers: Array.from({ length: 12 }, (_, i) => ({ name: `c${i}`, at: `f:${i}` })) }
    expect(noteText(many)).toContain('changed its parameters since the last commit')
    expect(noteText(many)).toContain('c9 (f:9) and 2 more.')
  })

  test('the gate stops only a check ripwire calls incompatible, and says why', () => {
    const blocking = { sym: 'parse', status: 'contract-change', paramsWas: 1, paramsNow: 2, incompatible: 1, callers: [{ name: 'main', at: 'main.go:5' }] }
    expect(isBlocking(blocking)).toBe(true)
    expect(isBlocking({ ...blocking, incompatible: 0 })).toBe(false)
    expect(isBlocking({ ...blocking, status: 'unchanged' })).toBe(false)
    expect(blockingLine(blocking)).toBe('parse changed from 1 to 2 parameter(s), 1 caller(s) do not match')
    for (const command of ['git commit -m x', 'git push origin main', 'git merge main']) expect(isGuarded(command), command).toBe(true)
    for (const command of ['git status', 'git push --dry-run', 'git log']) expect(isGuarded(command), command).toBe(false)
    expect(modeOf('deny')).toBe('deny')
    expect(modeOf('x')).toBe(undefined)
    expect(denyText([blockingLine(blocking)])).toBe(
      'stopped: 1 changed signature(s) leave a caller behind: parse changed from 1 to 2 parameter(s), 1 caller(s) do not match. Bring each caller to the new signature, then run the command again; there is no way around this gate, and only the person turns it off with /contract-watch mode note.',
    )
  })
})
