# gemini-advisor

The model makes a plan, picks one of two approaches or says the work is done, and nobody looks at it a second time. This mod gives the model a Gemini advisor it calls by itself. The model writes what it did or is about to do and its question; Gemini reads the whole conversation so far, tool calls and outputs included, and its second opinion comes back as the tool result.

The idea follows the advisor tool of the Claude API, where the executor model calls a stronger model that reads its transcript. Here Gemini answers, and the model also sends a message of its own.

## What it does

1. At session start, while the advisor is on, the mod declares the tool `mcp__gemini-advisor__advise` with one input, `message`.
2. The engine lists a plugin's tool behind ToolSearch, where the model sees only its name (measured on 2.1.277). So the mod adds a `# Gemini advisor` note to the end of the `env_info_simple` section of the system prompt: what the tool does, how to load it, and when to call it. The note does not change during a session, so the prompt cache holds.
3. The note makes the call required, without you asking, at four moments: before a substantial change or a multi-step plan, when the model is stuck (the same error twice), when it chooses between two approaches, and before it says the work is done. It also tells the model to check the advice against the code and to tell you where it disagrees.
4. At a call, the mod reads the conversation with `$.session.messages()`, which includes the running turn (measured). It writes out every message and each tool call with its input and output, and sends that with the model's message in one `generateContent` request. When the text is over `maxInputChars` (2,000,000 characters by default), the longest tool outputs are cut to one common length, each keeping its head and tail; a conversation over the limit even without any output is an error. gemini-core builds the request with the key, the model and the thinking level it holds for `gemini-advisor`, and reads the answer.
5. The advice comes back as the tool result. Every failure comes back as an error result that says why, so the model sees it; nothing is swallowed. An empty advice, and one Gemini cut at `maxOutputTokens`, are errors too.
6. Gemini answers HTTP 503 ("high demand") now and then, and the next request often works (measured: 2 of 5 requests on two flash models). gemini-core then has the mod ask again after 1 s, 2 s and 3 s, at most four attempts in all, and no attempt starts whose wait would end past 40 s, so the last one fits the 60-second tool timeout. After a 429 or a key error, gemini-core hands over the request with its next key, when it holds one.

In a live check on 2.1.277 with `gemini-3.8-flash`, the model called the advisor on its own while choosing between two approaches, sent 27 messages (15k tokens), got the advice in 7.1 seconds, and its answer used the advice. With a softer note ("call it on your own") the model did not call it in two such turns, and said afterwards that the turn was one the note named.

## What it shows

After each advice a toast stays for 10 seconds, and `/gemini-advisor` shows the last one:

    gemini-advisor: asked gemini-3.8-flash · 27 messages · 15k in, 2k out · sent to Gemini free tier

The `sent to Gemini free tier` part appears only on the free tier. A call from a subagent reads `message only` in place of the message count. The tool row in the transcript holds the model's message and the advice (ctrl+o).

## Command

    /gemini-advisor              on or off, the model, thinking level and tier gemini-core holds, whether a key is set, the last advice
    /gemini-advisor on | off     on is refused while gemini-core has no key; off: a call answers that the advisor is off
    /gemini-advisor reset        off again, the default

The advisor is off after an install: the model gets no tool and no note, and nothing goes to Gemini. `on` declares the tool at once. The system prompt note follows the setting at `/clear` or the next session, not at once, because a change of the system prompt in the middle of a session makes the next request write the whole prompt cache again. After `off` the note leaves at `/clear` or the next session and the tool at the next session; until then a call answers that the advisor is off. The setting is one for every window: an `on` in another window declares the tool here at this window's next turn and the note at its next `/clear` or session, and an `off` there makes a call here answer at once that the advisor is off.

The key, the tier, the model (default `gemini-3.8-flash`) and the thinking level belong to gemini-core, and a change applies from the next call:

    /gemini-core model advisor gemini-3.7-flash
    /gemini-core thinking advisor high
    /gemini-core paid

