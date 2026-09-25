import { describe, expect, test, tier } from 'claude-code/testing'

import { callKeys, newKeys } from '../hooks/keys.ts'
import { addFile, denyText, doneLines, fileLang, isGuarded, jsonKeys, missingKeys, modeOf, noteText, phpKeys, poKeys, sidebarLines, yamlKeys, type Catalog } from '../hooks/locale.ts'

tier('user')

describe('keys', () => {
  test('reads every call form and skips variables, template literals and lazy keys', () => {
    const src = [
      "t('a.one'); this.$t(\"a.two\"); i18n.t('a.three'); i18n.global.t('a.four'); I18n.t('a.five')",
      "__('messages.hi'); trans('x.y'); trans_choice('x.items', 3); @lang('x.z')",
      "_('Hello world'); gettext('Bye'); ngettext('One file', 'Files', n)",
      "t(name); t(`a.${b}`); t('.lazy'); obj.t('not.this'); format('no'); it's('no')",
      "t('it\\'s')",
    ].join('\n')
    expect([...callKeys(src)].sort()).toEqual([
      'Bye', 'Hello world', 'One file', 'a.five', 'a.four', 'a.one', 'a.three', 'a.two', "it's", 'messages.hi', 'x.items', 'x.y', 'x.z',
    ])
  })

  test('only keys the old text did not call are new', () => {
    expect(newKeys("t('a'); t('b')", "t('a'); t('b'); t('c')")).toEqual(['c'])
  })
})

describe('locale files', () => {
  test('names the language and namespace from the path', () => {
    expect(fileLang('tr.json')).toEqual({ lang: 'tr' })
    expect(fileLang('en-US/common.json')).toEqual({ lang: 'en-US', ns: 'common' })
    expect(fileLang('tr/LC_MESSAGES/django.po')).toEqual({ lang: 'tr', ns: 'django' })
    expect(fileLang('messages.tr.yaml')).toEqual({ lang: 'tr', ns: 'messages' })
    expect(fileLang('config.json')).toBe(undefined)
  })

  test('reads nested JSON with i18next plurals', () => {
    expect(jsonKeys('{"a":{"b":"x","item_one":"1"},"c":["y"]}')).toEqual(['a', 'a.b', 'a.item_one', 'a.item', 'c'])
    expect(() => jsonKeys('{')).toThrow()
  })

  test('reads a Laravel PHP array with nested arrays', () => {
    const php = "<?php\n\nreturn [\n    'title' => 'Hi',\n    'nav' => [\n        'home' => 'Home',\n    ],\n    \"inline\" => ['x' => 'y'],\n    'foot' => 'F',\n];\n"
    expect(phpKeys(php)).toEqual(['title', 'nav', 'nav.home', 'inline', 'foot'])
  })

  test('reads YAML by indent and drops a Rails top key', () => {
    const yml = 'tr:\n  checkout:\n    total: Toplam\n    "vat": KDV\n  # note: x\n  list:\n    - a: b\n'
    expect(yamlKeys(yml, 'tr')).toContain('checkout.total')
    expect(yamlKeys(yml, 'tr')).toContain('checkout.vat')
    expect(yamlKeys(yml, 'tr')).not.toContain('note')
  })

  test('reads gettext msgids with continuation lines', () => {
    const po = 'msgid ""\nmsgstr ""\n"Language: tr\\n"\n\nmsgid "Hello"\nmsgstr "Merhaba"\n\nmsgid ""\n"Long "\n"one"\nmsgstr "Uzun"\n'
    expect(poKeys(po)).toEqual(['Hello', 'Long one'])
  })

  test('names the languages that lack each key', () => {
    const catalog: Catalog = new Map()
    addFile(catalog, 'en/checkout.json', '{"total":"Total","vat":"VAT"}')
    addFile(catalog, 'tr/checkout.json', '{"total":"Toplam"}')
    addFile(catalog, 'de.json', '{}')
    const missing = missingKeys(catalog, ['checkout.total', 'checkout:vat', 'total', 'nope'])
    expect(missing).toEqual([
      { key: 'checkout.total', langs: ['de'] },
      { key: 'checkout:vat', langs: ['de', 'tr'] },
      { key: 'total', langs: ['de'] },
      { key: 'nope', langs: 'all' },
    ])
    expect(missingKeys(new Map(), ['x'])).toEqual([])
    // The line of each key is named where it was measured, and left out where it was not.
    expect(noteText(missing.slice(1, 2).concat(missing.slice(3)), { 'checkout:vat': 42 })).toBe(
      'i18n-watch: this edit uses translation keys the locale files lack: checkout:vat:42 (missing in de, tr) · nope (missing in every locale). Add them to each locale file.',
    )
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, langs: 'all' as const }))
    expect(noteText(many, {})).toContain('k9 (missing in every locale) · 2 more.')
  })

  test('the sidebar colours the key red, its line faint, and the locales by how many lack it', () => {
    const missing = [{ key: 'checkout:vat', langs: ['de', 'tr'] }, { key: 'nope', langs: 'all' as const }]
    expect(sidebarLines('src/Cart.vue', missing, { 'checkout:vat': 42 })).toEqual([
      { text: 'src/Cart.vue', kind: 'error' },
      {
        text: 'checkout:vat:42 (missing in de, tr)',
        parts: [{ text: 'checkout:vat', kind: 'error' }, { text: ':42', kind: 'dim' }, { text: ' (missing in ', kind: 'dim' }, { text: 'de, tr', kind: 'warn' }, { text: ')', kind: 'dim' }],
      },
      {
        text: 'nope (missing in every locale)',
        parts: [{ text: 'nope', kind: 'error' }, { text: ' (missing in ', kind: 'dim' }, { text: 'every locale', kind: 'error' }, { text: ')', kind: 'dim' }],
      },
    ])
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, langs: 'all' as const }))
    expect(sidebarLines('a.vue', many, {}).at(-1)).toEqual({ text: '2 more', kind: 'dim' })
    expect(doneLines('a.vue', ['x'], ['y'])).toEqual([
      { text: 'a.vue', kind: 'ok' },
      { text: 'x', kind: 'ok' },
      { text: 'y (no longer used)', parts: [{ text: 'y', kind: 'ok' }, { text: ' (no longer used)', kind: 'dim' }] },
    ])
  })

  test('the gate stops a commit, a push and a merge, and says why', () => {
    for (const command of ['git commit -m x', 'git push origin main', 'git merge main']) expect(isGuarded(command), command).toBe(true)
    for (const command of ['git status', 'git push --dry-run', 'git log']) expect(isGuarded(command), command).toBe(false)
    expect(modeOf('deny')).toBe('deny')
    expect(modeOf('x')).toBe(undefined)
    expect(denyText([{ file: 'src/Cart.vue', keys: ['checkout.fee'], lines: { 'checkout.fee': 7 } }])).toBe(
      'stopped: 1 file(s) use translation keys the locale files lack: src/Cart.vue (checkout.fee:7). Add the keys to every locale file, then run the command again; there is no way around this gate.',
    )
  })
})
