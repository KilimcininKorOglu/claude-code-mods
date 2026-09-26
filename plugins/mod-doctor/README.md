# mod-doctor

A Claude Code Mod that names each installed plugin, of every marketplace, whose local clone already offers a newer version, so an update you ran for the marketplace and not for the plugin does not stay unnoticed.

## What it does

1. At each session start, and again at the end of each main-loop turn, the mod reads what the host keeps on disk: `~/.claude/plugins/installed_plugins.json` (`$CLAUDE_CONFIG_DIR/plugins/` instead when `CLAUDE_CONFIG_DIR` is set, as the host reads it), which names the version installed of each `<plugin>@<marketplace>` per scope (the user install, and a project install for the project it names; a project install of another project is not read, and of two installs in force the older version is compared); each marketplace's own `.claude-plugin/marketplace.json` in its clone, which says where that plugin sits inside it (one marketplace keeps its plugins under `plugins/`, another is one plugin at its root); and that plugin's `.claude-plugin/plugin.json`, the version the clone offers.
2. It compares installed against offered by the numbers of each part, so `0.10.0` counts as newer than `0.9.0`. Two versions it cannot compare as numbers count as equal, so a version of another shape never asks for an update.
3. While the [sidebar](../sidebar) is open, the plugins that are behind are one `update available` section that stays for the session:

       update available
       sidebar 0.4.1 → 0.5.0
       turkish-native 1.0.0 → 1.2.0
       claude plugin update sidebar@kilimcininkoroglu-mods turkish-native@turkish-native

   In each row the installed version is faint and the offered version is coloured by the jump: a new major version red, a new minor version yellow, a new patch green. The rows past the eighth are counted in one faint line. With the sidebar closed, or without that mod installed, the same finding is one transcript line.
4. Nothing is drawn while every installed plugin is at its clone's version, and the section is taken down as soon as that is true.
5. The measure at each turn's end catches what the session start cannot: a plugin or a marketplace you updated in another window while this session was open, and a sidebar whose own plugin had not opened its pane yet when this mod first measured. The finding reaches the transcript once; a later measure of the same finding says nothing.
6. `/mod-doctor` measures again on the spot and prints the setting, the scope, how many plugins it holds and which are behind. `/mod-doctor marketplace <name>` narrows it to one marketplace, and `marketplace all` widens it back.

The clone is only as new as the last `claude plugin marketplace update`, so this mod answers "I updated the marketplace, did I update the plugins?", not "is there a newer version on GitHub?".

## Command

    /mod-doctor                        the setting, the scope, and every plugin that is behind
    /mod-doctor on | off               on by default
    /mod-doctor marketplace my-mods    that marketplace alone
    /mod-doctor marketplace all        every marketplace the host cloned; the default, stored across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install mod-doctor@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Install the [sidebar](../sidebar) mod for the per-plugin rows. Without it the mod writes one transcript line instead.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=mod-doctor}, turn.complete
    ❯ ./register.ts calls: $.command.register, $.env.get, $.fs.read (via readText), $.sidebar.clear (via clearShown), $.sidebar.set (via toPerson), $.store.get, $.store.set (via setEnabled, setScope), $.ui.log (via toPerson)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L1, it reads files.

    1. Reads:    CLAUDE_CONFIG_DIR, HOME, the host's install record, each marketplace clone's manifest, and one plugin.json per installed plugin. No project file, no prompt, no transcript.
    2. Runs:     nothing; the update command is text for the person to run
    3. Sends:    nothing to the model and nothing to the network; the rows are for the person only
    4. Persists: in $.store, the on/off setting and the scope
    5. Hostile input: every file is read as data, the versions are compared as numbers, and a file of another shape is skipped without a finding

## Limits

- The clone is the measure, not the upstream repository. Run `claude plugin marketplace update <marketplace>` first, or the mod reports nothing new.
- A marketplace that versions its plugins by commit sha (the official one does) reports nothing, because two shas are not comparable as numbers.
- A plugin the marketplace pulls from another repository as a git subdirectory has no version in the clone, so it is skipped.
- The record is read twice per session: at its start, and at the end of its first main-loop turn. A later update in the same session is not seen until `/mod-doctor` or the next session.
- It does not say whether the running session loaded the new code. A `claude plugin update` during a session leaves the old code loaded until `/reload-plugins` or a restart.
- A plugin installed at project scope and at user scope is read as its first record alone.
- Nothing is updated for you. The mod names the command; running it is yours.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
