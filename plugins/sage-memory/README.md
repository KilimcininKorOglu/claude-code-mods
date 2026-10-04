# sage-memory

A memory file loaded whole at every start grows until it fills the context, and the one note that matters for the file you are editing sits somewhere in the middle of it. This mod keeps project and global memories in SQLite through a shared local daemon, hands the model the entries that match its file tool calls, prompts and subagent tasks, and saves new ones with a haiku consolidator after each main-loop turn.

It runs beside [memory-save](../memory-save): memory-save hands the model all of `MEMORY.md` at a session's start, sage-memory hands it one memory at the moment it matters. A memory the context already shows (`MEMORY.md`, `CLAUDE.md`, a tool result) is not handed again.

## What it does

1. **One daemon for every session.** At session start the mod checks Node (22.18 or later, with built-in TypeScript and `node:sqlite`), then runs `node daemon/launch.ts`, which starts `daemon/server.ts` detached, or finds the one already running. The daemon listens on a Unix socket, answers only a request that carries its random token, and closes itself five minutes after its last request.
2. **Two stores.** `~/.claude/sage-memory/global.db` holds the `user` memories. `~/.claude/sage-memory/<project>/sage.db` holds the `project`, `session`, `file` and `symbol` memories of one repository; linked worktrees share it. The name is `<repository>-<8 hex of the git common dir>`.
3. **Memory reminders.** A reminder is a block of `<memory>` entries the model reads as saved project memory, framed by a note in the system prompt. Each entry names its id, kind, scope and status, and, when they apply, its priority (`critical` at importance 0.9, `high` at 0.75), a `permanent` persistence, its first anchor (`about`) and its first three tags:
   - on the result of each file tool (Read, Grep, Glob, LSP, Edit, Write, NotebookEdit, and MCP tools that name a file), the memories anchored to the paths that call touched or to a directory above them (any level, `src` included) and related to the tasks in progress, fewer as the context fills (8 under 65%, 3 up to 82%, 1 up to 95%, none above). The model reads them right after that result. Two memories of one file (one per function, say) both go; one memory that parallel calls both find goes with one of them. A memory `related` to one found this way comes along too, even without a shared anchor. The path goes into the query relative to the project root, so the root's own words (home directory, repository name) match no memory;
   - with a prompt you type, the memories that match it, at most 8;
   - to a subagent, in front of its task: the memories written for its type or permission mode, then the ones about its task.

   A `user` memory is a global rule, so it does not wait to be relevant: every active `user` memory goes with the first prompt of a context, whatever the prompt asks, with no count or size limit, and in front of every subagent's task. A compaction starts the context over, so they go again with the next prompt, or with the first file tool when the compaction came in the middle of a turn. A `user` memory written for one audience, or set to the `never` policy, keeps its own path. A `project` memory goes only when it is relevant. Each memory goes once per context. A compaction starts a new context, so it can go again. An answer that uses a reminded memory counts as a use. The global rules count toward no memory's reminders, because they go whatever the context asks. A reminder without a counted use lowers no memory's rank and opens no review, because the use count is a floor (see The sidebar).
