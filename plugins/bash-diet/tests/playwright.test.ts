import { describe, expect, test, tier } from 'claude-code/testing'

import { PLAYWRIGHT_TOOL, withoutEcho } from '../hooks/playwright.ts'

tier('user')

// Captured from Playwright MCP on this machine: a click, and a run_code call whose result holds a code fence.
const CLICK = "### Ran Playwright code\n```js\nawait page.getByRole('link', { name: 'Issues' }).click();\n```\n### Page\n- Page URL: https://github.com/redhat-et/ripwire/issues\n- Page Title: Issues\n### Snapshot\n- [Snapshot](.playwright-mcp/page-2026-09-26T09-26-54-071Z.yml)"
const RUN = '### Result\n{"a":1}\n### Ran Playwright code\n```js\nawait (async (page) => {\n  // ### not a heading\n  return 1;\n})(page);\n```\n### Page\n- Page URL: https://dnscheck.tr/admin/login\n### Events\n- New console entries: .playwright-mcp/console.log#L2-L7'
const TAIL = "### Page\n- Page URL: https://x.test/\n### Ran Playwright code\n```js\nawait page.close()\n```"

describe('playwright', () => {
  test('drops the code echo and keeps every other section', () => {
    expect(withoutEcho(CLICK)).toBe('### Page\n- Page URL: https://github.com/redhat-et/ripwire/issues\n- Page Title: Issues\n### Snapshot\n- [Snapshot](.playwright-mcp/page-2026-09-26T09-26-54-071Z.yml)')
    expect(withoutEcho(RUN)).toBe('### Result\n{"a":1}\n### Page\n- Page URL: https://dnscheck.tr/admin/login\n### Events\n- New console entries: .playwright-mcp/console.log#L2-L7')
    expect(withoutEcho(TAIL)).toBe('### Page\n- Page URL: https://x.test/\n')
    expect(withoutEcho('### Result\nno echo')).toBe('### Result\nno echo')
  })

  test('names the browser tools of the plugin and of a plain MCP server, and nothing else', () => {
    const names = ['mcp__plugin_playwright_playwright__browser_click', 'mcp__playwright__browser_navigate', 'mcp__ripwire__grep', 'Bash']
    expect(names.filter(n => PLAYWRIGHT_TOOL.test(n))).toEqual(names.slice(0, 2))
  })

  test('a Playwright result reaches the model without the echo, blocks and joined text alike, an error kept', async ($, on) => {
    on('tool.call', { tool: /^mcp__plugin_playwright_playwright__browser_click$/ }, () => ({ result: [{ type: 'text', text: CLICK }], text: CLICK, isError: true }) as never)
    const r = (await $.tool.call({ tool: 'mcp__plugin_playwright_playwright__browser_click', target: 'e1' } as never)) as unknown as { result: { text: string }[]; text: string; isError: boolean }
    expect(r.text).toBe(withoutEcho(CLICK))
    expect(r.result[0]?.text).toBe(withoutEcho(CLICK))
    expect(r.isError).toBe(true)
  })
})
