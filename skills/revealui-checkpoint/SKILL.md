---
name: revealui-checkpoint
description: Checkpoint checklist for RevealFleet sessions. Validates tracking surfaces, writes rolling handoff and workboard fragments in an isolated worktree, previews derived views, and commits only append-only fragments. Never commits on the primary .jv checkout or commits derived renders. Never master-handoff regen or auto-merge with --admin.
license: MIT
compatibility: RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked.
allowed-tools: Bash Read Write Edit
metadata:
  pack: studio
  author: RevealUI Studio
  version: "0.16.5"
  website: https://revealui.com
---

Checkpoint orchestrator. Run before ending a meaningful session to ensure the next agent can pick up cleanly. Validates tracking state, writes session-specific rolling handoff and workboard fragments in a dedicated `.jv` worktree, previews derived handoff and workboard views locally, and commits only those append-only fragments. The primary `.jv` checkout does not receive checkpoint fragments or commits. Then report CHECKPOINT-READY and emit the next-agent prompt.

This skill is human/agent handoff. It is not `rfloop`. rfloop is a PR/CI operator disk state machine only (P0 stub; no LLM; auto-merge locked). It is not the fleet brain or the product AgentRuntime. Prefer `rfloop`; `revloop` is a rename shim.

Policy home is `$JV_REPO/.revealui` (manager and content) before any vendor tree. Read location and handoff tiers there first. Active handoffs stay at `docs/HANDOFF-*.md`; archive stays at `docs/handoffs/archive/`. `$JV_REPO/.claude/rules/master-handoff.md`, `$JV_REPO/.claude/rules/jv-doc-locations.md`, and `~/.claude/rules/` (including `model-allocation.md`) are Claude adapter attach copies, not the policy home. `$JV_REPO/.claude/workboard.md` is adapter render only.

Load helpers:
```bash
. "$REVEALFLEET_ROOT/revskills/scripts/lib/session-state.sh"
```

## Step 1 — Resolve context

```bash
IDENTITY="$(ss_identity)"
REPO="$(ss_active_repo)"
JV_ROOT="$JV_REPO"
# Write SSOT (session-state defaults). Do not point these at a vendor path.
WORKBOARD_D="${WORKBOARD_D_NEUTRAL:-$JV_ROOT/.revealui/workboard.d}"
WORKBOARD="${WORKBOARD_NEUTRAL:-$JV_ROOT/.revealui/workboard.md}"
# Adapter render/attach only. Not the write SSOT. Not policy.
WORKBOARD_ADAPTER="${WORKBOARD_ADAPTER_CLAUDE:-$JV_ROOT/.claude/workboard.md}"
ISO_DATE="$(date -u +%Y-%m-%d)"
ISO_DATETIME="$(date -u +%Y-%m-%dT%H:%MZ)"
# Populated from handoff-render.js stdout in Step 5b; the primary checkout
# uses a gitignored sidecar, not the tracked CURRENT-HANDOFF.md.
CURRENT_HANDOFF=""
```

Rolling handoff **read surface** is the path printed by `handoff-render.js` for this run. The primary checkout uses a gitignored sidecar; the tracked `CURRENT-HANDOFF.md` can be stale until fragments land and must not be used as the live preview. **Durable write surface:** `docs/handoffs/rolling/<ISO>-<id>.md` only. `~/.claude/rules/model-allocation.md` may restate the handoff loop; that file is adapter attach, not policy. The renderer caps history (`--max`, default 12). Workboard durable writes go to `.revealui/workboard.d`; derived workboards are local previews.

## Step 1b — Load the auto-checkpoint snapshot (fidelity source)

A session snapshot is captured **before context compaction** by the `/snapshot` skill (Grok Stop-gate at the occupancy gate; Claude `[snapshot]` advisory; PreCompact mechanical last-ditch). When one exists it is the PRIMARY source for the narrative sections in Step 4 — more trustworthy than reconstructing from now-deep or already-compacted session memory.

The gate tracks the control-layer token budget (`token-economy`, authored in `packages/harnesses/src/token-budget.ts`). RevKit writes that budget into `~/.grok/config.toml` (`compaction_at_tokens` and `auto_compact_threshold_percent`). The Stop gate fires `snapshotHeadroomTokens` before compact. A checkpoint whose snapshot says `origin: precompact-mechanical` means compact won the race; say so in the fragment.

Resolve it by **this session's id, never by mtime** — a peer's snapshot must be structurally unreachable (GAP-317 + GAP-469). Session id and paths come from `session-state.sh` (neutral SSOT under `~/.local/share/revealui/coordination/`, with read-through of the legacy Claude adapter path).

