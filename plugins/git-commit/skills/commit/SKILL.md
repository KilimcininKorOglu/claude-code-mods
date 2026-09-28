---
name: commit
description: >
  Creates git commits with conventional commit messages: detects git state,
  stages explicit paths, and writes atomic type(scope): description commits.
  Invoke this skill for every git commit, both when the user asks ("commit",
  "commitle", "commit at", "commit yap", "push", "stage",
  "değişiklikleri commitle") and when you commit your own finished work.
  Never run `git commit` directly.
license: MIT
metadata:
  author: KilimcininKorOglu
  version: "1.1.0"
  category: git
argument-hint: "[--all | --staged | --modified | --amend | --no-verify | --push]"
---

# Commit

Creates well-formatted commits with conventional commit messages.

The git-commit mod holds every Bash git command to this skill. A `git commit` runs only after this skill was invoked in the current turn, by this agent. Pass the options the user gave (`--push`, `--amend`, `--no-verify`, `--all`) as this skill's arguments: the mod allows those operations only when the skill was opened with them. A command the mod stops tells you which rule it broke; fix that and run it again.

## Usage

```bash
/git-commit:commit                  # Auto-detect and handle changes
/git-commit:commit --all            # Stage all changes including untracked
/git-commit:commit --staged         # Only commit currently staged files
/git-commit:commit --modified       # Stage and commit modified files only
/git-commit:commit --no-verify      # Skip pre-commit hooks
/git-commit:commit --amend          # Amend the last commit
/git-commit:commit --push           # Commit, then push (confirms before pushing)
```

## Git Safety Protocol

- NEVER update the git config
- NEVER skip hooks (--no-verify) unless the user explicitly passes `--no-verify`
- NEVER use `git commit --amend` unless the user explicitly passes `--amend`
- NEVER commit files that likely contain secrets (.env, .env.local, credentials.json, *.pem, *.key, id_rsa, etc.) -- warn the user if detected
- NEVER commit a path that `.gitignore`, `.git/info/exclude` or the global excludes file ignores
- NEVER create empty commits if there are no changes
- NEVER use git commands with -i flag (git rebase -i, git add -i) -- interactive mode is not supported
- NEVER add signatures like "Created by Claude", "Co-authored-by: AI" or similar
- NEVER push unless the user explicitly asked (the `--push` flag, or said "push" / "commit and push") -- a plain commit NEVER pushes
- NEVER create, switch, checkout, or rename branches unless the user explicitly asked for that exact branch operation -- a plain commit MUST stay on the current branch

## Commit Message Format (Default)

Used when repo has no established style or uses conventional commits:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

For multi-line commit messages, use HEREDOC syntax:

```bash
git commit -m "$(cat <<'EOF'
type(scope): subject line

Body paragraph explaining the why, not the what.
Additional context if needed.

Footer: value
EOF
)"
```

## Types

| Type       | Description                              | Example                                |
|------------|------------------------------------------|----------------------------------------|
| `feat`     | New feature                              | `feat: add user authentication`        |
| `fix`      | Bug fix                                  | `fix: resolve memory leak`             |
| `docs`     | Documentation                            | `docs: update API reference`           |
| `style`    | Formatting                               | `style: format code with prettier`     |
| `refactor` | Code change (no fix/feat)                | `refactor: extract helper functions`   |
| `perf`     | Performance                              | `perf: optimize database queries`      |
| `test`     | Tests                                    | `test: add unit tests for auth`        |
| `chore`    | Maintenance                              | `chore: update dependencies`           |
| `ci`       | CI/CD changes                            | `ci: add GitHub Actions workflow`      |
| `security` | Security fixes                           | `security: patch XSS vulnerability`    |
| `hotfix`   | Critical hotfix                          | `hotfix: fix login crash`              |
| `revert`   | Revert changes                           | `revert: undo payment refactor`        |

### Extended Types

