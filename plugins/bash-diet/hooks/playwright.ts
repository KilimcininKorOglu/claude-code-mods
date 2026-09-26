/** The code echo in Playwright MCP results: the code of the call, which the model wrote or asked for itself. */

/** A Playwright MCP browser tool, as a plugin or as a plain MCP server names it. */
export const PLAYWRIGHT_TOOL = /^mcp__.*playwright.*__browser_/

/** The `### Ran Playwright code` section, up to the next section or the end. */
const ECHO = /^### Ran Playwright code\n[\s\S]*?(?=^### |(?![\s\S]))/gm

/** The text without its code echo. */
export function withoutEcho(text: string): string {
  return text.replace(ECHO, '')
}

type Block = { type?: unknown; text?: unknown }

/** An MCP tool result as it reaches a hook: the content blocks, and their text joined. */
export type McpResult = { result?: unknown; text?: unknown }

function blockWithoutEcho(block: unknown): unknown {
  const b = block as Block
  return b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string' ? { ...b, text: withoutEcho(b.text) } : block
}

/** The result with the code echo taken out of every text block and of the joined text. */
export function resultWithoutEcho<R extends McpResult>(r: R): R {
  const result = Array.isArray(r.result) ? r.result.map(blockWithoutEcho) : r.result
  const text = typeof r.text === 'string' ? withoutEcho(r.text) : r.text
  return { ...r, result, text }
}
