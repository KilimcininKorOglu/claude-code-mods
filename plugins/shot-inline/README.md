# shot-inline

A Claude Code Mod that draws each PNG or JPG the model saves or reads under its tool row, so you see the screenshot the model looked at without opening the file.

## What it does

1. The mod watches three kinds of tool call and takes the image path from each:
   - a Playwright `browser_take_screenshot`: the file its result links to, a relative link read against the directory the session started in, where the Playwright server writes it, also after a Bash `cd`;
   - a `Read` of a `.png`, `.jpg` or `.jpeg` file;
   - a Bash command that names such a file, when the file exists after the command (the last one named first).
2. A PNG is measured from its header. A PNG over 4 MiB, and a JPG, are measured with `sips`.
3. A JPG is copied once to `$TMPDIR/shot-inline/<hash>.png` with `sips -s format png`, because the terminal draws PNG only. The hash covers the path and the modification time.
4. The tool row draws the picture under itself: at most 80 columns wide and 24 rows tall, in the picture's shape. The terminal reads the file itself; no pixel crosses the engine.
5. A terminal with the kitty graphics protocol (kitty, Ghostty, read from `TERM`, `TERM_PROGRAM` and `KITTY_WINDOW_ID`) draws the pixels themselves. Every other terminal draws the same box as half-block cells: `sips` writes a BMP of exactly the box's pixels, the mod reads its rows, and each cell holds two pixels, the upper one as its foreground and the lower one as its background. The BMP is made once per picture and box. The cells of each picture are kept for the newest box it was drawn in, so a resize replaces them, and they go with the picture once the newest 200 pictures push it out.

iTerm2 has an inline image protocol of its own, and the engine does not use it, so iTerm2 takes the half-block path as well. The protocol is chosen inside the engine's `Image` element, so no mod can change it. Only the terminal surface draws a picture.

In the live check a `Read` of a PNG and of a JPG each drew under its row, the JPG through a `sips` copy, with no tree refused in the debug log. In tmux, which has no kitty protocol, the same `Read` drew 24 rows of half-block cells in 23 foreground and 18 background colours.

## Command

    /shot-inline            on or off, and the pictures of this session
    /shot-inline on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install shot-inline@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Use kitty or Ghostty for the picture itself. iTerm2, the VS Code terminal, Terminal.app, Windows Terminal and conhost get the half-block cells, because the engine sends the kitty protocol only.
2. `sips` is part of macOS, and both the JPG copy and the half-block cells need it. Elsewhere a PNG up to 4 MiB still draws in kitty and Ghostty, and every other path logs `a picture was not drawn: ...` once.
3. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.tsx hooks: session.start, command.run{command=shot-inline}, tool.call{tool=Read}, tool.call{tool=Bash}, tool.call{tool=/^mcp__(plugin_playwright_)?playwright__browser_take_screenshot$/}, ui.render{component=ToolUse}
    ❯ ./register.tsx calls: $.command.register, $.env.get, $.fs.exists (via bmpCopy, pngCopy, prepare), $.fs.read (via gridFor, measure), $.fs.stat (via prepare), $.process.run (via sips, tempDir), $.session.cwd, $.store.get, $.store.set (via runCommand), $.ui.invalidate (via remember, runCommand), $.ui.log (via report), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: KITTY_WINDOW_ID, TERM, TERM_PROGRAM, TMPDIR

Reach L2, runs processes and writes files.

    1. Reads:    the input of Read and Bash calls, the Playwright screenshot result, the header of each image file named, the pixels of the BMP it wrote itself, and TERM, TERM_PROGRAM, KITTY_WINDOW_ID and TMPDIR
    2. Runs:     sips (size, JPG to PNG, the BMP of the cells) and mkdir -p, by argv
    3. Sends:    nothing to the model; nothing leaves the machine
    4. Persists: PNG copies of JPGs and the BMPs of the drawn boxes under $TMPDIR/shot-inline, and the on/off setting in $.store
    5. Hostile input: a path comes from the model's command text; it reaches sips as one argv item, never through a shell, and only after the file is found to exist

## Limits

- The pictures live in memory: a resumed session draws its old rows without them.
- A Bash command that writes an image under a name it builds at run time (a variable, a glob) is not seen.
- A path starting with `~` is not expanded.
- The copies under `$TMPDIR/shot-inline` are not deleted by the mod; the system clears the temp directory.
- A half-block cell holds two pixels, so an 80 by 24 box is 160 by 48 pixels. The picture is recognizable, not sharp.
- The terminal's colour depth is the engine's to pick: in tmux it wrote 256-colour codes, not 24-bit ones.
- The half-block path needs `sips`, so it is macOS only. The kitty path needs no process for a PNG.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
