# context-restore

A Claude Code Mod that hands a skill or command call the current text of its file when the file changed on disk after the session loaded it, and hands the model a rules file or the global CLAUDE.md that changed on disk.

## What it does

Measured on Claude Code 2.1.280:

- The engine loads each skill and command once, and hands that copy at every call, also after its file changed on disk. A typed `/name` sends the old text, and a Skill tool call answers `Skill /<name> is already loaded above; instructions unchanged.`
- A skill that compaction cut is sent whole again by the engine itself when it is called again, typed or through the Skill tool. The mod does nothing for that case.
- A rules file, or the global `~/.claude/CLAUDE.md`, that changes between two prompts does not reach the model until a compaction.

So the mod does two things:

1. At each call of a skill or command (typed as `/name`, called through the Skill tool, or preloaded into a subagent), it reads the file the text came from. A skill names its directory in its first line (`Base directory for this skill: <dir>`), so its file is `<dir>/SKILL.md`. A command's file is looked up: a plugin's `commands/<name>.md` for `<plugin>:<name>`, else the project's or your own `commands/<name>.md`. A built-in command has no file.
   - A file with no placeholder is compared with the engine's text. When they differ, the file's text takes the place of the engine's copy, and the arguments the engine added after it (`ARGUMENTS: ...`) stay. The engine then sends the new text, also on a Skill tool call.
   - A file whose only placeholder is `$ARGUMENTS` is compared as a template: every other part word for word, each `$ARGUMENTS` any text. When the engine's text does not fit it, the engine's filled text stays and the file's current text follows it, with a note that it replaces the instructions above and that the arguments above still apply.
   - A file with another placeholder (`$1`, `${...}`, `` !`...` ``) cannot be compared, because the engine filled it in. When the file was written after the session started, the same note follows.
   - A skill or command that is not called again is not sent again.
2. It records every rules file the `instructions` attachment carries (each starts with `Contents of <path> (`, and only a path with `/rules/` in it counts), and the global `CLAUDE.md` (`~/.claude/CLAUDE.md`, under `CLAUDE_CONFIG_DIR` when it is set). A project's `CLAUDE.md` does not count. At each prompt you send, a rules file whose text changed since the session read it reaches the model with that prompt (a file written again with the same text sends nothing), as a note only the model reads: the file, and its current text, which replaces the earlier one. Each change is sent once.

You read one line per event in the [sidebar](../sidebar) stream, or in the transcript while the sidebar is closed:

    context-restore: changed on disk, the call got the current text: commit
    context-restore: changed on disk, the new text went to the model: context7.md

`/context-restore` prints the setting, how many rules files are watched, and the last event.

## Command

    /context-restore            the setting, what is watched, and the last event
    /context-restore on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install context-restore@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Install the [sidebar](../sidebar) mod for the event lines. Without it the mod writes them to the transcript.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.281:

    ❯ ./register.ts hooks: session.start, command.run{command=context-restore}, skill.prompt, prompt.attachment{type=instructions}, prompt.submit
    ❯ ./register.ts calls: $.clock.now, $.command.register, $.env.get, $.fs.exists (via commandFileOf, mtimeOf, pluginDirs), $.fs.read (via changedRules, pluginDirs, readBody, recordRules), $.fs.stat (via mtimeOf), $.sidebar.set (via toPerson), $.store.get, $.store.set (via setEnabled), $.ui.log
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1, it reads files.

    1. Reads:    the file of each skill and command the session calls, and its last write time; the rules files and the global CLAUDE.md the session read, and their last write time; the host's installed_plugins.json, to find a plugin's command file
    2. Runs:     nothing
    3. Sends:    to the model, the current text of a called skill or command whose file changed, and the whole text of a read rules file or of the global CLAUDE.md that changed on disk
    4. Persists: in $.store, the on/off setting; the rules records live in memory and end with the session
    5. Hostile input: every text sent is a file the session itself uses; a skill or rules file that holds hostile text reaches the model through the engine as well

## Limits

- A file with a placeholder other than `$ARGUMENTS` counts as changed by its last write time against the session's start. `/reload-plugins` keeps an unchanged module and its start time, so a plugin updated and reloaded mid-session reads as changed at each call of such a file.
- A `$ARGUMENTS` template fits loosely: a file that changed from `Old $ARGUMENTS` to `$ARGUMENTS` fits every engine text, so that change is not seen.
- A file with placeholders gets its current text after the engine's text, with the placeholders not filled in.
- A command whose file is in neither place the mod looks (a `--plugin-dir` plugin, a nested command name) keeps the engine's text.
- A changed rules file reaches the model with the next prompt, not at the moment it is written. When a compaction comes between the change and the next prompt, the engine sends the file too.
- A project's CLAUDE.md is not watched; only the global one is.
- The global CLAUDE.md goes to the model whole at each change, about 5k tokens for a 21 KB file.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
