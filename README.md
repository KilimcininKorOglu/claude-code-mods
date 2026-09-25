# claude-code-mods

Claude Mods for Claude Code. A Claude Mod is a Claude Code plugin whose `hooks/hooks.json` names a TypeScript module. The module exports `register(on, options)`, where `options` holds the plugin's `userConfig` values, and each hook is `on("event", matcher, async ($, e, next) => result)`. `$` is the engine interface, `e` is the event, and `next(e)` runs every hook beneath and then the engine.

Function hooks are early access. Nothing loads unless `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set, and the API can change between releases.

Every mod has a page of its own at [cc-mods.keremgok.tr](https://cc-mods.keremgok.tr), in English and in Turkish. The site is built from this repository: a mod's `README.md` is its English page and its `README.tr.md` the Turkish one, so a push to `main` publishes both.

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
| [task-poke](plugins/task-poke) | Submits a continue prompt while the task list has unfinished tasks, at most 99 times in a row. | L2 |
| [limit-watch](plugins/limit-watch) | Shows the 5-hour and 7-day usage limits under the prompt with a reset countdown and a forecast, opens a `/limit-watch` pane, and warns at 80% and 95%. | L0 |
| [memory-save](plugins/memory-save) | Loads `MEMORY.md` into the session and saves project learnings to it after every turn through a tool-less fork in the background, without blocking the stop. | L2 |
| [cache-warm](plugins/cache-warm) | Keeps the 1-hour prompt cache warm for a window you set, or with no end in every session under `always`, with one fork per idle stretch, and shows the cache state, the cold price and this session's cold writes. | L2 |
| [prompt-time](plugins/prompt-time) | Draws the time under each of your messages and each text block of the model's replies, also for a resumed session whose transcript is under 4 MiB. | L1 |
| [gemini-compact](plugins/gemini-compact) | Moves compaction from Claude to Gemini: a Gemini summary with the newest messages verbatim, or Gemini decisions that keep, cut or drop older tool calls. | L3 |
| [gemini-advisor](plugins/gemini-advisor) | Gives the model a Gemini advisor tool it calls by itself: Gemini reads the conversation and the model's message and answers with a second opinion. | L3 |
| [gemini-core](plugins/gemini-core) | Keeps the Gemini keys and tier of every Gemini mod, and each mod's model and thinking level, in one place, builds their Gemini requests, and picks a model from Google's list. | L3 |
| [gemini-review](plugins/gemini-review) | Has Gemini review every commit the model makes, from the diff and the conversation, and stops a commit with a blocking finding. | L3 |
| [gemini-plan-review](plugins/gemini-plan-review) | Has Gemini review each plan before the approval dialog, from the plan and the conversation, and sends a plan with a blocking finding back to the model, at most twice. | L3 |
| [flaky-memory](plugins/flaky-memory) | Remembers which tests failed on which code, and tells the model when a failing test has both passed and failed on the same code, so it runs the test again instead of changing code. | L2 |
| [disk-janitor](plugins/disk-janitor) | Measures the build artifacts of the repository, shows them on the status line from 5 GB, and deletes the ones you pick in the `/disk-janitor` pane; data directories are never listed. | L2 |
| [contract-watch](plugins/contract-watch) | After the model changes a function signature with Edit, adds the callers [ripwire](https://github.com/redhat-et/ripwire) finds to the Edit's result, so the model fixes them before the build does. | L2 |
| [doc-drift-watch](plugins/doc-drift-watch) | After each commit the model makes, adds the doc lines that commit made stale (file:line references, symbol names) to the commit's result, from [ripwire](https://github.com/redhat-et/ripwire) doc-drift, and holds each doc open until it holds again. | L2 |
| [prompt-deck](plugins/prompt-deck) | Learns the short prompts you send often in this project and draws them, with the ones you pin by hand, above the prompt; with the prompt box empty, a digit key sends one at once. | L2 |
| [config-parse](plugins/config-parse) | Parses each JSON, YAML, TOML or `.env` file an Edit or Write touches, notes the parse error at once, and says so again when a later edit fixes it. | L2 |
| [prompt-offload](plugins/prompt-offload) | Writes a prompt longer than the limit to a temp file and sends the model its first 200 characters with the path, so one paste does not fill the context. | L2 |
| [shot-inline](plugins/shot-inline) | Draws each PNG or JPG the model saves or reads (Playwright screenshot, Read, a Bash command) under its tool row: pixels in a terminal with the kitty graphics protocol, half-block cells in every other one. | L2 |
| [diagram-render](plugins/diagram-render) | Renders the mermaid blocks of the model's replies with an installed `mmdc` after each turn and draws each picture under its reply. | L2 |
| [dep-sentinel](plugins/dep-sentinel) | Checks each package the model installs against its registry and OSV.dev, and stops a missing, brand-new, look-alike, outdated or vulnerable one, naming the latest version. | L3 |
| [edit-loop](plugins/edit-loop) | Adds a note to the fifth edit of one file in one turn, so the model re-reads the code path and states the root cause instead of trying again. | L2 |
| [i18n-watch](plugins/i18n-watch) | After an edit that calls translation keys, names the keys the JSON, Laravel PHP, YAML or gettext locale files lack, and the languages that lack them. | L2 |
| [env-sync](plugins/env-sync) | After each commit the model makes, names the env variables its added lines read that `.env.example` lacks, with the file and line of each. | L2 |
| [sql-concat-watch](plugins/sql-concat-watch) | After an edit that builds SQL by joining or interpolating strings, names each line, so the model passes the values as query parameters. | L2 |
| [storage-guard](plugins/storage-guard) | After an edit that keeps browser data in `localStorage` or `sessionStorage`, names each line, so the model stores the data in a cookie instead. | L2 |
| [lockfile-sync](plugins/lockfile-sync) | After each commit the model makes, names the manifests whose dependencies it changed without their lockfile (npm, Composer, Cargo, Go, Python, Bundler, Dart, Mix). | L3 |
| [bg-tasks](plugins/bg-tasks) | Shows the running background shell tasks on the status line with the oldest one's age, and stops one from the `/bg-tasks` pane. | L2 |
| [sidebar](plugins/sidebar) | Opens one shared pane beside the transcript and draws the sections, lines and buttons every other mod writes into it through `$.sidebar`; each finding is stamped with its time and kept in a per-project log the next session takes back. | L2 |
| [action-pin](plugins/action-pin) | After an edit that adds a GitHub Actions step pinned to a tag or a branch, names each one with the commit SHA to write instead, from the GitHub API. | L3 |
| [error-poke](plugins/error-poke) | Submits one continue prompt after a turn an API error killed, so the half-done work carries on instead of the session going idle, at most 99 times in a row. | L2 |
| [output-flood](plugins/output-flood) | Measures how much context each Bash command spent and tells the model, past a size limit, which narrower command would have answered the same question. | L1 |
| [ua-fallback](plugins/ua-fallback) | After a `curl` or `wget` an automated-client filter answered 403 or 429, gives the model the browser User-Agent to retry with, and the two cases where it must not. | L1 |
| [commit-cadence](plugins/commit-cadence) | Measures the working tree at the end of each turn, names the uncommitted files to you, and tells the model at the next prompt to commit each finished piece as it lands. | L2 |
| [context-restore](plugins/context-restore) | Hands a skill or command call the current text of its file when the file changed on disk after the session loaded it, and hands the model a rules file or the global CLAUDE.md that changed on disk. | L1 |
| [mod-doctor](plugins/mod-doctor) | Names each installed plugin, of every marketplace, whose local clone already offers a newer version, with the `claude plugin update` command that closes the gap. | L1 |
| [subagent-ledger](plugins/subagent-ledger) | Shows each subagent of the session with its turns, time, model and tokens, the costliest first, yellow while it runs and green once it answered, and marks one that passed the token limit. | L0 |
| [mcp-doctor](plugins/mcp-doctor) | Tells you when an MCP server failed to connect or dropped, with the engine's reason and a reconnect button, and when it is back; claude.ai connectors are left out. | L2 |
| [orphan-server](plugins/orphan-server) | Lists the servers a Bash call of the model started in this repository and left listening on a port, with their age and session, and stops one with SIGTERM, then SIGKILL. | L2 |
| [slash-chain](plugins/slash-chain) | Runs slash commands joined with `&&` one after another, waits for each command's turn, pane or dialog to end, and stops the chain at a command that failed or a turn that ended without an answer. | L2 |
| [desk-notify](plugins/desk-notify) | Sends a desktop notification when a question or a plan waits for your answer, and when a turn ends or fails. | L2 |

Ten of these mods hold their findings open and share one setting, `/<mod> mode note | deny`: config-parse, env-sync, i18n-watch, lockfile-sync, dep-sentinel, sql-concat-watch, storage-guard, contract-watch, action-pin and doc-drift-watch. In `note` mode, the default, a finding only reaches the model and the transcript. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while one of its findings stands, and says which. Before it stops a command it measures its own findings again, so a finding the model fixed opens the gate itself. Each mod holds its own gate, so the first one with a finding stops the command and the next speaks at the following attempt. There is no bypass: only the person turns a gate off, with `/<mod> mode note`.

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
  README.tr.md                    the same README in Turkish, kept in step with it
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
