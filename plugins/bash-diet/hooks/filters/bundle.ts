import { plural } from './blocks.ts'
import { collapseBlanks, linesOf, type FilterResult, type FilterTable } from './common.ts'

/**
 * Bundlers: webpack, vite, rollup and esbuild. A build prints a row per emitted file and, for webpack,
 * a module tree; a failure adds the bundler's own stack. The model needs the errors with their code
 * frames, the warnings, the verdict, and how many files came out.
 */

type Asset = { name: string; size: string; bytes: number }

/** An emitted file's row: webpack's `asset main.js 5.76 KiB`, vite's `dist/a.js  3.11 kB │ gzip`, esbuild's `  eout/a.js  3.1kb`. */
const ASSET_ROWS = [
  /^asset (\S+) ([\d.]+ (?:bytes|[KMG]iB))/,
  /^(\S+)\s+([\d.]+ [kKMG]?B)\s+│/,
  /^\s+(\S+)\s+([\d.]+(?:b|kb|mb|gb))\s*$/,
]

/** Progress, the module tree, rollup's `in → out` header and help links, and the stack frames of the bundler itself. */
const NOISE = [
  /^(transforming|rendering chunks|computing gzip size)\.\.\.$/,
  /^✓ \d+ modules transformed\.$/,
  /^(runtime|orphan|cacheable) modules /,
  /^assets by (status|path|chunk) /,
  /^\s*\.\/\S+ .*\[(built|code generated)\]/,
  /^\S+ → \S+\.\.\.$/,
  /^https:\/\/rollupjs\.org\//,
  /^\s+at .*(node_modules|node:|\(file:)/,
  /^\s+errors: \[Getter\/Setter\]$/,
  /^\}$/,
]

/** The dump Node prints when esbuild's wrapper script rethrows its child's exit: from here to the `Node.js v` line. */
const NODE_DUMP_START = /^node:(child_process|internal)/
const NODE_DUMP_END = /^Node\.js v[\d.]+$/

const UNITS: Record<string, number> = { b: 1, bytes: 1, kb: 1000, kib: 1024, mb: 1e6, mib: 1024 ** 2, gb: 1e9, gib: 1024 ** 3 }

function assetOf(line: string): Asset | undefined {
  const m = ASSET_ROWS.map(re => re.exec(line)).find(x => x !== null)
  if (m === undefined || m === null) return undefined // find's type keeps null although the predicate drops it
  const size = (m[2] ?? '').trim()
  const n = /^([\d.]+)\s*(\w+)$/.exec(size)
  return { name: m[1] ?? '', size, bytes: Number(n?.[1] ?? 0) * (UNITS[(n?.[2] ?? 'b').toLowerCase()] ?? 1) }
}

/** `7 assets, largest: dist/assets/index.js 5.30 kB, dist/assets/m1.js 3.11 kB, …` */
function assetsLine(assets: Asset[]): string {
  const largest = [...assets].sort((a, b) => b.bytes - a.bytes).slice(0, 3).map(a => `${a.name} ${a.size}`)
  return `${plural(assets.length, 'asset')}, largest: ${largest.join(', ')}`
}

type Scan = { kept: string[]; assets: Asset[]; at: number; inDump: boolean; dropped: boolean }

function scanLine(s: Scan, line: string): void {
  if (s.inDump || NODE_DUMP_START.test(line)) { s.inDump = !NODE_DUMP_END.test(line); s.dropped = true; return }
  const asset = assetOf(line)
  if (asset !== undefined) { if (s.at < 0) s.at = s.kept.length; s.assets.push(asset); return }
  if (NOISE.some(re => re.test(line))) { s.dropped = true; return }
  s.kept.push(line)
}

/** A bundler's output: the asset rows as one line where they stood, the noise gone, every other line kept. */
export function bundle(input: { text: string }): FilterResult {
  const s: Scan = { kept: [], assets: [], at: -1, inDump: false, dropped: false }
  for (const line of linesOf(input.text)) scanLine(s, line)
  if (s.assets.length > 0) s.kept.splice(s.at, 0, assetsLine(s.assets))
  return { text: collapseBlanks(s.kept).join('\n').trim(), elided: s.dropped || s.assets.length > 0 }
}

export const BUNDLE: FilterTable = {
  webpack: { run: bundle },
  'webpack-cli': { run: bundle },
  vite: { run: bundle },
  rollup: { run: bundle },
  esbuild: { run: bundle },
}
