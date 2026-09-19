# gemini-advisor

A Claude Code Mod that gives the model a Gemini advisor it calls by itself. The model writes what it did, what it is about to do and its question; Gemini reads the whole conversation so far, tool calls and outputs included, and answers with a second opinion that comes back as the tool result.

The idea follows the advisor tool of the Claude API, where the executor model calls a stronger model that reads its transcript. This mod asks Gemini instead, and the model also sends a message of its own.

## What it does

1. At session start the mod declares the tool `mcp__gemini-advisor__advise` with one input, `message`.
2. The engine lists a plugin's tool behind ToolSearch, where the model sees only its name (measured on 2.1.277). So the mod adds a `# Gemini advisor` note to the end of the `env_info_simple` section of the system prompt: what the tool does, how to load it, and when to call it. The note does not change during a session, so the prompt cache holds.
3. The note makes the call required, without the user asking, at four moments: before a substantial change or a multi-step plan, when stuck (the same error twice), when choosing between two approaches, and before saying the work is done. It also tells the model to check the advice against the code.
4. At a call, the mod reads the conversation with `$.session.messages()`, which includes the running turn (measured), renders every message and each tool call with its input and output, and sends it with the model's message in one `generateContent` request. Above 2,000,000 characters the longest outputs are cut to their head and tail first.
5. The advice comes back as the tool result. Any failure comes back as an error result that says why, so the model sees it; nothing is swallowed.
6. Gemini answers HTTP 503 ("high demand") now and then, and the next request often works (measured: 2 of 5 requests on two flash models). The mod asks again after 2 s and then 4 s, and starts no attempt once 30 s have passed.

In a live check on 2.1.277 with `gemini-3.8-flash`, the model called the advisor on its own while choosing between two approaches, sent 27 messages (15k tokens), got the advice in 7.1 seconds, and its answer used the advice. With a softer note ("call it on your own") the model did not call it in two such turns, and said afterwards that the turn was one the note named.

## What it shows

A toast after each advice, and the last one in `/gemini-advisor`:

    gemini-advisor: asked gemini-3.8-flash · 27 messages · 15k in, 2k out · sent to Gemini free tier

The tool row in the transcript holds the model's message and the advice (ctrl+o).

## Command

    /gemini-advisor              on or off, model, tier, whether a key is set, the last advice
    /gemini-advisor on | off     off: a call answers that the advisor is off
    /gemini-advisor free | paid  the tier; free prints the warning below
    /gemini-advisor model <id>   for example gemini-3.5-flash; the tool is declared again with the new name
    /gemini-advisor reset        back to the plugin options

The settings are kept across sessions and take effect at once.

## Free tier or paid tier

Every call sends the conversation: your prompts, the commands the model ran and the contents of the files it read. The Gemini API Additional Terms say about the free tier: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services", "human reviewers may read, annotate, and process your API input and output", and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." On a project you would not show to Google, use a key with billing enabled and set `/gemini-advisor paid`. The mod cannot tell which tier a key is on; the `tier` setting only chooses the warning.

With the free key used in the live check, `gemini-3.1-pro-preview` answered HTTP 429 (quota exceeded), so a pro model needs a paid key.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-advisor@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag, and the key comes from the plugin option or the environment:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 GEMINI_API_KEY=... claude

## Options

| Option | Default | What it sets |
|---|---|---|
| `apiKey` | `GEMINI_API_KEY` | The Gemini API key, stored as a secret |
| `tier` | `free` | `free` or `paid`; `/gemini-advisor free\|paid` overrides it |
| `model` | `gemini-3.8-flash` | `/gemini-advisor model` overrides it |
| `maxInputChars` | `2000000` | Characters of conversation sent at most |
| `maxOutputTokens` | `8192` | The longest advice, thinking included; a cut advice is an error |

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.277:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-advisor}, prompt.section{name=env_info_simple}, tool.call{tool=mcp__gemini-advisor__advise}
    ❯ ./register.ts calls: $.clock.now (via fetchAnswer), $.clock.sleep (via fetchAnswer), $.command.register, $.env.get (via apiKey), $.http.fetch (via fetchAnswer), $.session.messages (via conversation), $.store.delete (via runCommand), $.store.get (via loadConfig), $.store.set (via runCommand), $.tool.register (via registerTool), $.ui.toast (via advise)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: GEMINI_API_KEY

Reach L3, reaches the network.

    1. Reads:    the conversation at each advisor call (messages, tool inputs and outputs); GEMINI_API_KEY; its own $.store
    2. Runs:     no process; it adds one note to the system prompt and declares one tool
    3. Sends:    the conversation and the model's message, one request per call (up to three after a 503), to generativelanguage.googleapis.com with the key in the x-goog-api-key header, never in the URL
    4. Persists: in $.store, the three command settings (enabled, tier, model); the last usage line lives in memory
    5. Hostile input: the advice is untrusted text the model reads as a tool result, so a hostile or wrong advice can steer the model as text in a file it reads can; the note tells the model to check it; a model id must match [a-z0-9.-] because it goes into the URL path

## Limits

- Whether the model calls the advisor is its own decision. The live check covered one kind of turn.
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
