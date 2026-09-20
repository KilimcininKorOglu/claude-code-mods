import { describe, expect, test, tier } from 'claude-code/testing'

import { distance, lookAlike } from '../hooks/popular.ts'
import { compareVersions, cratesInfo, goInfo, goOldest, latestInMajor, npmInfo, osvVulns, packagistInfo, pypiInfo, registryUrl } from '../hooks/registry.ts'
import { denyText, gateText, isGuarded, modeOf, registryReasons, targetVersion, vulnReason } from '../hooks/rules.ts'

tier('user')

const NOW = Date.parse('2026-09-19T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

describe('registry answers', () => {
  test('reads each registry into the latest version, the versions and the first publish time', async () => {
    expect(npmInfo({ 'dist-tags': { latest: '4.17.21' }, versions: { '4.17.15': {}, '4.17.21': {} }, time: { created: '2012-04-23T16:37:11.912Z' } }))
      .toEqual({ latest: '4.17.21', versions: ['4.17.15', '4.17.21'], created: Date.parse('2012-04-23T16:37:11.912Z') })
    expect(pypiInfo({ info: { version: '2.32.3' }, releases: { '0.1': [{ upload_time_iso_8601: '2011-02-14T00:00:00Z' }], '2.32.3': [{ upload_time_iso_8601: '2024-05-29T00:00:00Z' }], '9.9': [] } }))
      .toEqual({ latest: '2.32.3', versions: ['0.1', '2.32.3'], created: Date.parse('2011-02-14T00:00:00Z') })
    expect(goInfo({ Version: 'v1.12.0', Time: '2026-02-28T10:10:09Z' }, 'v1.9.0\nv1.3.0\n', { Version: 'v1.3.0', Time: '2018-08-14T00:00:00Z' }))
      .toEqual({ latest: 'v1.12.0', versions: ['v1.9.0', 'v1.3.0'], created: Date.parse('2018-08-14T00:00:00Z') })
    expect(goOldest('v1.9.0\nv1.10.0\nv1.3.0\n')).toBe('v1.3.0')
    expect(cratesInfo({ crate: { max_stable_version: '1.0.229', created_at: '2014-12-05T20:20:39Z' }, versions: [{ num: '1.0.229' }, { num: '1.0.1', yanked: true }] }))
      .toEqual({ latest: '1.0.229', versions: ['1.0.229'], created: Date.parse('2014-12-05T20:20:39Z') })
    expect(packagistInfo({ packages: { 'a/b': [{ version: '3.0.0-RC1', time: '2026-01-01T00:00:00+00:00' }, { version: 'v2.1.0', time: '2025-01-01T00:00:00+00:00' }, { version: '1.0.0', time: '2019-01-01T00:00:00+00:00' }] } }, 'a/b'))
      .toEqual({ latest: '2.1.0', versions: ['3.0.0-RC1', '2.1.0', '1.0.0'], created: Date.parse('2019-01-01T00:00:00Z') })
    expect(npmInfo({ error: 'x' })).toBe(undefined)
  })

  test('builds registry URLs, with a case-encoded Go path and an escaped npm scope', async () => {
    expect(registryUrl({ ecosystem: 'npm', name: '@types/node' })).toBe('https://registry.npmjs.org/@types%2Fnode')
    expect(registryUrl({ ecosystem: 'Go', name: 'github.com/BurntSushi/toml' })).toBe('https://proxy.golang.org/github.com/!burnt!sushi/toml/@latest')
  })

  test('compares versions and finds the newest in a major', async () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0-rc1', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(latestInMajor(['2.0.0', '2.11.1', '3.12.0', '2.12.0-beta'], '2.0.0')).toBe('2.11.1')
  })

  test('reads OSV ids and the versions that fix them, not commit hashes', async () => {
    const osv = { vulns: [{ id: 'GHSA-1', affected: [{ ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }, { type: 'GIT', events: [{ fixed: '74ea7cf7a6a27a4eeb2ae24e162bcc942a6706d5' }] }] }] }, { id: 'GHSA-2', affected: [{ ranges: [{ events: [{ fixed: '4.17.19' }] }] }] }] }
    expect(osvVulns(osv)).toEqual({ ids: ['GHSA-1', 'GHSA-2'], fixed: ['4.17.19', '4.17.21'] })
    expect(osvVulns({})).toEqual({ ids: [], fixed: [] })
  })
})

