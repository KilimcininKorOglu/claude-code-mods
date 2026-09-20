# gemini-review

A Claude Code Mod that has Gemini review every commit the model makes. Before a Bash `git commit` runs, Gemini reads the change the commit records and the conversation. A blocking finding stops the commit and the model reads why; a minor finding lets the commit run and the model reads it after the result.

## What it does

1. The mod hooks the Bash tool. A command with a `git commit` in it (the `commit` skill included) is reviewed before it runs; any other command runs untouched.
2. It reads the command without a shell: `cd <dir>` and `git -C <dir>` set the directory, `git add` before the commit in the same command says what gets staged, and `commit -a`, `add -u` and `add -A` say that every tracked or untracked change goes in. A commit message in a heredoc or in quotes is not read as a command. `git commit --help` and `--dry-run` record nothing and are not reviewed.
   A command that runs anything else before the commit (`echo x >> f && git commit -am ...`) is stopped before it runs, and the model reads that it must commit in a Bash call of its own. The review reads the change before the command runs, so what those steps change would not be in it: such a commit went through with an empty diff and no review (measured on 2.1.278). Commands after the commit (`&& git push`) are allowed.
3. It collects the change with git, run by argv in the Bash tool's directory (`$.session.cwd()` follows a Bash `cd`, measured on 2.1.278): the index, a path the command stages from the working tree (the index still holds its older content until `git add` runs), and each new file whole.
4. It sends the diff and the conversation in one `generateContent` request with a schema: a list of findings, each `blocker` or `minor`, with a file, a line and a message. gemini-core builds the request with the key, the model and the thinking level it holds for `gemini-review`, and reads the answer.
5. `blocker` means a bug the change introduces, data loss, a security hole, a secret or credential in the diff, or a change that contradicts what the user asked for. Everything else is `minor`.
6. The verdict:
   - a blocker: the command does not run; the model reads each blocker and the minor notes, with the instruction to fix and commit again, or, when a finding is wrong, to tell the user why and run the same command with `GEMINI_REVIEW_SKIP=1` in front;
   - only minor findings: the commit runs and the model reads the notes after the result;
   - no finding: the commit runs and the model reads one line saying the review found nothing.
7. When the review cannot answer (no key, an HTTP error, a malformed answer, a git error, a diff over 1,500,000 characters), the commit runs, a transcript line says why, and the model reads the reason.
8. Gemini answers HTTP 503 ("high demand") now and then, often after 10 seconds or more. As gemini-core reads it, the mod asks again after 1 s, 2 s and 3 s, at most four times, and starts no attempt once 60 s have passed. A hook's 10-second budget counts its `$.clock` waits but not its requests, so the waits stay short.

In a live check on 2.1.278 with `gemini-3.8-flash`, a commit of a file with `sk_live_...` was stopped with `sub/pay.ts:1: Hardcoded live Stripe secret key committed in source code`, a `git add pay.ts sub.ts && git commit` after the fix ran, a `GEMINI_REVIEW_SKIP=1` commit ran unreviewed, and an invalid key let the commit run with `Gemini HTTP 400: API key not valid`. Of eight reviews in that session, four got an answer (one after two 503s, 42.5 seconds in all) and four got only 503 answers and let the commit run.

## What it shows

A toast after each review, and the last one in `/gemini-review`:

    gemini-review: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out · sent to Gemini free tier

A transcript line after every review, so you read what the model was told. The line holds the findings alone, without the instruction:

    gemini-review: commit reviewed: 2 file(s), nothing to report
    gemini-review: commit reviewed with 1 minor note(s): pay.ts:12: Name the constant.
    gemini-review: commit stopped: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out
    gemini-review: commit ran without a review: the model used GEMINI_REVIEW_SKIP=1

The context and the line are separate channels: the model never reads the line, and you never read the context.

## Command

    /gemini-review              on or off, the model, thinking level and tier gemini-core holds, whether a key is set, the last review
    /gemini-review on | off     off: commits run without a review; on is refused while gemini-core has no key
    /gemini-review reset        off again, the default

The review is off after an install, so nothing is sent to Gemini before you set a key and turn it on.

The key, the tier, the model (default `gemini-3.8-flash`) and the thinking level are gemini-core's:

    /gemini-core model review gemini-3.7-flash
    /gemini-core thinking review low
    /gemini-core paid

## Free tier or paid tier

Every review sends the diff and the conversation: your prompts, the commands the model ran and the contents of the files it read. On the free tier Google may use them and human reviewers may read them; the gemini-core README quotes the Gemini API Additional Terms. On a project you would not show to Google, use a key with billing enabled and set `/gemini-core paid`.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-review@kilimcininkoroglu-mods

It depends on `gemini-core`, which `claude plugin install` adds. Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Set the Gemini key and the tier in gemini-core, as its [After installing](../gemini-core/README.md#after-installing) section says, then restart Claude Code.
2. Run `/gemini-review on`. Without a key it answers `still off: gemini-core has no Gemini key` and stays off.
3. Run `/gemini-review`. The first line reads `on · <model> · thinking ... · <tier> tier · key set`.
4. When a commit runs with `commit ran without a review: Gemini HTTP 429`, the model has no quota on your key. Pick another with `/gemini-core model review`.

After an update from 0.1.x: `claude plugin update` does not add gemini-core (measured on 2.1.278), so run `claude plugin install gemini-core@kilimcininkoroglu-mods` once. Version 0.2.0 moved the key, tier and model to gemini-core; the `apiKey`, `tier` and `model` options and the settings `/gemini-review free|paid|model` stored before are no longer read, so set them again in gemini-core. Version 0.3.0 made the review off by default: after an update from an earlier version it is off unless you ran `/gemini-review on` before, so run `/gemini-review on` once.

## Options

| Option | Default | What it sets |
|---|---|---|
| `maxInputChars` | `2000000` | Characters of conversation sent at most |

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-review}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via review, runCommand, storeEnabled), $.http.fetch (via askGemini), $.process.run (via collectDiff, git), $.session.cwd (via review), $.session.messages (via review), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.ui.log, $.ui.toast (via verdictOf)

Reach L3, reaches the network.

    1. Reads:    each Bash command; at a commit, the repository's diff and new files through git, and the conversation (messages, tool inputs and outputs); its own $.store; from gemini-core, the request with the key
    2. Runs:     read-only git by argv, no shell: rev-parse, diff, ls-files; at most 200 new files are read
    3. Sends:    the diff and the conversation, one request per commit (up to four after a 503, and once more per extra key after a 429 or a key error), to the URL gemini-core builds (generativelanguage.googleapis.com) with the key in the x-goog-api-key header, never in the URL
    4. Persists: in $.store, the on/off setting; the last review line lives in memory
    5. Hostile input: a diff or a conversation can steer Gemini's findings, so a hostile change can pass or a sound one be stopped; the model reads the findings as a denial or a note and can skip a wrong one; paths from the command reach git as argv after --, never through a shell

## Limits

- A review is a model's opinion. It can miss a problem, and a wrong blocker is passed with the skip prefix, which the model uses by its own decision.
- Only the model's Bash commits are reviewed. A commit from your terminal, from a script the model runs, from an alias or through another tool is not.
- The command reading covers the usual forms. A `cd` inside a subshell, variables in paths and globs that git expands are not resolved.
- A subagent's commit sends only the diff, because which transcript `$.session.messages()` answers inside a subagent was not verified.
- Every review sends the whole conversation, so a long session makes each review larger and slower. `$.session.messages()` answers the newest 4096 messages.
- The Bash hook ran 42.5 seconds without a limit in the live check. A longer limit was not measured.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
