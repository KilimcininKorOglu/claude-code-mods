# mod-doctor

A Claude Code Mod that names each installed plugin of one marketplace whose local clone already offers a newer version, so an update you ran for the marketplace and not for the plugin does not stay unnoticed.

## What it does

1. At each session start the mod reads two things the host keeps on disk: `~/.claude/plugins/installed_plugins.json`, which names the version installed of each `<mod>@<marketplace>`, and `~/.claude/plugins/marketplaces/<marketplace>/plugins/<mod>/.claude-plugin/plugin.json`, the version that marketplace's clone offers.
2. It compares the two by the numbers of each part, so `0.10.0` counts as newer than `0.9.0`. Two versions it cannot compare as numbers count as equal, so a version of another shape never asks for an update.
3. While the [sidebar](../sidebar) is open, the mods that are behind are one `mods behind` section that stays for the session:

       mods behind
       cache-warm 0.4.0 → 0.5.0
       sidebar 0.4.1 → 0.5.0
       claude plugin update cache-warm@kilimcininkoroglu-mods sidebar@kilimcininkoroglu-mods

   The rows past the eighth are counted in one faint line. With the sidebar closed, or without that mod installed, the same finding is one transcript line.
4. Nothing is drawn while every installed mod is at its clone's version, and the section is taken down as soon as that is true.
5. `/mod-doctor` measures again on the spot and prints the setting, the marketplace, how many of its mods are installed and which are behind.

The clone is only as new as the last `claude plugin marketplace update`, so this mod answers "I updated the marketplace, did I update the plugins?", not "is there a newer version on GitHub?".

## Command

    /mod-doctor                        the setting, the marketplace, and every mod that is behind
    /mod-doctor on | off               on by default
    /mod-doctor marketplace my-mods    the marketplace to check; kilimcininkoroglu-mods by default, stored across sessions

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install mod-doctor@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Run `/mod-doctor marketplace <name>` once when your mods come from another marketplace than `kilimcininkoroglu-mods`.
3. Install the [sidebar](../sidebar) mod for the per-mod rows. Without it the mod writes one transcript line instead.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=mod-doctor}
    ❯ ./register.ts calls: $.command.register, $.env.get, $.fs.read (via readInstalled, readOffered), $.sidebar.clear (via clearShown), $.sidebar.set (via toPerson), $.store.get, $.store.set (via setEnabled, setMarketplace), $.ui.log (via toPerson)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: HOME

Reach L1, it reads files.

    1. Reads:    HOME, the host's install record, and one plugin.json per installed mod of the marketplace. No project file, no prompt, no transcript.
    2. Runs:     nothing; the update command is text for the person to run
    3. Sends:    nothing to the model and nothing to the network; the rows are for the person only
    4. Persists: in $.store, the on/off setting and the marketplace name
    5. Hostile input: the two files are read as data, the versions are compared as numbers, and a file of another shape is skipped without a finding

## Limits

- The clone is the measure, not the upstream repository. Run `claude plugin marketplace update <marketplace>` first, or the mod reports nothing new.
- The record is read once per session, because a plugin's installed version does not change while a session runs. `/mod-doctor` measures again on demand.
- It does not say whether the running session loaded the new code. A `claude plugin update` during a session leaves the old code loaded until `/reload-plugins` or a restart.
- A mod installed at project scope and at user scope is read as its first record alone.
- Nothing is updated for you. The mod names the command; running it is yours.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