**Load order (GAP-342 residual):** prefer the filesystem SSOT when present; if the file is missing, best-effort hydrate from daemon `session.snapshot.get` by the same id into the neutral write path (`ss_snapshot_load_path`). Never mtime, never another session's file.

```bash
SID="$(ss_session_id 2>/dev/null || true)"
SNAPSHOT=""
if [ -n "$SID" ]; then
  # Prefers file SSOT; hydrates from daemon by id when file missing (soft-fail).
  SNAPSHOT="$(ss_snapshot_load_path "$SID" 2>/dev/null || true)"
  # Fallback for older session-state without load helper:
  if [ -z "$SNAPSHOT" ]; then
    SNAPSHOT="$(ss_snapshot_path "$SID" 2>/dev/null || true)"
  fi
fi
if [ -n "$SNAPSHOT" ]; then
  echo "snapshot for this session: $SNAPSHOT (sid=$SID)"
  if grep -q '^origin: precompact-mechanical' "$SNAPSHOT"; then
    echo "WARNING: origin=precompact-mechanical — last-ditch hook capture, lower fidelity. Prefer an agent-authored /snapshot if one can still be written."
  fi
else
  echo "no snapshot for this session (${SID:-no-session-id}) — Step 4 falls back to session memory"
fi
```

If `$SNAPSHOT` is set it is unambiguously THIS session's (the filename equals the resolved session id), so no content-matching guesswork is needed. READ it and use its five sections (Resume-From-Here, What-Shipped, Active-Constraints, Do-Not-Repeat, Open-Loose-Ends) as the spine of the Step 4 merge; they map onto the rolling file's sections. If frontmatter has `origin: precompact-mechanical`, say so in the fragment (lower fidelity; compaction fired before agent authoring). With no snapshot — occupancy never hit the gate, or `/snapshot` was not run, or no session id is set — Step 4 proceeds from session memory as before. Do **not** abort solely because `CLAUDE_CODE_SESSION_ID` is unset when another alias is present. Do NOT fall back to the most-recent file on disk; an unmatched id means no snapshot for this session.

## Step 2 — Run coherent-tracking validators

Capture pass/fail per check. Do NOT auto-fix anything destructive.

### 2a. Doc locations
```bash
cd "$JV_ROOT" && "$REVEALFLEET_ROOT/revealui/node_modules/.bin/tsx" scripts/doc-locations-check.ts --quiet
```
Exit 0 = clean. Exit 1 = drift (e.g., handoffs at `docs/handoffs/` top-level, lane plan missing).

### 2b. Workboard freshness
```bash
node "$JV_ROOT/scripts/workboard-check.js"
```
Read-only. Warns on stale Active Sessions / Coordination Notes / Log entries. Never blocks.

### 2c. MASTER_HANDOFF staleness
```bash
node "$JV_ROOT/scripts/master-handoff-staleness.js"
```
Recomputes `staleness-status` (FRESH / STALE / EXPIRED) in `docs/MASTER_HANDOFF.md` frontmatter. Read-only against body. If the result is STALE or EXPIRED, list `/rollup` under OUTSTANDING — do **not** run `master-handoff-regen` inside checkpoint (skill `revealui-rollup`).

### 2d. Lane plans
```bash
node "$JV_ROOT/scripts/lanes-check.js"
```
Validates each lane's frontmatter + plan.md presence.

### 2e. M-1 ADR tracking-issue compliance
```bash
TSX="$REVEALFLEET_ROOT/revealui/node_modules/.bin/tsx"
# revealui-jv default branch is `test`; origin/main is not a ref. Prefer a
# resolvable origin/test, then origin/main. The checker also falls back if the
# named ref is missing (dangling origin/HEAD used to point at origin/main).
BASE_REF=origin/test
if ( cd "$JV_ROOT" && git rev-parse --verify --quiet origin/test >/dev/null 2>&1 ); then
  BASE_REF=origin/test
elif ( cd "$JV_ROOT" && git rev-parse --verify --quiet origin/main >/dev/null 2>&1 ); then
  BASE_REF=origin/main
fi
"$TSX" "$JV_ROOT/scripts/m1-adr-tracking-check.ts" --base-ref="$BASE_REF" --head-ref=HEAD --mode=ci
```
Every ADR (post-2026-05-16 cutoff) must carry `tracking-issue:` frontmatter. The check needs a diff range: `<default-branch>...HEAD` (empty range → exit 0). Invoking it with no range exits 2 with a usage error — that was the Step 2e bug, fixed 2026-06-06. Do not hardcode `origin/main` on repos whose GitHub default branch is `test`.

### 2f. M-1 frontmatter staleness
```bash
"$REVEALFLEET_ROOT/revealui/node_modules/.bin/tsx" "$JV_ROOT/scripts/m1-frontmatter-staleness-check.ts" --mode=ci
```
Lane plan `last-updated:` must not be older than the most-recent ADR's `date:` field.

