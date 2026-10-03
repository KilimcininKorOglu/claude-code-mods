# context-restore

You fix a skill, a command or a rules file in the middle of a session, call it again, and the model keeps following the old text. Claude Code loads these files once and hands out that first copy for the rest of the session. This mod notices when such a file changed on disk and makes sure the model gets the current text.

## What it does

Measured on Claude Code 2.1.280:

- The engine loads each skill and command once and hands that copy out at every call, even after the file changed on disk. A typed `/name` sends the old text, and a Skill tool call answers `Skill /<name> is already loaded above; instructions unchanged.`
- A skill that compaction cut is sent whole again by the engine itself when it is called again, typed or through the Skill tool. The mod does nothing in that case.
- A rules file, or the global `~/.claude/CLAUDE.md`, that changes between two prompts does not reach the model until a compaction.
- A skill's other files (`subcommands/*.md`, `references/*.md`) never enter the engine's copy; the model reads them with the Read tool. A copy it read earlier in the session stays in the context after the file changed.

So the mod does three things:

1. At each call of a skill or command (typed as `/name`, called through the Skill tool, or preloaded into a subagent), it reads the file the text came from. A skill names its directory in its first line (`Base directory for this skill: <dir>`), so its file is `<dir>/SKILL.md`. A command's file is looked up: a plugin's `commands/<name>.md` for `<plugin>:<name>`, otherwise the project's or your own `commands/<name>.md`. A built-in command has no file.
   - A file with no placeholder is compared with the engine's text. If they differ, the file's text replaces the engine's copy, and the arguments the engine added after it (`ARGUMENTS: ...`) stay. The model then gets the new text, also on a Skill tool call.
   - A file whose only placeholder is `$ARGUMENTS` is compared as a template: every other part word for word, each `$ARGUMENTS` matching any text. If the engine's text does not fit, the engine's filled-in text stays and the file's current text follows it, with a note saying that it replaces the instructions above and that the arguments above still apply.
   - A file with another placeholder (`$1`, `${...}`, `` !`...` ``) cannot be compared, because the engine filled it in. If the file was written after the session started, the same note follows.
   - A skill or command that is not called again is not sent again.
2. It records every rules file the `instructions` attachment carries (each starts with `Contents of <path> (`, and only a path with `/rules/` in it counts), plus the global `CLAUDE.md` (`~/.claude/CLAUDE.md`, under `CLAUDE_CONFIG_DIR` when it is set). A project's `CLAUDE.md` does not count. With each prompt you send, a rules file whose text changed since the session read it reaches the model as a note only the model reads: the file, and its current text, which replaces the earlier one. A file written again with the same text sends nothing, and each change is sent once.
3. It records every file the main loop's Read tool read, with its last write time. A subagent's reads live in its own context, so they are not recorded. At each call of a skill, the files of that skill's directory that the model read and that were written since reach the model as one line at the end of the call's text, naming them and asking the model to read them again; their text is not sent. The line comes at every call until the model reads the file again. Measured on Claude Code 2.1.282 with a skill whose text asks to read its `sub/a.md` at every call: the model read the changed file again both with the line and without it, so the line matters for a skill that does not ask for a fresh read at every call.

You see one line per event in the [sidebar](../sidebar) stream, or in the transcript while the sidebar is closed. The first part is faint and the file names are in the default colour; for a file the model has to read again the names are yellow:

    context-restore: changed on disk, the call got the current text: commit
    context-restore: changed on disk, the new text went to the model: context7.md
    context-restore: changed on disk since the model read it, the call asks to read again: subcommands/ssrf.md (bug-report)

`/context-restore` prints the setting, how many rules files are watched, and the last event.

## Command

    /context-restore            the setting, what is watched, and the last event
    /context-restore on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install context-restore@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code.
2. Install the [sidebar](../sidebar) mod if you want the event lines there. Without it they go to the transcript.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=context-restore}, skill.prompt, tool.call{tool=Read}, prompt.attachment{type=instructions}, prompt.submit
    ❯ ./register.ts calls: $.clock.now, $.command.register, $.env.get, $.fs.exists (via commandFileOf, mtimeOf, pluginDirs), $.fs.read (via changedRules, pluginDirs, readBody, recordRules), $.fs.stat (via mtimeOf), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via setEnabled), $.ui.log
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1: it reads files.

    1. Reads:    the file of each skill and command the session calls, and its last write time; the rules files and the global CLAUDE.md the session read, and their last write time; the last write time of each file the model reads with the Read tool; the host's installed_plugins.json, to find a plugin's command file
    2. Runs:     nothing
    3. Sends:    to the model, the current text of a called skill or command whose file changed, and the whole text of a read rules file or of the global CLAUDE.md that changed on disk; the names of a called skill's files that changed since the model read them
    4. Persists: in $.store, the on/off setting; the rules and read records live in memory and end with the session
    5. Hostile input: every text sent is a file the session itself uses; a skill or rules file that holds hostile text reaches the model through the engine as well

## Limits

- A file with a placeholder other than `$ARGUMENTS` counts as changed by its last write time against the session's start. `/reload-plugins` keeps an unchanged module and its start time, so a plugin updated and reloaded mid-session reads as changed at every call of such a file.
- A `$ARGUMENTS` template fits loosely: a file that changed from `Old $ARGUMENTS` to `$ARGUMENTS` fits every engine text, so that change goes unnoticed.
- A file with placeholders gets its current text after the engine's text, with the placeholders not filled in.
- A command whose file is in neither place the mod looks (a `--plugin-dir` plugin, a command in a subdirectory of `commands/`) keeps the engine's text.
- A changed rules file reaches the model with your next prompt, not at the moment it is written. When a compaction comes between the change and the next prompt, the engine sends the file too.
- `/reload-plugins` makes the engine send the instruction files again with their new text, and the reloaded module takes that as its starting text. After an edit followed by a reload the mod therefore sends nothing, because the engine already did; it matters for an edit with no reload or restart in between.
- A project's CLAUDE.md is not watched, only the global one.
- The global CLAUDE.md goes to the model whole at every change, about 5k tokens for a 21 KB file.
- A changed skill file the model read is named only at the skill's next call, not between calls. `skill.prompt` does not say which loop called the skill, so a skill preloaded into a subagent can get the line for a file only the main loop read.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
