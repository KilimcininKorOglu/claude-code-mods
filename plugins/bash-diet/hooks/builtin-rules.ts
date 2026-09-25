/**
 * The mod's own data rules: commands whose output shrinks by dropping lines of a known shape, with no
 * parsing. A command with a filter in `filters/` never reaches these; the person's rules come first.
 */

import { ruleOf, type Rule, type RuleSpec } from './dsl.ts'

/** A clang or gcc source excerpt under a diagnostic: `   12 | code` and the `  |   ^` marker line. */
const EXCERPT = ['^\\s*\\d+ \\| ', '^\\s+\\| ']

export const BUILTIN_SPECS: Record<string, RuleSpec> = {
  cc: {
    description: 'C and C++ compilers: the source excerpts under each diagnostic go',
    match_command: '^(gcc|g\\+\\+|cc|c\\+\\+|clang|clang\\+\\+)(-\\d+)?( |$)',
    strip_ansi: true,
    strip_lines_matching: EXCERPT,
  },
  make: {
    description: 'make: directory changes, nothing-to-do lines and compiler source excerpts go',
    match_command: '^(make|gmake)( |$)',
    strip_ansi: true,
    strip_lines_matching: ['^make(\\[\\d+\\])?: (Entering|Leaving) directory', '^make(\\[\\d+\\])?: Nothing to be done for', ...EXCERPT],
  },
  'cmake-build': {
    description: 'cmake --build: progress, compile and link steps go; errors stay',
    match_command: '^cmake --build( |$)',
    strip_ansi: true,
    strip_lines_matching: ['^\\[\\s*\\d+%\\] (Building|Linking|Built target|Generating|Scanning)', '^(gmake|make)(\\[\\d+\\])?: (Entering|Leaving) directory', ...EXCERPT],
    on_empty: 'cmake --build: done',
  },
  cmake: {
    description: 'cmake configure: the compiler detection steps go',
    match_command: '^cmake( |$)',
    strip_ansi: true,
    strip_lines_matching: ['^-- (The \\w+ compiler identification|Detecting |Check for working |Looking for |Performing Test |Found \\w+: )'],
  },
  brew: {
    description: 'Homebrew: auto-update notes, new-formula lists, download and progress lines go',
    match_command: '^brew (install|upgrade|reinstall|update|tap|bundle)( |$)',
    strip_ansi: true,
    strip_lines_matching: [
      '^==> (Auto-updat|Downloading|Fetching|Pouring|Verifying|New Formulae|New Casks|Outdated Formulae|Outdated Casks|Updated Homebrew)',
      '^(Adjust how often this is run|`\\$HOMEBREW_NO_AUTO_UPDATE|Updated \\d+ taps?|Already downloaded:|You have \\d+ outdated)',
      '^✔︎? (Bottle|Formula|Cask|JSON API)',
      '^#+ *[\\d.]+%$',
      '^(?!Error|Warning)[\\w@.+-]+: .+',
      '^[\\w@.+-]+$',
      '^\\s*$',
    ],
    on_empty: 'brew: done',
  },
  rsync: {
    description: 'rsync: the file list goes, the transfer summary stays',
    match_command: '^rsync( |$)',
    strip_lines_matching: ['^sending incremental file list$', '^receiving incremental file list$', '^(?!sent |total size |rsync|.*: |.*error).*[^:]$', '^\\s*$'],
  },
  df: {
    description: 'df: virtual and system volumes go, column padding shrinks',
    match_command: '^df( |$)',
    replace: [{ pattern: ' {2,}', replacement: '  ' }],
    strip_lines_matching: ['^(devfs|map |devices |tmpfs|devtmpfs|udev|overlay|shm|none|/dev/loop)', ' /System/Volumes/(VM|Preboot|Update|xarts|iSCPreboot|Hardware)$', ' /Volumes/Recovery$', ' /(dev|run|sys/fs/cgroup|snap/\\S+)$'],
  },
  du: {
    description: 'du: the rows inside generated and vendored directories go, long listings are cut',
    match_command: '^du( |$)',
    strip_lines_matching: ['/(node_modules|\\.git|target|\\.venv|venv|__pycache__|\\.next|\\.nuxt|\\.gradle|DerivedData|Pods|\\.cache)/'],
    head_lines: 40,
    tail_lines: 10,
  },
  ping: {
    description: 'ping: each reply line goes, the header and the statistics stay',
    match_command: '^ping6?( |$)',
    strip_lines_matching: ['^\\d+ bytes from ', '^\\s*$'],
  },
  shellcheck: {
    description: 'shellcheck: the wiki link list and blank lines go',
    match_command: '^shellcheck( |$)',
    strip_ansi: true,
    strip_lines_matching: ['^For more information:$', '^\\s+https://www\\.shellcheck\\.net/wiki/', '^\\s*$'],
  },
}

/** Compiles the specs; a spec that does not compile is a fault of this file, so it throws. */
function compiledAll(specs: Record<string, RuleSpec>): Rule[] {
  return Object.entries(specs).map(([name, spec]) => {
    const r = ruleOf(name, 'builtin', spec)
    if (r.rule === undefined) throw new Error(`built-in rule ${r.errors.join('; ')}`)
    return r.rule
  })
}

export const BUILTIN_RULES: readonly Rule[] = compiledAll(BUILTIN_SPECS)
