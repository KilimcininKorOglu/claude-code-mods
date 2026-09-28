# shot-inline

The model takes a screenshot or reads a picture, draws a conclusion from it, and you see only a file path. To check what it looked at you open the file yourself. This mod draws each PNG or JPG the model saves or reads under its tool row, so you see the screenshot the model looked at without opening the file.

## What it does

1. The mod watches three kinds of tool call and takes the image path from each:
   - a Playwright `browser_take_screenshot`: the file its result links to, a relative link read against the directory the session started in, where the Playwright server writes it, also after a Bash `cd`;
   - a `Read` of a `.png`, `.jpg` or `.jpeg` file;
   - a Bash command that names such a file, when the file exists after the command (the last one named first).
2. A PNG is measured from its header. A PNG over 4 MiB, and a JPG, are measured with `sips`.
3. A JPG is copied once to `$TMPDIR/shot-inline/<hash>.png` with `sips -s format png`, because the terminal draws PNG only. The hash covers the path and the modification time.
4. The tool row draws the picture under itself, in the picture's shape: at most 80 columns wide (fewer when the terminal is narrower, and one column per 8 pixels for a small picture, so it is not stretched) and 24 rows tall. The terminal reads the file itself; no pixel crosses the engine.
5. A terminal with the kitty graphics protocol (kitty, Ghostty, read from `TERM`, `TERM_PROGRAM` and `KITTY_WINDOW_ID`) draws the pixels themselves. Every other terminal draws the same box as block cells: `sips` writes a BMP of exactly the pixels the cells hold, and the mod reads its rows. By default a cell is a quadrant character (`▘`, `▞`, `▐`, `▙` and the rest) over two by two pixels: the cell's pixels are split at the middle of the colour channel that spreads widest, the brighter side is drawn in its mean colour and the darker side is the background. That is twice the pixels of a half block across, at the cost of two colours per four pixels. `/shot-inline glyphs half` goes back to half blocks (`▀`), two pixels a cell, each in its own colour. The BMP is made once per picture and pixel size. The cells of each picture are kept for the newest box it was drawn in, so a resize replaces them, and they go with the picture once the newest 200 pictures push it out.

iTerm2 has an inline image protocol of its own, and the engine does not use it, so iTerm2 takes the block-cell path as well. The protocol is chosen inside the engine's `Image` element, so no mod can change it. Only the terminal surface draws a picture.

The finer sextant (2 by 3) and octant (2 by 4) characters cannot be used: they lie beyond the Basic Multilingual Plane, and `Raster` refuses them (measured on 2.1.283: `cell 42 holds code point 118089, beyond the Basic Multilingual Plane; the engine drew its own`).

In the live check a `Read` of a PNG and of a JPG each drew under its row, the JPG through a `sips` copy, with no tree refused in the debug log. In tmux, which has no kitty protocol, the same `Read` drew 24 rows of half-block cells in 23 foreground and 18 background colours. On 2.1.283 a 320 by 200 test picture drew as 40 by 13 quadrant cells in tmux, with no tree refused.

## Command

    /shot-inline                      on or off, the pictures of this session, and the cells in use
    /shot-inline on | off             on by default
    /shot-inline glyphs half | quadrant   the cells of a terminal without the kitty protocol; quadrant by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install shot-inline@kilimcininkoroglu-mods

Function hooks are early access, and nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Use kitty or Ghostty for the picture itself. iTerm2, the VS Code terminal, Terminal.app, Windows Terminal and conhost get the block cells, because the engine sends the kitty protocol only.
2. `sips` is part of macOS, and both the JPG copy and the block cells need it. Elsewhere a PNG up to 4 MiB still draws in kitty and Ghostty, and every other path logs `a picture was not drawn: ...` once.
3. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.tsx hooks: session.start, command.run{command=shot-inline}, tool.call{tool=Read}, tool.call{tool=Bash}, tool.call{tool=/"^mcp__(plugin_playwright_)?playwright__browser_take_screenshot$"/}, ui.render{component=ToolUse}
    ❯ ./register.tsx calls: $.command.register, $.env.get, $.fs.exists (via bmpCopy, pngCopy, prepare), $.fs.read (via gridFor, measure), $.fs.stat (via prepare), $.process.run (via sips, tempDir), $.session.cwd, $.store.get (via readSettings), $.store.set (via runCommand, setGlyphs), $.ui.invalidate (via readSettings, remember, runCommand, setGlyphs), $.ui.log (via report), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: KITTY_WINDOW_ID, TERM, TERM_PROGRAM, TMPDIR

Reach L2, runs processes and writes files.

    1. Reads:    the input of Read and Bash calls, the Playwright screenshot result, the header of each image file named, the pixels of the BMP it wrote itself, and TERM, TERM_PROGRAM, KITTY_WINDOW_ID and TMPDIR
    2. Runs:     sips (size, JPG to PNG, the BMP of the cells) and mkdir -p, by argv
    3. Sends:    nothing to the model; nothing leaves the machine
    4. Persists: PNG copies of JPGs and the BMPs of the drawn boxes under $TMPDIR/shot-inline, and the on/off and glyphs settings in $.store
    5. Hostile input: a path comes from the model's command text; it reaches sips as one argv item, never through a shell, and only after the file is found to exist

## Limits

- The pictures live in memory: a resumed session draws its old rows without them.
- A Bash command that writes an image under a name it builds at run time (a variable, a glob) is not seen.
- A path starting with `~` is not expanded.
- The copies under `$TMPDIR/shot-inline` are not deleted by the mod; the system clears the temp directory.
- A quadrant cell holds four pixels in two colours, so an 80 by 24 box is 160 by 48 pixels; a half-block cell holds two in their own colours, 80 by 48. The picture is recognizable, not sharp.
- The terminal's colour depth is the engine's to pick: in tmux it wrote 256-colour codes, not 24-bit ones.
- The block-cell path needs `sips`, so it is macOS only. The kitty path needs no process for a PNG.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
