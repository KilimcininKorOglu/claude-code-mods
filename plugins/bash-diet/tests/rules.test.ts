import { describe, expect, test, tier } from 'claude-code/testing'

import { BUILTIN_RULES, BUILTIN_SPECS } from '../hooks/builtin-rules.ts'
import { applyRule, ruleFor, ruleOf, rulesOf, type Rule, type RuleSpec } from '../hooks/dsl.ts'
import { planFor, runFilter } from '../hooks/pipeline.ts'

tier('user')

/** A compiled rule from a spec; a spec that does not compile fails the test. */
function rule(spec: RuleSpec): Rule {
  const r = ruleOf('t', 'global', spec)
  if (r.rule === undefined) throw new Error(r.errors.join('; '))
  return r.rule
}

/** What the mod shows for a command's output, and the share it saved. */
function shown(command: string, raw: string): { text: string; family: string; saved: number } {
  const plan = planFor(command)
  if (plan === undefined) throw new Error(`no plan for ${command}`)
  const text = runFilter(plan, raw, 0, false).text
  return { text, family: plan.family, saved: Math.round((1 - text.length / raw.length) * 100) }
}

describe('rule language', () => {
  test('the steps run in their order: replace, match_output, lines, cut, on_empty', () => {
    const r = rule({ match_command: '^x', replace: [{ pattern: '\\d+ms', replacement: 'Nms' }], strip_lines_matching: ['^debug'], truncate_lines_at: 12, max_lines: 2 })
    expect(applyRule(r, 'debug a\nstep 12ms\nstep 7ms done here and more\nlast\n')).toEqual({ text: 'step Nms\nstep Nms do…\n… +1 more lines', elided: true })
    expect(applyRule(rule({ match_command: '^x', keep_lines_matching: ['^ok'], on_empty: 'x: nothing' }), 'no\nnope\n')).toEqual({ text: 'x: nothing', elided: false })
  })

  test('match_output answers with its message unless the unless pattern also matches', () => {
    const r = rule({ match_command: '^x', match_output: [{ pattern: 'up to date', message: 'x: up to date', unless: '(?i)error' }] })
    expect(applyRule(r, 'checking\nall up to date\n').text).toBe('x: up to date')
    expect(applyRule(r, 'ERROR: disk\nall up to date\n').text).toBe('ERROR: disk\nall up to date')
  })

  test('head and tail keep both ends with a count between, and say when nothing was cut', () => {
    const r = rule({ match_command: '^x', head_lines: 2, tail_lines: 1 })
    const ten = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
    expect(applyRule(r, ten)).toEqual({ text: 'l0\nl1\n… 7 lines left out\nl9', elided: true })
    expect(applyRule(r, 'a\nb\nc')).toEqual({ text: 'a\nb\nc', elided: false })
  })

  test('a rule matches the command words after variables and wrappers, a leading (?i) ignores case', () => {
    const rules = [rule({ match_command: '(?i)^MAKE( |$)' })]
    expect(ruleFor(rules, ['make', 'all'])?.name).toBe('t')
    expect(ruleFor(rules, ['maker'])).toBe(undefined)
    expect(planFor('FOO=1 timeout 60 rsync -a a b')?.family).toBe('builtin rule rsync')
  })

  test('a file with mistakes keeps its good rules and names every mistake', () => {
    const text = JSON.stringify({ filters: {
      good: { match_command: '^a' },
      both: { match_command: '^b', strip_lines_matching: ['x'], keep_lines_matching: ['y'] },
      regex: { match_command: '^(c' },
      shape: { match_command: '^d', replace: [{ pattern: 'x' }] },
      missing: { max_lines: 3 },
    } })
    const r = rulesOf(text, 'project')
    expect(r.rules.map(x => x.name)).toEqual(['good'])
    expect(r.errors[0]).toBe('both: strip_lines_matching and keep_lines_matching exclude each other')
    expect(r.errors[1]).toMatch(/^regex: Invalid regular expression/)
    expect(r.errors.slice(2)).toEqual(['shape: replace expects a list of { pattern, replacement }', 'missing: match_command is missing'])
    expect(rulesOf('{ nope', 'global').errors[0]).toMatch(/^not valid JSON: /)
    expect(rulesOf('[]', 'global').errors).toEqual(['expects { "filters": { "<name>": { ... } } }'])
  })

  test('every built-in rule compiles and a command with its own filter never reaches one', () => {
    expect(BUILTIN_RULES.map(r => r.name)).toEqual(Object.keys(BUILTIN_SPECS))
    expect(planFor('cmake --build build')?.family).toBe('builtin rule cmake-build')
    expect(planFor('git status')?.family).toBe('git status')
  })
})

