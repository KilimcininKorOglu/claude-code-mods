# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and select **Report a vulnerability**, or go to <https://github.com/KilimcininKorOglu/claude-code-mods/security/advisories/new>. Only the maintainer sees the report.

Include:

- the mod and its version (`plugins/<mod>/.claude-plugin/plugin.json`);
- the Claude Code version and the operating system;
- what input reaches the mod, and what it makes the mod do;
- a fix you suggest, if you have one.

You get an answer to a report. A confirmed problem gets a fix in a new mod version and a GitHub security advisory, which credits you unless you ask not to be named.

## Scope

In scope: the code of every mod in `plugins/`, the scaffolding in `templates/`, and the site generator in `docs/`.

Out of scope: Claude Code itself (report those to Anthropic), and a problem that only an older mod version has. Run `claude plugin update <mod>@kilimcininkoroglu-mods` to get the current version.

Each mod README lists what the mod reads, runs, sends and keeps, and how it treats hostile input, under "What it can reach". A mod that does more than its README says is a security problem too.
