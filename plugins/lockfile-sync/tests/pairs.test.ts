import { describe, expect, test, tier } from 'claude-code/testing'

import { changedFiles, commitDir, denyText, isGuarded, isManifest, lockCandidates, modeOf, noteText, touchesDependencies } from '../hooks/pairs.ts'

tier('user')

/** A one-hunk diff whose lines are given as they appear after `@@`, from the file's first line. */
const diffOf = (...lines: string[]): string => `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,9 +1,9 @@\n${lines.join('\n')}\n`

/** The file as it stands after that diff: its context and added lines, without the diff's own marker. */
const fileOf = (...lines: string[]): string => lines.filter(l => !l.startsWith('-')).map(l => l.slice(1)).join('\n')

/** The whole file is the diff's own post-image, which is the case a hunk that starts at line 1 covers. */
const touches = (manifest: string, ...lines: string[]): boolean =>
  touchesDependencies(manifest, diffOf(...lines), fileOf(...lines))

describe('commits', () => {
  test('finds the commit\'s directory, and names one the shell expands first', () => {
    expect(commitDir('cd sub && git -C inner commit -m x', '/r')).toBe('/r/sub/inner')
    expect(() => commitDir('cd $D && git commit -m x', '/r')).toThrow("the commit's directory is not known: cd $D")
    expect(() => commitDir('cd `mktemp -d` && git commit -m x', '/r')).toThrow("the commit's directory is not known: cd `mktemp")
  })
})

describe('pairs', () => {
  test('lists added and modified files, not deleted ones', () => {
    expect(changedFiles('M\tpackage.json\nA\tapps/web/package.json\nD\tgo.mod\n')).toEqual(['package.json', 'apps/web/package.json'])
    expect(isManifest('apps/web/package.json')).toBe(true)
    expect(isManifest('package-lock.json')).toBe(false)
  })

  test('looks for the lockfile from the manifest directory up to the root', () => {
    expect(lockCandidates('crates/a/Cargo.toml')).toEqual(['crates/a/Cargo.lock', 'crates/Cargo.lock', 'Cargo.lock'])
    expect(lockCandidates('go.mod')).toEqual(['go.sum'])
  })

  test('a package.json dependency counts, a script or the version does not', () => {
    expect(touches('package.json', ' {', '   "dependencies": {', '-    "left-pad": "^1.0.0"', '+    "left-pad": "^1.3.0"', '   }', ' }')).toBe(true)
    expect(touches('package.json', ' {', '   "scripts": {', '+    "lint": "eslint ."', '   },', '-  "version": "1.0.0",', '+  "version": "1.1.0",')).toBe(false)
  })

  test('a root key the hunk cannot reach is read from the file, not from the hunk', () => {
    // The hunk starts 40 lines in, so nothing in it reaches the root `{`; only the file says where the key sits.
    const diff = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -40,2 +40,3 @@\n   "engines": { "node": ">=22" },\n+  "allowScripts": { "esbuild": true },\n   "private": true\n'
    const file = [...Array.from({ length: 38 }, (_, i) => `  "pad${i}": ${i},`)]
    const text = ['{', ...file, '  "engines": { "node": ">=22" },', '  "allowScripts": { "esbuild": true },', '  "private": true', '}'].join('\n')
    expect(touchesDependencies('package.json', diff, text)).toBe(false)
    // A manifest that cannot be read leaves the change counted.
    expect(touchesDependencies('package.json', diff, '')).toBe(true)
  })

  test('reads TOML tables, go.mod blocks, a Gemfile and pubspec.yaml', () => {
    expect(touches('Cargo.toml', ' [package]', '-version = "0.1.0"', '+version = "0.2.0"')).toBe(false)
    expect(touches('Cargo.toml', ' [dependencies]', '+serde = "1"')).toBe(true)
    expect(touches('Cargo.toml', ' [target.x86_64-unknown-linux-gnu.dependencies]', '+libc = "0.2"')).toBe(true)
    expect(touches('pyproject.toml', ' [tool.ruff]', '+line-length = 100')).toBe(false)
    expect(touches('pyproject.toml', ' [tool.poetry.dependencies]', '+httpx = "^0.27"')).toBe(true)
    expect(touches('go.mod', ' require (', '+\tgithub.com/x/y v1.2.3', ' )')).toBe(true)
    expect(touches('go.mod', ' module example.com/a', '-go 1.21', '+go 1.22')).toBe(false)
    expect(touches('Gemfile', "+gem 'rails', '~> 7.1'")).toBe(true)
    expect(touches('Gemfile', '+# a comment')).toBe(false)
    expect(touches('pubspec.yaml', ' dependencies:', '+  http: ^1.2.0')).toBe(true)
    expect(touches('pubspec.yaml', ' flutter:', '+  uses-material-design: true')).toBe(false)
  })

  test('the note names each manifest and its lockfile', () => {
    expect(noteText([{ manifest: 'package.json', lock: 'package-lock.json' }, { manifest: 'go.mod', lock: 'go.sum' }])).toBe(
      "lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum. Run the package manager's install so the lockfile matches, and commit it.",
    )
  })

  test('the gate stops a commit, a push and a merge, and says why', () => {
    for (const command of ['git commit -m x', 'git push origin main', 'git merge main']) expect(isGuarded(command), command).toBe(true)
    for (const command of ['git status', 'git push --dry-run', 'git log']) expect(isGuarded(command), command).toBe(false)
    expect(modeOf('note')).toBe('note')
    expect(modeOf('')).toBe(undefined)
    expect(denyText([{ manifest: 'package.json', lock: 'package-lock.json' }])).toBe(
      'stopped: 1 lockfile(s) are behind their manifest: package-lock.json behind package.json. Install the dependencies so the lockfile is written, then run the command again; there is no way around this gate.',
    )
  })
})
