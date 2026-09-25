import { describe, expect, test, tier } from 'claude-code/testing'

import { CLOUD, logs } from '../hooks/filters/cloud.ts'
import type { FilterResult, FilterTable } from '../hooks/filters/common.ts'
import { SYSTEM } from '../hooks/filters/system.ts'
import { planFor, runFilter } from '../hooks/pipeline.ts'

tier('user')

const TABLE: FilterTable = { ...SYSTEM, ...CLOUD }

function run(key: string, text: string, args: string[] = [], exitCode = 0): FilterResult {
  const filter = TABLE[key]
  if (filter === undefined) throw new Error(`no filter ${key}`)
  return filter.run({ args, text, exitCode })
}

// Captured from macOS ls and find in this repository.
const LS_LA = 'total 104\ndrwxr-xr-x  11 kerem  staff    352 Sep 25 14:58 .\ndrwxr-xr-x  15 kerem  staff    480 Sep 25 14:41 ..\n-rw-r--r--   1 kerem  staff   6256 Sep 25 14:42 command.ts\ndrwxr-xr-x  13 kerem  staff    416 Sep 25 14:59 filters\n-rw-r--r--   1 kerem  staff    178 Sep 25 14:36 hooks.json\ndrwxr-xr-x   3 kerem  staff     96 Sep 25 14:36 node_modules\n-rw-r--r--   1 kerem  staff  11355 Sep 25 14:44 register.ts\n'

