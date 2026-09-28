/** What a probe is asked to run, read from the command's words or the tool's input, and the texts the mod writes. */

export const DEFAULT_MODEL = 'sonnet'

/** A probe run: the plugins to load (names or paths), the steps in order, and the model. */
export type Probe = { plugins: string[]; steps: string[]; model: string }

export const USAGE = 'expects [--model <model>] <plugin>[,<plugin>...] <step> [;; <step> ...], a plugin by its name under plugins/ or by its path'

/** Splits the command's words: `--model m` first when given, the plugin list, then the steps joined by `;;`. */
export function parseArgs(args: string): Probe | string {
  const words = args.trim().split(/\s+/)
  let model = DEFAULT_MODEL
  if (words[0] === '--model') {
    model = words[1] ?? ''
    words.splice(0, 2)
  }
  const [list = '', ...rest] = words
  const steps = rest.join(' ').split(';;').map(s => s.trim()).filter(s => s !== '')
  const plugins = list.split(',').filter(p => p !== '')
  if (model === '' || plugins.length === 0 || steps.length === 0) return USAGE
  return { plugins, steps, model }
}

/** The tool's input, checked; a string names what is wrong. */
export function probeOf(input: Record<string, unknown>): Probe | string {
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [])
  const plugins = strings(input.plugins)
  const steps = strings(input.steps)
  if (plugins.length === 0) return 'plugins is required: at least one plugin name or path'
  if (steps.length === 0) return 'steps is required: at least one prompt or slash command'
  return { plugins, steps, model: typeof input.model === 'string' && input.model !== '' ? input.model : DEFAULT_MODEL }
}

/** Where a plugin named by `name` lives: a path as given (relative to `cwd`), or `<root>/plugins/<name>`. */
export function pluginDir(name: string, root: string, cwd: string, home: string): string {
  if (name.startsWith('~/')) return `${home}/${name.slice(2)}`
  if (name.startsWith('/')) return name
  return name.includes('/') ? `${cwd}/${name}` : `${root}/plugins/${name}`
}

/** The script's argument vector. */
export function scriptArgv(script: string, probe: Probe, dirs: readonly string[]): string[] {
  return ['python3', script, '--model', probe.model, ...dirs.flatMap(d => ['--plugin-dir', d]), ...probe.steps.flatMap(s => ['--step', s])]
}

export const TOOL_NAME = 'probe'

export const TOOL_DESCRIPTION = [
  'Run a live check of Claude Code plugins in a fresh session: a new git repository under /private/tmp (the system temp directory where that does not exist), tmux, only the given plugin directories loaded, and the steps typed into the prompt one after another, each once the one before has finished.',
  'You get the pane\'s final text, the session\'s transcript (prompts, replies, tool calls, command output, the context hooks added) and the list of what was deleted afterwards: the temp directory, its transcripts and the inline store files the probe wrote.',
  'A probe takes about 15 seconds to start and then as long as its steps; it stops at 10 minutes.',
].join(' ')

export const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    plugins: { type: 'array', items: { type: 'string' }, description: 'Plugins to load: a name under the repository\'s plugins/ directory, or a path.' },
    steps: { type: 'array', items: { type: 'string' }, description: 'The prompts and slash commands to type, in order. Each is one line.' },
    model: { type: 'string', description: `The probe session's model, ${DEFAULT_MODEL} by default.` },
  },
  required: ['plugins', 'steps'],
}