## Step 3 — Inventory tracking state

Surface what's currently tracked. Read-only.

### 3a. branches.json — active branches
```bash
BRANCHES_JSON="$(ss_branches_json)"
if [ -f "$BRANCHES_JSON" ] && command -v jq >/dev/null 2>&1; then
  ACTIVE_COUNT="$(jq '.branches | map(select(.status == "active")) | length' "$BRANCHES_JSON")"
  echo "active branches: $ACTIVE_COUNT (from $BRANCHES_JSON)"
  jq -r '.branches | map(select(.status == "active")) | .[] | "  - \(.project):\(.branch) (\(.pr // "no PR"))"' "$BRANCHES_JSON"
fi
```

### 3b. Open PRs across RevealFleet repos
```bash
for repo in revealui revealui-jv revvault revdev revforge revkit revskills revcon; do
  count="$(gh pr list --repo RevealUIStudio/$repo --state open --json number 2>/dev/null | jq 'length' 2>/dev/null)"
  if [ "${count:-0}" != "0" ]; then
    echo "$repo: $count open"
    gh pr list --repo RevealUIStudio/$repo --state open --json number,title,headRefName --jq '.[] | "  - #\(.number) \(.title) [\(.headRefName)]"' 2>/dev/null
  fi
done
```

### 3c. .jv git state
```bash
cd "$JV_ROOT" && git -c core.fileMode=false status --short && echo "---" && git log --oneline -5
```

### 3d. Active lanes (from INDEX)
```bash
# Count rows in the generated lanes-index block.
awk '/^<!-- BEGIN GENERATED:lanes-index -->/,/^<!-- END GENERATED:lanes-index -->/' "$JV_ROOT/docs/lanes/INDEX.md" | grep -cE '^\| [a-z][a-z0-9-]+ \|'
```

### 3e. Master tier-1 surfaces
```bash
# DIRECTION.md last-modified mtime — flag if updated this session.
stat -c '%Y' "$JV_ROOT/.claude/DIRECTION.md"
# MASTER_PLAN.md staleness check is part of M-1 (covered by 2f).
```

### 3f. Pending hotfixes → durable (GAP-405; read-only)

Surface registered debt so wrap-up cannot clear without naming the durable follow-up. **Prefer durable root-cause fixes; registry is admitted debt only.** Control layer: `revealui-harnesses hotfix` (store `~/.local/share/revealui/hotfixes`). Adapter thin entry still works.

```bash
# Prefer control-layer CLI; fall back to Studio adapter (forwards to control layer).
if command -v revealui-harnesses >/dev/null 2>&1 && revealui-harnesses hotfix store >/dev/null 2>&1; then
  revealui-harnesses hotfix check 2>/dev/null || true
  revealui-harnesses hotfix list 2>/dev/null || true
elif [ -f "$HOME/.claude/scripts/hotfix.js" ]; then
  node "$HOME/.claude/scripts/hotfix.js" check 2>/dev/null || true
  node "$HOME/.claude/scripts/hotfix.js" list 2>/dev/null || true
else
  echo "hotfix control CLI missing — build @revealui/harnesses (GAP-405)"
fi
```

Read-only. Capture output for Step 6 **HOTFIXES** and Step 4 fragment **Owner-gated** / **Outstanding** when any entry is `pending`. Do **not** call `resolve` here. Pending entries never block CHECKPOINT-READY alone, but they **must** appear under OUTSTANDING.

### 3g. Live peer report (GAP-494)

Read the peer roster before writing. Do not refresh an active row on the
primary checkout; Step 5b writes this session's row in the isolated worktree.
A live claim needed before checkpoint belongs to `/coordinate`.

```bash
node "$REVEALFLEET_ROOT/revskills/skills/revealui-coordinate/scripts/coordinate.js" \
  --mode=report
```

Live `/coordinate` is the manual skill. This step is read-only.

## Step 4 — Compose rolling handoff body

Compose `HANDOFF_BODY` now. Step 5b creates the worktree before writing any fragment. Do not write a primary-checkout fragment first and then rewrite it in a worktree; those are two distinct timestamped files and the first would remain uncommitted.

Compose the delta PRIMARILY from the Step 1b snapshot when present, supplemented by session memory + Step 2-3 results. With no snapshot, fall back to session memory.

**Security content: CITE, don't restate (owner ruling 2026-07-16).** When the session touched security findings / exploits / confinement / crypto, the delta references the artifact only — never re-describes the technique. Applies to the fragment, the workboard log (Step 5), and the next-agent prompt (Step 8).

### 4a. Compose the fragment body