4. **Learning.** After a main-loop turn that had your prompt or a tool call, a consolidator (haiku by default) reads what you wrote since the last consolidation (your last 3 prompts), the answer, the files the turn read and wrote, its last 10 Bash commands and the completed tasks, and adds what is worth keeping, in English: a decision and its reason, the cause of a bug, a limitation, a gap that stays open, a standing preference or a step still owed. It labels every candidate first and writes only the ones it marked keep, so a report of what the turn did, a plan, a status line or what the code already shows is not saved. A turn whose evidence reaches 20 paths consolidates once mid-turn instead of waiting for its end, and the turn-end pass still covers the whole turn. While a store holds fewer than 20 project entries, the consolidator also keeps what a first scan teaches (the stack, the layout, the tools, the conventions), which the base prompt drops as code-shown; the system note asks the model to save such facts itself, mid-turn. A new memory may name up to three existing entries of its own scope as `related`: the same decision, bug or rule from another side, never only the same file. Unlike SAGE, it writes no session digest of each answer: those digests were most of what triage found as noise. The consolidator also reads the memories relevance reminded the main loop of since the last consolidation (at most 20, not the global rules) and names the ones the turn acted on, whatever the language of the memory or the answer. For now that verdict goes to the audit log alone (`memory.judged`) and counts no use, until it is measured against real turns. After a turn that wrote files, a curator reviews the memories of those files against what the turn changed: it rewrites a memory whose value changed (a limit that went from 15 to 20), deletes one the turn made wrong or that another shown memory contradicts, merges or splits, recalibrates the scores, and links or unlinks two of the memories it was shown. A link stays inside one store, and deleting either memory removes it. A permanent memory is never rewritten or deleted.
5. **Fixing.** A wrong memory is deleted, not kept: a memory that is no longer true keeps misleading every later session. The system prompt note tells the model to fix a memory it found wrong at once, with `update` when it knows the current fact and with `delete` otherwise, and each such fix is a line in the stream. A deleted memory stays recoverable with `recover`.
6. **Checking.** An edit checks the memories anchored to the changed file again (path, content hash, symbol, command, agent, git blob), and a memory whose anchor no longer holds goes stale. A `mv`, `git mv` or `Move-Item` moves the anchors with the file once the move is on disk. At a session's end the daemon runs hygiene in the background, at most once an hour per store: verification, duplicates, contradictions, review proposals and the removal of session memories whose transcripts are gone.
7. **Search.** Full text search (FTS5) always. After `/sage-memory setup`, also a multilingual embedding model (`Xenova/paraphrase-multilingual-mpnet-base-v2`), offline, so a question can find a memory in another language. A result from this channel alone needs a cosine of 0.46; a paraphrase below it is left to the full text search and the anchors (measured on this model: `deploy.sh betiği nerede` found `Deploys go through the deploy.sh script...` at 0.68, `gemini key'ini nereye yazayım?` against its own memory at 0.41).

## The sidebar

While the [sidebar](../sidebar) is open, the mod keeps one `memory` section there, with a `manage` button that opens the pane:

    sage-memory: memory
    daemon ready · my-app
    embeddings off · /sage-memory setup
    this project: 2031 active · global: 12 active
    this session: reminded 4 · added 2 · used 1 · global rules 40
    [ manage ]

The first line says the daemon answers and names the project; the second names the embeddings model, yellow when it failed. It reads `embeddings available` while the model is installed but not loaded yet: the daemon loads it at its first search or write, and the next draw names it. The third line counts the active memories of this project's store and of the global store, read from the daemon at each draw of the section. An interactive session reads the embeddings state and the counts again and draws the section every 60 s, so a model another window loaded and a memory another session or project saved shows while this one is idle. That read is a request, so the daemon stays up while an interactive session is open. The global store holds the `user` memories, which every project is reminded of; the project count is green, the global count blue. The fourth line counts what this session did: the memories it was reminded of by relevance, the ones the model or the consolidator added, the ones it used, and the global rules sent to its contexts. The rules are counted apart, because they go whatever a context asks. Each count is drawn in its own colour: reminded blue, added green, used yellow, rules faint. A reminded memory counts as used once: when the answer names its id, or when a later successful tool call acts on its anchor, an edit of its file or of a file under its directory, or a Bash command that holds its anchored command (4 characters or more). Words the answer shares with a memory are not counted: they depend on the language each is written in, and an answer that says a memory is wrong shares them too. A read is not counted, because reading the file is what brings its memories. The count is a floor: a note the model follows without naming its id or touching its anchor is not counted.

While the jobs after a main-loop turn run, a blue fifth line names the one under way: `consolidating…` while the consolidator's model answers, `saving 2 memories…` while it writes what it kept, `curating 3 memories…` while the curator audits the memories of the files the turn wrote. The line goes once the jobs end.

Under it, the stream shows each reminder faint, with only the word `reminded` in blue. Each change to a memory, made by the model, the consolidator, the curator or a check, is a line in which only the word that says what happened is coloured: added green, changed yellow (updated, merged, gone stale, moved), deleted red. A failure is a red line; an empty model reply is retried once with a doubled token budget before that line is written, because a thinking job model can spend the whole budget on its reasoning and leave no text. With the sidebar closed, the first line goes to the status line and the stream lines to the transcript.

