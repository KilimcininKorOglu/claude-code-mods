import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { isCommit, isNarrowable, verdict } from '../hooks/locale.ts'
import { keyLines } from '../hooks/keys.ts'

tier('user')

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the hooks of `seatSidebar` answer. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

type Bar = { open: boolean; sections: { key: string; title: string; lines: string[] }[]; cleared: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; title: string; lines: { text: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, title: s.title, lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
  on('sidebar.clear', (_, e) => {
    const c = e as unknown as { key: string }
    bar.cleared.push(c.key)
    bar.sections = bar.sections.filter(s => s.key !== c.key)
    return { value: undefined }
  })
}

const ROOT = '/Users/u/app'

const run = (args: string): CommandRunInput => ({
  command: 'i18n-watch', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** Files by absolute path; `staged` is the index git answers with, `logs` the logged lines. */
type World = { files: Map<string, string>; staged: string[]; reads: number; logs: string[] }

function isDirPath(w: World, path: string): boolean {
  return [...w.files.keys()].some(f => f.startsWith(`${path}/`))
}

function world(on: On, files: Record<string, string>): World {
  const w: World = { files: new Map(Object.entries(files).map(([p, t]) => [`${ROOT}/${p}`, t])), staged: [], reads: 0, logs: [] }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) || isDirPath(w, e.path) }))
  on('fs.stat', (_, e) => ({ value: { kind: isDirPath(w, e.path) ? 'dir' as const : 'file' as const, size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.list', (_, e) => {
    const dir = e.path ?? ROOT
    const names = new Set([...w.files.keys()].filter(f => f.startsWith(`${dir}/`)).map(f => f.slice(dir.length + 1).split('/')[0] ?? ''))
    return { value: [...names].sort().map(name => ({ name, kind: isDirPath(w, `${dir}/${name}`) ? 'dir' as const : 'file' as const, size: 10, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    w.reads++
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('process.run', (_, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const stdout = argv.includes('--show-toplevel') ? `${ROOT}\n` : w.staged.map(p => `${p}\0`).join('')
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
}

/**
 * An Edit as the engine applies it: the world's file becomes `text` (the whole file after the edit), and
 * the tool is called with the fragment the model wrote, so the mod reads the file it will measure.
 */
function edit(w: World, $: Engine, file: string, before: string, after: string, text = after): Promise<{ context?: string[]; deny?: string }> {
  w.files.set(`${ROOT}/${file}`, text)
  return $.tool.call({ tool: 'Edit', file_path: `${ROOT}/${file}`, old_string: before, new_string: after } as never) as never
}

const LOCALES = {
  'locales/en.json': '{"checkout":{"total":"Total","vat":"VAT"}}',
  'locales/tr.json': '{"checkout":{"total":"Toplam"}}',
  'locales/de.json': '{"checkout":{}}',
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)

describe('i18n-watch', () => {
  test('the pure measures: the line of a key, what a claim reads as, and which commit is narrowed', () => {
    expect(keyLines("t('a')\n\nt('b')")).toEqual({ a: 1, b: 3 })
    const catalog = new Map([['en', new Set(['a'])]])
    // The code dropped `b`, `a` is in every locale, so nothing is missing and the finding closes.
    expect(verdict(catalog, ['a', 'b'], new Set(['a']))).toEqual({ missing: [], gone: ['b'], added: ['a'] })
    // A file that could not be read drops no key.
    expect(verdict(catalog, ['b'], undefined).missing).toEqual([{ key: 'b', langs: 'all' }])
    expect(isCommit('git commit -m x')).toBe(true)
    expect(isCommit('git push')).toBe(false)
    expect(isNarrowable('git commit -m x')).toBe(true)
    for (const bad of ['git commit -am x', 'git commit -a', 'git commit --all', 'git commit -m x -- index.php']) expect(isNarrowable(bad), bad).toBe(false)
  })

  test('an edit that calls keys some locales lack gets the note, and the person sees one line', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    const r = await edit(w, $, 'src/Cart.vue', "{{ $t('checkout.title') }}", "{{ $t('checkout.title') }} {{ $t('checkout.total') }} {{ $t('checkout.vat') }} {{ $t('checkout.fee') }}")
    expect(r.context).toEqual([
      'i18n-watch: this edit uses translation keys the locale files lack: checkout.total:1 (missing in de) · checkout.vat:1 (missing in de, tr) · checkout.fee:1 (missing in every locale). Add them to each locale file.',
    ])
    expect(w.logs).toEqual([
      'keys src/Cart.vue uses that the locale files lack: checkout.total:1 (missing in de) · checkout.vat:1 (missing in de, tr) · checkout.fee:1 (missing in every locale)',
    ])
  })

  withSidebar('a key the next edit deletes closes the finding, and the commit runs', async ($, on) => {
    const w = world(on, LOCALES)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await started($)
    await edit(w, $, 'index.php', '', "__('Unauthorized Access')")
    await $.command.run(run('mode deny'))
    w.staged = ['index.php']
    expect((await bash($, 'git commit -m x')).deny).toContain('index.php (Unauthorized Access:1)')
    // The same turn takes the string out again: the text is gone and the call moved to another file.
    await edit(w, $, 'index.php', "__('Unauthorized Access')", 'modalUnauthorized()', 'modalUnauthorized()')
    expect(bar.cleared).toEqual(['index.php'])
    expect(bar.sections.at(-1)).toEqual({ key: 'index.php', title: 'translation keys gone', lines: ['index.php', 'Unauthorized Access (no longer used)'] })
    expect((await bash($, 'git commit -m x')).result).toBe('ok')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · no file is open')
  })

  test('a key the edit replaced leaves no claim behind', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    await edit(w, $, 'index.php', '', "__('You are not authorized to open this.')")
    await edit(w, $, 'index.php', "__('You are not authorized to open this.')", "__('You are not authorized to access this page.')")
    await $.command.run(run('mode deny'))
    w.staged = ['index.php']
    const denied = await bash($, 'git commit -m x')
    expect(denied.deny).toContain('index.php (You are not authorized to access this page.:1)')
    expect(denied.deny).not.toContain('to open this.')
  })

  test('a file the code deleted closes its finding', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    await edit(w, $, 'index.php', '', "__('Unauthorized Access')")
    w.files.delete(`${ROOT}/index.php`)
    await $.command.run(run('mode deny'))
    expect((await bash($, 'git commit -m x')).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('index.php no longer uses: Unauthorized Access')
  })

  test('a commit that holds none of the open files runs, and one that holds one stops', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    await edit(w, $, 'index.php', '', "__('Unauthorized Access')")
    await $.command.run(run('mode deny'))
    w.staged = ['includes/controllers/actions.php']
    expect((await bash($, 'git commit -m x')).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('1 file(s) still lack translation keys, and this command holds none of them')
    // The finding stands: a push holds no index, and a commit of that file stops.
    expect((await bash($, 'git push')).deny).toContain('index.php (Unauthorized Access:1)')
    w.staged = ['index.php']
    expect((await bash($, 'git commit -m x')).deny).toContain('index.php')
    // A commit that stages the tracked files as it runs is not narrowed.
    w.staged = []
    expect((await bash($, 'git commit -am x')).deny).toContain('index.php')
  })

  test("the turn's end owes the model a note, and the next prompt carries it once", async ($, on) => {
    const w = world(on, LOCALES)
    const contexts: (readonly string[] | undefined)[] = []
    on('prompt.submit', (_, e) => { contexts.push(e.context); return { text: e.text } })
    on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
    const ends = (turnId: string) => $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId, reason: 'answer' } as never)
    const asks = () => $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' }, wait: false } as never)
    await started($)
    await edit(w, $, 'index.php', '', "__('Unauthorized Access')")
    await ends('t1')
    await asks()
    expect(contexts.at(-1)).toEqual([
      'i18n-watch: 1 file(s) still use translation keys the locale files lack: index.php (Unauthorized Access:1). Add the keys to every locale file, or take the calls out.',
    ])
    // The note is owed once per turn, not at every prompt.
    await asks()
    expect(contexts.at(-1)).toBe(undefined)
    // A turn that closed the finding owes nothing.
    await edit(w, $, 'index.php', "__('Unauthorized Access')", 'modalUnauthorized()', 'modalUnauthorized()')
    await ends('t2')
    await asks()
    expect(contexts.at(-1)).toBe(undefined)
  })

  withSidebar('an open sidebar takes the keys and the transcript stays clean', async ($, on) => {
    const w = world(on, LOCALES)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await started($)
    await edit(w, $, 'src/Cart.vue', '', "{{ $t('checkout.fee') }}")
    expect(bar.sections).toEqual([{ key: 'src-Cart.vue', title: 'missing translation keys', lines: ['src/Cart.vue', 'checkout.fee:1 (missing in every locale)'] }])
    expect(w.logs).toEqual([])
  })

  withSidebar('a locale edit that adds every missing key clears the entry and writes a new one', async ($, on) => {
    const w = world(on, LOCALES)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await started($)
    await edit(w, $, 'src/Cart.vue', '', "{{ $t('checkout.fee') }}")
    for (const lang of ['en', 'tr', 'de']) w.files.set(`${ROOT}/locales/${lang}.json`, '{"checkout":{"fee":"Fee"}}')
    await edit(w, $, 'locales/de.json', '{}', '{"checkout":{"fee":"Fee"}}')
    expect(bar.cleared).toEqual(['src-Cart.vue'])
    expect(bar.sections.at(-1)).toEqual({
      key: 'src-Cart.vue',
      title: 'translation keys added',
      lines: ['src/Cart.vue', 'checkout.fee'],
    })
    expect(w.logs).toEqual([])
  })

  test('a finding stays open until the last missing key is added, then the person reads one line', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    await edit(w, $, 'src/Cart.vue', '', "{{ $t('checkout.fee') }} {{ $t('checkout.vat') }}")
    w.files.set(`${ROOT}/locales/de.json`, '{"checkout":{"vat":"MwSt"}}')
    await edit(w, $, 'locales/de.json', '{}', '{"checkout":{"vat":"MwSt"}}')
    expect(w.logs).toHaveLength(1)
    w.files.set(`${ROOT}/locales/de.json`, '{"checkout":{"vat":"MwSt","fee":"Gebühr"}}')
    w.files.set(`${ROOT}/locales/tr.json`, '{"checkout":{"total":"Toplam","vat":"KDV","fee":"Ücret"}}')
    const en = '{"checkout":{"total":"Total","vat":"VAT","fee":"Fee"}}'
    await edit(w, $, 'locales/en.json', '{}', '"fee":"Fee"', en)
    expect(w.logs[1]).toBe('every locale now has the keys src/Cart.vue lacked: checkout.fee · checkout.vat')
  })

  test('reads Laravel, YAML and gettext trees, and Write checks the whole file', async ($, on) => {
    const w = world(on, {
      'resources/lang/en/messages.php': "<?php\nreturn [\n    'hi' => 'Hi',\n];\n",
      'resources/lang/tr/messages.php': '<?php\nreturn [\n];\n',
      'config/locales/en.yml': 'en:\n  shop:\n    buy: Buy\n',
      'config/locales/tr.yml': 'tr:\n  shop:\n    buy: Al\n',
      'locale/tr/LC_MESSAGES/django.po': 'msgid "Hello"\nmsgstr "Merhaba"\n',
    })
    await started($)
    const content = "<?php echo __('messages.hi'); echo t('shop.buy'); echo _('Hello');"
    w.files.set(`${ROOT}/app/x.php`, content)
    const r = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/app/x.php`, content } as never)
    expect(r.context?.[0]).toBe(
      'i18n-watch: this edit uses translation keys the locale files lack: messages.hi:1 (missing in tr) · Hello:1 (missing in en). Add them to each locale file.',
    )
  })

  test('no note without new keys, without locale files, for a non-source file, or when off', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    expect((await edit(w, $, 'src/a.ts', "t('checkout.total')", "t('checkout.total') // x")).context).toBe(undefined)
    expect((await edit(w, $, 'README.md', '', "t('checkout.fee')")).context).toBe(undefined)
    expect(w.reads).toBe(0)
    expect((await $.command.run(run('off'))).text).toBe('off: edits are not checked')
    expect((await edit(w, $, 'src/a.ts', '', "t('checkout.fee')")).context).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('off · mode note · no file is open')
  })

  test('in deny mode a commit stops while a key is missing, and runs once every locale has it', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    await edit(w, $, 'src/Cart.vue', '', "{{ $t('checkout.fee') }}")
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while a file lacks translation keys')
    w.staged = ['src/Cart.vue']
    const denied = await bash($, 'git commit -m x')
    expect(denied.deny).toContain('stopped: 1 file(s) use translation keys the locale files lack: src/Cart.vue (checkout.fee:1)')
    expect(denied.result).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · 1 file(s) still lack keys')
    expect((await bash($, 'git status')).result).toBe('ok')
    // The keys are in every locale now: the gate reads them again and the push runs.
    for (const lang of ['en', 'tr', 'de']) w.files.set(`${ROOT}/locales/${lang}.json`, '{"checkout":{"fee":"Fee"}}')
    expect((await bash($, 'git push')).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('every locale now has the keys src/Cart.vue lacked: checkout.fee')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
  })

  test('a broken locale file is skipped and logged once', async ($, on) => {
    const w = world(on, { ...LOCALES, 'locales/fr.json': '{' })
    await started($)
    expect((await edit(w, $, 'src/a.ts', '', "t('checkout.total')")).context?.[0]).toContain('checkout.total:1 (missing in de)')
    await $.turn.start({ text: 'again', turnId: 't2' } as never)
    await edit(w, $, 'src/a.ts', "t('checkout.total')", "t('checkout.total') t('checkout.vat')", "t('checkout.total') t('checkout.vat')")
    const read = w.logs.filter(l => l.startsWith('some locale files were not read'))
    expect(read).toHaveLength(1)
    expect(read[0]).toMatch(/^some locale files were not read: locales\/fr\.json: /)
  })

  test('a project without locale directories gets nothing', async ($, on) => {
    const w = world(on, { 'src/a.ts': '' })
    await started($)
    expect((await edit(w, $, 'src/a.ts', '', "t('x.y')")).context).toBe(undefined)
    expect(w.logs).toEqual([])
  })
})
