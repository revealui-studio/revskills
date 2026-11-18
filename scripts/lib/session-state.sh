#!/usr/bin/env bash
# Shared session-state helpers for continuity skills (/recover, /checkpoint,
# /snapshot, /doctor). Vendor-agnostic (GAP-469).
#
# Source from the revskills tree (canonical):
#   . "$REVEALFLEET_ROOT/revskills/scripts/lib/session-state.sh"
# Launch with rfg so REVEALFLEET_ROOT is the bootstrap pin.
# Claude-home copy paths (if any) are adapters, not the SSOT.

# REVEALFLEET_ROOT is the required canonical bootstrap pin.
# Never default to $HOME/revealfleet (HOME hijack). Fail closed if unset.
if [ -z "${REVEALFLEET_ROOT:-}" ]; then
  printf '%s\n' "session-state: REVEALFLEET_ROOT is unset. Launch with rfg (bootstrap pin). Never default to \$HOME/revealfleet." >&2
  return 1 2>/dev/null || exit 1
fi
REVEALUI_REPO="${REVEALUI_REPO:-$REVEALFLEET_ROOT/revealui}"
JV_REPO="${JV_REPO:-$REVEALFLEET_ROOT/.jv}"
# Write SSOT is .revealui before any vendor home.
#   fragments: $JV_REPO/.revealui/workboard.d
#   neutral rendered board: $JV_REPO/.revealui/workboard.md (derived local view)
# $JV_REPO/.claude/workboard.md is adapter render only.
# ~/.claude/rules is adapter attach only, not the policy home.
WORKBOARD_D_NEUTRAL="${WORKBOARD_D_NEUTRAL:-$JV_REPO/.revealui/workboard.d}"
WORKBOARD_D_LEGACY="${WORKBOARD_D_LEGACY:-$JV_REPO/.claude/workboard.d}"
WORKBOARD_NEUTRAL="${WORKBOARD_NEUTRAL:-$JV_REPO/.revealui/workboard.md}"
WORKBOARD_ADAPTER_CLAUDE="${WORKBOARD_ADAPTER_CLAUDE:-$JV_REPO/.claude/workboard.md}"
WORKBOARD="${WORKBOARD:-$WORKBOARD_NEUTRAL}"
DAEMON_SOCKET="${REVEALUI_SOCKET:-${DAEMON_SOCKET:-$HOME/.local/share/revealui/harness.sock}}"

# Neutral coordination root (SSOT). Claude/Grok homes may hold legacy copies.
REVEALUI_COORD_ROOT="${REVEALUI_COORD_ROOT:-$HOME/.local/share/revealui/coordination}"
# Legacy Claude adapter path (read-through only after neutral).
REVEALUI_COORD_LEGACY_CLAUDE="${REVEALUI_COORD_LEGACY_CLAUDE:-$HOME/.claude/coordination}"
SS_SNAPSHOT_FILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/snapshot-files.mts"

# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

