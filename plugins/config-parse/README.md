# config-parse

A Claude Code Mod that parses each JSON, YAML, TOML or `.env` file an Edit or Write touches, and notes the parse error at once instead of at the next build.

## What it does

1. After each Edit or Write that the engine ran, the mod reads the path. A `.json`, `.jsonc`, `.yml`, `.yaml`, `.toml`, `.env` or `.env.<name>` file is parsed; every other file is left alone. A file its own tool reads as JSON with comments (`.jsonc`, `tsconfig*.json`, `jsconfig*.json`, `.vscode/*.json`, `devcontainer.json`) may hold `//` and `/* */` comments and trailing commas; every other JSON file is strict.
2. JSON is parsed by the mod itself, and a `.env` file is read line by line: a line that is not empty, a comment or `KEY=value` is the finding, with its number.
3. YAML and TOML are parsed by `python3` (`yaml.load_all` with a safe loader, and `tomllib.load`), the file path as one argv item. Every document of a `---` stream is read, and an application tag such as `!Ref` or `!vault` is accepted, because both are valid YAML. When python or the module is missing, that kind is skipped for the session and one line says so.
4. A file that does not parse is written to two channels: the model gets a `context` note naming the file and the error, and the person gets a red entry in the shared sidebar's stream (the file, then the error with the position the parser names, such as `line 2` or `(line 3, column 5)`, in yellow), or a transcript line where the sidebar is closed. The file is named against the git repository the session started in, or against the session's directory outside a repository; that root is read once at the session's start, because a Bash `cd` moves the session's own directory.
5. When a later edit makes the same file parse again, the standing entry is cleared and one green line says so. That line goes to the person only, because the model fixed it itself. A file deleted while its finding stands closes the same way at the next measure, with `<file> is gone, and its parse error with it`. A file that is there and cannot be read keeps its finding.
6. The mod never denies an edit. The file is written, then read.
7. A finding the model did not close is measured again at the end of each main-loop turn, and what is left reaches the model as one note with its next prompt:

       config-parse: 1 file(s) still do not parse: package.json. Fix them.

   One note per turn, not one per prompt. Without this the finding would be said once, at the edit, and then stand in the pane while the model forgot it. You read nothing new: the pane already carries the same finding.
8. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while a file does not parse. Before it stops one it parses every open file again, so the command runs by itself once the model fixed them. A `git commit` answers for its own files alone: the mod reads the index (`git diff --cached --name-only`) and lets the commit run when it holds none of the open files, with one line to you naming how many still stand. A `push` and a `merge` hold no index to read, so every finding stands there. There is no bypass: a `--dry-run`, a `--help` and every other command pass, but a real commit of a broken file waits for the fix. `note` mode is the default and stops nothing.

In the live check a JSON file broken with a trailing comma got the note (`Property name must be a string literal`), a YAML file broken with `a: 1: 2` got the python error, and the next Write of `a: 1` closed the finding with `parses as YAML again`.

## Command

    /config-parse                 on or off, the mode, and the files that do not parse
    /config-parse on | off        on by default
    /config-parse mode note       note only; the default
    /config-parse mode deny       a commit, a push and a merge also stop while a file does not parse

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install config-parse@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Install `python3` with PyYAML for the YAML check (`python3 -m pip install pyyaml`). TOML needs python 3.11 or newer only. Without them those two kinds are skipped and JSON and `.env` still work.
2. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ ./register.ts hooks: session.start, command.run{command=config-parse}, tool.call{tool=Edit}, tool.call{tool=Write}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via pythonCheck, shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log

Reach L2, reads files and runs a process.

    1. Reads:    the path of each Edit and Write, the command of each Bash call, and the text of the edited JSON and .env files, and each open file again at the turn's end
    2. Runs:     python3 -c, by argv, on YAML and TOML files; git rev-parse --show-toplevel once at the session's start, to name files against the repository root; and git rev-parse --show-toplevel plus git diff --cached --name-only at a commit in deny mode
    3. Sends:    the file name and the parse error to the model, and one more note with the next prompt while a finding stands; nothing leaves the machine
    4. Persists: the on/off setting and the mode in $.store
    5. Hostile input: the path comes from the tool call and reaches python as one argv item, never through a shell; the python program is fixed text and reads sys.argv[1]

## Limits

- The check runs after the write, so a broken file exists until the next edit fixes it. No edit is ever denied; in `deny` mode only a commit, a push and a merge stop.
- The `deny` mode has no bypass. When a finding cannot be fixed, the person turns the gate off with `/config-parse mode note`.
- A git command run through a wrapper, an alias or a script the mod cannot read as `git commit|push|merge` passes the gate.
- A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed to the index, because they commit files the index does not hold yet. Every open finding stands for those.
- The index is read before the command runs. A commit whose files change between the read and the run is measured against what the index held at the read.
- A `.env` line is checked for its shape only. A wrong value, a missing quote or a duplicate key is not a finding.
- A JSON file with comments under a name the mod does not know as JSON with comments (a `.json` name outside the list in step 1) is reported as broken, because that name is read strictly.
- YAML and TOML need `python3`; on a machine without it those files are never checked.
- An edit made outside Edit and Write, for example by a Bash `sed`, is not seen.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