- `lint`, `move`, `arch`, `deps-add`, `deps-remove`, `deps-pin`
- `format`, `patch`, `catch`, `remove`, `typo`, `comments`, `deprecate`
- `init`, `seed`, `ux`, `a11y`, `i18n`, `animation`, `ui`, `responsive`
- `db`, `analytics`, `logs`, `logs-remove`, `backup`, `metrics`, `flags`
- `release`, `wip`, `ci-fix`, `ci-build`, `merge`, `license`, `breaking`
- `experiment`, `mock`, `snapshots`, `experimental`, `dx`
- `docs-api`, `docs-readme`, `types`, `business`, `assets`, `gitignore`
- `dead`, `cleanup`, `validation`, `thread`, `offline`

## Process Flow

1. **Gather Context (MANDATORY FIRST STEP)**: The mod appends a `Current repository state` block below this skill with the branch, the status, the recent subjects and the detected style. Run `git diff HEAD` yourself. When the block is missing or says a list was cut, also run these in parallel:
   ```bash
   git status                    # Current state of working tree
   git log --oneline -10         # Recent commits for style matching
   git branch --show-current     # Confirm the current branch and stay on it
   ```
2. **Security Scan**: Check changed files for secrets (.env, keys, credentials)
3. **Smart Staging Decision**:
   - Staged files exist -> commit only staged
   - No staged but changes exist -> analyze and stage appropriately
   - Untracked files -> ask if they should be included
   - Working tree clean -> if a push was requested, skip to step 8; otherwise report no changes
4. **Review Changes**: `git diff --cached --stat` + `git diff --cached`
5. **Match Repo Style**: Look at the recent `git log` and adopt the repo's existing style:
   - Conventional commits (`feat:`, `fix:`) -> follow that
   - Plain messages ("Add login page") -> follow that
   - Ticket prefixes (`JIRA-123: ...`) -> follow that
   - No clear pattern -> default to the conventional `<type>(<scope>): <subject>` format (see Commit Message Format)
6. **Analyze for Logical Grouping**: Check if changes belong together, suggest splitting if multiple concerns
7. **Create Commit**: Use HEREDOC syntax for multi-line, simple -m for single-line
8. **Push (only if requested)**: Push only when the user explicitly asked (`--push`, or said "push" / "commit and push"). If the tree was already clean (nothing to commit), push the existing commits instead.

## Smart Staging Strategy

| Situation            | Action                    |
|----------------------|---------------------------|
| Only staged files    | Commit staged files       |
| Only modified files  | Stage only the files for this logical change (explicit paths), then commit |
| Only untracked files | Prompt for inclusion      |
| Mixed changes        | Stage by logical group; ask which files belong together (never `git add -i`) |
| No changes           | Report clean state        |

## Commit Rules

- Imperative mood: "add" not "added"
- First line: max 72 characters
- Atomic commits: single logical change
- No period at end of subject line
- Subject case follows the repo's recent subjects: lowercase after `type(scope): ` where the log does that, capitalized where the log does that
- Focus on "why" not "what" -- the diff shows what changed
- Stage only the files this change touches (explicit paths); NEVER a blanket `git add .` / `git add -A` / `git add <dir>` -- it can sweep in unrelated changes or another session's work

### When to Split Commits
- Different features or fixes
- Mixed types (feat + fix)
- Unrelated file changes
- Large changes (>100 lines)
- Different modules/packages

## Options

| Option          | Description                | Behavior                  |
|-----------------|----------------------------|---------------------------|
| `--all`         | Stage all changes          | Everything incl. untracked -- use only when all changes belong in one commit |
| `--staged`      | Commit only staged         | Ignores unstaged changes  |
| `--modified`    | Stage modified only        | Excludes untracked files  |
| `--no-verify`   | Skip pre-commit hooks      | Bypass Husky checks       |
| `--amend`       | Modify last commit         | Edit previous commit      |
| `--push`        | Commit, then push          | Confirms before pushing   |