## The pane

`/sage-memory pane`, or the `manage` button, opens the memory manager, and again closes it. It has a search field, a scope filter and a status filter, and lists 30 memories a page (`next`, `previous`). Enter on a row shows the memory with its buttons: `mark stale`, `make active`, `archive`, `permanent`, `delete` (asks for a second press) and, for a deleted memory, `recover`. `candidates` lists the pending proposals: accept or reject a new memory, and resolve a review with `delete`, `archive` or `keep`.

## Command

    /sage-memory                          the state
    /sage-memory on | off                 turn the mod on or off in every window
    /sage-memory setup                    install the embedding runtime and model, and embed every memory
    /sage-memory pane                     the memory manager
    /sage-memory show <id> | search <query> | file <path> | graph <id|query> | audit [n] | stats
    /sage-memory remember [flags] <text>  write a memory; `--scope session` belongs to this session
    /sage-memory update <id> [flags] [text]  `--scope project|user` moves the memory to that store
    /sage-memory delete <id> | forget <query> | recover <id>
    /sage-memory audience remember --role <type> <text> | clear <id> | transfer <from> <to>
    /sage-memory hygiene | verify [id] | candidates [list|accept|reject|resolve]
    /sage-memory triage [apply]           a review of every memory that lists each change; a dry run unless `apply`
    /sage-memory compact [apply]          a proposal to shorten and merge; `apply` writes it
    /sage-memory import <path> [--section <heading>] [--kind <kind>] [--scope project|user] [--policy auto|never] [--tag <tags>] [--importance <n>] [--confidence <n>]
    /sage-memory model [name]             the model of the consolidator, curator, triage and compact (haiku)
    /sage-memory remind tools|prompt|subagent [on|off]
    /sage-memory consolidate|curate [on|off]
    /sage-memory daily [on|off]           a hygiene and an applied triage once a day, an hour after a start (on)
    /sage-memory capture outcomes|errors [on|off]   remember Bash results (off)

Flags: `--kind --scope --status --persistence --policy --tag --anchor --directory --symbol path#Name --command --agent --role --mode --importance --confidence --freshness --supersedes --contradicts`.

`triage` sorts every memory by rules, a value score and a rating from the model, then lists what `apply` would write: each deletion with its reason, each merge, each score patch, and a review for a memory of importance 0.9 or more, which it never deletes. A memory the model rated 1 or 2, and debris the rules or the score find (a `wip:` note, an expired one), is deleted. SAGE also kept every memory an answer had used; that rule is gone, because an answer that names a memory to say it is wrong counts as a use.

`import` writes each bullet of a markdown file, or of one section under a heading, as an ordinary memory with the file as its source. It moves notes kept in another file into the store once; the imported memories are then reminded by relevance like any other. A section whose heading says "retired" is left out with its subsections. An imported memory starts at importance 0.8 and confidence 0.9, because it is a rule you kept by hand: with the defaults of `remember` (0.6 and 0.75) an imported note a question named stayed just under the prompt reminder's gate. The report counts what the daemon did with each bullet (added, already there, folded into a near-duplicate, refused) and names every fold, because a fold keeps one of the two texts. Measured on the 13 memory-save files of this repository: 2093 bullets became 2000 memories, 0 refused, 11 already there and 82 folded; nearly every fold was the same fact written twice.

## Import from memory-save

`import` takes one file, and it writes into the store of the project the session was started in. To move a whole memory-save directory, open `claude` in the project's root directory and paste the prompt below. It needs the `self-command` mod, which lets the model run a slash command. The model runs one import per turn; each import's output comes back as the next prompt, so the chain goes on without you until the last file. The same prompt works unchanged in every project.

    Import this project's old memory-save files into sage-memory. Directory: ~/.cli-tweaks/memory/<name of the git root directory>/. First MEMORY.md, then every other .md file in the directory, in alphabetical order. Skip MEMORY.pre-migration.md, files that end with " 2.md", and .txt files. For each file, run the `sage-memory` command with mcp__self-command__run and the argument `import "<full path>"`. Run only one command per turn, then end the turn. When its output comes back as the next prompt, go on with the next file. If the directory does not exist or is empty, say so and stop. At the end, give the added, exact and near counts of every file as a table.

