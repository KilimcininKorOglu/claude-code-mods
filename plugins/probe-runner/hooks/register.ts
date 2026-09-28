import type { EngineInterface, Register } from 'claude-code'
import { INPUT_SCHEMA, parseArgs, pluginDir, probeOf, scriptArgv, TOOL_DESCRIPTION, TOOL_NAME, type Probe } from './probe.ts'

/** A probe ends at ten minutes, the most `$.process.run` waits. */
const PROBE_MS = 600_000

/** The plugin directories, each checked for its manifest; a string names the first one missing. */
async function pluginDirs($: EngineInterface, probe: Probe): Promise<string[] | string> {
  const cwd = await $.session.cwd()
  const root = (await $.session.repo())?.root ?? cwd
  const home = (await $.env.get('HOME')) ?? ''
  const dirs = probe.plugins.map(p => pluginDir(p, root, cwd, home))
  for (const dir of dirs) {
    if (!(await $.fs.exists(`${dir}/.claude-plugin/plugin.json`))) return `no plugin at ${dir}: it has no .claude-plugin/plugin.json`
  }
  return dirs
}

/** Runs one probe and answers its report, or why it did not run. */
async function runProbe($: EngineInterface, probe: Probe): Promise<string> {
  const dirs = await pluginDirs($, probe)
  if (typeof dirs === 'string') return dirs
  const r = await $.process.run(scriptArgv(`${$.plugin.root}/scripts/probe.py`, probe, dirs), { timeoutMs: PROBE_MS })
  return r.exitCode === 0 ? r.stdout : `the probe failed (exit ${r.exitCode}): ${r.stderr.trim() || r.stdout.trim()}`
}

/** The person's probe runs in the background; its report reaches the model as a prompt of its own. */
function runInBackground($: EngineInterface, probe: Probe): void {
  $.clock.after(0, async () => {
    const report = await runProbe($, probe)
    try {
      await $.command.run({ command: 'probe-runner:send', args: report })
    } catch (err) {
      $.ui.log(`the report could not be sent (${err instanceof Error ? err.message : String(err)}), so it went as a plugin prompt`)
      await $.prompt.submit({ text: report })
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'probe-runner', description: 'Live check of plugins in a fresh tmux session: --model, plugins, steps joined by ;; (probe-runner)', argumentHint: '[--model <m>] <plugin,...> <step> ;; <step>' })
    // Declared once at the start, so the tool list the prompt cache holds does not change mid-session.
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA })
    return r
  })

  // A plugin's tool waits behind ToolSearch by default; this one is listed, so the model can call it at once.
  on('tool.describe', { tool: /^mcp__probe-runner__probe$/ }, async (_, e, next) => ({ ...(await next(e)), isDeferred: false }))

  on('tool.call', { tool: /^mcp__probe-runner__probe$/ }, async ($, e) => {
    const probe = probeOf(e as Record<string, unknown>)
    if (typeof probe === 'string') return { deny: probe }
    return { result: await runProbe($, probe) }
  })

  // The engine prints the plugin name in front of command text, so the texts do not repeat it.
  on('command.run', { command: 'probe-runner' }, async ($, e) => {
    const probe = parseArgs(String(e.args ?? ''))
    if (typeof probe === 'string') return { text: probe }
    runInBackground($, probe)
    return { text: `started: ${probe.steps.length} step(s) with ${probe.plugins.join(', ')} on ${probe.model}; the report follows when it ends` }
  })
}
