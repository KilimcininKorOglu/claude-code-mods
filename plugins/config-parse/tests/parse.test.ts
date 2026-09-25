import { describe, expect, test, tier } from 'claude-code/testing'

import { denyText, doneLog, envError, isGuarded, isJsonc, isMissingTool, jsoncText, jsonError, kindOf, logText, modeOf, noteText, pythonCode, pythonError, sectionKey, shownPath, sidebarLines } from '../hooks/parse.ts'

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

  test('reads a JSON-with-comments file as its tool does, and keeps a strict one strict', async () => {
    for (const path of ['/a/tsconfig.json', '/a/tsconfig.build.json', '/a/jsconfig.json', '/a/.vscode/settings.json', '/a/.devcontainer/devcontainer.json', '/a/x.jsonc']) {
      expect(isJsonc(path), path).toBe(true)
    }
    for (const path of ['/a/package.json', '/a/composer.json', '/a/vscode/settings.json']) expect(isJsonc(path), path).toBe(false)
    expect(kindOf('/a/x.jsonc')).toBe('json')
    const tsconfig = '{\n  // the build\n  "compilerOptions": { "strict": true, /* on */ "outDir": "dist", },\n  "include": ["src/**/*", "http://x//y"],\n}\n'
    expect(jsonError(tsconfig)).not.toBe(undefined)
    expect(jsonError(jsoncText(tsconfig))).toBe(undefined)
    expect(JSON.parse(jsoncText(tsconfig)).include).toEqual(['src/**/*', 'http://x//y'])
    // A real error still reads, and the blanked text keeps every line where it stood.
    expect(jsonError(jsoncText('{\n  // a\n  "a": 1\n  "b": 2\n}'))).not.toBe(undefined)
    expect(jsoncText('{\n/* a\nb */ "a": 1,\n}')).toBe('{\n    \n     "a": 1 \n}')
  })

  test('finds the first line of a .env file that is not a setting', async () => {
    expect(envError('# note\n\nA=1\nexport B=2\nC =3\n')).toBe(undefined)
    expect(envError('A=1\nthis is prose\n')).toBe('line 2 is not a setting: this is prose')
    expect(envError('1BAD=2')).toBe('line 1 is not a setting: 1BAD=2')
  })

  test('builds the python program of a kind and reads what it printed', async () => {
    // A `---` stream and an application tag are valid YAML: every document is read, and a tag builds nothing.
    expect(pythonCode('yaml')).toContain('yaml.load_all(')
    expect(pythonCode('yaml')).toContain('class L(yaml.SafeLoader)')
    expect(pythonCode('yaml')).toContain('L.add_multi_constructor("",')
    expect(pythonCode('toml')).toContain('tomllib.load')
    expect(isMissingTool("ModuleNotFoundError: No module named 'yaml'")).toBe(true)
    expect(isMissingTool('yaml.scanner.ScannerError: mapping values are not allowed here')).toBe(false)
    expect(pythonError('Traceback:\n  File "x"\nyaml.scanner.ScannerError: mapping values are not allowed here')).toBe('yaml.scanner.ScannerError: mapping values are not allowed here')
    expect(pythonError('TOMLDecodeError: Invalid value (at line 3)')).toBe('Invalid value (at line 3)')
    expect(pythonError('')).toBe('the file was not parsed')
    // PyYAML prints the mark after the error: the error stays, the position joins it, the file name does not.
    const scanner = [
      '    raise ScannerError(None, None,',
      '            "mapping values are not allowed here",',
      'yaml.scanner.ScannerError: mapping values are not allowed here',
      '  in "/work/a.yml", line 1, column 5',
    ].join('\n')
    expect(pythonError(scanner)).toBe('yaml.scanner.ScannerError: mapping values are not allowed here (line 1, column 5)')
    const parser = [
      'yaml.parser.ParserError: while parsing a block mapping',
      '  in "/work/a.yml", line 1, column 1',
      "expected <block end>, but found '<block mapping start>'",
      '  in "/work/a.yml", line 3, column 2',
    ].join('\n')
    expect(pythonError(parser)).toBe("yaml.parser.ParserError: while parsing a block mapping (line 1, column 1); expected <block end>, but found '<block mapping start>' (line 3, column 2)")
    expect(pythonError('    raise TOMLDecodeError("Invalid value", src, pos)\ntomllib.TOMLDecodeError: Invalid value (at line 1, column 5)')).toBe('tomllib.TOMLDecodeError: Invalid value (at line 1, column 5)')
  })

  test('writes one text for the model and one for the person, and one sidebar line', async () => {
    expect(noteText('json', 'package.json', 'Unexpected token }')).toBe('config-parse: package.json does not parse as JSON after this edit: Unexpected token }. Fix the file before you go on; a build or a service that reads it fails on this.')
    expect(logText('json', 'package.json', 'Unexpected token }')).toBe('package.json does not parse as JSON: Unexpected token }')
    expect(logText('env', '.env', 'line 2 is not a setting: x')).toBe('.env does not parse as a .env file: line 2 is not a setting: x')
    expect(doneLog('yaml', 'ci.yml')).toBe('ci.yml parses as YAML again')
    // The pane draws the title, not the key, so the file is a line of its own.
    expect(sidebarLines('package.json', 'boom')).toEqual([{ text: 'package.json', kind: 'error' }, { text: 'boom', kind: 'error' }])
  })

  test('the position a parser names is yellow inside the red error', () => {
    expect(sidebarLines('.env', 'line 2 is not a setting: x')[1]).toEqual({
      text: 'line 2 is not a setting: x',
      kind: 'error',
      parts: [{ text: 'line 2', kind: 'warn' }, { text: ' is not a setting: x', kind: 'error' }],
    })
    expect(sidebarLines('a.toml', 'tomllib.TOMLDecodeError: Invalid value (at line 1, column 5)')[1]?.parts).toEqual([
      { text: 'tomllib.TOMLDecodeError: Invalid value ', kind: 'error' },
      { text: '(at line 1, column 5)', kind: 'warn' },
    ])
  })

  test('stops a commit, a push and a merge, and leaves every other command alone', async () => {
    for (const command of ['git commit -m "x"', 'cd app && git commit', 'git -c user.name=x push', 'git merge main', 'npm t && git push origin main']) {
      expect(isGuarded(command), command).toBe(true)
    }
    for (const command of ['git commit --dry-run', 'git log', 'git status', 'git push --help', 'echo "git commit"', 'gitcommit']) {
      expect(isGuarded(command), command).toBe(false)
    }
  })

  test('says why the command stopped and names the files, the rest counted', async () => {
    expect(denyText(['a.json'])).toBe('stopped: 1 file(s) do not parse: a.json. Fix them and run the command again; there is no way around this gate.')
    expect(denyText(Array.from({ length: 10 }, (_, i) => `f${i}.json`))).toContain('f7.json · 2 more.')
    expect(modeOf('deny')).toBe('deny')
    expect(modeOf('note')).toBe('note')
    for (const arg of ['', 'x', 'DENY']) expect(modeOf(arg), arg).toBe(undefined)
  })

  test('shows a path against the session directory and keys one section per file', async () => {
    expect(shownPath('/Users/u/app/src/a.json', '/Users/u/app/')).toBe('src/a.json')
    expect(shownPath('/other/a.json', '/Users/u/app')).toBe('/other/a.json')
    expect(sectionKey('src/a.json')).toBe('src-a.json')
  })
})
