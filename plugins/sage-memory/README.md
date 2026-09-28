# sage-memory

Keeps project and global memories in SQLite through a shared local daemon, hands the model the entries that match its file tool calls, prompts and subagent tasks, and saves new ones with a haiku consolidator after each main-loop turn.

It runs beside [memory-save](../memory-save): memory-save hands the model all of `MEMORY.md` at a session's start, sage-memory hands it one memory at the moment it matters. A memory the context already shows (`MEMORY.md`, `CLAUDE.md`, a tool result) is not handed again.

## What it does

1. **One daemon for every session.** At session start the mod checks Node (22.18 or later, with built-in TypeScript and `node:sqlite`), then runs `node daemon/launch.ts`, which starts `daemon/server.ts` detached, or finds the one already running. The daemon listens on a Unix socket, answers only a request that carries its random token, and closes itself five minutes after its last request.
2. **Two stores.** `~/.claude/sage-memory/global.db` holds the `user` memories. `~/.claude/sage-memory/<project>/sage.db` holds the `project`, `session`, `file` and `symbol` memories of one repository; linked worktrees share it. The name is `<repository>-<8 hex of the git common dir>`.
3. **Memory reminders.** A reminder is a block of `<memory>` entries the model reads as saved project memory, framed by a note in the system prompt:
   - on the result of each file tool (Read, Grep, Glob, LSP, Edit, Write, NotebookEdit, and MCP tools that name a file), the memories anchored to the paths that call touched or to a directory above them (any level, `src` included) and related to the tasks in progress, fewer as the context fills (8 under 65%, 3 up to 82%, 1 up to 95%, none above). The model reads them right after that result. Two memories of one file (one per function, say) both go; one memory that parallel calls both find goes with one of them;
   - with a prompt you type, the memories that match it, at most 8;
   - to a subagent, in front of its task: the memories written for its type or permission mode, then the ones about its task.

   No memory is sent at every start the way memory-save sends `MEMORY.md`: each one goes only when it is relevant. Each memory goes once per context. A compaction starts a new context, so it can go again. An answer that uses a reminded memory counts as a use.
