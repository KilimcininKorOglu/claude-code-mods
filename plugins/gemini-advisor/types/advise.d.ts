// The input of this plugin's own advise tool, so a tool.call hook and $.tool.call
// narrow to it (McpToolInputs is open for declaration merging).
import 'claude-code'

declare module 'claude-code' {
  interface McpToolInputs {
    'mcp__gemini-advisor__advise': { message: string }
  }
}
