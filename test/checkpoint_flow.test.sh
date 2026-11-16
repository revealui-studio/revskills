#!/usr/bin/env bash
# Execute the checkpoint skill's documented shell blocks against local Git
# and mocked gh/.jv scripts. No network or real coordination state is used.

test_checkpoint_writer_keeps_primary_clean() {
  local box main remote mock initial result
  box="$(make_sandbox)"
  main="$box/jv"
  remote="$box/origin.git"
  mock="$box/bin"
  mkdir -p "$main/docs/handoffs/rolling" "$main/.revealui/workboard.d/log" "$mock" "$box/empty-hooks"
  printf '# Workboard\n\n## Log\n\n## Next\n' >"$main/.revealui/workboard.md"
  git init --bare --quiet "$remote"
  git init --quiet -b test "$main"
  ( cd "$main" && git config user.name Tester && git config user.email tester@example.invalid && git config core.hooksPath "$box/empty-hooks" && git add . && git commit --quiet -m seed && git remote add origin "$remote" && git push --quiet -u origin test )
  initial="$(cd "$main" && git rev-parse HEAD)"

  cat >"$mock/node" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
script="$1"; shift
name="$(basename "$script")"
base=""; out=""; id=""; board=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base|--out|--id|--workboard) key="$1"; value="${2:-}"; shift 2
      case "$key" in --base) base="$value";; --out) out="$value";; --id) id="$value";; --workboard) board="$value";; esac ;;
    *) shift ;;
  esac
done
case "$name" in
  coordinate.js)
    if [ -n "$id" ]; then
      mkdir -p "$JV_REPO/.revealui/workboard.d/active"
      printf '| %s | claim |\n' "$id" >"$JV_REPO/.revealui/workboard.d/active/$id.md"
    fi ;;
  handoff-fragment.js)
    mkdir -p "$base"; cat >"$base/fragment.md"; printf '%s\n' "$base/fragment.md" ;;
  workboard-fragment.js)
    mkdir -p "$base/log"; cat >"$base/log/log.md"; printf '%s\n' "$base/log/log.md" ;;
  handoff-render.js)
    printf '# Preview\n\n## Launch\n\n%s\n' "$base" >"$out"; printf '%s\n' "$out" ;;
  workboard-sweep.js)
    printf '\nrendered from %s\n' "$base" >>"$board" ;;
  *) printf 'unexpected node script: %s\n' "$name" >&2; exit 1 ;;
esac
MOCK
  cat >"$mock/gh" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$GH_CALLS"
case "$1 $2" in
  'pr view') printf '17\n' ;;
  'pr create') printf 'https://example.invalid/pr/17\n' ;;
esac
MOCK
  chmod +x "$mock/node" "$mock/gh"

  python3 - "$REPO_ROOT/skills/revealui-checkpoint/SKILL.md" "$box" <<'PY'
from pathlib import Path
import sys
body = Path(sys.argv[1]).read_text().split("## Step 5b —", 1)[1].split("## Step 5c —", 1)[0]
blocks = []
for segment in body.split("```bash\n")[1:]:
    blocks.append(segment.split("\n```", 1)[0])
if len(blocks) != 2:
    raise SystemExit("checkpoint Step 5b must have preflight and commit blocks")
for index, block in enumerate(blocks, 1):
    (Path(sys.argv[2]) / f"block-{index}.sh").write_text(block + "\n")
PY
  cat >"$box/run.sh" <<'RUN'
#!/usr/bin/env bash
set -euo pipefail
ss_live_harness_peers() { printf '0\n'; }
export JV_ROOT="$CHECKPOINT_MAIN" JV_REPO="$CHECKPOINT_MAIN"
export REVEALFLEET_ROOT="$CHECKPOINT_FLEET" SID=fixture-session
export IDENTITY=fixture-agent ISO_DATE=2026-11-16 TS='2026-11-16 12:00'
export TRACK='6 pass / 0 fail' NEXT='rfg revealui'
HANDOFF_BODY='## Last merge
none

## Launch
| revealui | rfg revealui |'
. "$CHECKPOINT_BOX/block-1.sh"
main_head="$(cd "$JV_ROOT" && git rev-parse HEAD)"
test "$main_head" = "$CHECKPOINT_INITIAL"
test -z "$(cd "$JV_ROOT" && git status --porcelain)"
test -f "$HANDOFF_FRAGMENT"
test -f "$WORKBOARD_FRAGMENT"
test -f "$WT/.revealui/workboard.d/active/$SID.md"
if [ "$CHECKPOINT_MODE" = no-commit ]; then
  test -n "$(cd "$WT" && git status --porcelain)"
  exit 0
fi
. "$CHECKPOINT_BOX/block-2.sh"
test "$(cd "$JV_ROOT" && git rev-parse HEAD)" = "$CHECKPOINT_INITIAL"
test -z "$(cd "$JV_ROOT" && git status --porcelain)"
test ! -d "$WT"
test -n "$(cd "$JV_ROOT" && git ls-remote origin "refs/heads/$BR")"
test -f "$CURRENT_HANDOFF"
RUN
  chmod +x "$box/run.sh"
  export CHECKPOINT_MAIN="$main" CHECKPOINT_FLEET="$box" CHECKPOINT_BOX="$box"
  export CHECKPOINT_INITIAL="$initial" GH_CALLS="$box/gh-calls"
  if result="$(PATH="$mock:$PATH" TMPDIR="$box" CHECKPOINT_MODE=no-commit bash "$box/run.sh" 2>&1)"; then
    pass 'no-commit checkpoint leaves primary clean and isolated fragments unstaged'
  else fail 'no-commit checkpoint flow' "$result"; fi
  if result="$(PATH="$mock:$PATH" TMPDIR="$box" CHECKPOINT_MODE=commit bash "$box/run.sh" 2>&1)"; then
    pass 'committed checkpoint pushes only worktree fragments and leaves primary clean'
  else fail 'committed checkpoint flow' "$result"; fi
  unset CHECKPOINT_MAIN CHECKPOINT_FLEET CHECKPOINT_BOX CHECKPOINT_INITIAL GH_CALLS
}
