import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

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

/** Files by absolute path; `reads` counts the locale reads, `logs` the logged lines. */
type World = { files: Map<string, string>; reads: number; logs: string[] }

function isDirPath(w: World, path: string): boolean {
  return [...w.files.keys()].some(f => f.startsWith(`${path}/`))
}

function world(on: On, files: Record<string, string>): World {
  const w: World = { files: new Map(Object.entries(files).map(([p, t]) => [`${ROOT}/${p}`, t])), reads: 0, logs: [] }
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
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
}

const edit = ($: Engine, file: string, before: string, after: string) =>
  $.tool.call({ tool: 'Edit', file_path: `${ROOT}/${file}`, old_string: before, new_string: after } as never)

const LOCALES = {
  'locales/en.json': '{"checkout":{"total":"Total","vat":"VAT"}}',
  'locales/tr.json': '{"checkout":{"total":"Toplam"}}',
  'locales/de.json': '{"checkout":{}}',
}

describe('i18n-watch', () => {
  test('an edit that calls keys some locales lack gets the note, and the person sees one line', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    const r = await edit($, 'src/Cart.vue', "{{ $t('checkout.title') }}", "{{ $t('checkout.title') }} {{ $t('checkout.total') }} {{ $t('checkout.vat') }} {{ $t('checkout.fee') }}")
    expect(r.context).toEqual([
      'i18n-watch: this edit uses translation keys the locale files lack: checkout.total (missing in de) · checkout.vat (missing in de, tr) · checkout.fee (missing in every locale). Add them to each locale file.',
    ])
    expect(w.logs).toEqual([
      'keys the locale files lack: checkout.total (missing in de) · checkout.vat (missing in de, tr) · checkout.fee (missing in every locale)',
    ])
  })

  withSidebar('an open sidebar takes the keys and the transcript stays clean', async ($, on) => {
    const w = world(on, LOCALES)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await started($)
    await edit($, 'src/Cart.vue', '', "{{ $t('checkout.fee') }}")
    expect(bar.sections).toEqual([{ key: 'src-Cart.vue', title: 'missing translation keys', lines: ['checkout.fee (missing in every locale)'] }])
    expect(w.logs).toEqual([])
  })

  withSidebar('a locale edit that adds every missing key clears the entry and writes a new one', async ($, on) => {
    const w = world(on, LOCALES)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await started($)
    await edit($, 'src/Cart.vue', '', "{{ $t('checkout.fee') }}")
    for (const lang of ['en', 'tr', 'de']) w.files.set(`${ROOT}/locales/${lang}.json`, '{"checkout":{"fee":"Fee"}}')
    await edit($, 'locales/de.json', '{}', '{"checkout":{"fee":"Fee"}}')
    expect(bar.cleared).toEqual(['src-Cart.vue'])
    expect(bar.sections).toEqual([{
      key: 'src-Cart.vue',
      title: 'translation keys added',
      lines: ['src/Cart.vue', 'checkout.fee'],
    }])
    expect(w.logs).toEqual([])
  })

  test('a finding stays open until the last missing key is added, then the person reads one line', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    await edit($, 'src/Cart.vue', '', "{{ $t('checkout.fee') }} {{ $t('checkout.vat') }}")
    w.files.set(`${ROOT}/locales/de.json`, '{"checkout":{"vat":"MwSt"}}')
    await edit($, 'locales/de.json', '{}', '{"checkout":{"vat":"MwSt"}}')
    expect(w.logs).toHaveLength(1)
    w.files.set(`${ROOT}/locales/de.json`, '{"checkout":{"vat":"MwSt","fee":"Gebühr"}}')
    w.files.set(`${ROOT}/locales/en.json`, '{"checkout":{"total":"Total","vat":"VAT","fee":"Fee"}}')
    w.files.set(`${ROOT}/locales/tr.json`, '{"checkout":{"total":"Toplam","vat":"KDV","fee":"Ücret"}}')
    await edit($, 'locales/en.json', '{}', '{"checkout":{"fee":"Fee"}}')
    expect(w.logs[1]).toBe('every locale now has the keys src/Cart.vue lacked: checkout.fee · checkout.vat')
  })

  test('reads Laravel, YAML and gettext trees, and Write checks the whole file', async ($, on) => {
    world(on, {
      'resources/lang/en/messages.php': "<?php\nreturn [\n    'hi' => 'Hi',\n];\n",
      'resources/lang/tr/messages.php': "<?php\nreturn [\n];\n",
      'config/locales/en.yml': 'en:\n  shop:\n    buy: Buy\n',
      'config/locales/tr.yml': 'tr:\n  shop:\n    buy: Al\n',
      'locale/tr/LC_MESSAGES/django.po': 'msgid "Hello"\nmsgstr "Merhaba"\n',
    })
    await started($)
    const r = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/app/x.php`, content: "<?php echo __('messages.hi'); echo t('shop.buy'); echo _('Hello');" } as never)
    expect(r.context?.[0]).toBe(
      'i18n-watch: this edit uses translation keys the locale files lack: messages.hi (missing in tr) · Hello (missing in en). Add them to each locale file.',
    )
  })

  test('no note without new keys, without locale files, for a non-source file, or when off', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    expect((await edit($, 'src/a.ts', "t('checkout.total')", "t('checkout.total') // x")).context).toBe(undefined)
    expect((await edit($, 'README.md', '', "t('checkout.fee')")).context).toBe(undefined)
    expect(w.reads).toBe(0)
    expect((await $.command.run(run('off'))).text).toBe('off: edits are not checked')
    expect((await edit($, 'src/a.ts', '', "t('checkout.fee')")).context).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('off')
  })

  test('the catalog is read once per turn and again after a locale edit', async ($, on) => {
    const w = world(on, LOCALES)
    await started($)
    await edit($, 'src/a.ts', '', "t('checkout.fee')")
    await edit($, 'src/b.ts', '', "t('checkout.fee')")
    expect(w.reads).toBe(3)
    w.files.set(`${ROOT}/locales/de.json`, '{"checkout":{"total":"Summe","vat":"MwSt"}}')
    await edit($, 'locales/de.json', '{}', '{"checkout":{"total":"Summe","vat":"MwSt"}}')
    expect((await edit($, 'src/c.ts', '', "t('checkout.total')")).context).toBe(undefined)
    expect(w.reads).toBe(6)
  })

  test('a broken locale file is skipped and logged once', async ($, on) => {
    const w = world(on, { ...LOCALES, 'locales/fr.json': '{' })
    await started($)
    expect((await edit($, 'src/a.ts', '', "t('checkout.total')")).context?.[0]).toContain('checkout.total (missing in de)')
    await $.turn.start({ text: 'again', turnId: 't2' } as never)
    await edit($, 'src/a.ts', '', "t('checkout.vat')")
    const read = w.logs.filter(l => l.startsWith('some locale files were not read'))
    expect(read).toHaveLength(1)
    expect(read[0]).toMatch(/^some locale files were not read: locales\/fr\.json: /)
  })

  test('a project without locale directories gets nothing', async ($, on) => {
    const w = world(on, { 'src/a.ts': '' })
    await started($)
    expect((await edit($, 'src/a.ts', '', "t('x.y')")).context).toBe(undefined)
    expect(w.logs).toEqual([])
  })
})