Each file costs one turn, so a project with 20 topic files takes 20 turns. The directory name comes from the git root, not from the directory you opened `claude` in. When a memory-save directory is named differently from its repository, the model says the directory does not exist and stops; write the path into the prompt yourself then.

## Tools the model can call

Fifteen tools, `mcp__sage-memory__<name>`: `remember`, `search`, `search_explain`, `for_file`, `for_path`, `graph`, `gather`, `update`, `delete`, `forget`, `recover`, `backfill_recoverable`, `verify`, `hygiene`, `candidates`. `remember`, `search`, `for_file`, `update` and `delete` are listed at once, the rest wait behind ToolSearch. The system prompt's note about the plugin tells the model to look further with `search` and `for_file`, to fix a wrong note with `update` or `delete`, and to save a durable rule, decision, warning or root cause at once with `remember`, without waiting for the turn to end: with scope `project` and an anchor for a fact about the repository, with scope `user` and no anchor for a preference that holds in every project. The note also tells it to pick the scope from the reason behind a rule, not from how strongly you said it. `update` with `scope` moves a project memory to the user store or back under the same id, and the store it left keeps no copy; a move to `user` drops the path anchors, and a `file_note` or `symbol_note` left without an anchor needs another kind in the same call. A session memory does not move. A tool call with a field its schema does not name is refused with the list of its fields, so a wrong call does not answer as a success. None asks for approval: each writes only to the mod's own stores. A session memory belongs to the session that wrote it.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sage-memory@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code.
2. Have Node.js 22.18 or later as `node` on the `PATH`. An older Node shows `daemon failed: needs Node.js 22.18 or later ...` and the mod does nothing else.
3. Optional: run `/sage-memory setup` once for the embedding search. It runs `npm install` of `@huggingface/transformers` 4.3.0 into `~/.claude/sage-memory/runtime` and downloads the model: 760 MB on disk together, 289 MB of it the model (measured). A process with the model loaded held 1.2 GB of resident memory (measured once). Without it, search is full text only. The model of an earlier setup stays under `~/.claude/sage-memory/runtime/models/Xenova/` and can be deleted once a search has answered.
4. Optional: import the notes of a markdown file with `/sage-memory import` (see Command).
5. To remove every memory, delete `~/.claude/sage-memory` while no session runs.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.289 (the validator cuts the `calls:` line itself):

    ❯ ./register.tsx hooks: session.start, tool.describe{tool=/"^mcp__sage-memory__"/}, tool.check{tool=/"^mcp__sage-memory__"/}, tool.call{tool=/"^mcp__sage-memory__"/}, prompt.section{name=env_info_simple}, classic.SessionStart, session.compact, prompt.context, prompt.attachment, classic.PostToolBatch, tool.call{tool=/"^(Read|Grep|Glob|LSP|Edit|Write|NotebookEdit|MultiEdit|mcp__(?!sage-memory__).+)$"/}, prompt.submit, agent.spawn, turn.complete, tool.call{tool=/"^(Edit|Write|NotebookEdit|MultiEdit)$"/}, tool.call{tool=Bash}, session.end, command.run{command=sage-memory}, ui.render{component=Pane}, ui.close, turn.start
    ❯ ./register.tsx calls: $.clock.after (via afterAnswer, noteBatch, scheduleDaily, within), $.clock.every, $.clock.now (via captureOutcome, dailyRun, fileProposals, scheduleDaily, triageReport), $.command.register, $.env.get (via layoutFor), $.fs.read (via importCommand, launch), $.http.fetch (via send), $.model.complete (via answerOf, completeWithRetry, proposeCompact), $.process.run (via checkNode, git, launch), $.session.cwd, $.session.id (via afterCall, captureOutcome, consolidate, countUse, curate, importCommand, newContext, promptRelated, record, remapMoved, rememberCommand, send, serveTool, subagentRanking, verifyChanged), $.session.usage (via budgetOf), $.sidebar.set (via toPerson, toStream), $.store.get (via afterCall, captureOutcome, consolidate, curate, dailyRun, isDailyOn, jobModel, onByDefault, promptRelated, readEnabled, scheduleDaily, subagentRanking, toggle), $.store.set (via dailyRun, modelCommand, onByDefault, setEnabled, toggle), $.tool.call (via taskList), $.tool.regis… [+226 chars]
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: CLAUDE_CONFIG_DIR, HOME

