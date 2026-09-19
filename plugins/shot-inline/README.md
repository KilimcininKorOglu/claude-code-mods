# shot-inline

A Claude Code Mod that draws each PNG or JPG the model saves or reads under its tool row, so you see the screenshot the model looked at without opening the file.

## What it does

1. The mod watches three kinds of tool call and takes the image path from each:
   - a Playwright `browser_take_screenshot`: the file its result links to;
   - a `Read` of a `.png`, `.jpg` or `.jpeg` file;
   - a Bash command that names such a file, when the file exists after the command (the last one named first).
2. A PNG is measured from its header. A PNG over 4 MiB, and a JPG, are measured with `sips`.
3. A JPG is copied once to `$TMPDIR/shot-inline/<hash>.png` with `sips -s format png`, because the terminal draws PNG only. The hash covers the path and the modification time.
4. The tool row draws the picture under itself: at most 80 columns wide and 24 rows tall, in the picture's shape. The terminal reads the file itself; no pixel crosses the engine.

The picture shows in a terminal with the kitty graphics protocol (kitty, Ghostty). Another terminal shows `picture: <path>` in its place. Only the terminal surface draws it.

In the live check a `Read` of a PNG and of a JPG each drew under its row, the JPG through a `sips` copy, with no tree refused in the debug log. tmux shows the `picture: <path>` line, so the picture itself was not seen in that check.

## Command

    /shot-inline            on or off, and the pictures of this session
    /shot-inline on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install shot-inline@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Use a terminal that shows pictures (kitty, Ghostty) to see them; others show the path.
2. `sips` is part of macOS. Elsewhere a PNG up to 4 MiB still draws, and a JPG logs `a picture was not drawn: ...` once.
3. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.tsx hooks: session.start, command.run{command=shot-inline}, tool.call{tool=Read}, tool.call{tool=Bash}, tool.call{tool=/^mcp__(plugin_playwright_)?playwright__browser_take_screenshot$/}, ui.render{component=ToolUse}
    ❯ ./register.tsx calls: $.command.register, $.env.get (via pngCopy), $.fs.exists (via pngCopy, prepare), $.fs.read (via measure), $.fs.stat (via prepare), $.process.run (via pngCopy, sips), $.session.cwd (via remember), $.store.get, $.store.set (via runCommand), $.ui.invalidate (via remember, runCommand), $.ui.log (via report), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: TMPDIR

Reach L2, runs processes and writes files.

    1. Reads:    the input of Read and Bash calls, the Playwright screenshot result, and the header of each image file named
    2. Runs:     sips (size, JPG to PNG) and mkdir -p, by argv
    3. Sends:    nothing to the model; nothing leaves the machine
    4. Persists: PNG copies of JPGs under $TMPDIR/shot-inline, and the on/off setting in $.store
    5. Hostile input: a path comes from the model's command text; it reaches sips as one argv item, never through a shell, and only after the file is found to exist

## Limits

- The pictures live in memory: a resumed session draws its old rows without them.
- A Bash command that writes an image under a name it builds at run time (a variable, a glob) is not seen.
- A path starting with `~` is not expanded.
- The copies under `$TMPDIR/shot-inline` are not deleted by the mod; the system clears the temp directory.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
