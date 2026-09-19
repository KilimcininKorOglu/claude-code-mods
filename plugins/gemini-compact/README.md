# gemini-compact

A Claude Code Mod that moves compaction from Claude to Gemini. It has two modes:

- **summary** (the default): Gemini summarizes the conversation before the newest 6 messages, and those messages stay verbatim after the summary. Claude writes no summary; the engine's built-in summary runs only when Gemini fails.
- **prune**: Gemini answers, for every older tool call, whether the call and its output stay, stay with a cut output, or go. Every user and assistant message stays verbatim. Nothing is summarized.

The prune idea follows fast-jev-compaction by Tamara Tran (tamaratran/fast-jev-compaction), which asks TypeSafe Jev. The code is new and asks Gemini.

## Which mode

The built-in compaction is one Claude request: it reads the whole context and writes a summary, and that request counts against your Claude usage. Both modes replace that request with a Gemini request.

After the compaction, every Claude request reads what is left. In summary mode that is the summary and the newest messages, close to what the built-in summary leaves. In prune mode it is every message of the conversation less the dropped tool output, which is larger, so each following request reads more. The sizes were not measured on a long session.

Use summary mode to save the most Claude usage. Use prune mode when the exact wording of every message matters more than the size.

## Summary mode

1. At `/compact`, at the engine's own compaction, and after a turn that ends with the context over the threshold, the `session.compact` hook takes the conversation.
2. The newest 6 messages stay. The cut moves back to an assistant message, so a tool result is never kept without its call and the kept part opens with an assistant message after the summary.
3. One `generateContent` request sends everything before the cut to Gemini: every message, and each call with its input and its full output. Above 2,000,000 characters the longest outputs are cut to their head and tail first.
4. Gemini writes a plain-text summary in nine sections: the request and intent, technical concepts, files and code, errors and fixes, problem solving, every user message verbatim, pending tasks, the current work, and the next step. The text after `/compact` is passed to it.
5. The conversation becomes one user message (a note, then the summary) followed by the kept messages, which go back as the engine's own messages.
6. The built-in summary runs, and one line says why, when there is no key, Gemini fails, the summary is under 200 characters or cut at the output limit (32,768 tokens), or the result is not smaller than the conversation.

In both modes gemini-core builds the request with the key, the model and the thinking level it holds for `gemini-compact`, and reads the answer. After an HTTP 503 ("high demand") the mod asks again after 1 s, 2 s and 3 s, at most four times, and starts no attempt once 60 s have passed.

In a live check on 2.1.277, `/compact` took 2.6 seconds with `gemini-3.5-flash-lite`, Claude sent no compaction request, and after it the model named a word and a file that appeared only in the summarized part.

## Prune mode

1. The same three triggers reach the `session.compact` hook.
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

    gemini-compact: summary: 58 → 7 messages · 91% smaller · 312k in, 5k out
    gemini-compact: kept 9/11 messages · 93% smaller · 1 dropped, 0 truncated · 5k in, 59 out
    gemini-compact: built-in summary: under 25% smaller (kept 14/16 messages · 3% smaller · ...)
    gemini-compact: built-in summary: Gemini HTTP 429: Resource has been exhausted

On the free tier the toast adds `· sent to Gemini free tier`.

## Command

    /gemini-compact              on or off, mode, the model and thinking level gemini-core holds, threshold, tier, whether a key is set, the last result
    /gemini-compact on | off     off leaves every compaction to the built-in summary
    /gemini-compact mode summary | mode prune
    /gemini-compact at <1-99>    compact after a turn that ends with the context over this percentage
    /gemini-compact at off       no automatic compaction; /compact and the engine's own compaction still ask Gemini
    /gemini-compact reset        back to the plugin options

The command settings are kept across sessions and take effect at once. After a compaction it started, the mod starts no other one until a turn ends with the context under the threshold, so a context that stays over it does not compact after every turn.

The key, the tier, the model (default `gemini-3.5-flash-lite`) and the thinking level are gemini-core's:

    /gemini-core model compact gemini-3.5-flash
    /gemini-core thinking compact low
    /gemini-core paid

## Free tier or paid tier

