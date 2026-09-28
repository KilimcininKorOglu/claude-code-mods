/**
 * Secrets a commit would record: files whose names hold credentials, and
 * added lines that look like a key or a token. A hit names the place and the
 * kind, never the value, so the secret does not travel into a note.
 */

/** Example and template env files, which hold names without values. */
const ENV_EXAMPLE = /^\.env\.(?:example|sample|template|dist|defaults)$/

/** File names that hold credentials: env files, private keys, key stores, credential files. */
const SECRET_NAME = /^(?:\.env(?:\..+)?|.*\.(?:pem|key|p12|pfx|keystore|jks)|id_(?:rsa|dsa|ecdsa|ed25519)|credentials\.json|\.netrc|\.pgpass)$/

/** Whether a path's file name is one that holds credentials. */
export function isSecretName(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return SECRET_NAME.test(name) && !ENV_EXAMPLE.test(name)
}

/** A credential shape. `mixed` asks for letters and digits in the value, so an identifier is not read as a key. */
type Shape = { kind: string; re: RegExp; mixed?: boolean }

const SHAPES: Shape[] = [
  { kind: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/ },
  { kind: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'API key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/, mixed: true },
  { kind: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{30,}\b/ },
  { kind: 'Stripe key', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  { kind: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { kind: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: 'credential assignment', re: /\b(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["']([^"'\s]{16,})["']/i, mixed: true },
]

/** The kind of credential a line holds, or undefined. */
export function secretKind(line: string): string | undefined {
  for (const shape of SHAPES) {
    const m = shape.re.exec(line)
    if (m === null) continue
    const value = m[1] ?? m[0]
    if (shape.mixed === true && !(/[A-Za-z]/.test(value) && /\d/.test(value))) continue
    return shape.kind
  }
  return undefined
}

/** One added line that looks like a credential: the file, the line number, and the kind. */
export type SecretHit = { path: string; line: number; kind: string }

/** The path of a `+++ b/<path>` line, without git's quotes and the tab git adds after a path with a space. */
function newPath(header: string): string | undefined {
  const raw = header.slice(4).replace(/\t$/, '')
  const path = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
  return path.startsWith('b/') ? path.slice(2) : undefined
}

type Cursor = { path?: string; line: number; hits: SecretHit[] }

/** A file header's new side: `+++ b/<path>`, `+++ "b/<path>"` or `+++ /dev/null`. */
const NEW_SIDE = /^\+\+\+ (?:"?b\/|\/dev\/null$)/

/** Reads one line of a zero-context patch into the cursor. */
function readPatchLine(c: Cursor, text: string): void {
  if (NEW_SIDE.test(text)) c.path = newPath(text)
  else if (text.startsWith('@@ ')) c.line = Number(/\+(\d+)/.exec(text)?.[1] ?? '0')
  else if (text.startsWith('+') && c.path !== undefined) {
    const kind = secretKind(text.slice(1))
    if (kind !== undefined) c.hits.push({ path: c.path, line: c.line, kind })
    c.line++
  }
}

/** The added lines of a patch (`git diff -U0`) that look like credentials. */
export function secretLines(patch: string): SecretHit[] {
  const c: Cursor = { line: 0, hits: [] }
  for (const text of patch.split('\n')) readPatchLine(c, text)
  return c.hits
}
