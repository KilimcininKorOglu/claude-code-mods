import { readFileSync } from 'node:fs'

/** The plugin's version, read from the manifest the daemon ships beside. */
export function pluginVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('.claude-plugin/plugin.json names no version')
  return manifest.version
}

/** The value after `name` in an argument vector, or an error naming the missing flag. */
export function requiredArg(argv: readonly string[], name: string): string {
  const at = argv.indexOf(name)
  const value = at >= 0 ? argv[at + 1] : undefined
  if (value === undefined || value === '') throw new Error(`missing ${name} <value>`)
  return value
}
