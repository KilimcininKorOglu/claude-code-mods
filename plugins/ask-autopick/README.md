# ask-autopick

You start a long task, walk away, and come back an hour later to find the session stuck on a question the model asked in the first minute. This mod keeps that from happening: when a question has waited unanswered for a set time, it picks the option the model itself recommended and lets the work go on. It is off until you turn it on.

## What it does

1. While it is on, it watches every `AskUserQuestion` call. The question shows up as usual and waits for you.
2. If you answer within the wait (10 minutes by default), your answer goes through and the mod does nothing.
3. If no answer comes in time, the mod answers in your place with each question's recommended option. The engine closes the question, and the transcript shows the answer just as it would show yours.

   The tool tells the model to put the option it recommends first and to end its label with `(Recommended)`, and in a question written in another language the model writes that word in that language. So the mod takes the first option when its label ends with that word in parentheses and no other option carries it. It knows the word in English, Turkish, German, Spanish, Portuguese, French, Italian, Dutch, Polish, Russian, Chinese, Japanese and Korean, and full-width parentheses count too.
4. Along with the answer, the model gets one note: you did not answer within the wait, so the pick is a default and not your decision, and its next reply should name it. In the live check the model did say that you had not chosen it.
5. You get one entry saying what was picked: in the stream of the [sidebar](../sidebar) if it is open, otherwise as a transcript line. In the sidebar the picked answer is yellow, the question and the rest are faint:

       ask-autopick: no answer in 10 min, picked the recommended option: Renk? → Mavi (Önerilen)

6. Some questions are never picked: one whose first option is not marked, one where a second option is marked too, and one that takes several answers (`multiSelect`). Those wait for you, and one yellow entry tells you so.

In the live check on 2.1.282, a question left open got `Mavi (Önerilen)` after 1 minute and after 5 minutes, and the model carried on with it.

## Command

    /ask-autopick             on or off, and the wait
    /ask-autopick on | off    off by default, kept across sessions
    /ask-autopick 20          wait 20 minutes; 1 to 120, 10 by default, kept across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ask-autopick@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Turn it on with `/ask-autopick on`. Until then it answers nothing.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=ask-autopick}, tool.call{tool=/"^AskUserQuestion$"/}
    ❯ ./register.ts calls: $.clock.after (via answerOrPick), $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2: it drives Claude, because a pick answers a question for you.

    1. Reads:    the questions and option labels of each AskUserQuestion call
    2. Runs:     nothing
    3. Sends:    the recommended labels as the call's answer, with one note to the model, only after the wait ran out and only while on
    4. Persists: in $.store, the on/off setting and the wait
    5. Hostile input: a label is picked only when it holds a recommended mark the model wrote; the mod adds no text of its own to the answer

## Limits

- The mod trusts the model's mark: whatever the recommended option does, it gets picked.
- A question in a language whose word is not on the list waits for you.
- Waits of 10 minutes or more were not measured live; 1 and 5 minutes were.
- If you turn the mod off in another window during the wait, the question keeps waiting for you.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
