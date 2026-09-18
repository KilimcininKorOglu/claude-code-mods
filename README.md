# claude-code-mods

Claude Mods for Claude Code. A Claude Mod is a Claude Code plugin whose `hooks/hooks.json` names a TypeScript module. The module exports `register(on)`, and each hook is `on("event", matcher, async ($, e, next) => result)`. `$` is the engine interface, `e` is the event, and `next(e)` runs every hook beneath and then the engine.

Function hooks are early access. Nothing loads unless `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set, and the API can change between releases.

## Install

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install <mod>@kilimcininkoroglu-mods
```

## Mods

| Mod | What it does | Reach |
|---|---|---|
| [task-poke](plugins/task-poke) | Submits a continue prompt while the task list has unfinished tasks, at most 5 times in a row. | L2 |
| [limit-watch](plugins/limit-watch) | Shows the 5-hour and 7-day usage limits under the prompt with a reset countdown and a forecast, opens a `/limits` pane, and warns at 80% and 95%. | L0 |
| [memory-save](plugins/memory-save) | Loads `MEMORY.md` into the session and saves project learnings to it after every turn through a tool-less fork in the background, without blocking the stop. | L2 |
| [cache-warm](plugins/cache-warm) | Keeps the 1-hour prompt cache warm for a window you set with one fork per idle stretch, and shows the cache state, the cold price and this session's cold writes. | L2 |
| [prompt-time](plugins/prompt-time) | Draws the time under each of your messages and each text block of the model's replies, also for a resumed session. | L1 |

## Layout

```
.claude-plugin/marketplace.json   marketplace manifest, one entry per mod
plugins/<mod>/                    one directory per mod
  .claude-plugin/plugin.json      plugin manifest
  hooks/hooks.json                names the module: "modules": ["./register.ts"]
  hooks/register.ts               exports register(on)
  tests/register.test.ts          tests with claude-code/testing
  tsconfig.json
  README.md                       validator output and threat model
templates/mod/                    the template that make new-mod copies
```

## Development

```sh
make new-mod NAME=my-mod DESC='One sentence about what it does.'
make validate
make test
```

Load a mod for one session:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/<mod>
```

Run `/plugin-types` inside that session to write `.claude/types/` for type checking. The directory is version-specific and git-ignored.

## License

MIT. See `LICENSE`.