The conversation holds your prompts, the commands the model ran and the contents of the files it read. On the free tier Google may use them and human reviewers may read them; the gemini-core README quotes the Gemini API Additional Terms. On a project you would not show to Google, use a key with billing enabled and set `/gemini-core paid`. No mod can tell which tier a key is on; the tier setting only chooses the warning.

The free tier limits per model are shown in Google AI Studio, not in the documentation. They were not measured. A summary of a long conversation is one large request, so a per-minute token limit can refuse it with HTTP 429; the built-in summary then runs.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-compact@kilimcininkoroglu-mods

It depends on `gemini-core`, which `claude plugin install` adds. Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

Load it from a local checkout for one session, with gemini-core beside it:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/gemini-core --plugin-dir plugins/gemini-compact

## After installing

1. Set the Gemini key and the tier in gemini-core, as its [After installing](../gemini-core/README.md#after-installing) section says, then restart Claude Code.
2. Run `/gemini-compact`. The first line reads `on · summary · <model> · thinking ... · automatic at 60% · <tier> tier · key set`.
3. Run `/compact` once. The transcript line should start with `gemini-compact: summary:`. A line that starts with `built-in summary:` names why Gemini was not used.

After an update from 0.2.x: `claude plugin update` does not add gemini-core (measured on 2.1.278), so run `claude plugin install gemini-core@kilimcininkoroglu-mods` once. Version 0.3.0 moved the key, tier and model to gemini-core; the `apiKey`, `tier` and `model` options and the settings `/gemini-compact free|paid|model` stored before are no longer read, so set them again in gemini-core. The `mode` and `at` settings stay.

## Options

| Option | Default | What it sets |
|---|---|---|
| `mode` | `summary` | `summary` or `prune`; `/gemini-compact mode` overrides it |
| `compactAtPercent` | `60` | The automatic threshold; 0 turns it off; `/gemini-compact at` overrides it |
| `keepRecent` | `6` | Newest messages kept verbatim (summary) or whose calls are never sent for a decision (prune) |
| `minReduction` | `0.25` | Prune mode: below this fraction the built-in summary runs |
| `headChars` | `300` | Prune mode: characters kept of a truncated output |
| `maxInputChars` | `400000` | Prune mode: characters sent to Gemini at most |
| `summaryMaxInputChars` | `2000000` | Summary mode: characters sent to Gemini at most |

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-compact}, session.compact, turn.complete
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via compactWithGemini, runCommand), $.http.fetch (via askGemini), $.session.compact (via maybeCompact), $.session.usage (via maybeCompact), $.store.delete (via runCommand), $.store.get (via loadConfig), $.store.set (via runCommand), $.ui.log, $.ui.toast (via report)

Reach L3, reaches the network.

    1. Reads:    the conversation at each compaction (messages, tool inputs and outputs); the context fill after each main-loop turn; its own $.store; from gemini-core, the request with the key
    2. Runs:     no process; one $.session.compact after a turn that ends over the threshold, at most once until the context was under it again
    3. Sends:    the conversation (summary: all but the newest messages; prune: all of it), one request per compaction (up to four after a 503, and once more per extra key after a 429 or a key error), to the URL gemini-core builds (generativelanguage.googleapis.com) with the key in the x-goog-api-key header, never in the URL
    4. Persists: in $.store, the three command settings (enabled, mode, atPercent); the last result lives in memory
    5. Hostile input: the Gemini answer is untrusted: a prune answer is applied only in the schema shape with every candidate id once; a summary becomes the text of one user message the model reads, so a hostile summary can steer the model, as text in a file it reads can; anything malformed falls back to the built-in summary

## Limits

- A summary and a drop are a model's judgment. A summary loses detail the newest messages do not repeat. The prune note tells the model which calls ran, so it can run a tool again.
- After the compaction the context is written to the cache again. In prune mode it stays larger than a built-in summary, so the next message pays a larger cache write.
- A summary of a long conversation takes Gemini longer; the compaction waits for it. Only short conversations were timed.
- A subagent's own compaction is left to the engine.
- A compaction the engine precomputes (`precompute`) also asks Gemini. Whether the engine reuses that result for the compaction that follows was not measured.
- The test engine of `claude plugin test` passes no `trigger` to a `$.session.compact()` call. The `plugin` trigger and the hook that answers it were measured in a live session.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