```bash
# Compose body with at least ## Last merge (renderer extracts it for the top block)
# and ## Launch (product + exact rfg/rfc command). ADR 2026-08-26-session-launch-record.
# Include Live board / In-flight / Ordered next / Owner-gated as needed.
HANDOFF_BODY="$(cat <<'EOF'
## Last merge

<ISO_DATE> — <IDENTITY>: <≤15 words what landed>

## Launch

| Product | Command |
|---------|---------|
| <rfg basename> | `rfg <product> [--worktree=<label>]` |

## Live board

| Surface | State |
|---------|--------|
| … | re-verify with gh |

## In-flight

- …

## Ordered next actions

1. <exact Command from ## Launch row 1>

## Owner-gated

- …

## Pending hotfixes (if any from Step 3f)

- none | list id — title — durable target
EOF
)"
```

Never create a dated `docs/HANDOFF-YYYY-MM-DD-*.md` for the rolling train. Prefer session-specific truth in the fragment. Step 5b writes it exactly once.

### 4b. Size control

Rolling history is capped by `handoff-render.js --max` (default 12 fragments). Older fragments age out with `--gc` (7-day mtime → `docs/handoffs/archive/rolling/`). Do not hand-prune GENERATED blocks.

## Step 5 — Workboard log entry

**Compose** this session's Log line (do NOT hand-edit `## Log` — the workboard `## Log` block is now GENERATED from per-session fragments per ADR `2026-07-04-workboard-fragment-store`, the contention-free write path):
```
- [YYYY-MM-DD HH:MM] <IDENTITY>: [CHECKPOINT] → rolling fragment only | tracking: <X pass / Y fail> | next: <one-line next action from §Ordered next actions>
```

Step 5b writes it as a **fragment** (`.revealui/workboard.d/log/<ts>-<id>.md`) in the dedicated worktree and renders a temporary preview. Set volatile content as single-quoted literals so a next-action containing backticks, command substitution syntax, or quotes is never evaluated:
```bash
TS="$(date -u '+%Y-%m-%d %H:%M')"
TRACK='<X pass / Y fail>'
NEXT='<one-line next action from §Ordered next actions>'   # single-quoted literal; a literal ' inside → close+reopen: '\''
```
Step 5b assembles the line with `printf %s` (never re-evaluates) and pipes it to `workboard-fragment.js` on stdin. Because the log line is a fresh file (never an edit to the shared `workboard.md`), it sidesteps both the `rogue-workboard` hook and the dirty-file guard, so this step can never strand the checkout.

## Step 5b — Isolated fragment write and optional commit

The primary `.jv` checkout is never the checkpoint writer, even when no peer
is visible. Peer count is advisory for the report and does not select a
commit path. The `jv-single-writer-check.js` script has no `--count` API.
Use `ss_live_harness_peers` only for that advisory count.

Use one Bash session for the commands below so the values from Steps 1, 4,
and 5 remain available. Stop on any failure and report the retained worktree
path. Never hide a failed fetch, commit, push, or PR call with `|| true`.

```bash
set -euo pipefail
PEERS="$(ss_live_harness_peers)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BR="chore/checkpoint-${STAMP}-${IDENTITY}-$$"
WT="${JV_REPO}-wt/ckpt-${STAMP}-$$"
PREVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ckpt-preview.XXXXXXXX")"
CMSG="$(mktemp "${TMPDIR:-/tmp}/cmsg-ckpt.XXXXXXXX")"
printf 'chore(coord): checkpoint %s %s\n\nRolling handoff and workboard fragments for this session.\n' \
  "$ISO_DATE" "$IDENTITY" > "$CMSG"
test -s "$CMSG"

cd "$JV_ROOT"
git fetch origin test
mkdir -p "${JV_REPO}-wt"
git worktree add "$WT" -b "$BR" origin/test
cd "$WT"
if [ -n "$SID" ]; then
  JV_REPO="$WT" node "$REVEALFLEET_ROOT/revskills/skills/revealui-coordinate/scripts/coordinate.js" \
    --mode=refresh --id "$SID" --claim "$NEXT"
fi
HANDOFF_FRAGMENT="$(printf '%s\n' "$HANDOFF_BODY" \
  | node "$JV_ROOT/scripts/handoff-fragment.js" --id "$IDENTITY" \
      --base "$WT/docs/handoffs/rolling")"
WORKBOARD_FRAGMENT="$(printf -- '- [%s] %s: [CHECKPOINT] → rolling fragment only | tracking: %s | next: %s\n' \
  "$TS" "$IDENTITY" "$TRACK" "$NEXT" \
  | node "$JV_ROOT/scripts/workboard-fragment.js" --kind log --id "$IDENTITY" \
      --base "$WT/.revealui/workboard.d")"
CURRENT_HANDOFF="$(node "$JV_ROOT/scripts/handoff-render.js" \
  --base "$WT/docs/handoffs/rolling" --out "$PREVIEW_DIR/CURRENT-HANDOFF.md")"
cp "$WT/.revealui/workboard.md" "$PREVIEW_DIR/workboard.md"
node "$JV_ROOT/scripts/workboard-sweep.js" --render-only \
  --workboard "$PREVIEW_DIR/workboard.md" --base "$WT/.revealui/workboard.d"
git status --short
```

