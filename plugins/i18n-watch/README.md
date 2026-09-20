# i18n-watch

A Claude Code Mod that tells the model when an edit uses translation keys that one or more locale files lack. The note comes with the Edit's result, so the model adds the keys in the same turn. Nothing is stopped.

## What it does

1. The mod hooks the Edit and Write tools. After a successful call on a source file (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.php`, `.py`, `.rb`, `.erb`, `.haml`, `.slim`), it reads the translation calls the edit added: those in `new_string` that `old_string` does not have, or every call of a Write.
2. The calls read are `t`, `$t`, `i18n.t`, `__`, `trans`, `trans_choice`, `@lang`, `_`, `gettext` and `ngettext` with a quoted first argument, also after `this.`, `vm.`, `i18n.`, `$i18n.`, `I18n.` and `i18n.global.`. A variable argument, a template literal and a Rails lazy key (`t('.title')`) are skipped.
3. It reads the locale files under these directories of the session directory, at most 4 levels deep and 200 files: `locales`, `lang`, `i18n`, `translations`, `locale`, `config/locales`, `resources/lang`, `src/locales`, `src/i18n`, `public/locales`.

   | Format | Example path | Keys |
   |---|---|---|
   | JSON (i18next, vue-i18n, Laravel) | `locales/tr.json`, `locales/tr/checkout.json`, `lang/tr.json` | nested keys as dotted paths; `item_one` also defines `item` |
   | PHP array (Laravel) | `lang/tr/messages.php` | `messages.key`, nested arrays as dotted paths |
   | YAML (Rails, Symfony) | `config/locales/tr.yml`, `translations/messages.tr.yaml` | dotted paths; a Rails top key (`tr:`) is left out |
   | gettext | `locale/tr/LC_MESSAGES/django.po` | each `msgid` |

   The language comes from a directory (`tr/`, `en-US/`) or from the file name (`tr.json`, `messages.tr.yaml`). A key in a namespace file also counts as `ns.key` and `ns:key`.
4. A key is missing when a language lacks it, or when no language has it. The model reads this note after the Edit's result:

       i18n-watch: this edit uses translation keys the locale files lack: checkout.total (missing in tr, de) · checkout.vat (missing in every locale). Add them to each locale file.

   At most 10 keys are named, the rest counted.
5. The same moment writes one line to the transcript, so you see what the model was told. The line holds the keys alone, without the instruction:

       i18n-watch: keys the locale files lack: checkout.total (missing in tr, de) · checkout.vat (missing in every locale)

   The note and the line are separate channels: the model never reads the line, and you never read the note.

The locale files are read at the first edit of a turn that adds a key, and again after an Edit or Write of a locale file. A project without these directories gets nothing. A locale file that cannot be read or parsed is skipped and logged once per session.

In the live check the model added `t('cart.total')` to a file of a project with `locales/en.json` and `locales/tr.json`, read the note after the Edit, and quoted it word for word.

## Command

    /i18n-watch            on or off
    /i18n-watch on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install i18n-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=i18n-watch}, turn.start, tool.call{tool=Edit}, tool.call{tool=Write}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via isDir), $.fs.list (via walkLocales), $.fs.read (via loadCatalog), $.fs.stat (via isDir), $.session.cwd (via catalogOf), $.store.get, $.store.set (via runCommand), $.ui.log (via afterEdit, catalogOf)

Reach L1, reads files.

    1. Reads:    the text of each Edit and Write call; the locale directories under the session directory and their files
    2. Runs:     nothing
    3. Sends:    a note to the model after an edit that uses missing keys, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting; the locale keys live in memory for one turn
    5. Hostile input: locale files are only parsed as data (JSON.parse and line regexes), never run; PHP files are not executed

## Limits

- Only the locale directories under the session directory are read. A monorepo whose locales sit in `apps/web/src/locales` is not seen when the session starts at the repository root.
- A Laravel PHP file is read line by line, not run: an array opened and closed on one line, a computed key and an `include`d array are not seen.
- YAML is read by indent. Anchors, aliases and flow mappings (`{a: b}`) are not followed.
- A key built at run time (`t(name)`, `` t(`a.${b}`) ``) is not checked.
- A language code is two letters with an optional region or script (`tr`, `pt_BR`, `zh-Hant`); a three-letter code such as `fil` is not recognised.
- A key the edit only moves (it was in `old_string` too) is not checked, and neither is an edit through Bash.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
