# git-commit

A commit skill tells the model how to commit: explicit paths, no AI signature, no push nobody asked for. The model reads the skill, and then it sometimes runs `git commit` straight from Bash without it. This mod ships the commit skill and holds every Bash git command to it. A commit the skill did not open, a blanket `git add`, a signature trailer, a secret, an ignored path, or a push or branch change nobody asked for is stopped before git runs. The model reads which rule the command broke and runs it again the right way.

## What it does

1. The mod ships the skill as `git-commit:commit` (`skills/commit/SKILL.md`). The model opens it with the Skill tool, or you type `/git-commit:commit`, with the options you gave: `--all`, `--staged`, `--modified`, `--no-verify`, `--amend`, `--push`.
2. When the skill opens, the mod appends a `Current repository state (git-commit)` block to its text: the branch, the staged, unstaged, untracked and conflicted files (40 of each at most), the options the skill was opened with, the style of the last 20 subjects, the last 10 subjects, and a warning for each staged file whose name holds credentials or that an ignore file names. The model starts from that block instead of running `git status` and `git log` first.
3. The skill counts as open for the agent loop that opened it, until that loop's turn ends. The main loop and each subagent are separate: a subagent that commits opens the skill itself. A new turn opens it again.
4. Each Bash command that names git is read before it runs. The mod splits the command at `&&`, `||`, `;`, `|`, `&`, parentheses and new lines, skips `env`, `command`, `exec`, `time`, `nohup` and variable assignments in front of git, and follows a `cd` and `git -C`. It reads the arguments of `add`, `rm`, `commit`, `push`, `merge`, `config`, `rebase`, `switch`, `branch` and `checkout` the way git's own option parser reads them (`-am`, `-mtext`, `--message=text`, `--`), and a heredoc as the message it holds. Every other git call runs unread.
5. To measure what a commit records, the mod copies the index to a temporary file and replays the command's own `git add` and `git rm --cached` calls into that copy through `GIT_INDEX_FILE`. A `commit -a` stages the tracked changes into the copy; a commit with a pathspec starts from a fresh index that holds `HEAD`. The real index is never written, and the temporary files are deleted after the measure.
6. A rule is either hard or soft. In `deny` mode, the default, a command that breaks a hard rule stops before it runs, and the model reads:

       git-commit: stopped before it ran, because it breaks the git-commit:commit skill:
       - A git commit runs only after the git-commit:commit skill was opened in this turn, by this agent. Call the Skill tool with skill "git-commit:commit" and, as args, the options the user gave (such as --push or --amend), follow its steps, then run the commit again.
       There is no way around this gate.

   In `note` mode the command runs, and the model reads the broken rules after its result. A soft rule never stops a command: in both modes its note comes after the result.
7. You read one line per rule: in the [sidebar](../sidebar) stream while it is open (red for a hard rule, yellow for a soft one, under `git command stopped` or `git command noted`), else one transcript line such as `git-commit: stopped: skill not opened`.
8. While the mod is on, the engine's commit attribution text is empty, so the model is not told to add a `Co-Authored-By` trailer.

In the live check on Claude Code 2.1.284 the gate stopped a `git commit` run without the skill, a `git add .`, a `git add -f` of a file `.gitignore` names, a commit with a `Co-Authored-By: Claude` line, and a `git push` the prompt did not ask for. After the model opened `git-commit:commit`, it read the state block and the same commit ran. In `note` mode `git add .` ran, and the model read the broken rule and the three new files it staged.

## Rules

Hard rules (`deny` mode stops the command):

| Command | Stopped when |
|---|---|
| `git commit` | the skill was not opened in this turn by this agent |
| `git commit` | `--no-verify` or `-n` without the skill's `--no-verify`; `--amend` without `--amend`; `-a` without `--all` or `--modified` |
| `git commit` | `--allow-empty`, `--allow-empty-message`, `--interactive`, `-p` |
| `git commit`, `git add` | a pathspec that reaches past this change's files: `.`, `..`, `*`, a glob, a `:` pathspec, a directory (a submodule is a file here); the skill's `--all` allows them |
| `git add` | `-A` without `--all`; `-u` without `--all` or `--modified`; `-i`, `-p`, `-e`, `--pathspec-from-file` |
| `git add -f` | a path that an ignore file names |
| `git commit` | the commit holds a path that an ignore file names: the project's `.gitignore` files, `.git/info/exclude` and the global excludes file, as `git check-ignore -v` reports them, with the file and the line |
| `git commit` | the commit holds a file whose name holds credentials (`.env` and `.env.*` except the example files, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `id_rsa` and the other `id_*` keys, `credentials.json`, `.netrc`, `.pgpass`), or adds a line that looks like a private key, an AWS, Google, GitHub, Slack, Stripe, npm, Hugging Face or `sk-` key, a JSON Web Token, or a quoted value of 16 or more characters with letters and digits after `api_key`, `secret`, `token` or `password`; the note names the file, the line and the kind, never the value |
| `git commit` | the message carries an AI signature: a `Co-authored-by:` line that names an AI tool, a `Generated with` or `Created by` line that names one, `noreply@anthropic.com`, or 🤖. A `Co-authored-by:` line for a person passes |
| `git commit` | the subject is empty, longer than 72 characters, or ends with a period |
| `git commit` | the repository writes conventional subjects (more than half of the last 20, from at least 3), and the subject is not `type(scope): subject`, or its type is not in the skill's list |
| `git commit`, `git push`, `git merge` | `-c core.hooksPath=...`; `HUSKY=0`, `HUSKY_SKIP_HOOKS`, `SKIP` or `LEFTHOOK=0` without the skill's `--no-verify` |
| `git push` | your last prompt does not say `push` and the skill was not opened with `--push`; `--no-verify` without the skill's `--no-verify`. A `--dry-run` passes |
| `git switch`, `git branch <name>`, `git branch -d/-m/-c`, `git checkout -b/-B/--orphan/--detach`, `git checkout <name>` | your last prompt does not say `branch`, `checkout` or `switch`. A `git checkout` with `--`, with two or more operands, or with one operand that is an existing path restores files and passes |
| `git config` | it writes a setting; `--get`, `--list` and the other reads pass |
| `git rebase` | `-i` |

