/** Translation keys named by the calls in a piece of source code. */

/** Files whose calls are read; a locale file, a README or a config file is not. */
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|php|py|rb|erb|haml|slim)$/

/**
 * A translation call with a quoted first argument: `t`, `$t`, `i18n.t`, `__`, `trans`, `trans_choice`,
 * `@lang`, `_`, `gettext` and `ngettext`, also after `this.`, `vm.`, `i18n.`, `$i18n.`, `I18n.` or `i18n.global.`.
 * A call on any other object, a variable argument and a template literal do not match.
 */
const CALL = /(?:^|[^\w$.@])(?:(?:this|vm|I18n|i18n\.global|i18n|\$i18n)\.)?(?:\$t|t|__|trans_choice|trans|_|gettext|ngettext|@lang)\(\s*(['"])((?:\\.|(?!\1)[^\\\n])+)\1/gm

/** Undoes backslash escapes: `\n` and `\t` become the characters, any other escaped character itself. */
export function unescape(text: string): string {
  return text.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
}

export function isSource(path: string): boolean {
  return SOURCE.test(path)
}

/** The keys of the calls in `text`; a Rails lazy key (`.title`) is skipped, because its full name depends on the view. */
export function callKeys(text: string): Set<string> {
  const keys = new Set<string>()
  for (const m of text.matchAll(CALL)) {
    const key = unescape(m[2] ?? '')
    if (key.trim() !== '' && !key.startsWith('.')) keys.add(key)
  }
  return keys
}

/** The keys `after` calls that `before` does not. */
export function newKeys(before: string, after: string): string[] {
  const old = callKeys(before)
  return [...callKeys(after)].filter(k => !old.has(k))
}
