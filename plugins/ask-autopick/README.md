# ask-autopick

A Claude Code Mod that picks the recommended option of a question that waited unanswered for a set time, so a session you left does not stop on it. It is off until you turn it on.

## What it does

1. While on, the mod hooks every `AskUserQuestion` call. The question shows as always and waits for you.
2. When you answer within the wait (10 minutes by default), your answer is the call's, and the mod does nothing.
3. When no answer comes in time, the mod answers in your place with each question's recommended option. The engine closes the question, and the transcript shows the answer as it shows yours.

   The tool tells the model to put the option it recommends first and to end its label with `(Recommended)`, and in a question written in another language the model writes that word in the language. So the recommended option is the first one, when its label ends with that word in parentheses in one of these languages and no other option carries it: English, Turkish, German, Spanish, Portuguese, French, Italian, Dutch, Polish, Russian, Chinese, Japanese and Korean. Full-width parentheses count too.
4. The model gets one note with the answer: you did not answer within the wait, so the pick is a default and not your decision, and its next reply names it. In the live check the model wrote that you did not choose it.
5. One red entry says what was picked, in the sidebar's stream while the [sidebar](../sidebar) is open, else as a transcript line:

       ask-autopick: no answer in 10 min, picked the recommended option: Renk? → Mavi (Önerilen)

6. A question whose first option is not marked, with a second marked option, or one that takes several answers (`multiSelect`) is never picked. It waits for you, and one entry says so.

In the live check on 2.1.282 a question left open got `Mavi (Önerilen)` after 1 minute and after 5 minutes, and the model went on with it.

## Command

    /ask-autopick             on or off, and the wait
    /ask-autopick on | off    off by default, kept across sessions
    /ask-autopick 20          wait 20 minutes; 1 to 120, 10 by default, kept across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ask-autopick@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Turn the mod on with `/ask-autopick on`. It answers nothing until then.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.282:

    ❯ ./register.ts hooks: session.start, command.run{command=ask-autopick}, tool.call{tool=/"^AskUserQuestion$"/}
    ❯ ./register.ts calls: $.clock.after (via answerOrPick), $.command.register, $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L2, drives Claude: a pick answers a question for you.

    1. Reads:    the questions and option labels of each AskUserQuestion call
    2. Runs:     nothing
    3. Sends:    the recommended labels as the call's answer, with one note to the model, only after the wait ran out and only while on
    4. Persists: in $.store, the on/off setting and the wait
    5. Hostile input: a label is picked only when it holds a recommended mark the model wrote; the mod adds no text of its own to the answer

## Limits

- The mod trusts the model's mark: an option marked recommended is picked whatever it does.
- A question in a language whose word is not in the list waits for you.
- A wait of 10 minutes or more is not measured live; 1 and 5 minutes are.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