Soft rules (a note in both modes):

- The commit changes more than 100 lines.
- The commit touches more than one area, where an area is the first two path segments (`plugins/a` and `plugins/b`).
- The subject's first word ends in `-ed` or `-ing` (`added`, `adding`).
- The subject's case after `type(scope): ` differs from the case of the recent subjects.
- `git add` stages untracked files; the note names them.
- The mod could not read the message (the shell builds it at run time, it comes from another commit, or git opens an editor), or could not measure what the commit holds (after a `cd -`, a `cd ~` or a `cd` to a path with `$`, or when git could not replay the command's staging).

A `git commit --dry-run`, `--short`, `--porcelain`, `--long` or `--help` records nothing and is not read.

## Command

    /git-commit                   on or off, and the mode
    /git-commit on | off          on by default; off also gives the engine its commit attribution text back
    /git-commit mode deny         a command that breaks a hard rule stops; the default
    /git-commit mode note         every command runs, and the model reads the broken rules after it

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install git-commit@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code.
2. Type `/git-commit:commit` to commit through the skill. `/commit` does not open a plugin skill.
3. If you keep a commit skill of your own (`~/.claude/skills/commit`), remove it. The mod counts only `git-commit:commit` as the skill, so a commit after your own skill is stopped, and the model reads two skills that say the same thing.
4. If your `CLAUDE.md` tells the model to commit through a skill, name it `git-commit:commit` there.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.284:

    ❯ ./register.ts hooks: session.start, command.run{command=git-commit}, turn.start, prompt.submit, tool.call{tool=Skill}, skill.prompt{skill=git-commit:commit}, attribution.text{kind=commit}, tool.call{tool=Bash}, turn.complete
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via directoryFindings, judgeCheckout, scratchIndex), $.fs.read (via messageCheck), $.fs.stat (via directoryFindings), $.process.run (via dropTemps, git, scratchIndex), $.session.cwd (via judge, repoBlock), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via dropTemps, toPerson)

Reach L2, it runs git, `cp` and `rm`.

    1. Reads:    the Bash command text of each call that names git; your prompts, of which it keeps the last one in memory; the Skill tool's arguments; a -F message file; the repository through git
    2. Runs:     git with LC_ALL=C: rev-parse, status, log -20, diff --cached, check-ignore, ls-files, and read-tree, add and rm --cached into a temporary index through GIT_INDEX_FILE; cp to copy the index; rm -f to delete the temporary index files
    3. Sends:    a deny text or a note to the model, a repository state block after the skill's text, one sidebar entry or transcript line to you, and an empty commit attribution text to the engine; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the mode; for the length of one command, temporary index files beside .git/index
    5. Hostile input: the command text is parsed, never run by a shell; the command's own git add arguments are replayed as argv into a temporary index; a secret is named by file, line and kind, never by its value

## Limits

- The gate reads the Bash command text. A commit through `sh -c`, a script, a `make` target, a git alias, `git commit-tree` or an MCP git tool is not read.
- The push and branch checks search your last prompt for a word. `push etme` ("do not push") reads as a request for a push.
- A message that the shell builds when the command runs (`$VAR`, backticks, a `$(...)` other than `cat <<'EOF'`) is not checked; the model reads a note instead.
- The style rules follow the last 20 subjects. Where fewer than 3 exist or fewer than half are conventional, only the length, period and signature rules apply.
- The secret check matches file names and added lines with regular expressions. A key of another shape is not seen.
- The mood check reads the ending of the first word, not its grammar.
- A `git merge` is checked only for skipped hooks.
- The `deny` mode has no bypass. When a hard rule cannot be met, you turn the gate off with `/git-commit mode note`.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
