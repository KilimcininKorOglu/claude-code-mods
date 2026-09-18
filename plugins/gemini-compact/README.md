# gemini-compact

A Claude Code Mod that replaces the compaction summary with Gemini decisions. At a compaction, Gemini reads the whole conversation and answers, for every older tool call, whether the call and its output stay, stay with a cut output, or go. Every user and assistant message stays verbatim. Nothing is summarized.

The idea follows fast-jev-compaction by Tamara Tran (tamaratran/fast-jev-compaction), which asks TypeSafe Jev. The code is new and asks Gemini.

## What it does

1. At `/compact`, at the engine's own compaction, and after a turn that ends with the context over the threshold, the `session.compact` hook takes the conversation.
2. Tool calls in the first message and in the newest 6 messages are kept whole. Every other call gets an id (`c1`, `c2`, ...).
3. One `generateContent` request sends the conversation to Gemini: every message, and each call with its input and its full output. Above 400,000 characters the longest outputs are cut to their head and tail first. A response schema allows exactly one answer per id: `keep`, `truncate` or `drop`.
4. The mod checks the answer (every id exactly once, no other id) and rebuilds the conversation:
   - `keep`: the call and its output stay.
   - `truncate`: the call stays, the output keeps its first 300 characters and one line that says it was cut.
   - `drop`: the call and its output go. A note on the nearest assistant message names the removed calls, for example `[gemini-compact removed 1 earlier tool call(s) and their output after a compaction; they ran: Bash(ls -la /usr/bin)]`. Without the note, the model read a reply whose work was gone and said it had never done that work (measured on 2.1.277).
   - A message the answer does not touch goes back as the engine's own message.
5. When the result is less than 25% smaller, or anything fails (no key, an HTTP error, an answer that breaks the schema), the engine's built-in summary runs and one line says why.

In a live check on 2.1.277, `/compact` took 1.1 seconds with `gemini-3.5-flash-lite`. Gemini dropped an `ls` listing and kept the `cat` output of a file the user was about to edit, and the conversation became 93% smaller.

## What it shows

**One line in the transcript**, not sent to the model, and a toast:

    gemini-compact: kept 9/11 messages · 93% smaller · 1 dropped, 0 truncated · 5k in, 59 out
    gemini-compact: built-in summary: under 25% smaller (kept 14/16 messages · 3% smaller · ...)
    gemini-compact: built-in summary: Gemini HTTP 429: Resource has been exhausted

On the free tier the toast adds `· sent to Gemini free tier`.

## Command

    /gemini-compact              on or off, model, threshold, tier, whether a key is set, the last result
    /gemini-compact on | off     off leaves every compaction to the built-in summary
    /gemini-compact free | paid  the tier; free prints the warning below
    /gemini-compact model <id>   for example gemini-3.5-flash
    /gemini-compact at <1-99>    compact after a turn that ends with the context over this percentage
    /gemini-compact at off       no automatic compaction; /compact and the engine's own compaction still ask Gemini
    /gemini-compact reset        back to the plugin options

The command settings are kept across sessions and take effect at once. After a compaction it started, the mod starts no other one until a turn ends with the context under the threshold, so a context that stays over it does not compact after every turn.

## Free tier or paid tier

A Gemini API key from Google AI Studio works on the free tier. The Gemini API Additional Terms say about the free tier: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services", "human reviewers may read, annotate, and process your API input and output", and "Do not submit sensitive, confidential, or personal information to the Unpaid Services."

The conversation holds your prompts, the commands the model ran and the contents of the files it read. On a project you would not show to Google, use a key with billing enabled and set `/gemini-compact paid`. The mod cannot tell which tier a key is on; the `tier` setting only chooses the warning.

The free tier limits per model are shown in Google AI Studio, not in the documentation. They were not measured.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-compact@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag, and the key comes from the plugin option or the environment:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 GEMINI_API_KEY=... claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/gemini-compact

## Options

| Option | Default | What it sets |
|---|---|---|
| `apiKey` | `GEMINI_API_KEY` | The Gemini API key, stored as a secret |
| `tier` | `free` | `free` or `paid`; `/gemini-compact free\|paid` overrides it |
| `model` | `gemini-3.5-flash-lite` | `/gemini-compact model` overrides it |
| `compactAtPercent` | `60` | The automatic threshold; 0 turns it off; `/gemini-compact at` overrides it |
| `keepRecent` | `6` | Newest messages whose calls are never sent for a decision |
| `minReduction` | `0.25` | Below this fraction the built-in summary runs |
| `headChars` | `300` | Characters kept of a truncated output |
| `maxInputChars` | `400000` | Characters sent to Gemini at most |

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.277:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-compact}, session.compact, turn.complete
    ❯ ./register.ts calls: $.command.register, $.env.get (via apiKey), $.http.fetch (via ask), $.session.compact (via maybeCompact), $.session.usage (via maybeCompact), $.store.delete (via runCommand), $.store.get (via loadConfig), $.store.set (via runCommand), $.ui.log, $.ui.toast (via report)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: GEMINI_API_KEY

Reach L3, reaches the network.

    1. Reads:    the conversation at each compaction (messages, tool inputs and outputs); GEMINI_API_KEY; the context fill after each main-loop turn; its own $.store
    2. Runs:     no process; one $.session.compact after a turn that ends over the threshold, at most once until the context was under it again
    3. Sends:    the whole conversation, one request per compaction, to generativelanguage.googleapis.com with the key in the x-goog-api-key header, never in the URL
    4. Persists: in $.store, the four command settings (enabled, tier, model, atPercent); the last result lives in memory
    5. Hostile input: the Gemini answer is untrusted: only the schema shape with every candidate id once is applied, anything else falls back to the built-in summary; a model id must match [a-z0-9.-] because it goes into the URL path

## Limits

- A drop is a model's judgment. The note tells the model which calls ran, so it can run a tool again.
- After the compaction the context is written to the cache again. It stays larger than a built-in summary, so the next message pays a larger cache write.
- A subagent's own compaction is left to the engine.
- A compaction the engine precomputes (`precompute`) also asks Gemini. Whether the engine reuses that result for the compaction that follows was not measured.
- The test engine of `claude plugin test` passes no `trigger` to a `$.session.compact()` call. The `plugin` trigger and the hook that answers it were measured in a live session.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