ss_valid_identity() {
  local id="${1:-}"
  [ ${#id} -le 64 ] && ss_valid_session_id "$id"
}

ss_identity() {
  if [ -n "${REVEALUI_IDENTITY:-}" ]; then
    printf '%s\n' "$REVEALUI_IDENTITY"
    return 0
  fi
  if [ -n "${AGENT_ROLE:-}" ]; then
    printf '%s\n' "$AGENT_ROLE"
    return 0
  fi
  if [ -n "${CLAUDE_AGENT_ROLE:-}" ]; then
    printf '%s\n' "$CLAUDE_AGENT_ROLE"
    return 0
  fi
  # A process-bound stamp can carry the role. Global /tmp caches cannot.
  local stamp id
  stamp="$(ss_own_session_stamp 2>/dev/null)" || stamp=""
  id="${stamp#*$'\t'}"
  if [ "$stamp" != "$id" ] && ss_valid_identity "$id"; then
    printf '%s\n' "$id"
    return 0
  fi
  printf 'stagehand\n'
}

# ---------------------------------------------------------------------------
# Session id (GAP-469) — automatic; operator never exports by hand
#
# Order (first non-empty wins):
#   1. AGENT_SESSION_ID / REVEALUI_SESSION_ID (explicit override)
#   2. Native aliases: CODEX_THREAD_ID (preferred), CODEX_SESSION_ID,
#      CLAUDE_CODE_SESSION_ID, GROK_SESSION_ID
#   3. PPID stamp files written by SessionStart (scripts/stamp-session-id.sh)
#   No cwd-only or PID-only registry fallback (PID reuse is ambiguous).
#
# Snapshot write requires a value. Checkpoint consume may be empty (memory).
# ---------------------------------------------------------------------------

# IDs become filenames. Reject invalid authoritative values rather than falling
# through to a peer's discovery entry. Keep parity with the hook's safe IDs.
ss_valid_session_id() {
  node "$SS_SNAPSHOT_FILES" valid-id "${1:-}" >/dev/null 2>&1
}

# Collect ancestor PIDs of a process (inclusive), space-separated. Arg: start pid.
ss_ancestor_pids() {
  local pid="$1" pids="" n=0
  [ -n "$pid" ] || return 1
  while [ "$pid" -gt 1 ] && [ "$n" -lt 40 ]; do
    pids="${pids}${pids:+ }${pid}"
    pid="$(awk '/^PPid:/{print $2}' "/proc/${pid}/status" 2>/dev/null)" || break
    n=$((n + 1))
  done
  printf '%s\n' "$pids"
}

# Stamps bind a session and role to one owning harness PID plus its kernel
# process start time. A stale PID or a shared ancestor cannot name this session.
ss_own_session_stamp() {
  local stamp_dir
  stamp_dir="$(node "$SS_SNAPSHOT_FILES" stamp-dir-read "$REVEALUI_COORD_ROOT" 2>/dev/null)" || return 1
  python3 - "$stamp_dir" "$$" <<'PY'
import json, pathlib, sys

root = pathlib.Path(sys.argv[1])
pid = int(sys.argv[2])
allowed = {"claude", "grok", "codex", "opencode", "cursor", "cursor-agent"}

def valid(value, limit):
    if not isinstance(value, str) or not 1 <= len(value) <= limit:
        return False
    for index, char in enumerate(value):
        if char.isascii() and char.isalnum():
            continue
        if index and char in "._-":
            continue
        return False
    return True

for _ in range(40):
    try:
        proc = pathlib.Path(f"/proc/{pid}")
        stat = (proc / "stat").read_text()
        tail = stat[stat.rfind(")") + 2:].split()
        start = tail[19]
        parent = int(tail[1])
        command = (proc / "comm").read_text().strip()
        stamp_path = root / str(pid)
        if stamp_path.exists() or stamp_path.is_symlink():
            if stamp_path.is_symlink() or not stamp_path.is_file():
                sys.exit(1)
            stamp = json.loads(stamp_path.read_text())
            sid = stamp.get("sid")
            identity = stamp.get("identity") or ""
            if command not in allowed or stamp.get("start") != start or stamp.get("command") != command:
                sys.exit(1)
            if not valid(sid, 128) or (identity and not valid(identity, 64)):
                sys.exit(1)
            print(f"{sid}\t{identity}")
            sys.exit(0)
        # The nearest harness process is the ownership boundary. A nested
        # session cannot inherit an outer harness's stamp when it has none.
        if command in allowed:
            sys.exit(1)
        if parent <= 1:
            break
        pid = parent
    except (OSError, ValueError, IndexError, json.JSONDecodeError):
        sys.exit(1)
sys.exit(1)
PY
}

ss_session_id_from_pid_stamps() {
  local stamp
  stamp="$(ss_own_session_stamp)" || return 1
  printf '%s\n' "${stamp%%$'\t'*}"
}

ss_session_id() {
  local sid name
  for name in AGENT_SESSION_ID REVEALUI_SESSION_ID CODEX_THREAD_ID CODEX_SESSION_ID CLAUDE_CODE_SESSION_ID GROK_SESSION_ID; do
    sid="${!name:-}"
    if [ -n "$sid" ]; then
      ss_valid_session_id "$sid" || return 1
      printf '%s\n' "$sid"
      return 0
    fi
  done
  sid="$(ss_session_id_from_pid_stamps 2>/dev/null)" && {
    printf '%s\n' "$sid"
    return 0
  }
  # Grok's cwd/PID registry has no kernel process-start binding. SessionStart
  # stamps or an explicit native alias must establish identity instead.
  return 1
}

# ---------------------------------------------------------------------------
# Coordination paths
# ---------------------------------------------------------------------------

ss_coord_root() {
  printf '%s\n' "$REVEALUI_COORD_ROOT"
}

ss_snap_dir() {
  printf '%s\n' "$REVEALUI_COORD_ROOT/snapshots"
}

ss_snap_archive_dir() {
  node "$SS_SNAPSHOT_FILES" archive-dir "$REVEALUI_COORD_ROOT"
}

ss_ensure_coord_dirs() {
  node "$SS_SNAPSHOT_FILES" archive-dir "$REVEALUI_COORD_ROOT" >/dev/null || return 1
  node "$SS_SNAPSHOT_FILES" stamp-dir "$REVEALUI_COORD_ROOT" >/dev/null
}

# branches.json: prefer neutral SSOT; fall back to legacy Claude path if present.
ss_branches_json() {
  local neutral="$REVEALUI_COORD_ROOT/branches.json"
  local legacy="$REVEALUI_COORD_LEGACY_CLAUDE/branches.json"
  if [ -f "$neutral" ]; then
    printf '%s\n' "$neutral"
    return 0
  fi
  if [ -f "$legacy" ]; then
    printf '%s\n' "$legacy"
    return 0
  fi
  printf '%s\n' "$neutral"
}

# Resolve snapshot file for this session (id-match, never mtime).
# Search order: neutral SSOT, then legacy Claude adapter path.
# Prints path and returns 0 if found; returns 1 if no session id or no file.
# Optional $1 session id; callers usually omit and resolve via ss_session_id.
# shellcheck disable=SC2120
ss_snapshot_path() {
  local sid="${1:-}"
  if [ -z "$sid" ]; then
    sid="$(ss_session_id 2>/dev/null)" || return 1
  fi
  ss_valid_session_id "$sid" || return 1

  node "$SS_SNAPSHOT_FILES" path-read "$REVEALUI_COORD_ROOT" "$sid" 2>/dev/null && return 0
  node "$SS_SNAPSHOT_FILES" path-read "$REVEALUI_COORD_LEGACY_CLAUDE" "$sid" 2>/dev/null && return 0
  return 1
}

# Path where NEW snapshots must be written (always neutral SSOT).
ss_snapshot_write_path() {
  local sid="${1:-}"
  if [ -z "$sid" ]; then
    sid="$(ss_session_id 2>/dev/null)" || return 1
  fi
  ss_valid_session_id "$sid" || return 1
  node "$SS_SNAPSHOT_FILES" path-write "$REVEALUI_COORD_ROOT" "$sid"
}

# ---------------------------------------------------------------------------
# Peer / live harness detection (GAP-469)
# PEER LIVE when count of interactive equal-harness processes > 1.
# Patterns are bounded; prefer jv-single-writer-check when available.
# ---------------------------------------------------------------------------

ss_live_harness_peers() {
  local count=0
  local line
  # Interactive-ish agent CLIs. Exclude pipes, greps, and headless -p style.
  while IFS= read -r line; do
    # Skip the scanner itself and any grep/pgrep wrapper line (*grep* also matches pgrep).
    case "$line" in
      *grep*) continue ;;
    esac
    # Skip headless one-shots commonly flagged with " -p " (Claude print mode).
    case "$line" in
      *' -p '*|*' --print'*) continue ;;
    esac
    count=$((count + 1))
  done < <(
    # shellcheck disable=SC2009
    ps -eo args= 2>/dev/null | grep -E \
      '(^|/)(claude|grok|opencode)( |$)|cursor agent|cursor-agent' \
      || true
  )
  printf '%s\n' "$count"
}

