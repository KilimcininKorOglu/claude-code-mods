import { describe, expect, test, tier } from 'claude-code/testing'

import { commitDir, denyText, diffReads, isCommit, isGuarded, lineReads, listedNames, modeOf, noteText } from '../hooks/env.ts'

tier('user')

describe('env reads', () => {
  test('reads every language form and skips system and request names', () => {
    const lines = [
      'const a = process.env.STRIPE_KEY; const b = process.env["DB_URL"]; import.meta.env.VITE_API',
      "os.getenv('PY_A'); os.environ['PY_B']; os.environ.get('PY_C')",
      'os.Getenv("GO_A"); os.LookupEnv("GO_B")',
      "env('LARA_A'); getenv('PHP_A'); $_ENV['PHP_B']; $_SERVER['APP_KEY']; $_SERVER['REQUEST_URI']",
      'std::env::var("RS_A"); env::var_os("RS_B")',
      "ENV['RB_A']; ENV.fetch('RB_B')",
      'System.getenv("JAVA_A")',
      'process.env.NODE_ENV; process.env.HOME; process.env.lower; $obj->env("NO"); config.env("NO2")',
    ]
    expect(lines.flatMap(lineReads).sort()).toEqual([
      'APP_KEY', 'DB_URL', 'GO_A', 'GO_B', 'JAVA_A', 'LARA_A', 'PHP_A', 'PHP_B', 'PY_A', 'PY_B', 'PY_C', 'RB_A', 'RB_B', 'RS_A', 'RS_B', 'STRIPE_KEY', 'VITE_API',
    ])
  })

  test('names the file and line of each added read, once, and skips prose and deleted files', () => {
    const diff = [
      'diff --git a/src/pay.ts b/src/pay.ts',
      '--- a/src/pay.ts',
      '+++ b/src/pay.ts',
      '@@ -3,0 +4,2 @@ export',
      '+const a = 1',
      '+const key = process.env.STRIPE_KEY',
      '@@ -20 +22 @@',
      '-const u = 1',
      '+const url = process.env.REDIS_URL ?? process.env.STRIPE_KEY',
      'diff --git a/README.md b/README.md',
      '+++ b/README.md',
      '@@ -1,0 +2 @@',
      '+Set `process.env.DOC_ONLY`.',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-process.env.GONE',
      '+++ b/app/cache.py',
      '@@ -0,0 +1,4 @@',
      '+import os',
      '+',
      '+',
      "+REDIS = os.getenv('REDIS_URL') or os.getenv('CACHE_TTL')",
    ].join('\n')
    expect(diffReads(diff)).toEqual([
      { name: 'STRIPE_KEY', file: 'src/pay.ts', line: 5 },
      { name: 'REDIS_URL', file: 'src/pay.ts', line: 22 },
      { name: 'CACHE_TTL', file: 'app/cache.py', line: 4 },
    ])
  })

  test('reads the names a reference file lists', () => {
    const names = listedNames('A=1\nexport B=\n# C=placeholder\n  #D =x\n# just a comment\nE\nlower_case=1\n')
    expect([...names].sort()).toEqual(['A', 'B', 'C', 'D', 'lower_case'])
  })

  test('the note names at most ten variables', () => {
    expect(noteText([{ name: 'STRIPE_KEY', file: 'src/pay.ts', line: 12 }, { name: 'REDIS_URL', file: 'app/cache.py', line: 4 }], '.env.example')).toBe(
      'env-sync: this commit reads env variables .env.example lacks: STRIPE_KEY (src/pay.ts:12) · REDIS_URL (app/cache.py:4). Add them to .env.example with a placeholder value, never a real secret.',
    )
    const many = Array.from({ length: 13 }, (_, i) => ({ name: `V${i}`, file: 'a.ts', line: i }))
    expect(noteText(many, '.env.sample')).toContain('V9 (a.ts:9) · 3 more. Add them to .env.sample')
  })
})

describe('commits', () => {
  test('knows a commit and its directory', () => {
    expect(isCommit('git add a.ts && git commit -m x')).toBe(true)
    expect(isCommit('git -c user.email=k@x -c user.name=d commit -m x')).toBe(true)
    expect(commitDir('cd sub && git -c user.name=d -C deep commit -m x', '/src/app')).toBe('/src/app/sub/deep')
    expect(isCommit('git commit --dry-run')).toBe(false)
    expect(isCommit('git log')).toBe(false)
    expect(commitDir('cd sub && git -C inner commit -m x', '/r')).toBe('/r/sub/inner')
  })

  test('a directory the shell expands first is named, never joined as text', () => {
    expect(() => commitDir('cd $D && git commit -m x', '/r')).toThrow("the commit's directory is not known: cd $D")
    expect(() => commitDir('git -C ~/app commit -m x', '/r')).toThrow("the commit's directory is not known: git -C ~/app")
  })

  test('the gate stops a commit, a push and a merge, and nothing else', () => {
    for (const command of ['git commit -m x', 'git push', 'git -c a=b merge main', 'cd app && git push origin main']) {
      expect(isGuarded(command), command).toBe(true)
    }
    for (const command of ['git status', 'git push --dry-run', 'git log', 'echo "gitcommit"']) expect(isGuarded(command), command).toBe(false)
    expect(modeOf('deny')).toBe('deny')
    expect(modeOf('x')).toBe(undefined)
    expect(denyText(['A', 'B'], '.env.example')).toBe('stopped: .env.example still lacks 2 variable(s): A · B. Add them with a placeholder value and run the command again; there is no way around this gate.')
  })
})