Reach L3, starts a long-lived local process, sends turns to a model, and downloads packages and a model on `/sage-memory setup`.

    1. Reads:    the answers, prompts, subagent tasks and file tool calls of the session; the files a memory is anchored to; the markdown file you import; the transcripts directory, to find ended sessions
    2. Runs:     node (the version check, the launcher, the daemon), git rev-parse and git hash-object, npm install on setup; all by argv, no shell
    3. Sends:    each consolidated turn, curated file set, triage and compact request to the model you set (haiku by default); on setup, requests to the npm registry and Hugging Face; the daemon itself listens only on a Unix socket in ~/.claude/sage-memory
    4. Persists: the memories, their graph, audit log and reminder ledger in SQLite under ~/.claude/sage-memory; the settings in the mod's $.store
    5. Hostile input: a memory is text a model or a tool wrote, handed back inside an escaped <memory> fence; a text that looks like a secret is refused at write; a memory changes only through the daemon, which checks each request's token

## Measured

**Where a tool reminder goes.** On Claude Code 2.1.283 (Sonnet 5), with the memory written before a `/clear` and the prompt reminder off, 10 runs each: attached after the whole tool batch, the model called the memory a suspicious instruction or a prompt injection 4 times; attached to the file tool's own result, once. It used the memory's facts as often either way (4 of 5 in the scenario where the memory held). Version 0.2.0 moved the reminder to the result.

On Claude Code 2.1.283, macOS, Node 24.18: a daemon request over the socket took 3 to 9 ms (`/status` 7.0 ms, `/memory/remember` 9.3 ms, `/remind/prompt` 2.9 to 3.7 ms, `/remind/tools` 3.5 ms); setup embedded 24 memories in 19 s after the install. One daemon served every probe session in a row.

**What the consolidator keeps.** On 17 labeled turns of real sessions, each sent to haiku 10 times: with SAGE's prompt, every run of the 7 turns that held nothing durable (a report of the turn's work, a plan, a status line) wrote at least one memory (0 of 70 runs clean), and 99 of 100 runs of the 10 turns that held a durable fact kept it. With the candidate labels of 0.2.1, 62 of 70 runs stayed clean and 97 of 100 kept the fact. A consolidation took 2,482 input and 438 output tokens on average, about $0.005 at haiku prices. On two of these turns, a work report and a plan, Opus 5.5 wrote nothing in 10 of 10 runs with SAGE's prompt, at $0.005 to $0.012 a call.

**The vector floor, re-measured on the model change.** On 2174 real memories, 15 targeted and 15 unrelated Turkish questions, at the floor of 0.46 the mpnet model reached 11 of the 15 targeted questions with their own memory and 1 unrelated question found some memory there; the MiniLM model it replaces passed 4 of the unrelated ones at the same floor. The multilingual-e5 family separates nothing on this absolute scale: its unrelated bests ran 0.72 to 0.81 against targeted owns of 0.76 to 0.86, which is why the model is mpnet and not e5.

## Limits

- macOS and Linux only: the daemon uses a Unix socket, and a socket path over about 100 bytes stops the mod.
- An anchorless memory with default scores is rarely reminded: the reminder gate needs a score of 0.65.
- Without embeddings, a question in one language finds a memory in another only through shared terms.
- Claude Code's LSP tool has no rename, so a renamed symbol does not move its anchor.

## Development

    make install     # eslint, typescript-eslint, typescript, @types/node
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # the hooks and the daemon; needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test, then node --test for the daemon
