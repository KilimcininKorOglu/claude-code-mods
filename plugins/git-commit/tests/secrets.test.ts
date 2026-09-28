import { describe, expect, test, tier } from 'claude-code/testing'

import { isSecretName, secretKind, secretLines } from '../hooks/secrets.ts'

tier('user')

// The fixtures are built at run time, so this file itself holds no line the gate reads as a secret.
const AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP'
const PRIVATE = '-----BEGIN RSA ' + 'PRIVATE KEY-----'
const GITHUB = 'ghp_' + 'a1'.repeat(18)
const ASSIGNED = 'password = "' + 'hunter2' + 'hunter2hunter2' + '"'

describe('isSecretName', () => {
  test('names env files, keys and credential files, and not their templates', async () => {
    for (const path of ['.env', 'app/.env.local', 'certs/server.pem', 'id_ed25519', 'config/credentials.json', 'release.keystore']) expect(isSecretName(path)).toBe(true)
    for (const path of ['.env.example', 'app/.env.sample', 'id_ed25519.pub', 'src/env.ts', 'keys.md', 'docs/credentials.md']) expect(isSecretName(path)).toBe(false)
  })
})

describe('secretKind', () => {
  test('knows credential shapes', async () => {
    expect(secretKind(`const key = "${AWS}"`)).toBe('AWS access key')
    expect(secretKind(PRIVATE)).toBe('private key')
    expect(secretKind(`token: ${GITHUB}`)).toBe('GitHub token')
    expect(secretKind(ASSIGNED)).toBe('credential assignment')
  })

  test('does not read identifiers and prose as secrets', async () => {
    expect(secretKind('const token = await getAccessTokenFromStore()')).toBe(undefined)
    expect(secretKind('password: process.env.DATABASE_PASSWORD_VALUE')).toBe(undefined)
    expect(secretKind('import sk from "sk-learn-preprocessing-module"')).toBe(undefined)
    expect(secretKind('the secret = "just some words here"')).toBe(undefined)
  })
})

describe('secretLines', () => {
  test('names the file and the new line number of each hit, never the value', async () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,0 +4,2 @@',
      '+const ok = 1',
      `+const key = "${AWS}"`,
      'diff --git a/b c.txt b/b c.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/b c.txt\t',
      '@@ -0,0 +1 @@',
      `+${PRIVATE}`,
    ].join('\n')
    const hits = secretLines(patch)
    expect(hits).toEqual([
      { path: 'src/a.ts', line: 5, kind: 'AWS access key' },
      { path: 'b c.txt', line: 1, kind: 'private key' },
    ])
    expect(JSON.stringify(hits).includes(AWS)).toBe(false)
  })
})