# ---------------------------------------------------------------------------
# Repo / daemon helpers
# ---------------------------------------------------------------------------

ss_active_repo() {
  # 1. Explicit crashed-repo env var (set by claude-safe on crash recovery).
  #    Recovery tab is launched from $HOME to avoid direnv/Nix stalls, so PWD
  #    inference below would pick the wrong repo without this hint.
  if [ -n "${REVEALUI_CRASHED_REPO:-}" ] && [ -d "${REVEALUI_CRASHED_REPO:-}" ]; then
    printf '%s\n' "$REVEALUI_CRASHED_REPO"
    return 0
  fi
  # 2. CWD is inside RevealFleet — infer the enclosing repo.
  case "$PWD" in
    "$REVEALFLEET_ROOT"/*) git -C "$PWD" rev-parse --show-toplevel 2>/dev/null && return 0 ;;
  esac
  # 3. Fall back to the canonical primary repo.
  printf '%s\n' "$REVEALUI_REPO"
}

ss_daemon_alive() {
  [ -S "$DAEMON_SOCKET" ] && return 0 || return 1
}

# GAP-342 dual-write helpers (session.snapshot.*). Soft-fail when daemon down.
_ss_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/session-snapshot-daemon.sh
. "$_ss_dir/session-snapshot-daemon.sh"
unset _ss_dir


ss_revvault_alive() {
  command -v revvault >/dev/null 2>&1 || return 1
  revvault list >/dev/null 2>&1
}

# Read path: neutral board when present, else the Claude adapter render.
# The adapter file is never the write SSOT.
ss_workboard_read_path() {
  if [ -n "${WORKBOARD:-}" ] && [ -f "$WORKBOARD" ]; then
    printf '%s\n' "$WORKBOARD"
    return 0
  fi
  if [ -n "${WORKBOARD_ADAPTER_CLAUDE:-}" ] && [ -f "$WORKBOARD_ADAPTER_CLAUDE" ] \
    && [ "${WORKBOARD_ADAPTER_CLAUDE}" != "${WORKBOARD:-}" ] \
    && grep -Fq '## Log' "$WORKBOARD_ADAPTER_CLAUDE"; then
    printf '%s\n' "$WORKBOARD_ADAPTER_CLAUDE"
    return 0
  fi
  printf 'workboard missing: %s\n' "${WORKBOARD:-$WORKBOARD_NEUTRAL}" >&2
  return 1
}

ss_workboard_recent() {
  local identity="${1:-}" n="${2:-20}" board
  # Validate n is numeric
  [[ "$n" =~ ^[0-9]+$ ]] || { printf 'ss_workboard_recent: n must be numeric, got: %s\n' "$n" >&2; return 1; }
  board="$(ss_workboard_read_path)" || return 1
  if [ -n "$identity" ] && [ "$identity" != "stagehand" ]; then
    grep -E "\] ${identity}(-[0-9]+)?:" "$board" | tail -n "$n"
  else
    sed -n '/^## Log/,/^## /p' "$board" | grep -E '^- \[' | head -n "$n"
  fi
}

ss_empty_objects() {
  local repo="${1:-$(ss_active_repo)}"
  find "$repo/.git/objects" -type f -empty 2>/dev/null
}

ss_orphaned_handoffs() {
  # Find handoffs at LEGACY locations that weren't claimed by the receiving
  # session. Scoped intentionally to legacy paths only — canonical-location
  # handoffs at $JV_REPO/docs/HANDOFF-*.md (per the master-handoff.md
  # convention) are discoverable via the workboard `## Log` `[CHECKPOINT]`
  # entries + git history, not filesystem scan. Scanning the canonical
  # location for "orphans" would surface every active <7d handoff as orphaned,
  # which is wrong-by-construction (the sweep keeps them at root for 7 days).
  #
  # Legacy locations scanned below:
  #   /tmp/agent-handoff-*.md     — pre-2026-05-09 ad-hoc handoffs
  #   $JV_REPO/.claude/handoffs/  — deprecated /handoff slash command target
  #                                  (skill `revealui-handoff` v0.3.0+
  #                                  DEPRECATED 2026-05-19; superseded by
  #                                  /checkpoint). Kept for backcompat
  #                                  until next revskills major.
  local age_min="${1:-60}"
  # Validate age_min is numeric
  [[ "$age_min" =~ ^[0-9]+$ ]] || { printf 'ss_orphaned_handoffs: age_min must be numeric, got: %s\n' "$age_min" >&2; return 1; }
  find /tmp -maxdepth 1 -name 'agent-handoff-*.md' -mmin +"$age_min" 2>/dev/null
  find "$JV_REPO/.claude/handoffs" -maxdepth 1 -name '*.md' -mmin +"$age_min" 2>/dev/null
}

ss_hook_state() {
  local ppid="${1:-$PPID}"
  # Validate ppid is numeric
  [[ "$ppid" =~ ^[0-9]+$ ]] || { printf 'ss_hook_state: ppid must be numeric, got: %s\n' "$ppid" >&2; return 1; }
  local out="" f
  # Claude adapter tmp + any revealui-session caches for this ppid.
  for f in \
    "/tmp/claude-agent-edits-${ppid}.json" \
    "/tmp/claude-autocommit-${ppid}.json" \
    "/tmp/claude-context-${ppid}.json" \
    "/tmp/claude-session-${ppid}.json" \
    "/tmp/revealui-session-${ppid}.id" \
    "/tmp/revealui-daemon-session-${ppid}.id"
  do
    if [ -f "$f" ]; then
      out+="$f ($(wc -c <"$f") bytes)\n"
    fi
  done
  printf '%b' "$out"
}
