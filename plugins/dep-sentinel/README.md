# dep-sentinel

A Claude Code Mod that checks each package the model installs before the install runs. It asks the package's registry and OSV.dev, and stops an install of a missing, brand-new, look-alike, outdated or vulnerable package. The model reads why, and the latest version.

## What it does

1. The mod reads the Bash command without a shell and finds the packages it installs:
   - npm: `npm i|install|add`, `pnpm add`, `yarn add`, `bun add|install`;
   - PyPI: `pip install`, `pip3 install`, `python -m pip install`, `uv pip install`, `uv add`, `poetry add`;
   - Go: `go get`, `go install`;
   - crates.io: `cargo add`;
   - Packagist: `composer require`.

   A local path, a URL, a git source, a requirements file (`-r`) and an editable install (`-e`) are not checked. At most 10 packages per command are checked.
2. For each package it asks the registry: registry.npmjs.org, pypi.org, proxy.golang.org, crates.io or repo.packagist.org. A Go package path is looked up at its module, the nearest parent path the proxy knows.
3. It asks OSV.dev for known vulnerabilities of the version that would be installed: the pinned version, else the latest.
4. The install is stopped when:
   - no registry knows the package;
   - the name is one or two edits from a popular package name (one edit under 7 characters, none under 4), unless the package is over a year old with 10 or more versions;
   - the package was first published less than 7 days ago; a new version of an older package is not stopped;
   - an exact pin (`lodash@4.17.15`, `requests==2.25.0`, `tokio@=1.38.0`, `go get x@v1.9.0`, `vendor/pkg:2.0.0`) is not the latest version; the reason names the latest, and the latest in the same major version when that differs;
   - OSV.dev lists a known vulnerability for that version; the reason names the ids and the versions that fix them.
5. The model reads the reasons as the command's error, with the instruction to install the latest version or the right name. When the user needs exactly that package, the model tells the user why and runs the command again with the `DEP_SENTINEL_SKIP=1` prefix. The mod logs such a skip.
6. When a registry or OSV.dev cannot be reached, the install runs, and the model reads which package ran unchecked and why. The same moment writes one line to the transcript, so you see it too:

       dep-sentinel: the install ran unchecked for: lodash (api.osv.dev answered HTTP 503)

   The note and the line are separate channels: the model never reads the line, and you never read the note.
7. While the [sidebar](../sidebar) is open, the unchecked packages and the skipped ones go there instead, one line per package, as entries in its stream, and the transcript stays clean. An entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript lines are written as above.

In the live check `npm install --dry-run lodash@4.17.15` was stopped with the latest version 4.18.1 and 6 OSV ids, `npm install --dry-run lodahs` was stopped as a look-alike of lodash with OSV id MAL-2025-25502, and `npm install --dry-run left-pad` ran.

## Command

    /dep-sentinel            on or off
    /dep-sentinel on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install dep-sentinel@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=dep-sentinel}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now, $.command.register, $.http.fetch (via fetchText, osvCheck), $.sidebar.set (via toPerson), $.store.get (via isEnabled), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L3, reaches the network.

    1. Reads:    the Bash command text
    2. Runs:     nothing
    3. Sends:    each package name, and its version, to its public registry and to api.osv.dev; a note to the model and one line to the transcript when a check failed; nothing else leaves the machine
    4. Persists: in $.store, the on/off setting
    5. Hostile input: a package name comes from the model's command; it reaches a registry only inside a URL path or a JSON body, and a registry answer is read as data

## Limits

- The popular-name list is fixed in `hooks/popular.ts` (about 150 npm and PyPI names, fewer for the other registries). A look-alike of a package not on the list is not seen.
- A version range (`^18`, `>=4`, `cargo add serde@1.0`) is not stopped as old, because the installer resolves it; its latest version is checked on OSV.dev.
- npm package documents are large (16 MB for typescript, measured), so a check takes up to a few seconds.
- An install that a script, an alias or a lockfile runs (`npm ci`, `pip install -r`) is not checked.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