Review the handoff and workboard log fragments, this session's active row,
and the preview. Confirm `git status --short` shows only those session-owned
fragment paths. If it shows any other path, stop and
report it; never broaden the commit pathspec to make the status appear clean.
The preview files are temporary read surfaces, never commit paths.

For `/checkpoint --no-commit`, stop here, retain `$WT` and `$PREVIEW_DIR`, and
report both paths under OUTSTANDING. Do not run the following block.

For the default commit path, continue only after the fragment review:

```bash
git add -- docs/handoffs/rolling .revealui/workboard.d
git -c core.fileMode=false commit -F "$CMSG" -- \
  docs/handoffs/rolling .revealui/workboard.d
git push origin "HEAD:refs/heads/$BR"
gh pr create --repo RevealUIStudio/revealui-jv --base test --head "$BR" \
  --body-file "$CMSG"
PR="$(gh pr view "$BR" --repo RevealUIStudio/revealui-jv --json number --jq .number)"
test -n "$PR"
gh pr edit "$PR" --repo RevealUIStudio/revealui-jv \
  --add-label "merge:merge-commit"
git status --porcelain
HANDOFF_REL="${HANDOFF_FRAGMENT#"$WT/"}"
WORKBOARD_REL="${WORKBOARD_FRAGMENT#"$WT/"}"
cd "$JV_ROOT"
git worktree remove "$WT"
rm -f "$CMSG"
```

The owner disposes the PR with merge-commit only. A created PR is **not** a
merge to `origin/test`; report it as open and owner-gated. Do not fast-forward
or change the primary checkout. Keep the local branch until the owner merge
and a later cleanup confirms it is safe to delete. If any command fails, leave
the worktree and branch intact, report the exact failed command and paths,
and use the `--no-commit` report posture. Do not run `git worktree remove
--force` or lose uncommitted fragments. The temporary commit-message file
contains no secrets; remove it after successful PR creation or after its
contents have been recorded for a failed attempt.

## Step 5c — Prepare-for-exit verifier (read-only, runs after 5b converges)

Runs the seed `prepare-for-exit` workflow's read-only session-exit verifier ([GAP-314 §5]($JV_REPO/docs/gap-specs/GAP-314-operational-workflow-layer-design.md)) — 7 report-only checks. Capture output verbatim. Check 6 may still phrase "CURRENT-HANDOFF.md committed"; the durable artifacts are the rolling and workboard fragments. An open checkpoint PR is **not** on `origin/test` yet. Report that check as WARN until the PR lands. Do not relabel it PASS merely because a remote checkpoint branch exists.

```bash
node "$JV_ROOT/scripts/prepare-for-exit.js"
```

Runs unconditionally, in both the default (5b committed) and `--no-commit` paths — under `--no-commit` its check 6 (handoff committed + pushed) is expected to WARN, which is informative, not a bug. Capture the full output verbatim; do not re-derive or re-implement its checks here. Exit code is always 0 (report-only, never blocks) — this step never changes the CHECKPOINT-READY verdict.

Step 6 surfaces this output as the PREPARE-FOR-EXIT section of the CHECKPOINT REPORT.

## Step 5c2 — Cleanup-session report (no `--fix`)

Run the registered `cleanup-session` workflow through the runner so safety classification applies ([GAP-314 §6]($JV_REPO/docs/gap-specs/GAP-314-operational-workflow-layer-design.md)). Default (no `--fix`) runs the report-first arm then `STOPPED-GATED` on the destructive arm. Capture output as **CLEANUP-SESSION** in the report. One-off destructive apply is `/cleanup --fix` (skill `revealui-cleanup`), never from checkpoint.

```bash
node "$JV_ROOT/scripts/workflow-run.js" cleanup-session
```

`STOPPED-GATED` is expected and does **not** change CHECKPOINT-READY. Do not pass `--fix` or `--yes` here.

## Step 5d — Archive the consumed snapshot + GC stale ones (GAP-317 lifecycle)

Now that Step 4 folded this session's snapshot into the rolling handoff, retire it so the active dir only ever holds live sessions' records (acceptance: none older than 7 days active). This is the agent-invoked mover. Agent-authored five-section files are still not hook-authored; PreCompact may have written a labeled `origin: precompact-mechanical` last-ditch file — archive that too.