describe('files', () => {
  test('ls -la as directories first, files with their size, noise directories named only', () => {
    const r = run('ls', LS_LA, ['-la'])
    expect(r.text).toBe('filters/\ncommand.ts  6.1K\nhooks.json  178B\nregister.ts  11.1K\n(node_modules/ not listed)')
    expect(run('ls', 'a.ts\nb.ts\n').text).toBe('a.ts\nb.ts')
  })

  test('find grouped by directory with a count', () => {
    const text = 'hooks/text.ts\nhooks/rules.ts\ntests/js.test.ts\nhooks/filters/rust.ts\nhooks/filters/go.ts\n'
    expect(run('find', text, ['hooks', 'tests', '-name', '*.ts']).text).toBe('hooks/ text.ts rules.ts\ntests/ js.test.ts\nhooks/filters/ rust.ts go.ts\n5 paths in 3 directories')
    expect(run('find', 'a\x00b', ['.', '-print0']).text).toBe('a\x00b')
  })

  // grep -rn and rg -n print `path:line:text` when their output is not a terminal (written from that format).
  test('grep groups matches by file and caps each file', () => {
    const many = Array.from({ length: 30 }, (_, i) => `src/a.ts:${i + 1}:export function f${i}() {}`)
    const text = [...many, 'src/b.ts:3:export function g() {}'].join('\n')
    const r = run('grep', text, ['-rn', 'export function', 'src'])
    const lines = r.text.split('\n')
    expect(lines[0]).toBe('src/a.ts (30):')
    expect(lines[1]).toBe('  1:export function f0() {}')
    expect(lines).toContain('  … +5 more in this file')
    expect(lines.at(-1)).toBe('31 matches in 2 files, 26 shown')
    expect(r.elided).toBe(true)
    expect(run('rg', 'src/a.ts\nsrc/b.ts\n', ['-l', 'x']).text).toBe('src/a.ts\nsrc/b.ts')
    expect(run('grep', '3:only one file\n', ['-n', 'x', 'a.ts']).text).toBe('3:only one file')
  })

  test('env masks credentials and sorts', () => {
    expect(run('env', 'PATH=/usr/bin\nGITHUB_TOKEN=ghp_abc\nHOME=/Users/u\nEMPTY_SECRET=\n').text).toBe('EMPTY_SECRET=\nGITHUB_TOKEN=***\nHOME=/Users/u\nPATH=/usr/bin')
  })

  test('a bare env is the command, not a wrapper, and its secrets are masked through the plan', () => {
    // env alone, with options, or with variables alone prints the environment; with a command it wraps it.
    for (const cmd of ['env', 'env -0', 'env FOO=1', 'FOO=1 env']) expect(planFor(cmd)?.family, cmd).toBe('env')
    expect(planFor('env FOO=1 git status')?.family).toBe('git status')
    expect(planFor('env -i PATH=/bin ls')?.family).toBe('ls')
    const plan = planFor('env')
    if (plan === undefined) throw new Error('no plan for env')
    const r = runFilter(plan, 'B=1\nGEMINI_API_KEY=AIzaSyExample\nA=2\n', 0, false)
    expect(r).toEqual({ text: 'A=2\nB=1\nGEMINI_API_KEY=***', elided: true, redacted: true })
    expect(run('env', 'A=1\nB=2\n').redacted).toBe(undefined)
  })

  // Captured from macOS ls -R and GNU gls -R over a small tree with a node_modules directory.
  const LS_R_BSD = 'a\nf1.txt\nf2.txt\nnode_modules\n\nsrc/a:\nb\ng1.ts\ng2.ts\n\nsrc/a/b:\nh1.md\nh2.md\n\nsrc/node_modules:\nx\n\nsrc/node_modules/x:\nn1.js\nn2.js\nn3.js\n'
  const LS_R_GNU = `src:\n${LS_R_BSD}`

  test('ls -R lists one line per directory through the plan, and counts the directories under node_modules', () => {
    const plan = planFor('ls -R src')
    if (plan === undefined) throw new Error('no plan for ls -R')
    const want = 'src/ a f1.txt f2.txt node_modules\nsrc/a/ b g1.ts g2.ts\nsrc/a/b/ h1.md h2.md\n9 entries in 3 directories; 2 directories under noise directories not listed'
    expect(runFilter(plan, LS_R_BSD, 0, false)).toEqual({ text: want, elided: true })
    expect(run('ls', LS_R_GNU, ['-R', 'src']).text).toBe(want)
    const long = 'total 0\ndrwxr-xr-x  6 kerem  wheel  192 Sep 25 19:27 a\n-rw-r--r--  1 kerem  wheel    12 Sep 25 19:27 f1.txt\n\nsrc/a:\ntotal 0\n-rw-r--r--  1 kerem  wheel  2048 Sep 25 19:27 g1.ts\n'
    expect(run('ls', long, ['-lR', 'src']).text).toBe('src/ a/ f1.txt (12B)\nsrc/a/ g1.ts (2.0K)\n3 entries in 2 directories')
  })

  // Captured from macOS cp, mv, rm, ln and GNU gcp, grm with -v.
  test('cp, mv, rm and ln with -v keep every error, the first paths and the count', () => {
    const paths = Array.from({ length: 40 }, (_, i) => `moved/node_modules/x/n${i}.js`)
    const plan = planFor('rm -rv moved')
    if (plan === undefined) throw new Error('no plan for rm -rv')
    const r = runFilter(plan, [...paths, 'rm: moved/locked: Permission denied'].join('\n'), 1, false)
    expect(r.text).toBe(['rm: moved/locked: Permission denied', ...paths.slice(0, 5), '… +35 more', '40 paths removed'].join('\n'))
    expect(r.elided).toBe(true)
    const gnu = Array.from({ length: 8 }, (_, i) => `removed 'g2/f${i}.txt'`).concat(["removed directory 'g2'"]).join('\n')
    expect(run('grm', gnu, ['-rv', 'g2']).text.split('\n').at(-1)).toBe('9 paths removed')
    expect(run('cp', "src -> dst/\nsrc/f1.txt -> dst/f1.txt\n", ['-Rv', 'src', 'dst']).text).toBe('src -> dst/\nsrc/f1.txt -> dst/f1.txt\n2 paths copied')
    expect(run('mv', 'mv: rename nope to x: No such file or directory\n', ['nope', 'x']).text).toBe('mv: rename nope to x: No such file or directory')
    expect(planFor('ln -sfv a b')?.family).toBe('ln')
    // Without -v they stay quiet, so a chain around them is still the printing command's output.
    expect(planFor('rm -rf dist && cargo test')?.family).toBe('cargo test')
    expect(planFor('rm -rv dist && cargo test')?.family).toBe('other')
  })

  test('a grep at the end of a pipeline is what the filter reads', () => {
    expect(planFor('git log | grep fix')?.family).toBe('grep')
  })
})

