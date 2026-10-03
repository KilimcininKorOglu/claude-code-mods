# probe-runner

For mod development: runs a live check of plugins in a fresh Claude Code session in tmux, types the steps one by one, collects the pane and the transcript, then deletes the temp directory, its transcripts and the inline store files.

> **A development tool, not an everyday mod.** It was written to check the mods of this repository live while they are built: the model starts a real Claude Code session with only the plugins under test, types prompts and slash commands into it, and reads what happened. Each probe is a real session on your account, so it spends tokens, and the steps it types can run tools in a scratch repository. Install it on your own development machine while you work on mods, and disable it (`claude plugin disable probe-runner@kilimcininkoroglu-mods`) when you do not.

## What it does

One call does what a live check needs by hand: a temp git repository, tmux, the folder trust answer, `--plugin-dir`, the steps typed one after another, the pane and the transcript collected, then the directory, the transcripts and the inline store files deleted. The report looks like this:

    # probe probe-runner-k_mj_kix · sonnet · 102s

    ## pane
    ❯ Public site hangi adreste yayınlanıyor? Dosyalara bakmadan cevap ver.
    ⏺ Public site şu adreste yayınlanıyor: https://cc-mods.keremgok.tr

    ## transcript
    user: Public site hangi adreste yayınlanıyor? ...
    hook context (prompt.submit): [sage-memory] project memory related to this prompt ...
    assistant: Public site şu adreste yayınlanıyor: https://cc-mods.keremgok.tr

    ## deleted
    /private/tmp/probe-runner-k_mj_kix
    ~/.claude/projects/-private-tmp-probe-runner-k-mj-kix

## How it works

1. `scripts/probe.py` makes a git repository under `/private/tmp/probe-runner-<random>` (the system temp directory where `/private/tmp` does not exist) and starts `claude --setting-sources project --model <model> --plugin-dir <dir> ...` in a tmux session there, with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. `--setting-sources project` keeps your own plugins and hooks out, so only the plugins under test load.
2. It answers the folder trust question, waits for the prompt box, and types each step. A completion menu can take the first Enter of a slash command, so Enter is pressed again, up to four times, until the box empties.
3. A step has finished when the pane shows no `esc to interrupt`, shows the prompt box, and did not change between two looks 3 seconds apart. A step stops the probe after 5 minutes, and a probe stops at 10 minutes, the most `$.process.run` waits.
4. The report holds the pane's final text (the docked sidebar cut off), the transcript condensed (prompts, replies, tool calls and results, command output, mod log lines, and the context hooks added), and what was deleted.
5. Before deleting, it waits for the probe's claude to exit, because claude writes its transcript as it exits and would bring a deleted directory back. It deletes the temp directory, `<config dir>/projects/<encoded temp path>*` and the `*_inline-*.json` store files written since the probe started (`<config dir>` is `CLAUDE_CONFIG_DIR` when it is set, else `~/.claude`). A probe killed from outside (SIGTERM, SIGHUP) cleans up too.

Measured on Claude Code 2.1.283: a probe of two slash commands took 23 seconds inside a tool call, so the wait on `$.process.run` is not held to the 10-second hook budget.

What a probe does not test: a mod with a long-lived process of its own (sage-memory's daemon) reuses the running installed process when its protocol is the same, so a probe loads the checkout's hooks but not a daemon change.

## Use

The model calls the tool `mcp__probe-runner__probe` (listed at the start, not behind ToolSearch):

    { "plugins": ["pin-note"], "steps": ["/pin-note on", "/pin-note X", "/clear", "Sabitlenmiş not var mı?"], "model": "sonnet" }

The tool call waits for the probe and answers the report. You run it with the command:

    /probe-runner [--model <model>] <plugin>[,<plugin>...] <step> ;; <step> ;; ...

The command answers `started` at once; the report reaches the model through `/probe-runner:send` when the probe ends, as its own prompt. When the engine refuses that command, one line says so and the report goes as a plugin prompt. A probe that fails answers its exit code and its error text instead of a report.

A plugin is a name under the session's repository `plugins/` directory, or a path (absolute, `~/...`, or relative to the session's directory). A plugin without `.claude-plugin/plugin.json` is refused before anything runs. The model is `sonnet` unless named.

## Install

```sh
claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install probe-runner@kilimcininkoroglu-mods
```

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Install `tmux` and `python3` and keep them on PATH.
2. Restart Claude Code, or run `/reload-plugins` in each open session.
3. Disable it when you are not developing mods: `claude plugin disable probe-runner@kilimcininkoroglu-mods`.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, tool.describe{tool=/"^mcp__probe-runner__probe$"/}, tool.call{tool=/"^mcp__probe-runner__probe$"/}, command.run{command=probe-runner}
    ❯ ./register.ts calls: $.clock.after (via runInBackground), $.command.register, $.command.run (via runInBackground), $.env.get (via pluginDirs), $.fs.exists (via pluginDirs), $.process.run (via runProbe), $.prompt.submit (via runInBackground), $.session.cwd (via pluginDirs), $.session.repo (via pluginDirs), $.tool.register, $.ui.log (via runInBackground)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: HOME

Reach L3: the probe session talks to the Claude API.

## Threat model

```
Threat model for probe-runner (reach L3)
1. Reads:         the session's directory and repository root, HOME, each plugin's manifest; the probe's pane and transcript.
2. Runs:          python3 scripts/probe.py, which runs git, tmux and claude.
3. Sends:         the steps, to a Claude Code session of their own, with your account.
4. Persists:      nothing; the probe's directory, transcripts and inline store files are deleted.
5. Hostile input: the steps and plugin paths come from you or the model and go to claude and tmux as argv, never through a shell; a step can make the probe session run tools inside its scratch repository.
```

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs the /plugin-types output in .claude/types/
    make validate
    make test        # claude plugin test
