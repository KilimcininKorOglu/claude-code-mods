# diagram-render

A Claude Code Mod that renders the mermaid blocks of the model's replies with an installed `mmdc` and draws each picture under its reply. The block stays in the reply as text; the picture comes under it.

## What it does

1. When a reply is drawn, each closed ` ```mermaid ` block in it is queued. The last text of each turn is queued at the turn's end too. A block still streaming has no closing fence and waits.
2. After the turn ends, the queued blocks render one at a time in the background: `mmdc -i <hash>.mmd -o <hash>.png -b transparent -t dark -q`, by argv, 60 s at most each. The files live under `$TMPDIR/diagram-render`, named by a hash of the block, so a block renders once per session.
3. When a picture is ready, the reply redraws with the picture under it: at most 100 columns wide and 30 rows tall, in the picture's shape.
4. A block mmdc refuses (a syntax error) logs `a diagram was not rendered: Error: Parse error ...` once and stays text.
5. Without `mmdc` on PATH the mod logs `mmdc is not installed, so mermaid blocks stay text: npm i -g @mermaid-js/mermaid-cli` once per session and runs nothing more.

The picture shows in a terminal with the kitty graphics protocol (kitty, Ghostty). Another terminal shows `mermaid diagram 1` in its place. Only the terminal surface draws it.

In the live check without mmdc the install line came once after the reply. With mmdc on PATH a three-node flowchart rendered in 1.1 s and `mermaid diagram 1` came under the reply in tmux, with no tree refused in the debug log.

## Command

    /diagram-render            on or off, whether mmdc was found, and the counts of this session
    /diagram-render on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install diagram-render@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Install the mermaid CLI: `npm i -g @mermaid-js/mermaid-cli`. It renders through puppeteer. When npm skips puppeteer's browser download, set `PUPPETEER_EXECUTABLE_PATH` to an installed Chrome, for example `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
2. Use a terminal that shows pictures (kitty, Ghostty) to see them.
3. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.tsx hooks: session.start, command.run{command=diagram-render}, turn.complete, ui.render{component=AssistantMessage}
    ❯ ./register.tsx calls: $.command.register, $.env.get (via workDir), $.fs.read (via renderOne), $.fs.write (via renderOne), $.process.run (via mmdcReady, renderOne), $.store.get, $.store.set (via runCommand), $.ui.invalidate (via drain, runCommand), $.ui.log (via drain, mmdcReady), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: TMPDIR

Reach L2, runs processes and writes files.

    1. Reads:    the text of the model's replies and the header of each rendered PNG
    2. Runs:     mmdc --version once, and mmdc per new block, by argv
    3. Sends:    nothing to the model; nothing leaves the machine
    4. Persists: the block source and its PNG under $TMPDIR/diagram-render, and the on/off setting in $.store
    5. Hostile input: the block source comes from the model and reaches mmdc only as a file mmdc parses; mermaid runs it in a headless browser, so a hostile block runs inside that browser

## Limits

- The pictures live in memory: a resumed session draws its old replies without them until the next turn ends.
- The theme is dark on a transparent background; on a light terminal the lines are hard to see.
- The files under `$TMPDIR/diagram-render` are not deleted by the mod; the system clears the temp directory.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
