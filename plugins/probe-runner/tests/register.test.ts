import { describe, expect, test, tier } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { parseArgs, pluginDir, probeOf, scriptArgv, USAGE } from '../hooks/probe.ts'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'probe-runner', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** `argv` holds each process the mod ran; `exists` the manifests on disk; `tools` the declared tools. */
type World = { argv: string[][]; exists: Set<string>; tools: string[] }

function world(on: On): World {
  const w: World = { argv: [], exists: new Set(['/repo/plugins/pin-note/.claude-plugin/plugin.json']), tools: [] }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo/sub' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false, name: 'repo' } }))
  on('env.get', () => ({ value: '/Users/u' }))
  on('fs.exists', (_, e) => ({ value: w.exists.has(e.path) }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => { w.tools.push(e.name); return { value: { tool: `mcp__probe-runner__${e.name}` } } })
  on('process.run', (_, e) => { w.argv.push([...e.argv]); return { value: { exitCode: 0, stdout: '# probe report', stderr: '' } } })
  return w
}

describe('arguments', () => {
  test('the command reads the model, the plugin list and the steps joined by ;;', () => {
    expect(parseArgs('pin-note,sidebar /pin-note on ;; /pin-note X ;; not ne?')).toEqual({ plugins: ['pin-note', 'sidebar'], steps: ['/pin-note on', '/pin-note X', 'not ne?'], model: 'sonnet' })
    expect(parseArgs('--model opus pin-note merhaba')).toEqual({ plugins: ['pin-note'], steps: ['merhaba'], model: 'opus' })
    expect(parseArgs('pin-note')).toBe(USAGE)
    expect(parseArgs('--model')).toBe(USAGE)
  })

  test('a plugin is a name under plugins/ or a path', () => {
    expect(pluginDir('pin-note', '/repo', '/repo/sub', '/Users/u')).toBe('/repo/plugins/pin-note')
    expect(pluginDir('./x', '/repo', '/repo/sub', '/Users/u')).toBe('/repo/sub/./x')
    expect(pluginDir('~/m', '/repo', '/repo/sub', '/Users/u')).toBe('/Users/u/m')
    expect(pluginDir('/abs/m', '/repo', '/repo/sub', '/Users/u')).toBe('/abs/m')
  })

  test('the tool input needs plugins and steps', () => {
    expect(probeOf({ plugins: ['a'] })).toBe('steps is required: at least one prompt or slash command')
    expect(probeOf({ steps: ['a'] })).toBe('plugins is required: at least one plugin name or path')
    expect(probeOf({ plugins: ['a'], steps: ['b'], model: 'opus' })).toEqual({ plugins: ['a'], steps: ['b'], model: 'opus' })
  })

  test('the script gets each plugin directory and each step as its own argument', () => {
    expect(scriptArgv('/p/probe.py', { plugins: ['a'], steps: ['s 1', 's 2'], model: 'sonnet' }, ['/r/a'])).toEqual(['python3', '/p/probe.py', '--model', 'sonnet', '--plugin-dir', '/r/a', '--step', 's 1', '--step', 's 2'])
  })
})

describe('probe-runner', () => {
  test('the tool is declared at the start and answers the script\'s report', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: null, isInteractive: true, cwd: '/repo/sub' })
    expect(w.tools).toEqual(['probe'])
    const r = await $.tool.call({ tool: 'mcp__probe-runner__probe', plugins: ['pin-note'], steps: ['/pin-note on'] })
    expect(r.result).toBe('# probe report')
    expect(w.argv[0]?.slice(2)).toEqual(['--model', 'sonnet', '--plugin-dir', '/repo/plugins/pin-note', '--step', '/pin-note on'])
  })

  test('a plugin with no manifest is refused before anything runs', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: null, isInteractive: true, cwd: '/repo/sub' })
    const r = await $.tool.call({ tool: 'mcp__probe-runner__probe', plugins: ['nope'], steps: ['x'] })
    expect(r.result).toBe('no plugin at /repo/plugins/nope: it has no .claude-plugin/plugin.json')
    expect(w.argv).toEqual([])
    expect((await $.command.run(run('nope'))).text).toBe(USAGE)
  })
})