4. **Learning.** After a main-loop turn that had your prompt or a tool call, a consolidator (haiku by default) reads the answer, the files the turn read and wrote, its last 10 Bash commands and the completed tasks, and adds what is worth keeping, in English. After a turn that wrote files, a curator reviews the memories of those files: it supersedes, merges, recalibrates, marks a contradiction or archives. A permanent memory is never superseded, contradicted or archived.
5. **Checking.** An edit checks the memories anchored to the changed file again (path, content hash, symbol, command, agent, git blob), and a memory whose anchor no longer holds goes stale. A `mv`, `git mv` or `Move-Item` moves the anchors with the file once the move is on disk. At a session's end the daemon runs hygiene in the background, at most once an hour per store: verification, duplicates, contradictions, review proposals and the removal of session memories whose transcripts are gone.
6. **Search.** Full text search (FTS5) always. After `/sage-memory setup`, also a multilingual embedding model (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`), offline, so a question can find a memory in another language. A result from this channel alone needs a cosine of 0.46; a paraphrase below it is left to the full text search and the anchors (measured: `deploy.sh betiği nerede` found `Deploys go through the deploy.sh script...` at 0.55, `Uygulamayı sunucuya nasıl gönderiyoruz?` stayed under 0.46).

## The sidebar

While the [sidebar](../sidebar) is open, the mod keeps one `memory` section there, with a `manage` button that opens the pane:

    sage-memory: memory
    daemon ready · my-app · embeddings off · /sage-memory setup
    this session: reminded 4 · used 1 · added 2
    [ manage ]

Under it, the stream shows each reminder (faint), each added memory (green), each check and each failure (red). With the sidebar closed, the first line goes to the status line and the stream lines to the transcript.

## The pane

`/sage-memory pane`, or the `manage` button, opens the memory manager, and again closes it. It has a search field, a scope filter and a status filter, and lists 30 memories a page (`next`, `previous`). Enter on a row shows the memory with its buttons: `mark stale`, `make active`, `archive`, `permanent`, `delete` (asks for a second press) and, for a deleted memory, `recover`. `candidates` lists the pending proposals: accept or reject a new memory, and resolve a review with `delete`, `archive` or `keep`.

## Command

    /sage-memory                          the state
    /sage-memory on | off                 turn the mod on or off in every window
    /sage-memory setup                    install the embedding runtime and model, and embed every memory
    /sage-memory pane                     the memory manager
    /sage-memory show <id> | search <query> | file <path> | graph <id|query> | audit [n] | stats
    /sage-memory remember [flags] <text>  write a memory; `--scope session` belongs to this session
    /sage-memory update <id> [flags] [text]
    /sage-memory delete <id> | forget <query> | recover <id>
    /sage-memory audience remember --role <type> <text> | clear <id> | transfer <from> <to>
    /sage-memory hygiene | verify [id] | candidates [list|accept|reject|resolve]
    /sage-memory triage [apply]           a review of every memory; a dry run unless `apply`
    /sage-memory compact [apply]          a proposal to shorten and merge; `apply` writes it
    /sage-memory import <path> [--section <heading>] [--kind <kind>] [--scope project|user]
    /sage-memory model [name]             the model of the consolidator, curator, triage and compact (haiku)
    /sage-memory remind tools|prompt|subagent [on|off]
    /sage-memory consolidate|curate [on|off]
    /sage-memory daily [on|off]           a triage dry run once a day, an hour after a start (off)
    /sage-memory capture outcomes|errors [on|off]   remember Bash results (off)

Flags: `--kind --scope --status --persistence --policy --tag --anchor --directory --symbol path#Name --command --agent --role --mode --importance --confidence --freshness --supersedes --contradicts`.

`import` writes each bullet of a markdown file, or of one section under a heading, as an ordinary memory with the file as its source. It moves notes kept in another file into the store once; the imported memories are then reminded by relevance like any other.

## Tools the model can call

Fifteen tools, `mcp__sage-memory__<name>`: `remember`, `search`, `search_explain`, `for_file`, `for_path`, `graph`, `gather`, `update`, `delete`, `forget`, `recover`, `backfill_recoverable`, `verify`, `hygiene`, `candidates`. `remember` and `search` are listed at once, the rest wait behind ToolSearch. None asks for approval: each writes only to the mod's own stores. A session memory belongs to the session that wrote it.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sage-memory@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Have Node.js 22.18 or later as `node` on the `PATH`. An older Node shows `daemon failed: needs Node.js 22.18 or later ...` and the mod does nothing else.
3. Optional: run `/sage-memory setup` once for the embedding search. It runs `npm install` of `@huggingface/transformers` 4.3.0 into `~/.claude/sage-memory/runtime` and downloads the model: 615 MB on disk together, 145 MB of it the model (measured). With the model loaded the daemon held 648 MB of resident memory (measured). Without it, search is full text only.
4. Optional: import the notes of a markdown file with `/sage-memory import` (see Command).
5. To remove every memory, delete `~/.claude/sage-memory` while no session runs.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283 (the validator cuts the `calls:` line itself):

    ❯ ./register.tsx hooks: session.start, tool.describe{tool=/"^mcp__sage-memory__"/}, tool.check{tool=/"^mcp__sage-memory__"/}, tool.call{tool=/"^mcp__sage-memory__"/}, prompt.section{name=env_info_simple}, classic.SessionStart, session.compact, prompt.context, prompt.attachment, classic.PostToolBatch, tool.call{tool=/"^(Read|Grep|Glob|LSP|Edit|Write|NotebookEdit|MultiEdit|mcp__(?!sage-memory__).+)$"/}, prompt.submit, agent.spawn, turn.complete, tool.call{tool=/"^(Edit|Write|NotebookEdit|MultiEdit)$"/}, tool.call{tool=Bash}, session.end, command.run{command=sage-memory}, ui.render{component=Pane}, ui.close, turn.start
    ❯ ./register.tsx calls: $.clock.after (via scheduleDaily, within), $.clock.every (via pollSetup), $.clock.now (via captureOutcome, consolidate, dailyRun, fileProposals, scheduleDaily, triageReport), $.command.register, $.env.get (via layoutFor), $.fs.read (via importCommand, launch), $.http.fetch (via send), $.model.complete (via answerOf, consolidate, curate, proposeCompact), $.process.run (via checkNode, git, launch), $.session.cwd, $.session.id (via afterCall, beforePrompt, captureOutcome, consolidate, countUse, curate, forSubagent, importCommand, newContext, record, remapMoved, rememberCommand, send, serveTool, verifyChanged), $.session.usage (via budgetOf), $.sidebar.set (via toPerson, toStream), $.store.get (via afterCall, beforePrompt, captureOutcome, consolidate, curate, dailyRun, forSubagent, jobModel, onByDefault, readEnabled, scheduleDaily, toggle), $.store.set (via dailyRun, modelCommand, onByDefault, setEnabled, toggle), $.tool.call (via taskList), $.tool.register (via decla… [+212 chars]

Reach L3, starts a long-lived local process, sends turns to a model, and downloads packages and a model on `/sage-memory setup`.

    1. Reads:    the answers, prompts, subagent tasks and file tool calls of the session; the files a memory is anchored to; the markdown file you import; the transcripts directory, to find ended sessions
    2. Runs:     node (the version check, the launcher, the daemon), git rev-parse and git hash-object, npm install on setup; all by argv, no shell
    3. Sends:    each consolidated turn, curated file set, triage and compact request to the model you set (haiku by default); on setup, requests to the npm registry and Hugging Face; the daemon itself listens only on a Unix socket in ~/.claude/sage-memory
    4. Persists: the memories, their graph, audit log and reminder ledger in SQLite under ~/.claude/sage-memory; the settings in the mod's $.store
    5. Hostile input: a memory is text a model or a tool wrote, handed back inside an escaped <memory> fence; a text that looks like a secret is refused at write; a memory changes only through the daemon, which checks each request's token

## Measured

**Where a tool reminder goes.** On Claude Code 2.1.283 (Sonnet 5), with the memory written before a `/clear` and the prompt reminder off, 10 runs each: attached after the whole tool batch, the model called the memory a suspicious instruction or a prompt injection 4 times; attached to the file tool's own result, once. It used the memory's facts as often either way (4 of 5 in the scenario where the memory held). Version 0.2.0 moved the reminder to the result.

On Claude Code 2.1.283, macOS, Node 24.18: a daemon request over the socket took 3 to 9 ms (`/status` 7.0 ms, `/memory/remember` 9.3 ms, `/remind/prompt` 2.9 to 3.7 ms, `/remind/tools` 3.5 ms); setup embedded 24 memories in 19 s after the install. One daemon served every probe session in a row. The consolidator's token cost per turn was not measured.

## Limits

- macOS and Linux only: the daemon uses a Unix socket, and a socket path over about 100 bytes stops the mod.
- An anchorless memory with default scores is rarely reminded: the reminder gate needs a score of 0.65.
- Without embeddings, a question in one language finds a memory in another only through shared terms.
- Claude Code's LSP tool has no rename, so a renamed symbol does not move its anchor.

## Development

    make install     # eslint, typescript-eslint, typescript, @types/node
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # the hooks and the daemon; needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test, then node --test for the daemon