```bash
ss_ensure_coord_dirs
SNAP_DIR="$(ss_snap_dir)"
ARCH="$(ss_snap_archive_dir)"
SID="$(ss_session_id 2>/dev/null || true)"
# GC: sweep any active-dir snapshot older than 7 days into archive/ (bounded active dir)
find "$SNAP_DIR" -maxdepth 1 -type f -name '*.md' -mtime +7 -exec mv {} "$ARCH/" \; -printf 'GC-archived stale snapshot: %f\n' 2>/dev/null || true
# Also GC legacy Claude adapter active dir (read-through path; do not leave orphans)
LEGACY_SNAP="$HOME/.claude/coordination/snapshots"
if [ -d "$LEGACY_SNAP" ]; then
  mkdir -p "$LEGACY_SNAP/archive"
  find "$LEGACY_SNAP" -maxdepth 1 -type f -name '*.md' -mtime +7 -exec mv {} "$LEGACY_SNAP/archive/" \; -printf 'GC-archived legacy snapshot: %f\n' 2>/dev/null || true
fi
# Archive THIS session's consumed snapshot wherever it lived (neutral first)
if [ -n "$SID" ]; then
  for p in "$SNAP_DIR/$SID.md" "$LEGACY_SNAP/$SID.md"; do
    if [ -f "$p" ]; then
      dest_arch="$ARCH"
      case "$p" in
        "$LEGACY_SNAP"/*) dest_arch="$LEGACY_SNAP/archive"; mkdir -p "$dest_arch" ;;
      esac
      mv "$p" "$dest_arch/" && echo "archived consumed snapshot: $p → $dest_arch/"
    fi
  done
fi
```

Under `--no-commit`: run the GC lines but **skip** the `$SID.md` move (the handoff edit was not committed, so the snapshot must stay active as the fidelity source until a real checkpoint captures it). If Step 1b found no snapshot for this session, the `$SID.md` lines are a no-op — nothing to archive.

## Step 6 — Report

Print this structured summary to the user (NOT just the assistant log — actual user-facing report):

```
=== CHECKPOINT REPORT — <ISO_DATETIME> ===

Handoff fragment:     <branch>:<HANDOFF_REL or absolute worktree path for --no-commit>
Workboard fragment:   <branch>:<WORKBOARD_REL or absolute worktree path for --no-commit>
Derived preview:      <CURRENT_HANDOFF> and <PREVIEW_DIR/workboard.md>; never committed
Commit:               <open PR #N on branch | --no-commit: worktree left unstaged for owner>

TRACKING SURFACES (6)
  [PASS|FAIL]  doc-locations-check.ts
  [PASS|WARN]  workboard-check.js
  [FRESH|...]  master-handoff-staleness.js
  [PASS|FAIL]  lanes-check.js
  [PASS|FAIL]  m1-adr-tracking-check.ts
  [PASS|FAIL]  m1-frontmatter-staleness-check.ts

INVENTORY
  active branches (branches.json):    <N>
  open PRs across fleet:              <N>
  active lanes:                       <N>
  uncommitted .jv changes:            <N files>

HOTFIXES → DURABLE (GAP-405, read-only; prefer durable fixes)
  [NONE|N pending]  revealui-harnesses hotfix check
  <for each pending: id — title — durable one-liner — resolve command>

PREPARE-FOR-EXIT (7, read-only, report-only)
  [PASS|WARN]  1. Fleet repo checkouts (main checkout) clean
  [PASS|WARN]  2. No worktree created this session remains
  [PASS|WARN]  3. No unpushed commits on any branch
  [PASS|WARN]  4. Registered temp scripts confirmed or surfaced
  [PASS|WARN]  5. Memory files created this session are indexed in MEMORY.md
  [PASS|WARN]  6. Handoff/workboard **fragments** committed and pushed (derived render optional/local)
  [PASS|WARN]  7. Scratchpad files that look like owner-run helpers are flagged
  <under each WARN, the verifier's own remediation line>

CLEANUP-SESSION (workflow cleanup-session, no --fix)
  [REPORT|STOPPED-GATED]  capture runner lines; STOPPED-GATED is expected
  <SAFE-TO-REMOVE / PR-OPEN / UNKNOWN worktree labels; do not remove from checkpoint>

OUTSTANDING (action by owner or next agent)
  - <enumerate each FAIL item with suggested fix>
  - <enumerate uncommitted/unpushed work>
  - <enumerate owner-gated items>
  - <enumerate each PREPARE-FOR-EXIT WARN with its remediation line>
  - <enumerate each pending hotfix id + durable target (from Step 3f); never omit>
  - <if Step 2c is STALE or EXPIRED: `/rollup` (do not auto-run)>
  - <cleanup residue the user must apply: `/cleanup --fix` — never implied>

CHECKPOINT-READY: <YES | NO — see outstanding>
```