// The columns and spacing of docker 29's `ps` and `images`, with made-up names.
const DOCKER_PS = 'CONTAINER ID   IMAGE           COMMAND                  CREATED        STATUS                  PORTS                    NAMES\nb699b119d3e7   app:latest      "/usr/bin/supervisor…"   11 hours ago   Up 11 hours (healthy)   127.0.0.1:3131->3131/tcp   app-web\n6e03cb3d360e   worker          "/usr/local/bin/work…"   11 hours ago   Exited (1) 2 hours ago                            app-worker\n'
const DOCKER_IMAGES = 'WARNING: This output is designed for human readability. For machine-readable output, please use --format.\nIMAGE                 ID             DISK USAGE   CONTENT SIZE   EXTRA\nalpine:3.21           2155344e09b4       8.17MB             0B   U    \ndebian:12-slim        813cd0370d82       97.2MB             0B        \n'

describe('containers and clouds', () => {
  test('docker ps and images keep the columns that name a container or an image', () => {
    expect(run('docker ps', DOCKER_PS, ['-a']).text).toBe('2 rows: NAMES  IMAGE  STATUS  PORTS\napp-web  app:latest  Up 11 hours (healthy)  127.0.0.1:3131->3131/tcp\napp-worker  worker  Exited (1) 2 hours ago')
    expect(run('docker images', DOCKER_IMAGES).text).toBe('2 rows: IMAGE  DISK USAGE\nalpine:3.21  8.17MB\ndebian:12-slim  97.2MB')
    expect(run('docker ps', '{"Names":"a"}\n', ['--format', 'json']).text).toBe('{"Names":"a"}')
  })

  test('logs fold lines that differ only in times and numbers, and keep the newest', () => {
    const text = ['2026-09-25T10:00:01Z GET /health 200 3ms', '2026-09-25T10:00:02Z GET /health 200 4ms', '2026-09-25T10:00:03Z GET /health 200 2ms', '2026-09-25T10:00:04Z ERROR db timeout'].join('\n')
    expect(logs({ text }).text).toBe('2026-09-25T10:00:03Z GET /health 200 2ms (×3 similar)\n2026-09-25T10:00:04Z ERROR db timeout')
    const long = Array.from({ length: 300 }, (_, i) => `line ${String.fromCharCode(97 + (i % 26))}${i % 2 === 0 ? 'x' : 'y'}`).join('\n')
    const r = logs({ text: long })
    expect(r.elided).toBe(true)
    expect(r.text.split('\n')[0]).toBe('… 100 earlier lines left out')
  })

  test('JSON from aws, kubectl -o json and curl is printed again without indentation', () => {
    const pretty = '{\n    "Account": "123",\n    "Arn": "arn:aws:iam::123:user/x"\n}\n'
    expect(run('aws', pretty, ['sts', 'get-caller-identity']).text).toBe('{"Account":"123","Arn":"arn:aws:iam::123:user/x"}')
    expect(run('kubectl get', '{\n  "items": []\n}\n', ['pods', '-o', 'json']).text).toBe('{"items":[]}')
    expect(run('kubectl get', 'NAME   READY\nweb    1/1\n', ['pods', '-o', 'wide']).text).toBe('NAME   READY\nweb    1/1')
    expect(run('curl', '  % Total    % Received % Xferd  Average Speed   Time\n                                 Dload  Upload   Total\n100    20  100    20    0     0    100      0 --:--:--\n{\n  "ok": true\n}\n', ['-s', 'https://x']).text).toBe('{"ok":true}')
    expect(run('curl', '<html>hi</html>\n').text).toBe('<html>hi</html>')
  })

  test('aws s3 ls rows are capped through the plan, where s3 is the subcommand and ls its first argument', () => {
    const plan = planFor('aws s3 ls s3://bucket/')
    if (plan === undefined) throw new Error('no plan for aws s3 ls')
    const rows = Array.from({ length: 300 }, (_, i) => `2026-09-25 10:00:00       1024 file-${i}.txt`).join('\n')
    const r = runFilter(plan, rows, 0, false)
    expect(r.elided).toBe(true)
    expect(r.text.split('\n').length).toBeLessThan(300)
    expect(r.text).toContain('file-0.txt')
  })

  test('terraform plan drops the refresh lines', () => {
    expect(run('terraform plan', 'aws_s3_bucket.a: Refreshing state... [id=a]\naws_s3_bucket.b: Refreshing state... [id=b]\n\nNo changes. Your infrastructure matches the configuration.\n').text)
      .toBe('\nNo changes. Your infrastructure matches the configuration.')
  })
})
