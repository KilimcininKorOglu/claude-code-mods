# gemini-core

A Claude Code Mod that keeps the Gemini settings of every Gemini mod in one place: the key and the tier for all of them, and the model and the thinking level for each. It adds `$.gemini` to the engine interface; `gemini-compact`, `gemini-advisor` and `gemini-review` depend on it and build their Gemini requests through it.

## What it does

1. Each Gemini mod enrolls at session start with its plugin name and its default model.
2. When a mod asks Gemini, `$.gemini.request` builds the `generateContent` request from the mod's body: the key in the `x-goog-api-key` header, never in the URL, the mod's model, and its thinking level in `generationConfig.thinkingConfig.thinkingLevel`. Without a level the body is sent as it is, so the model uses its own default.
3. The mod sends the request with its own `$.http.fetch`, and `$.gemini.read` reads the answer: the text and the token counts, Gemini's error message, or a wait before the same request goes again after an HTTP 503 (1 s, 2 s, 3 s, at most four attempts, no attempt once the mod's deadline has passed). After an HTTP 429 or a key error it answers the same request with the next key, which the mod sends at once.

A method on a plugin's noun must answer within 10 seconds (measured on 2.1.278: a 14-second fetch inside one was refused with `did not answer within 10000ms`). A Gemini request can take longer, so the request is sent by the mod and not inside `$.gemini`.

## Thinking levels

`minimal`, `low`, `medium` and `high`. Which levels a model takes differs per model, and the mod keeps no table of them: an unsupported level is Gemini's HTTP 400, which the mod that asked shows. Measured on 2.1.278:

| Model | minimal | low | medium | high |
|---|---|---|---|---|
| `gemini-3.8-flash` | HTTP 400 "Thinking level MINIMAL is not supported for this model" | yes | yes | yes |
| `gemini-3.5-flash-lite` | yes | yes | yes | yes |

The Gemini docs say Gemini 3.1 Pro takes no `minimal` either.

## Command

    /gemini-core                                    tier, whether a key is set, each enrolled mod's model and thinking level
    /gemini-core free | paid                        the tier of every Gemini mod; free prints the warning below
    /gemini-core model <mod> <id>                   for example: model review gemini-3.7-flash
    /gemini-core thinking <mod> <level|default>     for example: thinking compact low; default drops the level
    /gemini-core reset                              the tier from the plugin option, each mod its default model and no level

A mod is named in full (`gemini-review`) or without `gemini-` (`review`). The settings are kept across sessions and take effect at the next request. A mod may hook `gemini.configure` to follow a change.

## Several keys

The `apiKey` option and `GEMINI_API_KEY` take a comma-separated list; the option wins when it is set. The keys are tried in order:

- An HTTP 429 (quota), 401, 403, or 400 "API key not valid" sends the same request with the next key at once. The last key wraps to the first, and each key is tried once per request.
- When every key failed, the error names each key's failure by its place in the list (`all 2 keys failed: key 1: Gemini HTTP 400: API key not valid...; key 2: ...`), never the key.
- The next request starts at the key the last one succeeded or moved on with, so a key whose daily quota is used up is not asked first every time. This place is kept in memory and starts over when the module reloads.
- An HTTP 503 is the model's load, the same for every key, so it stays on the same key and waits as above.

In a live check on 2.1.278 with an invalid key first and a working key second, the first review got HTTP 400 in 0.4 s and HTTP 200 from the second key; the next review asked the second key only.

Google applies the rate limits per project, not per key ("Rate limits are applied per project, not per API key", Gemini API rate limits), so two keys of one project share one quota. Keys of several projects used to add up free quota go against the Google APIs Terms of Service: "You agree to, and will not attempt to circumvent, such limitations documented with each API." A second key is for a key that stops working, or a paid key beside a free one. All keys share the one tier setting.

## Free tier or paid tier

The Gemini mods send the conversation, tool outputs and diffs. The Gemini API Additional Terms say about the free tier: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services", "human reviewers may read, annotate, and process your API input and output", and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." On a project you would not show to Google, use a key with billing enabled and set `/gemini-core paid`. The mod cannot tell which tier a key is on; the tier only chooses the warning the mods show.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-core@kilimcininkoroglu-mods

A Gemini mod lists `gemini-core` in its `dependencies`, so installing one installs this one. Function hooks are early access. Nothing loads without the flag, and the key comes from the plugin option or the environment:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 GEMINI_API_KEY=... claude

## Options

| Option | Default | What it sets |
|---|---|---|
| `apiKey` | `GEMINI_API_KEY` | The Gemini API key of every Gemini mod, or several separated by commas, stored as a secret |
| `tier` | `free` | `free` or `paid`; `/gemini-core free\|paid` overrides it |

## For a mod author

The contract is `types/index.d.ts`. A mod that uses it:

```ts
const prepared = await $.gemini.request({ consumer: 'my-mod', body })
if ('error' in prepared) return fail(prepared.error)
const started = await $.clock.now()
let http = prepared.http
for (let attempt = 1; ; attempt++) {
  const r = await $.http.fetch(http.url, http.init)
  const read = await $.gemini.read({ http, status: r.status, ok: r.ok, text: r.text, attempt, elapsedMs: (await $.clock.now()) - started })
  if ('answer' in read || 'error' in read) return read
  if ('next' in read) http = read.next
  else await $.clock.sleep(read.retryInMs)
}
```

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ types ./types/index.d.ts declares on $: $.gemini
    ❯ ./register.ts hooks: engine.create, session.start, command.run{command=gemini-core}
    ❯ ./register.ts calls: $.command.register, $.env.get, $.gemini.configure (via runCommand), $.gemini.settings (via statusOf), $.store.delete, $.store.get, $.store.set
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: GEMINI_API_KEY

Reach L1: it reads the environment and its own store and sends nothing. The request it builds carries the key to the mod that sends it.

    1. Reads:    GEMINI_API_KEY or the apiKey option; its own $.store
    2. Runs:     no process
    3. Sends:    nothing; the Gemini mods send the requests it builds, with the key in their x-goog-api-key header
    4. Persists: in $.store, the tier, the enrolled mods with their default models, and each mod's model and thinking level
    5. Hostile input: a mod that calls $.gemini.request receives the key, so only install Gemini mods you trust; a model id must match [a-z0-9.-] because it goes into the URL path; the response text is read as JSON and never run

## Limits

- The key reaches every plugin that calls `$.gemini.request`.
- Settings kept by the Gemini mods before they used gemini-core (their `tier` and `model`) are not read.
- The test engine of 2.1.278 runs no `engine.create`, so the tests build `$.gemini` on a store in memory, and the mods' tests answer `gemini.*` themselves.
- Plugin nouns are early access; the 10-second limit and the rest were measured on 2.1.278.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
