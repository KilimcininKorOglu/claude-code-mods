# slash-chain

A Claude Code Mod that runs slash commands joined with `&&` one after another, as a shell does: `/tiny && /context` runs `/context` once `/tiny` ended well. Without the mod the engine runs the first command alone and drops the rest.

## What it does

1. The engine hands everything after the first command's name to that command as its arguments. The mod splits them at each `&& /<name>`: the first command runs with its own arguments alone, and every `/<name>` after a `&&` becomes a step with its own arguments. A `&&` that no `/<name>` follows stays in the arguments, so `/commit build && test` keeps its text.
2. Each step waits for what it started before the next one runs:
   - A command that hands the model a prompt (a skill or a prompt command) waits for its turn to end. A turn that ends with `answer` runs the next step. A turn that ends with `error`, `refusal` or `aborted` (Esc) stops the chain. A question the model asks with AskUserQuestion stays inside that turn, so the chain waits for the answer too.
   - A command that opens a focused pane (`/disk-janitor`) waits until that pane closes.
   - A built-in dialog (`/cost`, `/model`) holds its command until it closes.
   - Any other command is done when it returns.
3. A command that throws stops the chain.
4. Each step gets one transcript line, and the chain gets one last line:

       1/2: /tiny
       2/2: /context
       all 2 command(s) ran
       stopped after /tiny: its turn ended with aborted; not run: /context

5. A prompt or a new chain you type while a chain waits cancels it: `cancelled; not run: /context`. The new chain starts from there. A single command you type (`/cost`) runs beside the waiting chain and does not cancel it, because the mod hooks only the commands whose arguments hold `&& /<name>`. The engine still writes this mod's name in front of every plugin command's output (`task-poke+slash-chain: ...`): it picks the names it writes by a hook's `command` matcher alone, and a chain can start with any command, so this hook cannot name one (measured on 2.1.281 with two probe plugins: a hook with only an `args` matcher that never ran was named, a hook with a `command` matcher was not).

The model gets no note from this mod.

## Command

    /slash-chain          the setting and the chain that runs, with what it waits for
    /slash-chain stop     cancels the chain that runs
    /slash-chain on | off on by default; off leaves the command as the engine hands it

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install slash-chain@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ ./register.ts hooks: session.start, command.run{command=slash-chain}, command.run{args=/"(?:^|\\s)&&\\s*\\/[A-Za-z0-9_:.-]+(?=\\s|$)"/}, skill.prompt, ui.open, ui.close, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.clock.after (via advance), $.command.register, $.command.run (via runStep), $.store.get, $.store.set (via setEnabled), $.ui.log (via advance, cancel, runFirst, stop)

Reach L2, it drives Claude: it runs the slash commands you chained.

    1. Reads:    the arguments of every slash command, the name of each skill prompt, each pane's id and focus, and each main-loop turn's end reason. It reads no file, no prompt text and no answer.
    2. Runs:     each command after the first of a chain, once, with the arguments you typed for it
    3. Sends:    nothing to the model and nothing to the network
    4. Persists: in $.store, the on/off setting
    5. Hostile input: the chain comes from the text you typed; a step runs only a command the engine knows, with its own arguments, and a pasted text that holds `&& /<name>` in a command's arguments runs that command too

## Limits

- The steps after the first run as a plugin (`origin.kind: 'plugin'`), so a command that answers only the person refuses there. `/disk-janitor delete <path>` is one.
- A local command succeeds when it does not throw. The engine gives no other error signal, so a command that prints an error and returns counts as done.
- An unknown first command never reaches the mod: the engine answers `Unknown skill`, and nothing after it runs. An unknown later command stops the chain with the engine's error: `stopped after /x: it failed: $.command.run: no command named /x in this session`.
- Only `&&` is read. `||`, `;` and `|` stay in the arguments.
- A focused pane is recognized when it opens during its step. A pane a command opens later, from a timer, is not waited for.
- The chain was checked in an interactive session alone. A headless session (`claude -p`) was not measured.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
