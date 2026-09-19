# claude-code-mods

Claude Mods for Claude Code. A Claude Mod is a Claude Code plugin whose `hooks/hooks.json` names a TypeScript module. The module exports `register(on, options)`, where `options` holds the plugin's `userConfig` values, and each hook is `on("event", matcher, async ($, e, next) => result)`. `$` is the engine interface, `e` is the event, and `next(e)` runs every hook beneath and then the engine.

Function hooks are early access. Nothing loads unless `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set, and the API can change between releases.

## Install

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install <mod>@kilimcininkoroglu-mods
```

## After installing

1. Turn function hooks on for good. Add this to `~/.claude/settings.json`; without it no mod loads (measured on 2.1.278):

   ```json
   { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
   ```

2. Restart Claude Code. A session that was open during the install does not load the mod.
3. For a Gemini mod, give gemini-core a Gemini API key and choose the tier, then turn the mod on (`/gemini-review on`, `/gemini-plan-review on`, `/gemini-advisor on`, `/gemini-compact on`). A Gemini mod is off after an install and sends nothing to Gemini until then. The [gemini-core README](plugins/gemini-core/README.md#after-installing) lists the steps.

Each mod README has an "After installing" section when that mod needs more.

## Update

```sh
claude plugin marketplace update kilimcininkoroglu-mods
claude plugin update <mod>@kilimcininkoroglu-mods
```

Then restart Claude Code, or run `/reload-plugins` in each open session.

## Mods

| Mod | What it does | Reach |
|---|---|---|
| [task-poke](plugins/task-poke) | Submits a continue prompt while the task list has unfinished tasks, at most 5 times in a row. | L2 |
| [limit-watch](plugins/limit-watch) | Shows the 5-hour and 7-day usage limits under the prompt with a reset countdown and a forecast, opens a `/limits` pane, and warns at 80% and 95%. | L0 |
| [memory-save](plugins/memory-save) | Loads `MEMORY.md` into the session and saves project learnings to it after every turn through a tool-less fork in the background, without blocking the stop. | L2 |
| [cache-warm](plugins/cache-warm) | Keeps the 1-hour prompt cache warm for a window you set with one fork per idle stretch, and shows the cache state, the cold price and this session's cold writes. | L2 |
| [prompt-time](plugins/prompt-time) | Draws the time under each of your messages and each text block of the model's replies, also for a resumed session whose transcript is under 4 MiB. | L1 |
| [gemini-compact](plugins/gemini-compact) | Moves compaction from Claude to Gemini: a Gemini summary with the newest messages verbatim, or Gemini decisions that keep, cut or drop older tool calls. | L3 |
| [gemini-advisor](plugins/gemini-advisor) | Gives the model a Gemini advisor tool it calls by itself: Gemini reads the conversation and the model's message and answers with a second opinion. | L3 |
| [gemini-core](plugins/gemini-core) | Keeps the Gemini keys and tier of every Gemini mod, and each mod's model and thinking level, in one place, builds their Gemini requests, and picks a model from Google's list. | L3 |
| [gemini-review](plugins/gemini-review) | Has Gemini review every commit the model makes, from the diff and the conversation, and stops a commit with a blocking finding. | L3 |
| [gemini-plan-review](plugins/gemini-plan-review) | Has Gemini review each plan before the approval dialog, from the plan and the conversation, and sends a plan with a blocking finding back to the model, at most twice. | L3 |
| [flaky-memory](plugins/flaky-memory) | Remembers which tests failed on which code, and tells the model when a failing test has both passed and failed on the same code, so it runs the test again instead of changing code. | L2 |
| [disk-janitor](plugins/disk-janitor) | Measures the build artifacts of the repository, shows them on the status line from 5 GB, and deletes the ones you pick in the `/janitor` pane; data directories are never listed. | L2 |
| [contract-watch](plugins/contract-watch) | After the model changes a function signature with Edit, adds the callers ripwire finds to the Edit's result, so the model fixes them before the build does. | L2 |
| [doc-drift-watch](plugins/doc-drift-watch) | After each commit the model makes, adds the doc lines that commit made stale (file:line references, symbol names) to the commit's result, from ripwire doc-drift. | L2 |
| [prompt-deck](plugins/prompt-deck) | Learns the short prompts you send often and draws the top five above the prompt; with the prompt box empty, a digit key sends one at once. | L2 |

gemini-compact, gemini-advisor, gemini-review and gemini-plan-review depend on gemini-core, which holds their keys, tier, models and thinking levels. `claude plugin install` adds gemini-core with them; `claude plugin update` does not (measured on 2.1.278), so after an update from a version without it, run `claude plugin install gemini-core@kilimcininkoroglu-mods` once, then set the key in gemini-core again, because the old `apiKey` option of the Gemini mod is no longer read.

## Layout

```
.claude-plugin/marketplace.json   marketplace manifest, one entry per mod
plugins/<mod>/                    one directory per mod
  .claude-plugin/plugin.json      plugin manifest
  hooks/hooks.json                names the module: "modules": ["./register.ts"]
  hooks/register.ts               exports register(on, options); register.tsx in a mod that draws
  types/index.d.ts                a noun or tool input the mod declares, when it has one
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
