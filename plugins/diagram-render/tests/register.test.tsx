import { describe, expect, mock, test, tier, type Engine, type MockClock } from 'claude-code/testing'
import type { CommandRunInput, On, RenderPropsOf, TurnCompleteInput } from 'claude-code'

tier('user')

const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

/** The head of a PNG: signature, IHDR length and type, width, height. */
const pngHead = (width: number, height: number): string =>
  btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), ...[...'IHDR'].map(c => c.charCodeAt(0)), ...u32(width), ...u32(height), 8, 6, 0, 0, 0))

const run = (args: string): CommandRunInput => ({
  command: 'diagram-render', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const GOOD = '```mermaid\ngraph TD\n  A-->B\n```'
const BAD = '```mermaid\ngraph TD\n  A-->\n```'

const turn = (answer: string): TurnCompleteInput => ({ answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })

/** The commands run, the files written, the lines logged; `mmdc` false means it is not installed. */
type World = { argv: string[]; written: Map<string, string>; logs: string[]; mmdc: boolean; clock: MockClock }

function world(on: On): World {
  mock.store(on, {})
  const w: World = { argv: [], written: new Map(), logs: [], mmdc: true, clock: mock.clock(on, { now: 0 }) }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('env.get', () => ({ value: '/tmp/t' }))
  on('fs.write', (_, e) => { w.written.set(e.path, e.text); return { value: undefined } })
  on('fs.read', () => ({ value: { base64: pngHead(800, 400) } }) as never)
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('process.run', (_, e) => {
    w.argv.push(e.argv.join(' '))
    if (!w.mmdc) return { value: { exitCode: 127, stdout: '', stderr: 'command not found: mmdc' } }
    const bad = e.argv.includes('-i') && (w.written.get(e.argv[2] ?? '') ?? '').trimEnd().endsWith('-->')
    return { value: bad ? { exitCode: 1, stdout: '', stderr: 'Error: Parse error on line 2:' } : { exitCode: 0, stdout: '11.4.0', stderr: '' } }
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: '/Users/u/app' })
}

const reply = ($: Engine, id: string, text: string) =>
  $.ui.mount({ plugin: 'diagram-render', surface: 'terminal', component: 'AssistantMessage', requestId: id, props: { text, isFirstOfReply: true } as RenderPropsOf['AssistantMessage'] })

describe('diagram-render', () => {
  test('a mermaid block renders after the turn and draws under its reply', async ($, on) => {
    const w = world(on)
    await started($)
    await $.turn.complete(turn(`Here:\n\n${GOOD}`))
    await w.clock.settle()
    expect(w.argv[0]).toBe('mmdc --version')
    expect(w.argv[1]).toMatch(/^mmdc -i \/tmp\/t\/diagram-render\/[0-9a-f]{8}\.mmd -o \/tmp\/t\/diagram-render\/[0-9a-f]{8}\.png -b transparent -t dark -q$/)
    const image = await (await reply($, 'm1', `Here:\n\n${GOOD}`)).find({ type: 'Image' })
    expect(image?.props.columns).toBe(80)
    expect(image?.props.rows).toBe(20)
    expect(image?.props.alt).toBe('mermaid diagram 1')
    await $.turn.complete(turn(GOOD))
    await w.clock.settle()
    expect(w.argv).toHaveLength(2)
  })

  test('a block mmdc refuses is logged once and stays text', async ($, on) => {
    const w = world(on)
    await started($)
    await $.turn.complete(turn(BAD))
    await w.clock.settle()
    await $.turn.complete(turn(BAD))
    await w.clock.settle()
    expect(w.logs).toEqual(['a diagram was not rendered: Error: Parse error on line 2:'])
    expect(await (await reply($, 'm2', BAD)).find({ type: 'Image' })).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('on; mmdc found; 0 rendered, 1 failed this session')
  })

  test('without mmdc it says once how to install it, and off renders nothing', async ($, on) => {
    const w = world(on)
    w.mmdc = false
    await started($)
    await $.turn.complete(turn(GOOD))
    await w.clock.settle()
    await $.turn.complete(turn(GOOD))
    await w.clock.settle()
    expect(w.logs).toEqual(['mmdc is not installed, so mermaid blocks stay text: npm i -g @mermaid-js/mermaid-cli'])
    expect(w.argv).toEqual(['mmdc --version'])
    expect((await $.command.run(run('off'))).text).toBe('off: mermaid blocks stay text')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
  })
})
