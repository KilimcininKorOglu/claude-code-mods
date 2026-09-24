# prompt-deck

A Claude Code Mod that learns the short prompts you send often in this project, and draws them, with the ones you pin by hand, in the band above the prompt. A digit key sends one at once.

## What it does

1. Each prompt you type, or send through Remote Control, is counted: trimmed, one line, 1 to 80 characters, not a slash command. A notification, a peer message, a schedule or another plugin's prompt is not counted.
2. `/prompt-deck add <text>` pins a prompt by hand. A pinned prompt is drawn first, in the order it was added, and the counts never push it off the band. It has no length limit and is kept per project, like the counts. Up to 5 prompts are pinned, because the band holds 5. `/prompt-deck remove <n>` unpins one.
3. A prompt reaches the band after 3 uses. The band draws the 5 most used, the latest first on a tie, as `1: commitle  2: devam et ...`, each label cut to its share of the width.
4. With the prompt box empty, a digit key sends that prompt at once. A click, or ctrl+x tab and Enter, sends it too. A press counts as one more use.
5. The band is not drawn while a survey holds it, while a turn runs, or while an agent's transcript is in view.
6. The counts and the pinned prompts live in the plugin store, one deck per project, shared by every session of it. The project is the session's git top level, else its working directory, and the deck is keyed by that full path, so two checkouts named `app` keep two decks; the status names the project by its last path part. At most 200 prompts are kept per project; the least used and oldest go first.
7. The deck of a version before 0.2.0 counted every project into one. The first project that loads 0.2.0 takes those counts, once, and says so in one line; every other project starts empty.
8. A deck of a version before 0.5.0 was keyed by the project's name alone. The first checkout of that name that loads 0.5.0 takes it to the key of its path, once, and says so in one line; another checkout of the same name starts empty.

A press runs the mod's own markdown command `/prompt-deck:send <prompt>`, whose body is its arguments alone. The transcript shows that command line, and the model reads the prompt as it is written, as it reads a typed slash command (measured on 2.1.282). A prompt that holds `&& /<name>` would read as a command chain there, so it goes out as a plugin prompt instead, and so does a press whose command the engine refuses, with one line that says so. The model reads a plugin prompt inside a `The prompt-deck plugin sent a message:` frame.

In the live check a pinned `Yalnız tamam kelimesini yaz.` appeared as `1: Yalnız tamam kelimesini yaz.`, the `1` key sent it as `/prompt-deck:send Yalnız tamam kelimesini yaz.`, and the model read the prompt without the frame and answered `tamam`.

## Command

    /prompt-deck                on or off, the project, and its prompts with their uses
    /prompt-deck list           the same
    /prompt-deck add <text>     pin a prompt of your own, drawn before the counted ones
    /prompt-deck remove <n>     forget the prompt at place n of the list, pinned or counted
    /prompt-deck clear          forget every prompt
    /prompt-deck on | off       on by default; off keeps the counts
    /prompt-deck:send <prompt>  the command a press runs; typed, it sends the prompt as written

`/prompt-deck:send` is the mod's second command, the one exception to one command per mod, because only a markdown command hands the model a prompt without the plugin frame.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install prompt-deck@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.282:

    ❯ ./register.tsx hooks: session.start, command.run{command=prompt-deck}, prompt.submit, ui.render{component=AbovePrompt}
    ❯ ./register.tsx calls: $.clock.after (via sendPrompt), $.clock.now (via countUse), $.command.register, $.command.run (via sendPrompt), $.process.run (via resolveRoot), $.prompt.submit (via submitPrompt), $.session.cwd (via resolveRoot), $.store.delete (via adoptLegacy, adoptNamed), $.store.get (via adoptLegacy, adoptNamed, countUse, loadDeck), $.store.set (via saveCounts, savePins, setEnabled), $.ui.invalidate, $.ui.log (via adoptLegacy, adoptNamed, sendPrompt, submitPrompt), $.ui.resolve

Reach L2, runs git and drives Claude: a press submits a prompt.

    1. Reads:    the text and origin of each submitted prompt; the session's working directory
    2. Runs:     git rev-parse --show-toplevel, once per session, to find the project's root
    3. Sends:    a stored prompt as a user turn through /prompt-deck:send, only on the person's press; nothing leaves the machine
    4. Persists: in $.store, per project, up to 200 short prompts with their use counts and last use time, up to 5 pinned prompts, and the on/off setting
    5. Hostile input: only prompts from the composer or Remote Control are counted, and only a typed /prompt-deck add pins one, so a notification, a peer or a plugin cannot put a prompt on the band

## Limits

- A prompt longer than 80 characters or over several lines is never counted. `/prompt-deck add` takes any length on one line.
- The band is drawn on the terminal only, because the engine raises `AbovePrompt` there only.
- Two prompts that differ only in case or punctuation count apart.
- The on/off setting is one setting for every project.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
