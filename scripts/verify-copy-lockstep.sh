#!/usr/bin/env bash
# verify-copy-lockstep.sh — shared CI/local gate for revcon copy-mode materialization
#
# GAP-372 design (shared gate, not per-repo ports of revealui rules-lockstep.ts):
#   One script, many consumers. Each fleet repo that materializes
#   .claude/{rules,agents,skills} via `link.sh --mode copy` runs this gate in
#   CI so hand-edits and stray tracked files fail the build.
#
# Self-consistency only (no sibling revcon profile checkout required):
#   1. .claude/.revcon-manifest.json present, mode=copy
#   2. Every manifest entry exists as a real file (not a symlink) with matching sha256
#   3. Every git-tracked file under .claude/{rules,agents,skills} appears in the manifest
#
# Profile-source freshness (stale vs current profiles) remains an operator
# concern via status.sh (needs the revcon checkout). CI only needs the
# tracked tree to match its own manifest.
#
# Usage:
#   bash scripts/verify-copy-lockstep.sh --target /path/to/repo
#   bash scripts/verify-copy-lockstep.sh --target . --dot .claude
#
# Exit: 0 ok · 1 drift / missing manifest · 2 usage error

set -euo pipefail

TARGET=""
DOT=".claude"
MATERIALIZED_SUBDIRS=(rules agents skills commands)

usage() {
  cat <<'EOF'
Usage: verify-copy-lockstep.sh --target DIR [--dot .claude]

Options:
  --target DIR   Repo root that owns the materialized editor dir (required)
  --dot NAME     Dot-dir under target (default: .claude)
  -h, --help     Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --dot)    DOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "error: --target is required" >&2
  usage >&2
  exit 2
fi

if [[ ! -d "$TARGET" ]]; then
  echo "error: target is not a directory: $TARGET" >&2
  exit 2
fi

[[ "$DOT" == ".revealui" ]] && MATERIALIZED_SUBDIRS=(content/rules content/agents content/skills content/commands)
TARGET="$(cd "$TARGET" && pwd)"
MANIFEST="$TARGET/$DOT/.revcon-manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "✗ missing $DOT/.revcon-manifest.json" >&2
  echo "  Materialize with revcon:" >&2
  echo "    bash ~/revealfleet/revcon/link.sh --target $TARGET --profile revealfleet --mode copy" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 2
fi

mode="$(jq -r '.mode // empty' "$MANIFEST")"
if [[ "$mode" != "copy" ]]; then
  echo "✗ $DOT/.revcon-manifest.json mode is '${mode:-missing}' (expected copy)" >&2
  exit 1
fi

if ! jq -e '.files | type == "object"' "$MANIFEST" >/dev/null 2>&1; then
  echo "✗ $DOT/.revcon-manifest.json missing files map" >&2
  exit 1
fi

# Native manifests describe only first-party content, never vendor aliases or
# arbitrary paths. Validate before any file reads or hash comparisons.
if [[ "$DOT" == ".revealui" ]]; then
  if ! jq -se '
    length == 1 and (.[0].editor == "revealui") and
    all(.[0].files | to_entries[];
      (.key | startswith("content/rules/") or startswith("content/agents/") or
        startswith("content/skills/") or startswith("content/commands/")) and
      (.key | split("/") | all(.[]; length > 0 and . != "." and . != "..")) and
      (.key | test("[[:cntrl:]]") | not) and
      (.value.source | type == "string" and contains("/revealui/")) and
      (.value.sha256 | type == "string" and test("^[0-9a-f]{64}$")))
  ' "$MANIFEST" >/dev/null 2>&1; then
    echo "✗ invalid first-party RevealUI manifest" >&2
    exit 1
  fi
fi

hash_file() {
  sha256sum < "$1" | awk '{print $1}'
}

if ! jq -e '
  all(.files | keys[];
    (startswith("/") | not) and
    (test("[[:cntrl:]]") | not) and
    (split("/") | all(.[]; length > 0 and . != "." and . != "..")))
' "$MANIFEST" >/dev/null 2>&1; then
  echo "✗ manifest path escapes $DOT" >&2
  exit 1
fi

problems=0
count=0
declare -A manifest_paths=()

