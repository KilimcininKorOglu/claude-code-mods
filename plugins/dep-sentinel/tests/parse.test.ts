import { describe, expect, test, tier } from 'claude-code/testing'

import { planOf } from '../hooks/parse.ts'

tier('user')

const names = (command: string): string[] => planOf(command).installs.map(p => `${p.ecosystem}:${p.name}${p.version === undefined ? '' : `@${p.version}`}${p.exact ? '!' : ''}`)

describe('parse', () => {
  test('reads npm, pnpm, yarn and bun installs, scoped names and exact pins', async () => {
    expect(names('npm install lodash@4.17.15 @types/node -D')).toEqual(['npm:lodash@4.17.15!', 'npm:@types/node'])
    expect(names('cd web && pnpm add react@^18 && yarn add Zod')).toEqual(['npm:react@^18', 'npm:zod'])
    expect(names('bun add ./local-pkg https://x.test/a.tgz file:../b left-pad@=1.3.0')).toEqual(['npm:left-pad@1.3.0!'])
    expect(names('npm install')).toEqual([])
    expect(names('npm ci && npm run build')).toEqual([])
  })

  test('reads pip, uv and poetry installs with normalized names; a requirements file is not read', async () => {
    expect(names('pip install Flask_Cors requests==2.25.0 "django>=4" numpy[extra]==1.26.0')).toEqual(['PyPI:flask-cors', 'PyPI:requests@2.25.0!', 'PyPI:django', 'PyPI:numpy@1.26.0!'])
    expect(names('python3 -m pip install -U --index-url https://x.test/simple httpx')).toEqual(['PyPI:httpx'])
    expect(names('uv add ruff && poetry add black')).toEqual(['PyPI:ruff', 'PyPI:black'])
    expect(names('pip install -r requirements.txt')).toEqual([])
    expect(names('pip install -e .')).toEqual([])
  })

  test('reads go, cargo and composer installs', async () => {
    expect(names('go get github.com/gin-gonic/gin@v1.9.0 golang.org/x/tools/cmd/goimports@latest ./...')).toEqual(['Go:github.com/gin-gonic/gin@v1.9.0!', 'Go:golang.org/x/tools/cmd/goimports'])
    expect(names('cargo add serde@1.0.100 tokio@=1.38.0 --features full')).toEqual(['crates.io:serde@1.0.100', 'crates.io:tokio@1.38.0!'])
    expect(names('composer require monolog/monolog:2.0.0 guzzlehttp/guzzle ^7.0 php')).toEqual(['Packagist:monolog/monolog@2.0.0!', 'Packagist:guzzlehttp/guzzle@^7.0'])
  })

  test('sees the skip prefix, keeps each package once and ignores other commands', async () => {
    expect(planOf('DEP_SENTINEL_SKIP=1 npm i lodash@4.17.15').skipped).toBe(true)
    expect(planOf('npm i lodash@4.17.15').skipped).toBe(false)
    expect(names('npm i a b a')).toEqual(['npm:a', 'npm:b'])
    expect(names('echo "npm install evil" && git status')).toEqual([])
    expect(planOf('npm i a b c d e f g h i j k l').installs).toHaveLength(10)
  })
})
