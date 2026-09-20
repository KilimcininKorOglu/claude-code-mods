# prompt-offload

A Claude Code Mod that writes a long pasted prompt to a file and sends the model its first lines with the path, so one paste does not fill the context.

## What it does

1. Each prompt you type, or send through Remote Control, is measured. A notification, a peer message, a schedule or another plugin's prompt is left alone.
2. A prompt longer than the limit (2000 characters by default) is written to `$TMPDIR/prompt-offload/<hash>.txt`, whole and unchanged. The hash covers the text and the time it was sent.
3. The model reads the first 200 characters of the prompt, cut at a line break when the head holds one, then one line naming the file, the character count and the line count, and telling it to read the file before answering.
4. The transcript gets one line: how many characters went to the file and where.
5. A failed write is not a lost prompt: the whole prompt reaches the model as it is, and the reason is logged once.

In the live check a 2980-character prompt was written to the file, the model read the file with `Read` and answered the question that only the tail of the prompt held.

## Command

    /prompt-offload              on or off, and the limit
    /prompt-offload on | off     on by default
    /prompt-offload limit <n>    at least 500 characters; kept across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-offload@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Allow reading `$TMPDIR/prompt-offload`, or answer the permission question the first `Read` of a file raises.
2. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=prompt-offload}, prompt.submit
    ❯ ./register.ts calls: $.clock.now (via offload), $.command.register, $.env.get (via tempDir), $.fs.write (via offload), $.process.run (via tempDir), $.store.get, $.store.set (via setEnabled, setLimit), $.ui.log (via offload, report)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: TMPDIR

Reach L2, writes files and runs a process.

    1. Reads:    the text and origin of each submitted prompt, and TMPDIR
    2. Runs:     mkdir -p, by argv
    3. Sends:    the first 200 characters of the prompt and the path to the model; nothing leaves the machine
    4. Persists: the whole prompt under $TMPDIR/prompt-offload, and the on/off setting and the limit in $.store
    5. Hostile input: only a prompt from the composer or Remote Control is written, the file name is a hash the mod builds, and the path never reaches a shell

## Limits

- The file is not deleted by the mod; the system clears the temp directory.
- An attachment, an image or a file reference in the prompt is not counted or moved: the mod measures the text alone.
- The model needs one `Read` to see the whole prompt, so a prompt it would have answered at once costs one tool call.
- A limit under 500 characters is refused, because a head of 200 characters leaves too little of the prompt behind.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
