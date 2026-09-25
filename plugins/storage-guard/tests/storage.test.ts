import { describe, expect, test, tier } from 'claude-code/testing'

import { denyText, doneLines, isGuarded, isSource, lineOf, modeOf, noteText, placesOf, sidebarLines, stillUsed, storageLines } from '../hooks/storage.ts'

tier('user')

describe('storage', () => {
  test('finds each form of localStorage and sessionStorage used as code', () => {
    const flagged = [
      "localStorage.setItem('token', token)",
      "const theme = sessionStorage.getItem('theme')",
      'window.localStorage.removeItem(key)',
      "const store = window['localStorage']",
      'const { sessionStorage } = window',
      'if (typeof localStorage !== "undefined") save()',
      'const label = `saved: ${localStorage.getItem(key)}`',
      '<script>localStorage.clear()</script>',
    ]
    for (const line of flagged) expect([line, storageLines('', line)]).toEqual([line, [line]])
  })

  test('leaves strings, comments, cookies and other names alone', () => {
    const clean = [
      '// localStorage.setItem("token", token)',
      ' * reads sessionStorage first',
      '<!-- localStorage is not used here -->',
      'const msg = "we never use localStorage"',
      'const label = `localStorage is off`',
      'document.cookie = `token=${token}; Secure; SameSite=Lax`',
      'save(token) // not localStorage',
      'const myLocalStorage = createStore()',
      'indexedDB.open("app")',
    ]
    for (const line of clean) expect([line, storageLines('', line)]).toEqual([line, []])
  })

  test('skips lines the old text had', () => {
    const after = 'const a = 1\nlocalStorage.setItem("a", a)\nsessionStorage.clear()'
    expect(storageLines('sessionStorage.clear()', after)).toEqual(['localStorage.setItem("a", a)'])
    expect(lineOf(after, 'sessionStorage.clear()')).toBe(3)
    expect(lineOf(after, 'nope')).toBe(undefined)
  })

  test('reads JavaScript, TypeScript, component files and their tests', () => {
    for (const path of ['a.js', 'a.jsx', 'a.ts', 'a.tsx', 'a.mjs', 'a.cjs', 'a.mts', 'a.cts', 'A.vue', 'A.svelte', 'a.astro', 'index.html', 'auth.test.ts', 'auth.spec.js']) {
      expect(isSource(path), path).toBe(true)
    }
    for (const path of ['a.py', 'README.md', 'a.json', 'a.d.ts.map']) expect(isSource(path), path).toBe(false)
  })

  test('a measure keeps the lines the file still uses, and a commented-out line counts as fixed', () => {
    const lines = ['localStorage.setItem("a", a)', 'sessionStorage.clear()']
    const text = 'x()\n// localStorage.setItem("a", a)\nsessionStorage.clear()\n'
    expect(stillUsed(text, lines)).toEqual(['sessionStorage.clear()'])
    expect(placesOf('src/a.ts', text, ['sessionStorage.clear()'])).toEqual(['src/a.ts:3'])
    expect(placesOf('src/a.ts', undefined, ['sessionStorage.clear()'])).toEqual(['src/a.ts'])
    expect(stillUsed('', lines)).toEqual([])
  })

  test('the note names a cookie and at most eight places', () => {
    expect(noteText(['src/auth.ts:12'])).toBe(
      "storage-guard: this edit stores data in the browser with localStorage or sessionStorage: src/auth.ts:12. Store it in a cookie instead (document.cookie, or the server's Set-Cookie).",
    )
    expect(noteText(Array.from({ length: 10 }, (_, i) => `a.ts:${i}`))).toContain('a.ts:7 · 2 more.')
  })

  test('the places past eight are one faint count in the sidebar, not one more red place', () => {
    const places = Array.from({ length: 10 }, (_, i) => `a.ts:${i}`)
    expect(sidebarLines(places).slice(-2)).toEqual([{ text: 'a.ts:7', kind: 'error' }, { text: '2 more', kind: 'dim' }])
    expect(doneLines('a.ts', places).slice(-2)).toEqual([{ text: 'a.ts:7', kind: 'ok' }, { text: '2 more', kind: 'dim' }])
    expect(sidebarLines(['a.ts:1'])).toEqual([{ text: 'a.ts:1', kind: 'error' }])
  })

  test('the gate stops a commit, a push and a merge, and says why', () => {
    for (const command of ['git commit -m x', 'git push origin main', 'git merge main', 'git -c user.name=x commit -m y']) expect(isGuarded(command), command).toBe(true)
    for (const command of ['git status', 'git push --dry-run', 'git log']) expect(isGuarded(command), command).toBe(false)
    expect(modeOf('deny')).toBe('deny')
    expect(modeOf('x')).toBe(undefined)
    expect(denyText(['src/auth.ts:12'])).toBe(
      'stopped: 1 place(s) store data in localStorage or sessionStorage: src/auth.ts:12. Move the data to a cookie, then run the command again; there is no way around this gate.',
    )
  })
})
