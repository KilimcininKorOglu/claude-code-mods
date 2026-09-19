# gemini-advisor

A Claude Code Mod that gives the model a Gemini advisor it calls by itself. The model writes what it did, what it is about to do and its question; Gemini reads the whole conversation so far, tool calls and outputs included, and answers with a second opinion that comes back as the tool result.

The idea follows the advisor tool of the Claude API, where the executor model calls a stronger model that reads its transcript. This mod asks Gemini instead, and the model also sends a message of its own.

## What it does

1. At session start the mod declares the tool `mcp__gemini-advisor__advise` with one input, `message`.
2. The engine lists a plugin's tool behind ToolSearch, where the model sees only its name (measured on 2.1.277). So the mod adds a `# Gemini advisor` note to the end of the `env_info_simple` section of the system prompt: what the tool does, how to load it, and when to call it. The note does not change during a session, so the prompt cache holds.
3. The note makes the call required, without the user asking, at four moments: before a substantial change or a multi-step plan, when stuck (the same error twice), when choosing between two approaches, and before saying the work is done. It also tells the model to check the advice against the code.
4. At a call, the mod reads the conversation with `$.session.messages()`, which includes the running turn (measured), renders every message and each tool call with its input and output, and sends it with the model's message in one `generateContent` request. Above 2,000,000 characters the longest outputs are cut to their head and tail first. gemini-core builds the request with the key, the model and the thinking level it holds for `gemini-advisor`, and reads the answer.
5. The advice comes back as the tool result. Any failure comes back as an error result that says why, so the model sees it; nothing is swallowed.
6. Gemini answers HTTP 503 ("high demand") now and then, and the next request often works (measured: 2 of 5 requests on two flash models). As gemini-core reads it, the mod asks again after 1 s, 2 s and 3 s, at most four times, and starts no attempt once 40 s have passed, so the last one fits the 60-second tool timeout.

In a live check on 2.1.277 with `gemini-3.8-flash`, the model called the advisor on its own while choosing between two approaches, sent 27 messages (15k tokens), got the advice in 7.1 seconds, and its answer used the advice. With a softer note ("call it on your own") the model did not call it in two such turns, and said afterwards that the turn was one the note named.

## What it shows

A toast after each advice, and the last one in `/gemini-advisor`:

    gemini-advisor: asked gemini-3.8-flash · 27 messages · 15k in, 2k out · sent to Gemini free tier

The tool row in the transcript holds the model's message and the advice (ctrl+o).

## Command

    /gemini-advisor              on or off, the model, thinking level and tier gemini-core holds, whether a key is set, the last advice
    /gemini-advisor on | off     off: a call answers that the advisor is off
    /gemini-advisor reset        on again

The key, the tier, the model (default `gemini-3.8-flash`) and the thinking level are gemini-core's, and a change applies from the next call:

    /gemini-core model advisor gemini-3.7-flash
    /gemini-core thinking advisor high
    /gemini-core paid

## Free tier or paid tier

Every call sends the conversation: your prompts, the commands the model ran and the contents of the files it read. On the free tier Google may use them and human reviewers may read them; the gemini-core README quotes the Gemini API Additional Terms. On a project you would not show to Google, use a key with billing enabled and set `/gemini-core paid`.

With the free key used in the live check, `gemini-3.1-pro-preview` answered HTTP 429 (quota exceeded), so a pro model needs a paid key.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-advisor@kilimcininkoroglu-mods

It depends on `gemini-core`, which the install adds. Function hooks are early access. Nothing loads without the flag, and the key comes from the gemini-core option or the environment:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 GEMINI_API_KEY=... claude

Version 0.2.0 moved the key, tier and model to gemini-core; the `apiKey`, `tier` and `model` options and the settings `/gemini-advisor free|paid|model` stored before are no longer read.

## Options

| Option | Default | What it sets |
|---|---|---|
| `maxInputChars` | `2000000` | Characters of conversation sent at most |
| `maxOutputTokens` | `8192` | The longest advice, thinking included; a cut advice is an error |

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-advisor}, prompt.section{name=env_info_simple}, tool.call{tool=mcp__gemini-advisor__advise}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via runCommand), $.http.fetch (via askGemini), $.session.messages (via conversation), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via runCommand), $.tool.register, $.ui.toast (via advise)

Reach L3, reaches the network.

    1. Reads:    the conversation at each advisor call (messages, tool inputs and outputs); its own $.store; from gemini-core, the request with the key
    2. Runs:     no process; it adds one note to the system prompt and declares one tool
    3. Sends:    the conversation and the model's message, one request per call (up to four after a 503), to the URL gemini-core builds (generativelanguage.googleapis.com) with the key in the x-goog-api-key header, never in the URL
    4. Persists: in $.store, the on/off setting; the last usage line lives in memory
    5. Hostile input: the advice is untrusted text the model reads as a tool result, so a hostile or wrong advice can steer the model as text in a file it reads can; the note tells the model to check it

## Limits

- Whether the model calls the advisor is its own decision. The live check covered one kind of turn.
- The tool description names no model. The engine keeps the description it first sent for the whole session: a tool registered again after a model change still reached the model with the old text (measured on 2.1.278). The toast and `/gemini-advisor` name the model a call went to.
- The engine serves the tool with a 60-second MCP timeout (debug log, 2.1.277). A call that takes longer fails, and the model reads the error.
- The note is added to the `env_info_simple` section. A setup whose system prompt has no such section gets no note, and the model sees the tool's name only. Only one setup was checked.
- A subagent's call sends only its message, because which transcript `$.session.messages()` answers inside a subagent was not verified.
- `$.session.messages()` answers the newest 4096 messages of a long transcript.
- Every call sends the whole conversation, so a long session makes each call larger and slower.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
