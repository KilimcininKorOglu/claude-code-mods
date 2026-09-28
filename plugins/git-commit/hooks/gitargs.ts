/**
 * Reads the arguments of the git subcommands the mod rules on, the way git's
 * own option parser reads them: short clusters (`-am`), attached values
 * (`-mtext`, `--message=text`), a value in the next word, and `--`.
 */

/** The options a call named, by their long name, the values of the valued ones, and the operands. */
export type Parsed = { flags: Set<string>; values: Map<string, string[]>; operands: string[] }

/**
 * One subcommand's options: short letters and long names mapped to one name, the ones that take the next
 * word as their value, and the short ones whose value can only be attached (`-S<key>`).
 */
type Spec = {
  short: Partial<Record<string, string>>
  shortValue: Partial<Record<string, string>>
  shortAttached: Partial<Record<string, string>>
  long: Partial<Record<string, string>>
  longValue: Partial<Record<string, string>>
}

/** A spec with the tables it does not name left empty. */
function spec(given: Partial<Spec>): Spec {
  return { short: {}, shortValue: {}, shortAttached: {}, long: {}, longValue: {}, ...given }
}

function put(p: Parsed, name: string, value: string): void {
  p.flags.add(name)
  p.values.set(name, [...(p.values.get(name) ?? []), value])
}

/** One letter of a short cluster; returns the words the cluster used when this letter ends it, else 0. */
function shortLetter(p: Parsed, s: Spec, word: string, i: number, next: string | undefined): number {
  const c = word[i] ?? ''
  const rest = word.slice(i + 1)
  const attached = s.shortAttached[c]
  if (attached !== undefined) {
    put(p, attached, rest)
    return 1
  }
  const valued = s.shortValue[c]
  if (valued === undefined) {
    p.flags.add(s.short[c] ?? c)
    return 0
  }
  put(p, valued, rest === '' ? (next ?? '') : rest)
  return rest === '' && next !== undefined ? 2 : 1
}

/** One short cluster (`-am`, `-mtext`); returns how many words it used. */
function parseShort(p: Parsed, s: Spec, word: string, next: string | undefined): number {
  for (let i = 1; i < word.length; i++) {
    const used = shortLetter(p, s, word, i, next)
    if (used > 0) return used
  }
  return 1
}

/** The known long name `key` abbreviates, as git accepts a unique prefix; `key` itself when none or several fit. */
function fullName(s: Spec, key: string): string {
  const names = [...Object.keys(s.long), ...Object.keys(s.longValue)]
  if (names.includes(key) || key.length < 3) return key
  const fits = names.filter(name => name.startsWith(key))
  return fits.length === 1 ? (fits[0] ?? key) : key
}

/** One long option (`--all`, `--message=text`, `--message text`); returns how many words it used. */
function parseLong(p: Parsed, s: Spec, word: string, next: string | undefined): number {
  const eq = word.indexOf('=')
  const key = fullName(s, eq < 0 ? word.slice(2) : word.slice(2, eq))
  const valued = s.longValue[key]
  if (valued !== undefined && eq < 0) {
    put(p, valued, next ?? '')
    return next === undefined ? 1 : 2
  }
  const name = valued ?? s.long[key] ?? key
  if (eq < 0) p.flags.add(name)
  else put(p, name, word.slice(eq + 1))
  return 1
}

/** Reads a subcommand's arguments; `--` ends the options and is itself kept as a flag. */
function parseArgs(args: readonly string[], spec: Spec): Parsed {
  const p: Parsed = { flags: new Set(), values: new Map(), operands: [] }
  for (let i = 0; i < args.length; ) {
    const word = args[i] ?? ''
    if (word === '--') {
      p.flags.add('--')
      p.operands.push(...args.slice(i + 1))
      break
    }
    if (word.startsWith('--')) i += parseLong(p, spec, word, args[i + 1])
    else if (word.startsWith('-') && word !== '-') i += parseShort(p, spec, word, args[i + 1])
    else {
      p.operands.push(word)
      i++
    }
  }
  return p
}

/** Names that map to themselves. */
function same(...names: string[]): Record<string, string> {
  return Object.fromEntries(names.map(name => [name, name]))
}

const ADD = spec({
  short: { A: 'all', u: 'update', f: 'force', i: 'interactive', p: 'patch', e: 'edit', n: 'dry-run', N: 'intent-to-add', v: 'verbose' },
  long: { ...same('all', 'update', 'force', 'interactive', 'patch', 'edit', 'dry-run', 'intent-to-add', 'verbose', 'help'), 'no-ignore-removal': 'all' },
  longValue: same('pathspec-from-file', 'chmod'),
})

const COMMIT = spec({
  short: { a: 'all', n: 'no-verify', p: 'patch', i: 'include', o: 'only', e: 'edit', v: 'verbose', q: 'quiet', s: 'signoff', z: 'null', h: 'help' },
  shortValue: { m: 'message', F: 'file', C: 'reuse', c: 'reuse', t: 'template' },
  shortAttached: { S: 'gpg-sign', u: 'untracked-files' },
  long: {
    ...same('all', 'no-verify', 'patch', 'interactive', 'amend', 'allow-empty', 'allow-empty-message', 'dry-run', 'help', 'only', 'include', 'no-edit', 'edit', 'signoff', 'verbose', 'quiet'),
    short: 'dry-run',
    porcelain: 'dry-run',
    long: 'dry-run',
  },
  longValue: { ...same('message', 'file', 'fixup', 'squash', 'author', 'date', 'template', 'cleanup', 'trailer', 'pathspec-from-file'), 'reuse-message': 'reuse', 'reedit-message': 'reuse' },
})

