# config-parse

A missing comma in `package.json` or a bad indent in a YAML file costs nothing at the moment it is made; you find out at the next build, or when a service refuses to start, often far from the edit that caused it. This mod parses every JSON, YAML, TOML or `.env` file right after an Edit or Write touches it, and tells the model about a parse error on the spot.

## What it does

1. After each Edit or Write the engine ran, it looks at the path. A `.json`, `.jsonc`, `.yml`, `.yaml`, `.toml`, `.env` or `.env.<name>` file is parsed; every other file is left alone. Files their own tool reads as JSON with comments (`.jsonc`, `tsconfig*.json`, `jsconfig*.json`, `.vscode/*.json`, `devcontainer.json`) may hold `//` and `/* */` comments and trailing commas. Every other JSON file is parsed strictly.
2. JSON is parsed by the mod itself. A `.env` file is read line by line: a line that is not empty, not a comment and not `KEY=value` (an `export` in front is fine) is the finding, with its line number.
3. YAML and TOML are parsed by `python3` (`yaml.load_all` with a safe loader, and `tomllib.load`), with the file path passed as one argv item. Every document of a `---` stream is read, and application tags such as `!Ref` or `!vault` are accepted, because both are valid YAML. If python or the module is missing, that kind is skipped for the session and one line tells you.
4. A file that does not parse goes to two channels. The model gets a `context` note naming the file and the error. You get a red entry in the [sidebar](../sidebar) stream (the file first, then the error, with the position the parser names, such as `line 2` or `(line 3, column 5)`, in yellow), or a transcript line when the sidebar is closed. The file is shown relative to the git repository the session started in, or to the session's directory outside a repository. That root is read once at the session's start, because a Bash `cd` moves the session's own directory.
5. When a later edit makes the same file parse again, the standing entry is cleared and a green line says so. That line goes to you only, because the model fixed the file itself. A file deleted while its finding stands closes the same way at the next measure, with `<file> is gone, and its parse error with it`. A file that is there but cannot be read keeps its finding.
6. It never denies an edit. The file is written first, then read.
7. A finding the model did not close is measured again at the end of each main-loop turn, and whatever is left reaches the model as one note with your next prompt:

       config-parse: 1 file(s) still do not parse: package.json. Fix them.

   That is one note per turn, not one per prompt. Without it the finding would be said once, at the edit, and then sit in the pane while the model forgot about it. You read nothing new, because the pane already shows the same finding.
8. In `deny` mode it also stops `git commit`, `git push` and `git merge` while a file does not parse. Before stopping one it parses every open file again, so the command goes through by itself once the model fixed them. A `git commit` answers for its own files alone: the mod reads the index (`git diff --cached --name-only -z`) and lets the commit run when it holds none of the open files, with one line telling you how many still stand. A `push` and a `merge` have no index to read, so every finding counts there. There is no bypass: `--dry-run`, `--help` and `-h` pass, but a real commit of a broken file waits for the fix. `note` mode is the default and stops nothing.

In the live check a JSON file broken with a trailing comma got the note (`Property name must be a string literal`), a YAML file broken with `a: 1: 2` got the python error, and the next Write of `a: 1` closed the finding with `parses as YAML again`.

## Command

    /config-parse                 on or off, the mode, and the files that do not parse
    /config-parse on | off        on by default
    /config-parse mode note       note only; the default
    /config-parse mode deny       a commit, a push and a merge also stop while a file does not parse

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install config-parse@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Install `python3` with PyYAML for the YAML check (`python3 -m pip install pyyaml`). TOML only needs python 3.11 or newer. Without them those two kinds are skipped; JSON and `.env` still work.
2. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=config-parse}, tool.call{tool=Edit}, tool.call{tool=Write}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isGone), $.fs.read (via fileText), $.process.run (via pythonCheck, shownRootOf, stagedPaths), $.session.cwd, $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log

Reach L2: it reads files and runs a process.

    1. Reads:    the path of each Edit and Write, the command of each Bash call, and the text of the edited JSON and .env files, and each open file again at the turn's end
    2. Runs:     python3 -c, by argv, on YAML and TOML files; git rev-parse --show-toplevel once at the session's start, to name files against the repository root; and git rev-parse --show-toplevel plus git diff --cached --name-only -z at a commit in deny mode
    3. Sends:    the file name and the parse error to the model, and one more note with the next prompt while a finding stands; nothing leaves the machine
    4. Persists: the on/off setting and the mode in $.store
    5. Hostile input: the path comes from the tool call and reaches python as one argv item, never through a shell; the python program is fixed text and reads sys.argv[1]

## Limits

- The check runs after the write, so a broken file exists until the next edit fixes it. No edit is ever denied; in `deny` mode only a commit, a push and a merge stop.
- The `deny` mode has no bypass. When a finding cannot be fixed, you turn the gate off with `/config-parse mode note`.
- A git command run through a wrapper, an alias or a script that the mod cannot read as `git commit|push|merge` passes the gate.
- A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed to the index, because they commit files the index does not hold yet. Every open finding counts for those.
- The index is read before the command runs. A commit whose files change between that read and the run is measured against what the index held at the read.
- A `.env` line is checked for its shape only. A wrong value, a missing quote or a duplicate key is not a finding.
- A JSON file with comments under a name the mod does not know as JSON with comments (a `.json` name outside the list in item 1) is reported as broken, because that name is read strictly.
- YAML and TOML need `python3`; on a machine without it those files are never checked.
- An edit made outside Edit and Write, for example by a Bash `sed`, is not seen.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