## Free tier or paid tier

Every call sends the conversation: your prompts, the commands the model ran and the contents of the files it read. On the free tier Google may use them and human reviewers may read them; the gemini-core README quotes the Gemini API Additional Terms. On a project you would not show to Google, use a key with billing enabled and set `/gemini-core paid`.

With the free key used in the live check, `gemini-3.1-pro-preview` answered HTTP 429 (quota exceeded), so a pro model needs a paid key.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-advisor@kilimcininkoroglu-mods

It depends on `gemini-core`, which `claude plugin install` adds. Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Set the Gemini key and the tier in gemini-core, as its [After installing](../gemini-core/README.md#after-installing) section says, then restart Claude Code.
2. Run `/gemini-advisor on`, then `/clear` or start a new session, so the system prompt note reaches the model. Without a key `on` answers `still off: gemini-core has no Gemini key` and stays off.
3. Run `/gemini-advisor`. The first line reads `on · <model> · thinking ... · <tier> tier · key set`.
4. When an advice call fails with `Gemini HTTP 429`, the model has no quota on your key. Pick another with `/gemini-core model advisor`.

After an update from 0.1.x: `claude plugin update` does not add gemini-core (measured on 2.1.278), so run `claude plugin install gemini-core@kilimcininkoroglu-mods` once. Version 0.2.0 moved the key, tier and model to gemini-core; the `apiKey`, `tier` and `model` options and the settings `/gemini-advisor free|paid|model` stored before are no longer read, so set them again in gemini-core. Version 0.3.0 made the advisor off by default: after an update from an earlier version it is off unless you ran `/gemini-advisor on` before, so run `/gemini-advisor on` once.

## Options

| Option | Default | What it sets |
|---|---|---|
| `maxInputChars` | `2000000` | Characters of conversation sent at most; 10,000 to 4,000,000 |
| `maxOutputTokens` | `8192` | The longest advice, thinking included; 256 to 65,536; a cut advice is an error |

A value outside its range, or one that is not a whole number, falls back to the default.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, turn.start, classic.SessionStart, command.run{command=gemini-advisor}, prompt.section{name=env_info_simple}, tool.call{tool=mcp__gemini-advisor__advise}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via runCommand, storeEnabled), $.http.fetch (via askGemini), $.session.messages (via conversation), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.tool.register (via declareTool), $.ui.toast (via advise)

Reach L3, reaches the network.

    1. Reads:    the conversation at each advisor call (messages, tool inputs and outputs); its own $.store; from gemini-core, the request with the key
    2. Runs:     no process; while on, it adds one note to the system prompt and declares one tool
    3. Sends:    the conversation and the model's message, one request per call (up to four after a 503, and once more per extra key after a 429 or a key error), to the URL gemini-core builds (generativelanguage.googleapis.com) with the key in the x-goog-api-key header, never in the URL
    4. Persists: in $.store, the on/off setting; the last usage line lives in memory
    5. Hostile input: the advice is untrusted text the model reads as a tool result, so a hostile or wrong advice can steer the model as text in a file it reads can; the note tells the model to check it

## Limits

- Whether the model calls the advisor is its own decision. The live check covered one kind of turn.
- The tool description names no model. The engine keeps the description it first sent for the whole session: a tool registered again after a model change still reached the model with the old text (measured on 2.1.278). The toast and `/gemini-advisor` name the model a call went to.
- The engine serves the tool with a 60-second MCP timeout (debug log, 2.1.277). A call that takes longer fails, and the model reads the error.
- The note goes into the `env_info_simple` section. A setup whose system prompt has no such section gets no note, and the model sees the tool's name only. Only one setup was checked.
- A subagent's call sends only its message, because which transcript `$.session.messages()` answers inside a subagent was not verified.
- `$.session.messages()` answers the newest 4096 messages of a long transcript.
- Every call sends the whole conversation, so a long session makes each call larger and slower.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
