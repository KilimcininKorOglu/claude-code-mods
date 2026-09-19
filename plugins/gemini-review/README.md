# gemini-review

A Claude Code Mod that has Gemini review every commit the model makes. Before a Bash `git commit` runs, Gemini reads the change the commit records and the conversation. A blocking finding stops the commit and the model reads why; a minor finding lets the commit run and the model reads it after the result.

## What it does

1. The mod hooks the Bash tool. A command with a `git commit` in it (the `commit` skill included) is reviewed before it runs; any other command runs untouched.
2. It reads the command without a shell: `cd <dir>` and `git -C <dir>` set the directory, `git add` before the commit in the same command says what gets staged, and `commit -a`, `add -u` and `add -A` say that every tracked or untracked change goes in. A commit message in a heredoc or in quotes is not read as a command. `git commit --help` and `--dry-run` record nothing and are not reviewed.
3. It collects the change with git, run by argv in the Bash tool's directory (`$.session.cwd()` follows a Bash `cd`, measured on 2.1.278): the index, a path the command stages from the working tree (the index still holds its older content until `git add` runs), and each new file whole.
4. It sends the diff and the conversation in one `generateContent` request with a schema: a list of findings, each `blocker` or `minor`, with a file, a line and a message.
5. `blocker` means a bug the change introduces, data loss, a security hole, a secret or credential in the diff, or a change that contradicts what the user asked for. Everything else is `minor`.
6. The verdict:
   - a blocker: the command does not run; the model reads each blocker and the minor notes, with the instruction to fix and commit again, or, when a finding is wrong, to tell the user why and run the same command with `GEMINI_REVIEW_SKIP=1` in front;
   - only minor findings: the commit runs and the model reads the notes after the result;
   - no finding: the commit runs and the model reads one line saying the review found nothing.
7. When the review cannot answer (no key, an HTTP error, a malformed answer, a git error, a diff over 1,500,000 characters), the commit runs, a transcript line says why, and the model reads the reason.
8. Gemini answers HTTP 503 ("high demand") now and then, often after 10 seconds or more. The mod asks again after 1 s, 2 s and 3 s, at most four times, and starts no attempt once 60 s have passed. A hook's 10-second budget counts its `$.clock` waits but not its requests, so the waits stay short.

In a live check on 2.1.278 with `gemini-3.8-flash`, a commit of a file with `sk_live_...` was stopped with `sub/pay.ts:1: Hardcoded live Stripe secret key committed in source code`, a `git add pay.ts sub.ts && git commit` after the fix ran, a `GEMINI_REVIEW_SKIP=1` commit ran unreviewed, and an invalid key let the commit run with `Gemini HTTP 400: API key not valid`. Of eight reviews in that session, four got an answer (one after two 503s, 42.5 seconds in all) and four got only 503 answers and let the commit run.

## What it shows

A toast after each review, and the last one in `/gemini-review`:

    gemini-review: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out · sent to Gemini free tier

A transcript line when a commit is stopped, skipped or not reviewed:

    gemini-review: commit stopped: reviewed 1 file(s) · 1 blocker, 0 minor · 2k in, 515 out
    gemini-review: commit ran without a review: the model used GEMINI_REVIEW_SKIP=1

## Command

    /gemini-review              on or off, model, tier, whether a key is set, the last review
    /gemini-review on | off     off: commits run without a review
    /gemini-review free | paid  the tier; free prints the warning below
    /gemini-review model <id>   for example gemini-3.5-flash
    /gemini-review reset        back to the plugin options

The settings are kept across sessions and take effect at once.

## Free tier or paid tier

Every review sends the diff and the conversation: your prompts, the commands the model ran and the contents of the files it read. The Gemini API Additional Terms say about the free tier: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services", "human reviewers may read, annotate, and process your API input and output", and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." On a project you would not show to Google, use a key with billing enabled and set `/gemini-review paid`. The mod cannot tell which tier a key is on; the `tier` setting only chooses the warning.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-review@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag, and the key comes from the plugin option or the environment:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 GEMINI_API_KEY=... claude

## Options

| Option | Default | What it sets |
|---|---|---|
| `apiKey` | `GEMINI_API_KEY` | The Gemini API key, stored as a secret |
| `tier` | `free` | `free` or `paid`; `/gemini-review free\|paid` overrides it |
| `model` | `gemini-3.8-flash` | `/gemini-review model` overrides it |
| `maxInputChars` | `2000000` | Characters of conversation sent at most |

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-review}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via fetchAnswer), $.clock.sleep (via fetchAnswer), $.command.register, $.env.get (via apiKey), $.http.fetch (via fetchAnswer), $.process.run (via collectDiff, git), $.session.cwd (via review), $.session.messages (via review), $.store.delete (via runCommand), $.store.get (via loadConfig), $.store.set (via runCommand), $.ui.log, $.ui.toast (via verdictOf)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: GEMINI_API_KEY

Reach L3, reaches the network.

    1. Reads:    each Bash command; at a commit, the repository's diff and new files through git, and the conversation (messages, tool inputs and outputs); GEMINI_API_KEY; its own $.store
    2. Runs:     read-only git by argv, no shell: rev-parse, diff, ls-files; at most 200 new files are read
    3. Sends:    the diff and the conversation, one request per commit (up to four after a 503), to generativelanguage.googleapis.com with the key in the x-goog-api-key header, never in the URL
    4. Persists: in $.store, the three command settings (enabled, tier, model); the last review line lives in memory
    5. Hostile input: a diff or a conversation can steer Gemini's findings, so a hostile change can pass or a sound one be stopped; the model reads the findings as a denial or a note and can skip a wrong one; paths from the command reach git as argv after --, never through a shell; a model id must match [a-z0-9.-] because it goes into the URL path

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
