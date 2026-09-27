# pin-note

A Claude Code Mod that keeps the notes you pin with `/pin-note` for the whole session, and sends them to the model again, word for word, after each compaction and `/clear`. A compaction summary can drop or reword an instruction you gave early on; a pinned note comes back as you wrote it.

## What it does

1. `/pin-note <note>` pins a note. The model reads it at once, in the command's answer:

       pin-note: pinned note 1, kept for this session and sent to you again after each compaction and /clear:
       ask before every push

2. After a compaction, and after `/clear`, the notes go into the model's new context through a `SessionStart` hook, as one numbered list, each note as you typed it. One line tells you:

       pin-note: sent 1 pinned note(s) again after the compaction

3. The notes belong to the session. They are kept in `$.store` under the session's id, so a reloaded module and a resumed session find them again. `/clear` starts a new session, and the notes go with it.
4. Nothing is sent at a session's start or at a resume, because the conversation there still holds the notes as you pinned them.

Measured on Claude Code 2.1.283 in a live session: after `/compact` the note reached the model's context, and after `/clear` the model, asked whether a note was pinned, wrote it word for word and followed it.

## Command

    /pin-note                  on or off, and the pinned notes, numbered
    /pin-note on | off         off by default; off keeps the notes and sends none
    /pin-note <note>           pins a note; the text is kept as typed, several lines too
    /pin-note drop <n>         takes note n out

While the mod is off, `/pin-note <note>` and `drop` are refused. `on`, `off` and `drop <n>` are the only command words, so a note may start with `drop` when no number alone follows it.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install pin-note@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Run `/pin-note on`.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=pin-note}, classic.SessionStart
    ❯ ./register.ts calls: $.command.register, $.session.id, $.store.get, $.store.set (via runCommand, savePins), $.ui.log

Reach L0, no network, no files, no processes.

    1. Reads:        the notes you pin, and the session's id
    2. Runs:         nothing
    3. Sends:        nothing off the machine; the notes go into the model's context as you typed them
    4. Persists:     the on/off setting and each session's notes in $.store
    5. Hostile input: a note is your own text and the model reads it as your instruction; nothing else is read

## Limits

- The notes are sent again only at a compaction and at `/clear`. A note you want gone from the context must be dropped and the context compacted, because a note the model already read stays in the conversation.
- Every session's notes stay in `$.store` under its id; nothing deletes the notes of an old session.
- There is no limit on the number or length of notes, and every note goes into the context after each compaction.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs the /plugin-types output in .claude/types/
    make validate
    make test        # claude plugin test