describe('rules', () => {
  const old = { latest: '4.18.1', versions: ['4.17.15', '4.17.21', '4.18.1'], created: NOW - 5000 * DAY }

  test('stops an old exact pin and names the latest, and lets a range or the latest through', async () => {
    expect(registryReasons({ ecosystem: 'npm', name: 'lodash', version: '4.17.15', exact: true }, old, NOW)).toEqual(['lodash@4.17.15 (npm) is not the latest version: the latest is 4.18.1'])
    expect(registryReasons({ ecosystem: 'npm', name: 'lodash', version: '^4.17.0', exact: false }, old, NOW)).toEqual([])
    const twoMajors = { latest: '3.12.0', versions: ['2.0.0', '2.11.1', '3.12.0'], created: NOW - 5000 * DAY }
    expect(registryReasons({ ecosystem: 'Packagist', name: 'monolog/monolog', version: '2.0.0', exact: true }, twoMajors, NOW)).toEqual(['monolog/monolog@2.0.0 (Packagist) is not the latest version: the latest is 3.12.0, the latest in its major version is 2.11.1'])
    expect(targetVersion({ ecosystem: 'npm', name: 'lodash', exact: false }, old)).toBe('4.18.1')
  })

  test('stops a package first published under 7 days ago, and a young look-alike name', async () => {
    const young = { latest: '1.0.0', versions: ['1.0.0'], created: NOW - 2 * DAY }
    expect(registryReasons({ ecosystem: 'npm', name: 'lodahs', exact: false }, young, NOW)).toEqual([
      'lodahs looks like the popular package lodash, and it is not that package; check the name',
      'lodahs was first published 2 day(s) ago, less than 7 days ago',
    ])
    expect(registryReasons({ ecosystem: 'npm', name: 'react-dnd', exact: false }, { latest: '16.0.1', versions: Array.from({ length: 40 }, (_, i) => `1.${i}.0`), created: NOW - 3000 * DAY }, NOW)).toEqual([])
    expect(lookAlike('PyPI', 'reqeusts')).toBe('requests')
    expect(lookAlike('npm', 'ms')).toBe(undefined)
    expect(lookAlike('npm', 'react')).toBe(undefined)
    expect(distance('lodash', 'lodahs')).toBe(1)
  })

  test('writes the vulnerability reason and the deny text', async () => {
    expect(vulnReason({ ecosystem: 'npm', name: 'lodash', exact: true }, '4.17.15', { ids: ['GHSA-1', 'GHSA-2'], fixed: ['4.17.12', '4.17.21'] }))
      .toBe('lodash@4.17.15 has 2 known vulnerability(ies) on OSV.dev: GHSA-1, GHSA-2; fixed in 4.17.21')
    expect(vulnReason({ ecosystem: 'npm', name: 'x', exact: false }, '1.0.0', { ids: [], fixed: [] })).toBe(undefined)
    expect(denyText(['a', 'b'])).toBe('dep-sentinel stopped this install: a · b. Install the latest version or the right name instead. If the user needs exactly this, tell them why, then run the same command again with the DEP_SENTINEL_SKIP=1 prefix.')
  })

  test('the gate stops a commit, a push and a merge, and says why', () => {
    for (const command of ['git commit -m x', 'git push origin main', 'git merge main']) expect(isGuarded(command), command).toBe(true)
    for (const command of ['git status', 'git push --dry-run', 'git log']) expect(isGuarded(command), command).toBe(false)
    expect(modeOf('note')).toBe('note')
    expect(modeOf('')).toBe(undefined)
    expect(gateText(['lodash'])).toBe(
      'stopped: 1 package(s) were installed unchecked: lodash. Run the install again so the registry and OSV.dev answer, then run the command again; there is no way around this gate, and only the person turns it off with /dep-sentinel mode note.',
    )
  })
})
