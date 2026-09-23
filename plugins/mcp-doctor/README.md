# mcp-doctor

A Claude Code Mod that tells you when an MCP server failed to connect or dropped, with a button that reconnects it, and says so again when the server is back. The engine tells only the model about a failed server; this mod tells the person.

## What it does

1. At session start, at the end of each main-loop turn and after each engine note about deferred tools, the mod reads the engine's own list of servers that are not connected. It asks the built-in `ToolSearch` tool, whose result names each failed server (`failed_mcp_servers`) and each server still connecting (`pending_mcp_servers`). The engine adds that list only to an answer with no match, so the query selects a tool that cannot exist. The call leaves nothing in the model's context.
2. The engine's `deferred_tools_delta` note to the model is read too: its "configured but failed to connect" block names failed servers, and its "available again (MCP server reconnected)" line names the tool prefixes that came back. The note reaches the model unchanged.
3. A server that is not connected gets one red section in the [sidebar](../sidebar) that stays for the session, with the engine's reason and a reconnect button:

       flaky: not connected (CONNECTION_CLOSED: Connection closed)
       [ reconnect flaky ]

   While the sidebar is closed, one transcript line says the same and names the command: `flaky: not connected (disconnected); /mcp-doctor reconnect flaky`.
4. The button runs `/mcp-doctor reconnect <server>`, which asks the engine to run `/mcp reconnect <server>` and reads the list again. A server still failed afterwards gets one line with the engine's answer.
5. A server that is back loses its red section and gets one green line: `flaky: connected again`. A server still connecting is left as it is.
6. The same failure is written once. A later turn that finds the same server failed writes nothing.

claude.ai connectors (servers named `claude.ai <name>`) are left out, because they belong to the account and not to this machine's config. The model gets no note from this mod, because the engine already tells it.

## Command

    /mcp-doctor                    the setting and every server that is not connected
    /mcp-doctor reconnect <server> asks the engine to reconnect one server
    /mcp-doctor on | off           on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install mcp-doctor@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Install the [sidebar](../sidebar) mod for the red section and its button. Without it the mod writes one transcript line per server.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ ./register.ts hooks: session.start, command.run{command=mcp-doctor}, turn.complete, prompt.attachment{type=deferred_tools_delta}
    ❯ ./register.ts calls: $.clock.after (via later, runCommand), $.command.register, $.command.run (via reconnect), $.sidebar.clear (via showBack), $.sidebar.set (via showBack, showFailed), $.store.get, $.store.set (via setEnabled), $.tool.call (via measure), $.ui.log (via later, measure, reconnect, showBack, showFailed)

Reach L2, it drives Claude: it runs the `/mcp reconnect` command.

    1. Reads:    the engine's list of failed and connecting MCP servers (a ToolSearch result), and the engine's deferred_tools_delta note. It reads no file, no prompt and no answer.
    2. Runs:     ToolSearch once per session start, per turn end and per deferred_tools_delta note; /mcp reconnect <server> once per press of the button
    3. Sends:    nothing to the model and nothing to the network
    4. Persists: in $.store, the on/off setting
    5. Hostile input: the server names and error texts come from the engine and the server config; they are drawn as text and never run, and the reconnect command takes the name only as its argument

## Limits

- Reconnecting works in an interactive session alone. A headless session (`claude -p`) answers `Reconnect, enable, and disable aren't available in this session.`, and the mod writes that answer.
- The engine gives no error for a server that dropped during the session, so its line reads `disconnected`.
- A build where `ToolSearch` does not answer (tool search turned off) is read through the engine's notes alone, and the mod says so once.
- The engine's note names a reconnected server by its tool prefix. Two server names that map to one prefix (`a.b` and `a_b`) are closed together.
- A subagent's turn does not trigger a measure; only the main loop's end does.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
