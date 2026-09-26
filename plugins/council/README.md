# council

A Claude Code Mod that asks a council of models about a hard problem. Several models answer the same question on their own, and the model of the session, as the chair, writes one verdict from their answers. The model calls it through a tool when it is stuck, and you run it with `/council <question>`.

## What it does

1. The members are Opus 5.5, Sonnet 5, Fable 5.1 and Haiku 4.5, and `gemini-3.8-flash` when [gemini-core](../gemini-core) is installed and has a key. Without gemini-core, or without a key, the Gemini members are skipped and the result says why. `/council members` changes the list.
2. Every member is asked at once:
   - The member that runs on the session's own model forks the session with `$.model.fork`, so it reads the whole conversation from the prompt cache.
   - Every other Claude member gets the conversation as text through `$.model.complete`, at `high` effort. Over 400,000 characters the longest tool outputs are cut first, then the oldest messages are left out. Haiku 4.5 reads at most 560,000 characters, because its window is 200k tokens.
   - A Gemini member gets the same text through gemini-core, which holds the key, the tier and the thinking level. gemini-core 0.3.0 or later is needed, because each request names its own model.
3. The chair forks the session too. It reads the answers named by letter (`Member A`, `Member B`), not by model, and writes where the members agree, where they disagree and which side the conversation supports, what they missed, and the next step.
4. The caller reads the verdict and every answer, each headed with its letter, model and time. A member that failed is named with its reason. When no member answers, the call is refused with each reason, and no chair runs.
5. A call from a subagent sends no conversation, because a fork and `$.session.messages()` read the main thread. Every member and the chair then get the question alone, by completion.

## When the model calls it

The tool is `mcp__council__convene` with one `question` input. It is listed without ToolSearch, and a note in the system prompt tells the model when to call it:

- the same error survived two attempts to fix it;
- the root cause is still unclear after it investigated;
- it must choose between two designs that each have real trade-offs;
- before a change that is hard to undo.

The note is fixed at a session start and at `/clear`, so `/council on` gives the model the tool at once and the note from the next session. There is no limit on how often the model calls it.

## You see

With the [sidebar](../sidebar) open, a standing section follows the run: each member yellow while it runs, green with its time and tokens once it answered, red with the reason when it failed, the chair, and the verdict's first words:

    council: run
    avg.js boş dizi için ne dönmeli: NaN, 0, yoksa hata mı fırl… · done in 44s
    opus 5.5 · fork · answered 11s · 89k in, 902 out
    sonnet 5 · complete · answered 17s · 6.7k in, 1.1k out
    fable 5.1 · complete · answered 24s · 6.7k in, 1.4k out
    haiku 4.5 · complete · answered 9s · 5.2k in, 634 out
    gemini-3.8-flash · gemini · answered 8s · 4.7k in, 1.3k out · free tier
    chair · opus 5.5 · fork · done 20s

With the sidebar closed, one line at the end:

    council: 1 of 2 members answered in 4s; the chair wrote the verdict

## Command

    /council                               on or off, the members, the chair, the last run
    /council on | off                      whether the model has the tool; off by default
    /council members                       the members
    /council members <model> ...           opus, sonnet, fable, haiku, a claude- id, a gemini- or gemma- id
    /council members reset                 the default members
    /council <question>                    runs the council now, also while it is off

`/council <question>` answers `convened: 5 members` at once. When the members and the chair have answered, the mod hands the verdict to the model through `/council:send`, so the model reads it as your message and tells you what it takes from it. A turn that runs meanwhile holds it until its end (measured on 2.1.283).

## Cost

Each run makes one request per member and one for the chair. Measured on Claude Code 2.1.283:

- A run of the five default members took 25 to 44 seconds; the slowest member sets the time. Forks took 4 to 11 seconds and read the conversation from the cache (83k tokens in a short session).
- 400,000 characters of conversation, the default limit, are 163,828 input tokens on Opus 5.5, Sonnet 5 and Fable 5.1, 128,018 on Haiku 4.5 and 120,057 on gemini-3.8-flash.

At the list prices, one run at the full 400,000 characters costs about $2.20, estimated: Fable 5.1 about $1.70 ($10 per million input tokens), Sonnet 5 about $0.34, Haiku 4.5 about $0.13, and the two forks a few cents of cache reads. A shorter conversation costs less in proportion. On a Claude subscription the requests count toward the usage limits instead. Leave out a member with `/council members` to lower the cost, for example `/council members opus sonnet haiku gemini-3.8-flash`.

`gemini-3.1-pro-preview` answered HTTP 429 on every free-tier key of the check, because the free tier has no quota for it. Add it to the members only with a paid key.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install council@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Run `/council on` if the model should call the council by itself. It is off after an install, and `/council <question>` works either way.
3. For Gemini members, install gemini-core 0.3.0 or later and give it a key (see its README). The council does not depend on it and runs with Claude members alone without it.

## Options

| Option | Default | What it sets |
|---|---|---|
| `maxInputChars` | `400000` | How much of the conversation, in characters, each member reads when it does not fork the session; from 20,000 to 2,000,000 |

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=council}, prompt.section{name=env_info_simple}, tool.describe{tool=/"^mcp__council__convene$"/}, tool.call{tool=/"^mcp__council__convene$"/}, turn.step
    ❯ ./register.ts calls: $.clock.after (via runManual), $.clock.now (via askClaude, askGemini, askGeminiModel, convene, drawRun, ended, verdictOf), $.command.register, $.command.run (via send), $.gemini.enroll (via enrollGemini), $.gemini.read (via askGeminiModel), $.gemini.request (via askGeminiModel), $.gemini.settings (via geminiReach), $.http.fetch (via askGeminiModel), $.model.complete (via askChair, askClaude), $.model.fork (via askChair, askClaude), $.prompt.submit (via send), $.session.messages (via contextOf), $.sidebar.set (via drawRun), $.store.delete (via runCommand), $.store.get (via isEnabled, membersNow), $.store.set (via runCommand, storeEnabled), $.tool.register (via declareTool), $.ui.log (via enrollGemini, runManual, send, toPerson)

Reach L3, one request per member and one for the chair.

    1. Reads:    the conversation of the main thread, the question, and the model of each main-loop request
    2. Runs:     no process
    3. Sends:    the conversation and the question to each Claude member through Claude Code's own API connection, and to Google for each Gemini member through gemini-core
    4. Persists: in $.store, the on/off setting and the member list; a run lives in memory
    5. Hostile input: the answers are text the model reads and never run; a member id must match [a-z0-9.-] before it reaches a Gemini URL; a free-tier Gemini key lets Google read what it is sent

## Limits

- Every member answers from what it is sent. A member that does not fork reads the conversation as text, cut at `maxInputChars`, so it can miss what was cut.
- The chair runs on the session's model and judges answers from its own family too; the letters hide which answer came from which model, not what the answers say.
- After a Gemini HTTP 503 the request goes again at once, without the wait gemini-core names, because `$.clock.sleep` counts against the hook's 10-second budget (measured on 2.1.283). Three quick retries can all meet the same load.
- Measured on 2.1.283: a plugin tool call ran 333 seconds without a timeout. On 2.1.277 the limit was 60 seconds, so an older Claude Code can cut a slow run.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types with --plugin-dir ../sidebar --plugin-dir ../gemini-core
    make validate
    make test        # claude plugin test
