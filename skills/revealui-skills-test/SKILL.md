---
name: revealui-skills-test
description: Static linter for Studio Agent Skills. Checks source frontmatter shape and rule patterns, plus installed adapter command symlinks. Read-only.
license: MIT
compatibility: RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked.
allowed-tools: Bash Read Glob Grep
metadata:
  pack: studio
  author: RevealUI Studio
  version: "0.2.2"
  website: https://revealui.com
---

Lint the source skill tree **without** requiring a Claude-only command dir. The batch linter checks frontmatter and rule patterns, plus installed command symlinks. It does not execute skill bodies or resolve every command, referenced script, repo, or CLI in prose.

Load helpers:
```bash
. "$REVEALFLEET_ROOT/revskills/scripts/lib/session-state.sh"
```

## Roots scanned

1. **SoT (always):** `$REVEALFLEET_ROOT/revskills/skills/*/SKILL.md`
2. **Adapter command symlinks (when present):** `~/.claude/commands`, `~/.grok/commands`, and `~/.cursor/commands`, or the colon-separated `REVSKILLS_COMMAND_DIRS` override.

Never FAIL solely because `~/.claude/commands` is missing.

## Checks performed by the batch linter

### 1. Frontmatter

- Parse frontmatter with the repository metadata validator and check the declared required fields.

### 2. Rule compliance (awk linter)

```bash
awk -f "$REVEALFLEET_ROOT/revskills/scripts/lib/lint-skill.awk" <skill>
```

Tags: `stale-suite-path`, `git-C-violates-bash.md`, `pnpm-dir-violates-bash.md`, `inline-node-e-violates-hooks.md`, `tmux-legacy`.

### 3. Adapter command symlinks

For present configured command directories, dangling Markdown symlinks fail.
This check does not validate plain command file bodies.

## Batch / CI (no interactive harness required)

```bash
bash "$REVEALFLEET_ROOT/revskills/scripts/lint-all-skills.sh"
bash "$REVEALFLEET_ROOT/revskills/scripts/lint-all-skills.sh" --json
```

Exits 0 on clean, 1 on violation. Preferred pre-push path.

## Output

```
skill              status   issues
revealui-recover   PASS     -
…
```

`--json` prints summary counts. It does not write a sidecar.

## Do not

- Do not execute skill bodies — parse statically only.
- Do not modify any file — read-only validator.
