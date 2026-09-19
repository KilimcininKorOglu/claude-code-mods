# gemini-plan-review

A Claude Code Mod that has Gemini review every plan before it reaches you. When the model calls ExitPlanMode, Gemini reads the plan and the conversation before the approval dialog opens. A plan with a blocking finding goes back to the model, at most twice; you see the plan once it passes.

## What it does

1. The mod hooks the ExitPlanMode tool. A `tool.call` hook runs before the permission prompt, so a plan sent back never opens the approval dialog.
2. It reads the plan file from disk, which is the text the dialog shows. The file is the call's `planFilePath`, else the one the engine's plan mode note names (`## Plan File Info: ... create your plan at /.../x.md`). The call's own `plan` field is used only when no path is known, because on 2.1.278 the first call after a new plan file carried neither `plan` nor `planFilePath`, and a later call carried the plan as it was before the model's last edit (measured).
3. It sends the plan and the conversation in one `generateContent` request with a schema: a list of findings, each `blocker` or `minor`, with a message. gemini-core builds the request with the key, the model and the thinking level it holds for `gemini-plan-review`, and reads the answer.
4. `blocker` means a step the goal needs that the plan leaves out, an assumption the conversation or the code shown in it contradicts, a goal with no way to check that it was reached, or a decision against what you asked for. Everything else is `minor`.
5. The verdict:
   - a blocker, in round 1 or 2: the plan goes back. The model reads each blocker and the minor notes, with the instruction to fix the plan, or to answer a wrong finding in the plan file under a `## Gemini plan review` heading. Gemini reads that section in the next round and is told to accept an answer the conversation supports;
   - a blocker after 2 rounds: the plan reaches you. A transcript line lists the open blockers, and the model reads them after your answer;
   - only minor findings, or none: the plan reaches you, and the model reads the notes, or one line that the review found nothing, after your answer.
6. A prompt you send gives the next plan its 2 rounds again, and so does a plan that reached the dialog. A background notification or a peer message does not.
7. When the review cannot answer (no key, an HTTP error, a malformed answer, an unreadable plan file), the plan reaches you, a transcript line says why, and the model reads the reason.
8. After a 503, gemini-core has the mod ask again after 1 s, 2 s and 3 s, at most four times, and no attempt starts once 50 s have passed.

In a live check on 2.1.278 with `gemini-3.5-flash`, the request was a `--json` flag with a unit test and the plan was `1. Add a --json flag to /task-poke. 2. Done.`. Round 1 sent it back with `The plan does not include the requested unit test for the --json flag`. The model added the test step, and the second call opened the approval dialog. With `gemini-3.8-flash` on a free key, the same review got only 503 answers and the plan reached the dialog with the reason.

## What it shows

A toast after each review, and the last one in `/gemini-plan-review`:

    gemini-plan-review: plan reviewed · 1 blocker, 0 minor · 621 in, 1k out · sent to Gemini free tier

A transcript line when a plan goes back, passes with open blockers, or is not reviewed:

    gemini-plan-review: plan sent back (round 1 of 2): plan reviewed · 1 blocker, 0 minor · 621 in, 1k out
    gemini-plan-review: plan reached you without a review: Gemini HTTP 503: This model is currently experiencing high demand. ...

## Command

    /gemini-plan-review              on or off, the model, thinking level and tier gemini-core holds, whether a key is set, the last review
    /gemini-plan-review on | off     off: plans reach you without a review; on is refused while gemini-core has no key
    /gemini-plan-review reset        off again, the default

The review is off after an install, so nothing is sent to Gemini before you set a key and turn it on.

The key, the tier, the model (default `gemini-3.8-flash`) and the thinking level are gemini-core's:

    /gemini-core model plan-review gemini-3.5-flash
    /gemini-core thinking plan-review low
    /gemini-core paid

## Free tier or paid tier

Every review sends the plan and the conversation: your prompts, the commands the model ran and the contents of the files it read. On the free tier Google may use them and human reviewers may read them; the gemini-core README quotes the Gemini API Additional Terms. On a project you would not show to Google, use a key with billing enabled and set `/gemini-core paid`.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install gemini-plan-review@kilimcininkoroglu-mods

It depends on `gemini-core`, which `claude plugin install` adds. Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Set the Gemini key and the tier in gemini-core, as its [After installing](../gemini-core/README.md#after-installing) section says, then restart Claude Code.
2. Run `/gemini-plan-review on`. Without a key it answers `still off: gemini-core has no Gemini key` and stays off.
3. Run `/gemini-plan-review`. The first line reads `on · <model> · thinking ... · <tier> tier · key set`.
4. When a plan reaches you with `Gemini HTTP 429` or repeated `Gemini HTTP 503`, pick another model with `/gemini-core model plan-review`.

## Options

| Option | Default | What it sets |
|---|---|---|
| `maxInputChars` | `2000000` | Characters of conversation sent at most |

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=gemini-plan-review}, prompt.submit, prompt.attachment{type=plan_mode}, tool.call{tool=ExitPlanMode}
    ❯ ./register.ts calls: $.clock.now (via askGemini), $.clock.sleep (via askGemini), $.command.register, $.fs.read (via planOf), $.gemini.enroll, $.gemini.read (via askGemini), $.gemini.request (via askGemini), $.gemini.settings (via review, runCommand, storeEnabled), $.http.fetch (via askGemini), $.session.messages (via review), $.store.delete (via runCommand), $.store.get (via isEnabled), $.store.set (via storeEnabled), $.ui.log (via notReviewed, verdictOf), $.ui.toast (via verdictOf)

Reach L3, reaches the network.

    1. Reads:    the plan file at each ExitPlanMode call; the plan mode note, for the plan file's path; the origin of each prompt; the conversation (messages, tool inputs and outputs); its own $.store; from gemini-core, the request with the key
    2. Runs:     nothing
    3. Sends:    the plan and the conversation, one request per ExitPlanMode call (up to four after a 503, and once more per extra key after a 429 or a key error), to the URL gemini-core builds (generativelanguage.googleapis.com) with the key in the x-goog-api-key header, never in the URL
    4. Persists: in $.store, the on/off setting; the round count, the plan file path and the last review line live in memory
    5. Hostile input: a plan or a conversation can steer Gemini's findings, so a weak plan can pass or a sound one go back; the model can answer a wrong finding in the plan, and after 2 rounds the plan reaches you whatever Gemini says

## Limits

- A review is a model's opinion. It can miss a problem, and it can report one the plan already solves.
- Each `$.http.fetch` ends after 30 seconds without a complete answer (measured on 2.1.278). A slow model then lets the plan through without a review.
- A subagent's ExitPlanMode is not reviewed, because it does not open your approval dialog.
- The plan mode note's wording is the engine's. When a build changes it, the first call after a new plan file carries no path, and that plan reaches you with `the call carries no plan text`.
- Every review sends the whole conversation, so a long session makes each review larger and slower. `$.session.messages()` answers the newest 4096 messages.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