**CHECKPOINT-READY rules:**
- `YES` only when: all 6 validators PASS (or only `master-handoff-staleness` is STALE which is non-blocking), the primary `.jv` checkout has no session-owned dirty files, the checkpoint worktree has no uncommitted fragments, and every open PR for active branches is GREEN-AND-MERGEABLE or explicitly owner-gated. `--no-commit` with uncommitted fragments reports NO.
- `NO` when any agent-doable item remains. Finish those in-session, then re-run the verdict. Owner-gated leftovers and pending hotfixes alone do not force NO. List them under OUTSTANDING. They still allow YES.
- PREPARE-FOR-EXIT WARNs do NOT gate CHECKPOINT-READY — the verifier is report-only by design (it can never fail, per `prepare-for-exit.js`'s own contract). List its WARNs under OUTSTANDING for visibility; do not flip YES to NO on their account alone.
- CLEANUP-SESSION `STOPPED-GATED` does NOT gate CHECKPOINT-READY. List SAFE-TO-REMOVE items under OUTSTANDING; do not `--fix` from this skill.

## Step 7 — Optionally notify daemon

If the RPC daemon is up (`ss_daemon_alive`) and `nc` is installed, post a `checkpoint` event (advisory — not required):
```bash
DAEMON_NOTIFIED="no"
DAEMON_NOTIFY_REASON=""
if ! command -v nc >/dev/null 2>&1; then
  DAEMON_NOTIFY_REASON="nc-missing"
elif [ ! -S "$DAEMON_SOCKET" ]; then
  DAEMON_NOTIFY_REASON="socket-absent"
elif ! command -v jq >/dev/null 2>&1; then
  DAEMON_NOTIFY_REASON="jq-missing"
else
  PAYLOAD="$(jq -cn --arg file "$CURRENT_HANDOFF" --arg from "$IDENTITY" \
    '{type:"checkpoint", file:$file, from:$from}')"
  if printf '%s\n' "$PAYLOAD" | nc -U -w 1 "$DAEMON_SOCKET" >/dev/null 2>&1; then
    DAEMON_NOTIFIED="yes"
  else
    DAEMON_NOTIFY_REASON="nc-write-failed"
  fi
fi
```

Daemon notification is non-blocking. If it fails for any reason, the handoff is still valid: next session's SessionStart hook discovers it via filesystem — `session-start.js` / Grok SessionStart print the `[menu] CURRENT-HANDOFF` pointer (orientation only). Consume is `/pickup`. (The former Step 7.5 invoked a `session-note` skill that was never built; removed in 0.6.1.)

## Step 8 — Next session consume path (prompt LAST)

**Primary:** new equal-adapter session, owner types `/pickup` (skill `revealui-pickup`). That skill reads CURRENT-HANDOFF, re-verifies with `gh`, and continues agent-doable work. Do not auto-run `/pickup` on SessionStart.

**Fallback** (skill missing, other adapter, chat closed): emit a copy-pasteable next-agent prompt. Archive-Readiness still requires the fenced block as the last output of this turn.

Per fleet coordination rules: the fallback prompt must be droppable into a new session with no synthesis. Compose it with these 5 sections (in order):

1. **First line** — `New session: /pickup. Session <session-id> read-first: <CURRENT_HANDOFF preview path>`. If the checkpoint PR is still open, also give its exact repository, PR URL, and branch: the tracked `$JV_REPO/docs/handoffs/CURRENT-HANDOFF.md` may be stale until merge. If `--no-commit`, give the retained worktree and fragment paths instead.
2. **TL;DR** — 1–2 sentences with the single most important next action. Mirror CURRENT-HANDOFF **## Launch** row 1 (exact `rfg`/`rfc` command). Do not re-summarize.
3. **Ordered next-actions** — numbered list. Item 1 is that Launch command. Further items are the fragment's **Owner-gated** one-liners only (merge, deploy, promote, vault). Do not write a second plan. No "investigate X" / "decide Y". If the next-agent has to fill in `<paste prod URL here>` or guess a product, the convention has been violated.
4. **Locked-posture reminder** — one line. HARDLINES: `core.fileMode=false` on every .jv commit; **fragments-only pathspec** (`rolling` + `workboard.d`, never derived CURRENT-HANDOFF/workboard); `-F /tmp/cmsg-*.txt`; `--body-file`; `--head`/`--base` explicit; `gh pr merge --merge` only on revealui-jv (label `merge:merge-commit`); no `--auto`/`--no-verify`/`--admin`/`--force-push`/`--squash`; audit-first; no authored regex; revvault-first secrets; durable-only.
5. **Owner-gated deferrals** — one short list of items the next agent must NOT auto-pick up without explicit owner sign-off.

Emit the prompt wrapped in a single triple-backtick fenced code block. The block must be the LAST thing emitted in the turn — no commentary, no "and that's it" trailer, nothing.

If the Step 6 verdict is `CHECKPOINT-READY: NO`, the TL;DR must lead with `BLOCKED: <reason>. Resolve before next session.` and the NEXT ACTIONS list must enumerate the blockers (failed validators, uncommitted state, open PRs without owner-gate clearance) as items to clear first.

If the session was a no-op (nothing shipped, no in-flight work), still emit the prompt — TL;DR reads `SESSION END — no follow-up required. Next agent starts fresh.` and NEXT ACTIONS list is empty (the section header still appears for symmetry).

Include the same prompt in the preview when composing it. The committed fragment and open PR are the durable recovery record before merge; a temporary preview alone is not.

## Do not

- Do NOT emit ANY text or tool call after Step 8's fenced prompt block. The block is the last thing in the turn — the owner triple-clicks to select.
- Do NOT auto-commit on the MAIN `.jv` checkout. Committing there strands it (the 8-session divergence bug). Commit ONLY from the Step 5b throwaway worktree, including when this session is solo, or pass `--no-commit` to defer to the owner. Still NEVER auto-merge with `--admin` or squash.
- Do NOT commit `docs/handoffs/CURRENT-HANDOFF.md`, `.revealui/workboard.md`, or `.claude/workboard.md` in a session checkpoint PR (derived renders; ADR 2026-07-23). Commit fragments only (`.revealui/workboard.d`). Do NOT treat `.claude/workboard.md` or `~/.claude/rules/` as the policy home.
- Do NOT run `master-handoff-regen.js` from this skill — one-off `/rollup` (workflow `master-handoff-regen`) only, when Step 2c is STALE/EXPIRED or the owner asked.
- Do NOT pass `--fix`/`--yes` to `cleanup-session` from this skill — report only; one-off `/cleanup --fix` is explicit.
- Do NOT create dated standalone handoff files (`docs/HANDOFF-YYYY-MM-DD-*.md`) — the rolling CURRENT-HANDOFF.md is the target. Do NOT write to `$JV_REPO/.claude/handoffs/` (non-canonical, retired 2026-05-19).
- Do NOT write to `/tmp/agent-handoff-*.md` (orphaned by design).
- Do NOT move or delete handoff files — the 7-day sweep handles dated files; the CURRENT-HANDOFF.md prune (Step 4b) handles the rolling file.
- Do NOT modify lane plans or MASTER_PLAN.md — validators here are READ-ONLY against body content.
- Do NOT reference tmux, tmux windows, panes, or `TMUX_PANE` — Studio-native.
- Do NOT attempt to spawn a new agent process — the user (or Studio UI) controls session creation.

## When to invoke

- End of a meaningful session (something shipped that needs handoff).
- Before a planned absence (owner stepping away mid-flight).
- When the user types `/checkpoint`, `/checkpoint <topic>`, or the Stop hook decides to run a final check.
- NOT for one-off questions, read-only sessions, or aborted starts.

**Arguments:** `/checkpoint --no-commit` runs the isolated Step 5b write and preview, then leaves its fragments unstaged in the retained worktree for owner review. The default (no flag) commits and opens a fragments-only PR against `.jv` `test`; only an owner merge lands it on `test` (merge-commit, label `merge:merge-commit`).

## Relationship to /handoff

`/handoff` is the predecessor — writes a basic handoff doc to the (now non-canonical) `.claude/handoffs/` location with no tracking-surface validation. `/checkpoint` supersedes it: rolling **fragments** + local CURRENT-HANDOFF render + 6 validators + inventory + structured report. **Consume** is `/pickup`, not `/next`. Recommend the slash command symlink at `~/.claude/commands/handoff.md` be retargeted to this skill in a follow-up (separate revskills PR).

## Related ADRs / gaps (.jv)

- `docs/decisions/2026-07-23-jv-coordination-merge-model.md` — fragments-only PRs; concurrent land-as-ready
- `docs/decisions/2026-07-23-jv-merge-commit-only.md` — merge-commit policy + label
- `docs/decisions/2026-07-21-current-handoff-rolling-fragments.md` — rolling fragments (amended)
- `docs/decisions/2026-07-04-workboard-fragment-store.md` — workboard.d fragments
- `docs/decisions/2026-08-26-session-launch-record.md` — `## Launch` / rfg product id
- `docs/gap-specs/GAP-469-revskills-vendor-agnostic-design.md` — neutral session + coordination root
- `docs/gaps/GAP-469.yml` — session contract execution unit
- `docs/gaps/GAP-494.yml` — `/coordinate` live peer packet (snapshot report / checkpoint refresh)
