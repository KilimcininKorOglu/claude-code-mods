# prompt-deck

A Claude Code Mod that learns the short prompts you send often in this project, and draws them, with the ones you pin by hand, in the band above the prompt. A digit key sends one at once.

## What it does

1. Each prompt you type, or send through Remote Control, is counted: trimmed, one line, 1 to 80 characters, not a slash command. A notification, a peer message, a schedule or another plugin's prompt is not counted.
2. `/deck add <text>` pins a prompt by hand. A pinned prompt is drawn first, in the order it was added, and the counts never push it off the band. It has no length limit and is kept per project, like the counts. Up to 5 prompts are pinned, because the band holds 5. `/deck remove <n>` unpins one.
3. A prompt reaches the band after 3 uses. The band draws the 5 most used, the latest first on a tie, as `1: commitle  2: devam et ...`, each label cut to its share of the width.
4. With the prompt box empty, a digit key sends that prompt at once. A click, or ctrl+x tab and Enter, sends it too. A press counts as one more use.
5. The band is not drawn while a survey holds it, while a turn runs, or while an agent's transcript is in view.
6. The counts and the pinned prompts live in the plugin store, one deck per project, shared by every session of it. The project is the name of the session's git top level, else of its working directory. At most 200 prompts are kept per project; the least used and oldest go first.
7. The deck of a version before 0.2.0 counted every project into one. The first project that loads 0.2.0 takes those counts, once, and says so in one line; every other project starts empty.

The engine shows a pressed prompt as `The prompt-deck plugin sent a message:` with the prompt under it, and the model answers it as a user turn (measured on 2.1.278). A plugin's own `$.prompt.submit` passes every hook but the calling plugin's, so the mod cannot leave the plugin name out.

In the live check a prompt sent three times appeared as `1: reply with the single word ok`, the `1` key sent it, the model answered, and `/deck` showed 4 uses.

## Command

    /deck                on or off, the project, and its prompts with their uses
    /deck list           the same
    /deck add <text>     pin a prompt of your own, drawn before the counted ones
    /deck remove <n>     forget the prompt at place n of the list, pinned or counted
    /deck clear          forget every prompt
    /deck on | off       on by default; off keeps the counts

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-deck@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.tsx hooks: session.start, command.run{command=deck}, prompt.submit, ui.render{component=AbovePrompt}
    ❯ ./register.tsx calls: $.clock.now (via countUse), $.command.register, $.process.run (via resolveProject), $.prompt.submit (via sendPressed), $.session.cwd (via resolveProject), $.store.delete (via adoptLegacy), $.store.get (via adoptLegacy, countUse, loadDeck), $.store.set (via saveCounts, savePins, setEnabled), $.ui.invalidate, $.ui.log (via adoptLegacy), $.ui.resolve

Reach L2, runs git and drives Claude: a press submits a prompt.

    1. Reads:    the text and origin of each submitted prompt; the session's working directory
    2. Runs:     git rev-parse --show-toplevel, once per session, to name the project
    3. Sends:    a stored prompt as a user turn, only on the person's press; nothing leaves the machine
    4. Persists: in $.store, per project, up to 200 short prompts with their use counts and last use time, up to 5 pinned prompts, and the on/off setting
    5. Hostile input: only prompts from the composer or Remote Control are counted, and only a typed /deck add pins one, so a notification, a peer or a plugin cannot put a prompt on the band

## Limits

- A prompt longer than 80 characters or over several lines is never counted. `/deck add` takes any length on one line.
- The band is drawn on the terminal only, because the engine raises `AbovePrompt` there only.
- Two prompts that differ only in case or punctuation count apart.
- Two projects with the same directory name share one deck, because the project is the name only, not the path.
- The on/off setting is one setting for every project.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
