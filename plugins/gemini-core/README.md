# gemini-core

A Claude Code Mod that keeps the Gemini settings of every Gemini mod in one place: the key and the tier for all of them, and the model and the thinking level for each. It adds `$.gemini` to the engine interface; `gemini-compact`, `gemini-advisor`, `gemini-review` and `gemini-plan-review` depend on it and build their Gemini requests through it.

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

    /gemini-core [status]                           tier, how many keys are set, each enrolled mod's model and thinking level
    /gemini-core free | paid                        the tier of every Gemini mod; free prints the warning below
    /gemini-core models [refresh]                   the Gemini text models the key lists
    /gemini-core model <mod>                        a pane to pick the mod's model from that list
    /gemini-core model <mod> <id>                   for example: model review gemini-3.7-flash; an id the list lacks is refused
    /gemini-core thinking <mod> <level|default>     for example: thinking compact low; default drops the level
    /gemini-core reset                              the tier from the plugin option, each mod its default model and no level

A mod is named in full (`gemini-review`) or without `gemini-` (`review`). The settings are kept across sessions and take effect at the next request. A mod may hook `gemini.configure` to follow a change.

## Model list

The list comes from Google's `models.list` (`GET /v1beta/models`, the key in the `x-goog-api-key` header), asked once per session, again with `models refresh`. When a key fails, the next key is asked. It keeps the models that take `generateContent` and whose id starts with `gemini-`, and leaves out ids with `tts` or `image`, which answer with speech or pictures. On the checked key Google listed 58 models and 21 stayed (measured on 2.1.278). The filter reads names only, so a new model of another kind whose name does not say so stays in the list; Gemini's own error then reaches the mod that asks.

`/gemini-core model <mod>` opens a pane with a `Select` of the list, the mod's current model selected; Enter sets the pick, shows it in a toast and closes the pane, and Esc closes it with no change. In the terminal the Select draws a scrolling list of ten rows. A surface without a `Select` (mobile) shows the list and the command that sets one. An id given with the command is refused when the list lacks it, with the three closest ids:

    gemini-9-flash is not a Gemini text model this key lists; closest: gemini-2.5-flash, gemini-3.5-flash, gemini-3.6-flash.

## Several keys

The `apiKey` option and `GEMINI_API_KEY` take a comma-separated list; the option wins when it is set. The keys are tried in order:

- An HTTP 429 (quota), 401, 403, or 400 "API key not valid" sends the same request with the next key at once. The last key wraps to the first, and each key is tried once per request. No key is tried once the mod's deadline has passed (60 s for review and compact, 40 s for the advisor).
- When no key is left, the error names each distinct failure once with the places of the keys that got it, never a key: `all 34 keys failed: Gemini HTTP 429: quota (keys 1-4, 6-34); Gemini HTTP 400: API key not valid. (key 5)`.
- The next request starts at the key the last one succeeded or moved on with, so a key whose daily quota is used up is not asked first every time. This place is kept in memory and starts over when the module reloads.
- An HTTP 503 is the model's load, the same for every key, so it stays on the same key and waits as above.

In a live check on 2.1.278 with an invalid key first and a working key second, the first review got HTTP 400 in 0.4 s and HTTP 200 from the second key; the next review asked the second key only.

Google applies the rate limits per project, not per key ("Rate limits are applied per project, not per API key", Gemini API rate limits), so two keys of one project share one quota. Keys of several projects used to add up free quota go against the Google APIs Terms of Service: "You agree to, and will not attempt to circumvent, such limitations documented with each API." A second key is for a key that stops working, or a paid key beside a free one. All keys share the one tier setting.

## Free tier or paid tier

The Gemini mods send the conversation, tool outputs and diffs. The Gemini API Additional Terms say about the free tier: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services", "human reviewers may read, annotate, and process your API input and output", and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." On a project you would not show to Google, use a key with billing enabled and set `/gemini-core paid`. The mod cannot tell which tier a key is on; the tier only chooses the warning the mods show.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-core@kilimcininkoroglu-mods

A Gemini mod lists `gemini-core` in its `dependencies`, so installing one installs this one. Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Give it a key from Google AI Studio, in one of two places. Without a key every Gemini mod reports `no Gemini key`: gemini-compact runs the built-in summary, gemini-review lets the commit run unreviewed, gemini-plan-review lets the plan reach you unreviewed, and the advisor call fails.
   - The environment. Add the line to your shell profile (`~/.zshrc`, `~/.bashrc`), open a new terminal, then start Claude Code from it:

         export GEMINI_API_KEY="key1"
         export GEMINI_API_KEY="key1,key2"    # several keys, tried in turn

   - The plugin option, stored as a secret. It wins over the environment. Set it in the `/plugin` configure flow, or at install time with `claude plugin install gemini-core@kilimcininkoroglu-mods --config apiKey=...`, which also leaves the key in your shell history.
2. Restart Claude Code and run `/gemini-core`. The first line names the tier and the number of keys, for example `free tier · 2 keys, tried in turn`. `no key: set GEMINI_API_KEY ...` means Claude Code did not get the key.
3. Choose the tier. The default is `free`, and every Gemini mod then shows a free-tier warning. With a billing-enabled key run `/gemini-core paid`. When you mix a paid and a free key, put the paid key first, because one tier covers all keys.
4. Turn on each Gemini mod you want: `/gemini-review on`, `/gemini-plan-review on`, `/gemini-advisor on`, `/gemini-compact on`. Each is off after an install and sends nothing to Gemini until then; `on` is refused while this mod has no key.
5. Check that each mod's model answers on your key. A free key can have no quota for a model: the free key of the live checks answered HTTP 429 for `gemini-3.8-flash`, the default of gemini-review, gemini-plan-review and gemini-advisor, and HTTP 200 for `gemini-3.5-flash` (measured). Pick another model with `/gemini-core models` and `/gemini-core model <mod>`.

After an update from a Gemini mod that kept its own settings (gemini-review and gemini-advisor 0.1.x, gemini-compact 0.2.x): `claude plugin update` does not add gemini-core, so run `claude plugin install gemini-core@kilimcininkoroglu-mods` once. The mod's old `apiKey`, `tier` and `model` options and its stored `free`, `paid` and `model` settings are not read, so do steps 1 to 5 again.

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
    ❯ ./register.ts hooks: engine.create, session.start, command.run{command=gemini-core}, ui.render{component=Pane}, ui.close
    ❯ ./register.ts calls: $.command.register, $.env.get, $.gemini.configure (via applyChange, pickModel), $.gemini.settings (via openPicker, statusOf), $.http.fetch (via listModels), $.store.delete, $.store.get, $.store.set, $.ui.close (via pickModel), $.ui.open (via openPicker), $.ui.resolve, $.ui.toast
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: GEMINI_API_KEY

Reach L3, reaches the network: `/gemini-core models` and a model change ask Google for the model list. The generateContent requests it builds carry the key to the mod that sends them.

    1. Reads:    GEMINI_API_KEY or the apiKey option; its own $.store
    2. Runs:     no process; it opens one pane for a model pick
    3. Sends:    the model list request (GET generativelanguage.googleapis.com/v1beta/models, no conversation), once per session and on refresh, with the key in the x-goog-api-key header; the Gemini mods send the requests it builds
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