while IFS=$'\t' read -r rel src want; do
  [[ -n "$rel" ]] || continue
  count=$((count + 1))
  file_rel="$DOT/$rel"
  manifest_paths["$file_rel"]=1
  abs="$TARGET/$DOT/$rel"
  resolved="$(realpath -m -- "$abs")"
  if [[ "$resolved" != "$TARGET/$DOT/"* ]]; then
    echo "  $file_rel — path escapes the editor directory" >&2
    problems=$((problems + 1))
    continue
  fi
  if [[ ! -e "$abs" ]]; then
    echo "  $file_rel — missing on disk (manifest source: $src)" >&2
    problems=$((problems + 1))
    continue
  fi
  if [[ -L "$abs" ]]; then
    echo "  $file_rel — still a symlink; re-materialize with link.sh --mode copy" >&2
    problems=$((problems + 1))
    continue
  fi
  if [[ ! -f "$abs" ]]; then
    echo "  $file_rel — not a regular file" >&2
    problems=$((problems + 1))
    continue
  fi
  have="$(hash_file "$abs")"
  if [[ "$src" == harnesses:* ]]; then
    content_root="$(jq -r '.contentRoot // "content"' "$TARGET/.revealui/manager.json" 2>/dev/null || echo content)"
    canonical="$TARGET/.revealui/$content_root/$rel"
    expected_source="harnesses:$rel"
    if [[ "$rel" == "rules/00-revealui-manager.md" ]]; then
      expected_source="harnesses:adapters/claude-code.md"
      canonical="$TARGET/.revealui/adapters/claude-code.md"
    fi
    if [[ "$DOT" != ".claude" || "$rel" != rules/*.md || "${rel#rules/}" == */* || "$src" != "$expected_source" || ! -f "$canonical" || -L "$canonical" || "$(realpath -m -- "$canonical")" != "$canonical" || "$(hash_file "$canonical")" != "$have" ]]; then
      echo "  $file_rel — invalid harness ownership or drift from manager content" >&2
      problems=$((problems + 1))
    fi
  fi
  if [[ "$have" != "$want" ]]; then
    echo "  $file_rel — content differs from the manifest (locally edited?)." >&2
    echo "    Edit the revcon profile ($src), then re-run link.sh --mode copy." >&2
    problems=$((problems + 1))
  fi
done < <(jq -r '.files | to_entries[] | [.key, .value.source, .value.sha256] | @tsv' "$MANIFEST")

# Native Codex artifacts have one separate owner: the harness materializer.
# Validate that ownership rather than treating its tracked files as strays.
if [[ "$DOT" == ".agents" && -f "$TARGET/.revealui/adapters/codex-files.json" ]]; then
  harness_manifest="$TARGET/.revealui/adapters/codex-files.json"
  if [[ -L "$harness_manifest" ]] || ! jq -e '.version == 1 and (.files | type == "object")' "$harness_manifest" >/dev/null; then
    echo "Invalid native Codex ownership manifest" >&2
    exit 1
  fi
  while IFS=$'\t' read -r file_rel want; do
    if [[ "$file_rel" != .agents/skills/* || "$file_rel" == */../* || "$file_rel" =~ [[:cntrl:]] || -n "${manifest_paths[$file_rel]+x}" ]]; then
      echo "Invalid or multiply owned native skill path: $file_rel" >&2
      problems=$((problems + 1))
      continue
    fi
    manifest_paths["$file_rel"]=1
    abs="$TARGET/$file_rel"
    resolved="$(realpath -m -- "$abs")"
    if [[ "$resolved" != "$TARGET/"* || ! -f "$abs" || -L "$abs" || "$resolved" != "$abs" || "$(hash_file "$abs")" != "$want" ]]; then
      echo "Missing, linked, or modified native skill: $file_rel" >&2
      problems=$((problems + 1))
    fi
  done < <(jq -r '.files | to_entries[] | [.key, .value] | @tsv' "$harness_manifest")
fi

# Strays: git-tracked under materialized dirs but not in the manifest
if git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  pathspecs=()
  for sub in "${MATERIALIZED_SUBDIRS[@]}"; do
    pathspecs+=("$DOT/$sub")
  done
  while IFS= read -r tracked; do
    [[ -n "$tracked" ]] || continue
    if [[ -z "${manifest_paths[$tracked]+x}" ]]; then
      echo "  $tracked — tracked but not in the manifest (hand-added?)." >&2
      echo "    Add it to the revcon profile and re-run link.sh --mode copy, or untrack it." >&2
      problems=$((problems + 1))
    fi
  done < <(git -C "$TARGET" ls-files -- "${pathspecs[@]}" 2>/dev/null || true)
else
  echo "  (warn) not a git work tree — skipping stray-file check" >&2
fi

profiles="$(jq -r '.profiles | join(", ")' "$MANIFEST" 2>/dev/null || echo "?")"

if (( problems > 0 )); then
  echo "✗ copy-lockstep: $problems violation(s) ($count manifest entr(y/ies), profiles: $profiles)" >&2
  printf '  Re-apply: bash "$REVEALFLEET_ROOT/revcon/link.sh" --target %q --mode copy --profile revealfleet\n' "$TARGET" >&2
  exit 1
fi

echo "✓ copy-lockstep: $count materialized file(s) match the manifest (profiles: $profiles); no strays"
exit 0
