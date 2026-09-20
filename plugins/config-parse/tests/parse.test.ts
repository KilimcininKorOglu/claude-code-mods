import { describe, expect, test, tier } from 'claude-code/testing'

import { doneLog, envError, isMissingTool, jsonError, kindOf, logText, noteText, pythonCode, pythonError, sectionKey, shownPath, sidebarLines } from '../hooks/parse.ts'

tier('user')

describe('parse', () => {
  test('names the configuration files it reads', async () => {
    expect(kindOf('/a/package.json')).toBe('json')
    expect(kindOf('/a/docker-compose.YML')).toBe('yaml')
    expect(kindOf('/a/Cargo.toml')).toBe('toml')
    expect(kindOf('/a/.env')).toBe('env')
    expect(kindOf('/a/.env.production')).toBe('env')
    for (const path of ['/a/main.ts', '/a/README.md', '/a/environment.py', '/a/.envrc']) expect(kindOf(path), path).toBe(undefined)
  })

  test('finds a JSON error and lets a good file through', async () => {
    expect(jsonError('{"a": 1}')).toBe(undefined)
    expect(jsonError('{"a": 1,}')).not.toBe(undefined)
    expect(jsonError('')).not.toBe(undefined)
  })

  test('finds the first line of a .env file that is not a setting', async () => {
    expect(envError('# note\n\nA=1\nexport B=2\nC =3\n')).toBe(undefined)
    expect(envError('A=1\nthis is prose\n')).toBe('line 2 is not a setting: this is prose')
    expect(envError('1BAD=2')).toBe('line 1 is not a setting: 1BAD=2')
  })

  test('builds the python program of a kind and reads what it printed', async () => {
    expect(pythonCode('yaml')).toContain('yaml.safe_load')
    expect(pythonCode('toml')).toContain('tomllib.load')
    expect(isMissingTool("ModuleNotFoundError: No module named 'yaml'")).toBe(true)
    expect(isMissingTool('yaml.scanner.ScannerError: mapping values are not allowed here')).toBe(false)
    expect(pythonError('Traceback:\n  File "x"\nyaml.scanner.ScannerError: mapping values are not allowed here')).toBe('yaml.scanner.ScannerError: mapping values are not allowed here')
    expect(pythonError('TOMLDecodeError: Invalid value (at line 3)')).toBe('Invalid value (at line 3)')
    expect(pythonError('')).toBe('the file was not parsed')
  })

  test('writes one text for the model and one for the person, and one sidebar line', async () => {
    expect(noteText('json', 'package.json', 'Unexpected token }')).toBe('config-parse: package.json does not parse as JSON after this edit: Unexpected token }. Fix the file before you go on; a build or a service that reads it fails on this.')
    expect(logText('json', 'package.json', 'Unexpected token }')).toBe('package.json does not parse as JSON: Unexpected token }')
    expect(logText('env', '.env', 'line 2 is not a setting: x')).toBe('.env does not parse as a .env file: line 2 is not a setting: x')
    expect(doneLog('yaml', 'ci.yml')).toBe('ci.yml parses as YAML again')
    expect(sidebarLines('boom')).toEqual([{ text: 'boom', kind: 'error' }])
  })

  test('shows a path against the session directory and keys one section per file', async () => {
    expect(shownPath('/Users/u/app/src/a.json', '/Users/u/app/')).toBe('src/a.json')
    expect(shownPath('/other/a.json', '/Users/u/app')).toBe('/other/a.json')
    expect(sectionKey('src/a.json')).toBe('src-a.json')
  })
})
