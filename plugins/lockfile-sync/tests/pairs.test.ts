import { describe, expect, test, tier } from 'claude-code/testing'

import { changedFiles, isManifest, lockCandidates, noteText, touchesDependencies } from '../hooks/pairs.ts'

tier('user')

/** A one-hunk diff whose lines are given as they appear after `@@`. */
const diffOf = (...lines: string[]): string => `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,9 +1,9 @@\n${lines.join('\n')}\n`

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
    expect(touchesDependencies('package.json', diffOf(' {', '   "dependencies": {', '-    "left-pad": "^1.0.0"', '+    "left-pad": "^1.3.0"', '   }', ' }'))).toBe(true)
    expect(touchesDependencies('package.json', diffOf(' {', '   "scripts": {', '+    "lint": "eslint ."', '   },', '-  "version": "1.0.0",', '+  "version": "1.1.0",'))).toBe(false)
    expect(touchesDependencies('package.json', diffOf('+    "left-pad": "^1.3.0"'))).toBe(true)
  })

  test('reads TOML tables, go.mod blocks, a Gemfile and pubspec.yaml', () => {
    expect(touchesDependencies('Cargo.toml', diffOf(' [package]', '-version = "0.1.0"', '+version = "0.2.0"'))).toBe(false)
    expect(touchesDependencies('Cargo.toml', diffOf(' [dependencies]', '+serde = "1"'))).toBe(true)
    expect(touchesDependencies('Cargo.toml', diffOf(' [target.x86_64-unknown-linux-gnu.dependencies]', '+libc = "0.2"'))).toBe(true)
    expect(touchesDependencies('pyproject.toml', diffOf(' [tool.ruff]', '+line-length = 100'))).toBe(false)
    expect(touchesDependencies('pyproject.toml', diffOf(' [tool.poetry.dependencies]', '+httpx = "^0.27"'))).toBe(true)
    expect(touchesDependencies('go.mod', diffOf(' require (', '+\tgithub.com/x/y v1.2.3', ' )'))).toBe(true)
    expect(touchesDependencies('go.mod', diffOf(' module example.com/a', '-go 1.21', '+go 1.22'))).toBe(false)
    expect(touchesDependencies('Gemfile', diffOf("+gem 'rails', '~> 7.1'"))).toBe(true)
    expect(touchesDependencies('Gemfile', diffOf('+# a comment'))).toBe(false)
    expect(touchesDependencies('pubspec.yaml', diffOf(' dependencies:', '+  http: ^1.2.0'))).toBe(true)
    expect(touchesDependencies('pubspec.yaml', diffOf(' flutter:', '+  uses-material-design: true'))).toBe(false)
  })

  test('the note names each manifest and its lockfile', () => {
    expect(noteText([{ manifest: 'package.json', lock: 'package-lock.json' }, { manifest: 'go.mod', lock: 'go.sum' }])).toBe(
      "lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum. Run the package manager's install so the lockfile matches, and commit it.",
    )
  })
})
