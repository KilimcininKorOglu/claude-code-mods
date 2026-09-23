import { describe, expect, test, tier } from 'claude-code/testing'

import { deltaOf, failedOf, isWatched, prefixOf, statusText } from '../hooks/doctor.ts'

tier('user')

const TAIL = '\n\nTreat this as a connection failure, not a missing capability — do not conclude the server is unconfigured or that access does not exist.'

/** The failed block as the engine wrote it on 2.1.280, with the error it gave. */
const FAILED_WITH_ERROR = `The following MCP servers are configured but failed to connect — their tools (typically named mcp__<server>__*) are unavailable for this session:\nplugin:playwright:playwright: "Skipping connection (recent failure cached retries automatically in 15 min, or edit the plugin config to retry now)"${TAIL}`

/** The same block for a server that dropped mid-session: no error. */
const FAILED_BARE = `The following MCP servers are configured but failed to connect — their tools (typically named mcp__<server>__*) are unavailable for this session:\nplugin:playwright:playwright\nclaude.ai Gmail${TAIL}`

const RECONNECTED = '73 deferred tools are available again (MCP server reconnected — names announced earlier in this conversation): mcp__cloudflare__* (3), mcp__coolify__* (45), mcp__plugin_playwright_playwright__* (25). Load via ToolSearch as before.'

describe('doctor', () => {
  test('a ToolSearch result names the failed servers with the engine\'s reason, and none for a dropped one', () => {
    expect(failedOf({ matches: [], failed_mcp_servers: [{ name: 'flaky', errorCode: 'CONNECTION_CLOSED', error: 'Connection closed' }] })).toEqual([{ name: 'flaky', reason: 'CONNECTION_CLOSED: Connection closed' }])
    expect(failedOf({ failed_mcp_servers: [{ name: 'flaky' }, { name: 'claude.ai Gmail' }] })).toEqual([{ name: 'flaky', reason: 'disconnected' }])
    expect(failedOf({ matches: [] })).toEqual([])
    expect(failedOf(undefined)).toEqual([])
  })

  test('the failed block of an attachment reads with and without the error', () => {
    expect(deltaOf(FAILED_WITH_ERROR).failed).toEqual([{ name: 'plugin:playwright:playwright', reason: 'Skipping connection (recent failure cached retries automatically in 15 min, or edit the plugin config to retry now)' }])
    // A claude.ai connector is left out.
    expect(deltaOf(FAILED_BARE).failed).toEqual([{ name: 'plugin:playwright:playwright', reason: 'failed to connect' }])
  })

  test('the reconnected line names tool prefixes, which a server name maps onto', () => {
    expect(deltaOf(RECONNECTED)).toEqual({ failed: [], reconnected: ['cloudflare', 'coolify', 'plugin_playwright_playwright'] })
    expect(prefixOf('plugin:playwright:playwright')).toBe('plugin_playwright_playwright')
    expect(prefixOf('claude.ai Claude Docs')).toBe('claude_ai_Claude_Docs')
    expect(prefixOf('gemini-advisor')).toBe('gemini-advisor')
  })

  test('claude.ai connectors are not watched, and the status names every failed server', () => {
    expect(isWatched('claude.ai Gmail')).toBe(false)
    expect(isWatched('coolify')).toBe(true)
    expect(statusText(true, [])).toBe('on · every watched MCP server is connected')
    expect(statusText(true, [{ name: 'flaky', reason: 'disconnected' }])).toBe('on · flaky: not connected (disconnected)')
  })
})
