/** A transcript's rows for one Bash call, in the shape Claude Code writes them. */
export function callRows(id: string, command: string, output: string, failed = false): string[] {
  return [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description: 'x' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ tool_use_id: id, type: 'tool_result', content: output, is_error: failed }] }, toolUseResult: { stdout: output } }),
  ]
}
