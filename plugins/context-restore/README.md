# context-restore

A Claude Code Mod that puts back the full text of every skill and command the session used when compaction cut it, and hands the model the new text of a skill, command or rules file that changed on disk while the session ran.

## What it does

1. Each time a skill or a command opens (typed as `/name`, called through the Skill tool, or preloaded into a subagent), the mod records the text the model read, the file it came from, and when that file was last written. A skill names its directory in its first line (`Base directory for this skill: <dir>`), so its file is `<dir>/SKILL.md`. A command's file is looked up: a plugin's `commands/<name>.md` for `<plugin>:<name>`, else the project's or your own `commands/<name>.md`. A built-in command has no file.
2. After a compaction the engine hands the used skills back to the model in one `invoked_skills` attachment, and cuts a skill longer than 20,000 characters with the line `[... skill content truncated for compaction; use Read on the skill path if you need the full text]` (measured on 2.1.280). The mod rewrites that attachment before the request goes out: each skill and command gets the text the model read when the session used it. A resumed session in a new process has no such record, so the text comes from the file.
3. The mod records every rules file the `instructions` attachment carries (each starts with `Contents of <path> (`, and only a path with `/rules/` in it counts). The rules survive a compaction whole (measured: the same text is sent again), so a rules file is watched for changes alone.
4. At each prompt you send, the mod checks the last write of every recorded file. A file written since the session read it reaches the model with that prompt, as a note only the model reads: the file, and its current text, which replaces the earlier one. Each change is sent once.
5. You read one line per event in the [sidebar](../sidebar) stream, or in the transcript while the sidebar is closed:

       context-restore: restored after compaction: commit, no-ai
       context-restore: changed on disk, the new text went to the model: context7.md

6. `/context-restore` prints the setting, how many skills, commands and rules files are watched, and the last event.

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

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ ./register.ts hooks: session.start, command.run{command=context-restore}, skill.prompt, prompt.attachment{type=invoked_skills}, prompt.attachment{type=instructions}, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.env.get, $.fs.exists (via commandFileOf, fullTextOf, mtimeOf, pluginDirs), $.fs.read (via changedRules, pluginDirs, readBody), $.fs.stat (via mtimeOf), $.sidebar.set (via toPerson), $.store.get, $.store.set (via setEnabled), $.ui.log (via changeNotes, recordUse, restoreSkills, toPerson)
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1, it reads files.

    1. Reads:    the text of each skill and command the session opens; the skill, command and rules files it used, and their last write time; the host's installed_plugins.json, to find a plugin's command file
    2. Runs:     nothing
    3. Sends:    to the model, the full text of the used skills and commands after a compaction, and the text of a used file that changed on disk
    4. Persists: in $.store, the on/off setting; the recorded texts live in memory and end with the session
    5. Hostile input: every text sent is a file the session itself used; a skill or rules file that holds hostile text was already in the context before the mod sent it again

## Limits

- The full text is larger than the cut one: a 50 KB skill costs its whole size in the context after each compaction. `/context-restore off` keeps the engine's cut.
- A file read from disk (a resumed session, or a change) is sent as written, with its frontmatter removed and `$ARGUMENTS` not filled in.
- A changed file reaches the model with the next prompt, not at the moment it is written.
- A command whose file is in neither place the mod looks (a `--plugin-dir` plugin, a nested command name) is restored from its record, and a change to its file is not seen.
- CLAUDE.md is not watched.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
