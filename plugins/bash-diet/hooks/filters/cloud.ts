import { plural } from './blocks.ts'
import { CAP_INVENTORY, CAP_LIST, capped, hasArg, linesOf, stripAnsi, whole, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'
import { pickColumns } from './table.ts'

/** How many log lines a log command keeps: the newest ones, after repeats are folded. */
const LOG_TAIL = 200

/** Options that choose the output format themselves. */
const OWN_FORMAT = ['--format', '-o', '--output', '--quiet', '-q', '--json', '--template']

// -------------------------------------------------------------------------------------------- tables

/** A table command as its chosen columns, capped. */
function columns(wanted: string[], cap = CAP_LIST) {
  return (input: { args: string[]; text: string }): FilterResult => {
    if (hasArg(input.args, ...OWN_FORMAT)) return json(input)
    const t = pickColumns(linesOf(input.text), wanted)
    if (t === undefined) return cleanup(input.text)
    const c = capped(t.rows, cap, 'rows')
    return { text: [`${plural(t.rows.length, 'row')}: ${t.header}`, ...c.lines].join('\n'), elided: c.elided }
  }
}

// ---------------------------------------------------------------------------------------------- json

/**
 * JSON printed with indentation, printed again without it: the same data in fewer characters. Output
 * that is not one JSON value is left to the cleanup.
 */
export function json(input: { text: string }): FilterResult {
  const text = stripAnsi(input.text).trim()
  if (!/^[[{]/.test(text)) return cleanup(input.text)
  try {
    return { text: JSON.stringify(JSON.parse(text)), elided: false }
  } catch {
    return cleanup(input.text)
  }
}

// ---------------------------------------------------------------------------------------------- logs

/** A line with its times, numbers and ids replaced, so two lines that differ only there read as one. */
const shapeOf = (line: string): string =>
  line.replace(/\d{4}-\d\d-\d\d[T ][\d:.,]+(Z|[+-]\d\d:?\d\d)?/g, '<t>').replace(/\b[0-9a-f]{8,}\b/gi, '#').replace(/\d+(\.\d+)?/g, '#')

/** Log lines: runs of the same shape folded into one line with a count, the newest `LOG_TAIL` kept. */
export function logs(input: { text: string }): FilterResult {
  const out: string[] = []
  let count = 0
  const lines = linesOf(input.text)
  for (let i = 0; i < lines.length; i += 1) {
    count += 1
    if (lines[i + 1] !== undefined && shapeOf(lines[i + 1] ?? '') === shapeOf(lines[i] ?? '')) continue
    out.push(count > 1 ? `${lines[i]} (×${count} similar)` : (lines[i] ?? ''))
    count = 0
  }
  if (out.length <= LOG_TAIL) return whole(out)
  return { text: [`… ${out.length - LOG_TAIL} earlier lines left out`, ...out.slice(-LOG_TAIL)].join('\n'), elided: true }
}

// --------------------------------------------------------------------------------------------- builds

/** BuildKit's plain progress: step headers and errors stay, cache hits, timings and transfers go. */
function dockerBuild(input: { text: string }): FilterResult {
  const kept = linesOf(input.text).filter(l => !/^#\d+ (DONE|CACHED|sha256:|transferring|resolve |\[internal\])|^#\d+ \d+\.\d+ (?:sha256|extracting|downloading)|^#\d+ \[internal\]|^#\d+ (naming|exporting|writing) /.test(l) && l.trim() !== '' && !/^#\d+ \d+(\.\d+)?s? ?$/.test(l))
  return whole(kept)
}

/** Pull and up progress: layer lines go; what was created or failed stays. */
const composeOp = (input: { text: string }): FilterResult =>
  whole(linesOf(input.text).filter(l => !/\b(Pulling fs layer|Waiting|Downloading|Download complete|Extracting|Verifying Checksum|Pull complete|Already exists)\b/.test(l) && !/^\s*[0-9a-f]{12} /.test(l.trim())))

// ---------------------------------------------------------------------------------------- infrastructure

/** terraform and tofu plans: the refresh lines go, the plan stays. */
const plan = (input: { text: string }): FilterResult =>
  whole(linesOf(input.text).filter(l => !/: (Refreshing state|Reading\.\.\.|Read complete after|Still reading)/.test(l) && !/^(Acquiring|Releasing) state lock/.test(l.trim())))

/** pulumi: the header, the permalink and the duration go. */
const pulumi = (input: { text: string }): FilterResult =>
  whole(linesOf(input.text).filter(l => !/^(View (Live|in Browser)|Previewing update|Updating \(|Duration:|Resources:\s*$|\s*@ (previewing|updating))/.test(l.trim()) && !/^https?:\/\//.test(l.trim())))

/** curl and wget: progress meters go; a JSON body is printed again without indentation. */
function download(input: { text: string }): FilterResult {
  const lines = linesOf(input.text).filter(l => !/^\s*(% Total|Dload|\d+\s+\d+[kMG]?\s+\d+ )/.test(l) && !/^\s*\d+[KMG]? [.\s]{10,}/.test(l) && !/^(Resolving|Connecting to|HTTP request sent|Length:|Saving to:)/.test(l))
  return json({ text: lines.join('\n') })
}

/** `aws s3`: the subcommand is classified apart from the arguments, so `ls` is the first argument; its rows are capped. */
function awsS3(input: { args: string[]; text: string }): FilterResult {
  if (input.args[0] !== 'ls') return json(input)
  const c = capped(linesOf(input.text), CAP_INVENTORY, 'objects')
  return { text: c.lines.join('\n'), elided: c.elided }
}

/** The value of `-o json`, `-ojson`, `--output=json` or `--output json`, or undefined. */
function outputFormat(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? ''
    const joined = /^(?:-o|--output=)(.+)$/.exec(a)?.[1]
    if (joined !== undefined) return joined
    if (a === '-o' || a === '--output') return args[i + 1]
  }
  return undefined
}

/** `kubectl get`: JSON printed again without indentation, a table (also `-o wide`) capped. */
function kubectlGet(input: { args: string[]; text: string }): FilterResult {
  const format = outputFormat(input.args)
  if (format !== undefined && format !== 'wide') return json(input)
  const c = capped(linesOf(input.text), CAP_INVENTORY, 'rows')
  return { text: c.lines.join('\n'), elided: c.elided }
}

export const CLOUD: FilterTable = {
  'docker ps': { run: columns(['NAMES', 'IMAGE', 'STATUS', 'PORTS'], CAP_LIST) },
  'docker images': { run: columns(['IMAGE', 'REPOSITORY', 'TAG', 'DISK USAGE', 'SIZE'], CAP_INVENTORY) },
  'docker image': { run: input => (input.args[0] === 'ls' ? columns(['IMAGE', 'REPOSITORY', 'TAG', 'DISK USAGE', 'SIZE'], CAP_INVENTORY)(input) : cleanup(input.text)) },
  'docker logs': { run: logs },
  'docker build': { run: dockerBuild },
  'docker pull': { run: composeOp },
  'docker inspect': { run: json },
  'docker compose': { run: input => (input.args[0] === 'logs' ? logs(input) : input.args[0] === 'ps' ? columns(['NAME', 'SERVICE', 'STATUS', 'PORTS'])(input) : composeOp(input)) },
  'kubectl get': { run: kubectlGet },
  'kubectl logs': { run: logs },
  'kubectl describe': { run: ({ text }) => cleanup(text) },
  'oc get': { run: kubectlGet },
  'oc logs': { run: logs },
  'aws s3': { run: awsS3 },
  aws: { run: json },
  gcloud: { run: json },
  'terraform plan': { run: plan },
  'terraform apply': { run: plan },
  'tofu plan': { run: plan },
  'tofu apply': { run: plan },
  pulumi: { run: pulumi },
  curl: { run: download },
  wget: { run: download },
  'helm list': { run: ({ args, text }) => columns(['NAME', 'NAMESPACE', 'STATUS', 'CHART', 'APP VERSION'])({ args, text }) },
}
