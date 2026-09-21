# i18n-watch

A Claude Code Mod that tells the model when an edit uses translation keys that one or more locale files lack. The note comes with the Edit's result, so the model adds the keys in the same turn. By default nothing is stopped; in `deny` mode a commit, a push and a merge stop while a key is missing.

## What it does

1. The mod hooks the Edit and Write tools. After a successful call on a source file (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.php`, `.py`, `.rb`, `.erb`, `.haml`, `.slim`), it reads the translation calls the edit added: those in `new_string` that `old_string` does not have, or every call of a Write.
2. The calls read are `t`, `$t`, `i18n.t`, `__`, `trans`, `trans_choice`, `@lang`, `_`, `gettext` and `ngettext` with a quoted first argument, also after `this.`, `vm.`, `i18n.`, `$i18n.`, `I18n.` and `i18n.global.`. A variable argument, a template literal and a Rails lazy key (`t('.title')`) are skipped.
3. It reads the locale files under these directories of the session directory, at most 4 levels deep and 200 files: `locales`, `lang`, `i18n`, `translations`, `locale`, `config/locales`, `resources/lang`, `src/locales`, `src/i18n`, `public/locales`. The session directory is the one the session started in, read once at its start, because a Bash `cd` moves the session's own directory. The edited file is named against that directory too, so a path inside the project is written from the project root.

   | Format | Example path | Keys |
   |---|---|---|
   | JSON (i18next, vue-i18n, Laravel) | `locales/tr.json`, `locales/tr/checkout.json`, `lang/tr.json` | nested keys as dotted paths; `item_one` also defines `item` |
   | PHP array (Laravel) | `lang/tr/messages.php` | `messages.key`, nested arrays as dotted paths |
   | YAML (Rails, Symfony) | `config/locales/tr.yml`, `translations/messages.tr.yaml` | dotted paths; a Rails top key (`tr:`) is left out |
   | gettext | `locale/tr/LC_MESSAGES/django.po` | each `msgid` |

   The language comes from a directory (`tr/`, `en-US/`) or from the file name (`tr.json`, `messages.tr.yaml`). A key in a namespace file also counts as `ns.key` and `ns:key`.
4. A key is missing when a language lacks it, or when no language has it. Each key is named with the line it is called on, so you can open it. The model reads this note after the Edit's result:

       i18n-watch: this edit uses translation keys the locale files lack: checkout.total:42 (missing in tr, de) · checkout.vat:58 (missing in every locale). Add them to each locale file.

   At most 10 keys are named, the rest counted.
5. The same moment writes one line to the transcript, so you see what the model was told. The line holds the keys alone, without the instruction:

       i18n-watch: keys the locale files lack: checkout.total:42 (missing in tr, de) · checkout.vat:58 (missing in every locale)

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. While the [sidebar](../sidebar) is open, those keys go there instead, one line per key, as an entry in its stream, and the transcript stays clean. The entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript line is written as above.

7. A finding is never a remembered answer. The keys it holds are a claim, and every measure reads the source file from disk again and drops the keys it no longer calls. So a finding closes two ways, and both are measured after each Edit and Write and again before a guarded git command:

   - every locale gained the keys;
   - the code stopped calling them, because the edit deleted the string, replaced it with another one or moved it to another file. A file that is gone closes its finding too.

   The entry is cleared and a new one says which of the two it was:

       i18n-watch: every locale now has the keys src/Cart.vue lacked: checkout.total · checkout.vat
       i18n-watch: index.php no longer uses: Unauthorized Access

   With the sidebar closed the same text is one transcript line. The model reads nothing of this: the finding closed by its own work, so a note would only repeat what it just did. A file that is there and cannot be read keeps its finding, because an unread file proves nothing.

8. A finding the model did not close is measured again at the end of each main-loop turn, and what is left reaches the model as one note with its next prompt:

       i18n-watch: 1 file(s) still use translation keys the locale files lack: index.php (Unauthorized Access:42). Add the keys to every locale file, or take the calls out.

   One note per turn, not one per prompt. Without this the finding would be said once, at the edit, and then stand in the pane while the model forgot it. You read nothing new: the pane already carries the same finding.

9. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while a file still uses keys the locale files lack. A `git commit` answers for its own files alone: the mod reads the index (`git diff --cached --name-only`) and lets the commit run when it holds none of the open files, with one line to you naming how many still stand. A `push` and a `merge` hold no index to read, so every finding stands there. There is no bypass; only the person turns the gate off with `/i18n-watch mode note`. `note` mode is the default and stops nothing, but it measures the findings at a git command all the same, so a settled one does not stay in the pane.

The locale files are read at the first edit of a turn that adds a key, and again after an Edit or Write of a locale file. A project without these directories gets nothing. A locale file that cannot be read or parsed is skipped and logged once per session.

In the live check the model added `t('cart.total')` to a file of a project with `locales/en.json` and `locales/tr.json`, read the note after the Edit, and quoted it word for word.

## Command

    /i18n-watch                 on or off, the mode, and the files still missing keys
    /i18n-watch on | off        on by default
    /i18n-watch mode note       note only; the default
    /i18n-watch mode deny       a commit, a push and a merge also stop while a key is missing

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install i18n-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=i18n-watch}, turn.start, tool.call{tool=Bash}, turn.complete, prompt.submit, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isDir, usedNow), $.fs.list (via walkLocales), $.fs.read (via loadCatalog, usedNow), $.fs.stat (via isDir), $.process.run (via stagedPaths), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via catalogOf, gate, toPerson)

Reach L2, it runs git to read the index.

    1. Reads:    the text of each Edit and Write call; the Bash command text; each reported source file again; the locale directories under the session directory and their files
    2. Runs:     git rev-parse --show-toplevel and git diff --cached --name-only, at a guarded command in deny mode, to read which files the commit holds
    3. Sends:    a note to the model after an edit that uses missing keys, one more with the next prompt while a finding stands, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the mode; the locale keys live in memory for one turn
    5. Hostile input: locale files are only parsed as data (JSON.parse and line regexes), never run; PHP files are not executed

## Limits

- Only the locale directories under the session directory are read. A monorepo whose locales sit in `apps/web/src/locales` is not seen when the session starts at the repository root.
- A Laravel PHP file is read line by line, not run: an array opened and closed on one line, a computed key and an `include`d array are not seen.
- YAML is read by indent. Anchors, aliases and flow mappings (`{a: b}`) are not followed.
- A key built at run time (`t(name)`, `` t(`a.${b}`) ``) is not checked.
- A language code is two letters with an optional region or script (`tr`, `pt_BR`, `zh-Hant`); a three-letter code such as `fil` is not recognised.
- A key the edit only moves (it was in `old_string` too) is not checked, and neither is an edit through Bash.
- The `deny` mode has no bypass. When a finding cannot be fixed, the person turns the gate off with `/i18n-watch mode note`.
- The gate reads the command text. A commit through a script or an alias that hides `git commit` is not stopped.
- A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed to the index, because they commit files the index does not hold yet. Every open finding stands for those.
- The index is read before the command runs. A commit whose files change between the read and the run (another process staging meanwhile) is measured against what the index held at the read.
- A finding is closed by the calls the file makes, not by the locale files' own use. A key the code stopped calling is dropped from the finding even when the locale files still lack it, because nothing calls it any more.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