// Captured on macOS 27 with the tools on this machine; home and project paths are shortened.
describe('built-in rules', () => {
  test('df drops the system volumes and the column padding', () => {
    const r = shown('df -h', "Filesystem                                                                                        Size    Used   Avail Capacity iused ifree %iused  Mounted on\n/dev/disk3s1s1                                                                                   1.8Ti    13Gi   613Gi     3%    484k  4.3G    0%   /\ndevfs                                                                                            202Ki   202Ki     0Bi   100%     698     0  100%   /dev\n/dev/disk3s6                                                                                     1.8Ti    24Ki   613Gi     1%       0  6.4G    0%   /System/Volumes/VM\n/dev/disk3s2                                                                                     1.8Ti    10Gi   613Gi     2%    1.0k  6.4G    0%   /System/Volumes/Preboot\n/dev/disk3s4                                                                                     1.8Ti    80Mi   613Gi     1%     109  6.4G    0%   /System/Volumes/Update\n/dev/disk1s2                                                                                     500Mi   6.0Mi   480Mi     2%       1  4.9M    0%   /System/Volumes/xarts\n/dev/disk1s1                                                                                     500Mi   5.8Mi   480Mi     2%      30  4.9M    0%   /System/Volumes/iSCPreboot\n/dev/disk1s3                                                                                     500Mi   3.7Mi   480Mi     1%      59  4.9M    0%   /System/Volumes/Hardware\n/dev/disk3s5                                                                                     1.8Ti   1.2Ti   613Gi    67%     10M  6.4G    0%   /System/Volumes/Data\nmap auto_home                                                                                      0Bi     0Bi     0Bi   100%       0     0     -   /System/Volumes/Data/home\nOrbStack:/OrbStack                                                                               700Gi   124Gi   576Gi    18%       0     0     -   /Users/u/OrbStack\n/dev/disk3s3                                                                                     1.8Ti   1.4Gi   613Gi     1%      67  6.4G    0%   /Volumes/Recovery\ndevices -- file:///Users/u/Library/Containers/com.apple.CoreDevice.CoreDeviceService/Data/   1.0Ti     0Bi   1.0Ti     0%       0  9.2E    0%   /Users/u/Library/Developer/CoreDevice/DeviceFS\n")
    expect(r.text).toBe('Filesystem  Size  Used  Avail Capacity iused ifree %iused  Mounted on\n/dev/disk3s1s1  1.8Ti  13Gi  613Gi  3%  484k  4.3G  0%  /\n/dev/disk3s5  1.8Ti  1.2Ti  613Gi  67%  10M  6.4G  0%  /System/Volumes/Data\nOrbStack:/OrbStack  700Gi  124Gi  576Gi  18%  0  0  -  /Users/u/OrbStack')
    expect(r.saved).toBeGreaterThanOrEqual(60)
  })

  test('brew keeps what it installed and drops the update notes and progress', () => {
    const r = shown('brew install jq', "==> Auto-updating Homebrew...\nAdjust how often this is run with `$HOMEBREW_AUTO_UPDATE_SECS` or disable with\n`$HOMEBREW_NO_AUTO_UPDATE=1`. Hide these hints with `$HOMEBREW_NO_ENV_HINTS=1` (see `man brew`).\n==> Auto-updated Homebrew!\n==> Updated Homebrew from 27af95f6a3 to ddc6726c17.\nUpdated 5 taps (shivammathur/php, jarvis322/tap, kilimcininkoroglu/tap, homebrew/core and homebrew/cask).\n==> New Formulae\nkubectl-radar: Missing open-source Kubernetes UI with a built-in MCP server for AI agents\nplink1: Whole-genome association analysis toolset\n==> New Casks\nactivitywatch@experimental: Time tracker\namp-app: Coding agent and development environment\nfont-pennstander\nmindroom: Self-hostable AI stack for multi-user, multi-agent workflows on Matrix\nrobbietilton-compositor: Photoshop alternative\n\nYou have 97 outdated formulae and 8 outdated casks installed.\n\n==> Downloading bottle manifests\n\u2714\ufe0e Bottle Manifest jq (1.8.2)\n==> Would install 1 formula:\njq 1.8.2\n==> Fetching downloads for: jq\n\u2714\ufe0e Bottle jq (1.8.2)\n==> Pouring jq--1.8.2.arm64_golden_gate.bottle.1.tar.gz\n\ud83c\udf7a  /opt/homebrew/Cellar/jq/1.8.2: 20 files, 1.2MB\n")
    expect(r.text).toBe('==> Would install 1 formula:\njq 1.8.2\n🍺  /opt/homebrew/Cellar/jq/1.8.2: 20 files, 1.2MB')
    expect(shown('brew install nope', 'Error: No available formula with the name "nope".\n').text).toBe('Error: No available formula with the name "nope".')
  })

  test('make and the compilers drop the source excerpts and keep the diagnostic', () => {
    expect(shown('make', "building a\ngcc -c bad.c\nbad.c:1:32: error: use of undeclared identifier 'y'\n    1 | int main(void) { int x; return y; }\n      |                                ^\n1 error generated.\nmake: *** [a] Error 1\n").text).toBe("building a\ngcc -c bad.c\nbad.c:1:32: error: use of undeclared identifier 'y'\n1 error generated.\nmake: *** [a] Error 1")
    expect(shown('cmake --build build', "[ 25%] Building C object CMakeFiles/t.dir/main.c.o\n[ 50%] Linking C executable t\n[ 50%] Built target t\n[ 75%] Building C object CMakeFiles/l.dir/a.c.o\n[100%] Linking C static library libl.a\n[100%] Built target l\n").text).toBe('cmake --build: done')
  })

  test('shellcheck drops the wiki links and blank lines', () => {
    const r = shown('shellcheck s.sh', "\nIn s.sh line 3:\necho $foo\n     ^--^ SC2086 (info): Double quote to prevent globbing and word splitting.\n\nDid you mean:\necho \"$foo\"\n\n\nIn s.sh line 4:\nif [ $foo == 1 ]; then ls *.txt | grep x; fi\n     ^--^ SC2086 (info): Double quote to prevent globbing and word splitting.\n          ^-- SC3014 (warning): In POSIX sh, == in place of = is undefined.\n                       ^-- SC2010 (warning): Don't use ls | grep. Use a glob or a for loop with a condition to allow non-alphanumeric filenames.\n                          ^-- SC2035 (info): Use ./*glob* or -- *glob* so names with dashes won't become options.\n\nDid you mean:\nif [ \"$foo\" == 1 ]; then ls *.txt | grep x; fi\n\nFor more information:\n  https://www.shellcheck.net/wiki/SC2010 -- Don't use ls | grep. Use a glob o...\n  https://www.shellcheck.net/wiki/SC3014 -- In POSIX sh, == in place of = is ...\n  https://www.shellcheck.net/wiki/SC2035 -- Use ./*glob* or -- *glob* so name...\n")
    expect(r.text).not.toContain('For more information')
    expect(r.text).toContain('^-- SC2010 (warning): Don\'t use ls | grep.')
    expect(r.text.split('\n')[0]).toBe('In s.sh line 3:')
  })

  test('ping keeps its header and statistics, rsync its summary and any error', () => {
    expect(shown('ping -c 3 127.0.0.1', "PING 127.0.0.1 (127.0.0.1): 56 data bytes\n64 bytes from 127.0.0.1: icmp_seq=0 ttl=65 time=0.077 ms\n64 bytes from 127.0.0.1: icmp_seq=1 ttl=65 time=0.105 ms\n64 bytes from 127.0.0.1: icmp_seq=2 ttl=65 time=0.144 ms\n\n--- 127.0.0.1 ping statistics ---\n3 packets transmitted, 3 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = 0.077/0.109/0.144/0.027 ms\n").text).toBe('PING 127.0.0.1 (127.0.0.1): 56 data bytes\n--- 127.0.0.1 ping statistics ---\n3 packets transmitted, 3 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = 0.077/0.109/0.144/0.027 ms')
    const list = ['sending incremental file list', ...Array.from({ length: 40 }, (_, i) => `f${i}.txt`), '', 'sent 2,556 bytes  received 776 bytes  6,664.00 bytes/sec', 'total size is 111  speedup is 0.03'].join('\n')
    expect(shown('rsync -av src/ dst/', list).text).toBe('sent 2,556 bytes  received 776 bytes  6,664.00 bytes/sec\ntotal size is 111  speedup is 0.03')
    expect(shown('rsync -av a/ b/', 'rsync: [sender] change_dir "/nope" failed: No such file or directory (2)\nNumber of files: 0\n').text).toBe('rsync: [sender] change_dir "/nope" failed: No such file or directory (2)\nNumber of files: 0')
  })
})