/** What a `git add` names: its options and its paths. */
export function addArgs(args: readonly string[]): Parsed {
  return parseArgs(args, ADD)
}

/** What a `git commit` names: its options, the values of `-m`, `-F`, `--trailer` and the rest, and its pathspec. */
export function commitArgs(args: readonly string[]): Parsed {
  return parseArgs(args, COMMIT)
}

/** Whether a `git commit` records nothing: a dry run, a status listing or the help. */
export function isDryCommit(p: Parsed): boolean {
  return p.flags.has('dry-run') || p.flags.has('help')
}

const PUSH = spec({
  short: { n: 'dry-run', f: 'force', u: 'set-upstream', q: 'quiet', v: 'verbose', d: 'delete', h: 'help' },
  long: same('no-verify', 'dry-run', 'force', 'set-upstream', 'delete', 'help', 'tags', 'all', 'mirror'),
  longValue: same('repo', 'receive-pack', 'exec', 'push-option', 'recurse-submodules'),
})

/** What a `git push` names. */
export function pushArgs(args: readonly string[]): Parsed {
  return parseArgs(args, PUSH)
}

const REBASE = spec({
  short: { i: 'interactive', h: 'help' },
  shortValue: { x: 'exec', s: 'strategy', X: 'strategy-option' },
  long: same('interactive', 'help'),
  longValue: same('onto', 'exec', 'strategy', 'strategy-option'),
})

/** Whether a `git rebase` opens the interactive editor. */
export function isInteractiveRebase(args: readonly string[]): boolean {
  return parseArgs(args, REBASE).flags.has('interactive')
}

const CONFIG = spec({
  short: { l: 'list', e: 'edit', z: 'null' },
  shortValue: { f: 'file' },
  long: same('list', 'edit', 'get', 'get-all', 'get-regexp', 'get-urlmatch', 'get-color', 'get-colorbool', 'add', 'unset', 'unset-all', 'replace-all', 'rename-section', 'remove-section', 'global', 'system', 'local', 'worktree', 'show-origin', 'show-scope', 'name-only'),
  longValue: same('file', 'blob', 'type', 'default', 'comment', 'value'),
})

const CONFIG_WRITE_SUBS = new Set(['set', 'unset', 'rename-section', 'remove-section', 'edit'])
const CONFIG_READ_SUBS = new Set(['get', 'list'])
const CONFIG_WRITE_FLAGS = ['add', 'unset', 'unset-all', 'replace-all', 'rename-section', 'remove-section', 'edit']
const CONFIG_READ_FLAGS = ['get', 'get-all', 'get-regexp', 'get-urlmatch', 'get-color', 'get-colorbool', 'list']

/** Whether a `git config` changes a setting: a write subcommand or option, or a key with a value. */
export function isConfigWrite(args: readonly string[]): boolean {
  const p = parseArgs(args, CONFIG)
  const first = p.operands[0] ?? ''
  if (CONFIG_WRITE_SUBS.has(first)) return true
  if (CONFIG_READ_SUBS.has(first)) return false
  if (CONFIG_WRITE_FLAGS.some(flag => p.flags.has(flag))) return true
  if (CONFIG_READ_FLAGS.some(flag => p.flags.has(flag))) return false
  return p.operands.length >= 2
}

const BRANCH = spec({
  short: { d: 'delete', D: 'delete', m: 'move', M: 'move', c: 'copy', C: 'copy', f: 'force', a: 'all', r: 'remotes', l: 'list', v: 'verbose', q: 'quiet', t: 'track' },
  shortValue: { u: 'set-upstream-to' },
  long: same('delete', 'move', 'copy', 'force', 'all', 'remotes', 'list', 'verbose', 'quiet', 'track', 'no-track', 'show-current', 'edit-description', 'unset-upstream'),
  longValue: same('set-upstream-to', 'contains', 'no-contains', 'merged', 'no-merged', 'points-at', 'sort', 'format'),
})

const BRANCH_CHANGE = ['delete', 'move', 'copy']
const BRANCH_READ = ['list', 'all', 'remotes', 'show-current', 'contains', 'no-contains', 'merged', 'no-merged', 'points-at', 'edit-description', 'set-upstream-to', 'unset-upstream']

/** Whether a `git branch` creates, renames, copies or deletes a branch, rather than listing or configuring one. */
export function isBranchChange(args: readonly string[]): boolean {
  const p = parseArgs(args, BRANCH)
  if (BRANCH_CHANGE.some(flag => p.flags.has(flag))) return true
  if (BRANCH_READ.some(flag => p.flags.has(flag))) return false
  return p.operands.length > 0
}

const CHECKOUT = spec({
  short: { f: 'force', q: 'quiet', m: 'merge', p: 'patch', l: 'reflog', t: 'track' },
  shortValue: { b: 'create', B: 'create' },
  long: same('detach', 'force', 'merge', 'patch', 'track', 'no-track', 'quiet', 'ours', 'theirs', 'guess', 'no-guess', 'overlay', 'no-overlay', 'progress'),
  longValue: same('orphan', 'conflict', 'pathspec-from-file'),
})

/**
 * What a `git checkout` does: `branch` when it creates or switches a branch, `paths` when it restores
 * files, `none` when it names nothing, and the single operand when only the file system can tell (a path
 * that exists is a restore, anything else a switch).
 */
export function checkoutKind(args: readonly string[]): 'branch' | 'paths' | 'none' | { operand: string } {
  const p = parseArgs(args, CHECKOUT)
  if (['create', 'orphan', 'detach'].some(flag => p.flags.has(flag))) return 'branch'
  if (p.flags.has('--') || p.flags.has('pathspec-from-file') || p.operands.length >= 2) return 'paths'
  const operand = p.operands[0]
  return operand === undefined ? 'none' : { operand }
}
