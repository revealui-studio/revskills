#!/usr/bin/env bash
# stamp-session-id.sh — SessionStart hook helper (GAP-469 automatic session id).
#
# Writes one process-start-bound harness stamp under the neutral coordination
# root. Shared ancestors and PID-only records cannot identify a session.
#
# Invoked from Grok/Claude SessionStart hooks. Env (hook-injected):
#   GROK_SESSION_ID | CLAUDE_CODE_SESSION_ID | AGENT_SESSION_ID
#
# Usage (hook command):
#   bash "$REVEALFLEET_ROOT/revskills/scripts/stamp-session-id.sh"
#
# Safe to re-run; always exit 0 so SessionStart never blocks.

set -uo pipefail

SID="${AGENT_SESSION_ID:-${REVEALUI_SESSION_ID:-${CODEX_THREAD_ID:-${CODEX_SESSION_ID:-${GROK_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-}}}}}}"
if [ -z "$SID" ]; then
  # Try stdin JSON (Grok SessionStart may provide sessionId on stdin envelope)
  if command -v python3 >/dev/null 2>&1; then
    SID="$(python3 -c '
import json,sys
try:
    raw=sys.stdin.read()
    if not raw.strip():
        raise SystemExit
    o=json.loads(raw)
    print(o.get("sessionId") or o.get("session_id") or "")
except Exception:
    pass
' 2>/dev/null || true)"
  fi
fi

if [ -z "$SID" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/lib/snapshot-files.mts" valid-id "$SID" >/dev/null 2>&1 || exit 0
IDENTITY="${REVEALUI_IDENTITY:-${AGENT_ROLE:-${CLAUDE_AGENT_ROLE:-}}}"
if [ -n "$IDENTITY" ]; then
  node "$SCRIPT_DIR/lib/snapshot-files.mts" valid-id "$IDENTITY" >/dev/null 2>&1 || IDENTITY=""
fi

ROOT="${REVEALUI_COORD_ROOT:-$HOME/.local/share/revealui/coordination}"
STAMP_DIR="$(node "$SCRIPT_DIR/lib/snapshot-files.mts" stamp-dir "$ROOT" 2>/dev/null)" || exit 0
REVEALUI_STAMP_SID="$SID" REVEALUI_STAMP_IDENTITY="$IDENTITY" \
REVEALUI_STAMP_DIR="$STAMP_DIR" REVEALUI_STAMP_START_PID="$$" \
python3 - <<'PY' 2>/dev/null || true
import fcntl, json, os, pathlib, secrets, sys

sid = os.environ["REVEALUI_STAMP_SID"]
identity = os.environ["REVEALUI_STAMP_IDENTITY"]
by_pid = pathlib.Path(os.environ["REVEALUI_STAMP_DIR"])
pid = int(os.environ["REVEALUI_STAMP_START_PID"])
allowed = {"claude", "grok", "codex", "opencode", "cursor", "cursor-agent"}

owner = None
for _ in range(40):
    proc = pathlib.Path(f"/proc/{pid}")
    stat = (proc / "stat").read_text()
    tail = stat[stat.rfind(")") + 2:].split()
    start = tail[19]
    parent = int(tail[1])
    command = (proc / "comm").read_text().strip()
    if command in allowed:
        owner = (pid, start, command)
        break
    if parent <= 1:
        break
    pid = parent

if owner is None:
    sys.exit(0)

old_umask = os.umask(0o077)
try:
    if by_pid.is_symlink() or not by_pid.is_dir():
        sys.exit(0)
    directory_fd = os.open(by_pid, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    fcntl.flock(directory_fd, fcntl.LOCK_EX)
    # SessionStart prunes stale PID records; active peers keep their stamps.
    for candidate in by_pid.iterdir():
        if not candidate.name.isdecimal() or candidate.is_symlink() or not candidate.is_file():
            continue
        try:
            prior = json.loads(candidate.read_text())
            other = pathlib.Path(f"/proc/{candidate.name}")
            other_stat = (other / "stat").read_text()
            other_start = other_stat[other_stat.rfind(")") + 2:].split()[19]
            other_command = (other / "comm").read_text().strip()
            if prior.get("start") == other_start and prior.get("command") == other_command:
                continue
        except FileNotFoundError:
            pass
        except (PermissionError, OSError):
            continue
        except (ValueError, IndexError, json.JSONDecodeError):
            pass
        candidate.unlink()
    target = by_pid / str(owner[0])
    if target.is_symlink():
        sys.exit(0)
    temp = by_pid / f".{owner[0]}.{secrets.token_hex(8)}.tmp"
    record = {"sid": sid, "identity": identity, "start": owner[1], "command": owner[2]}
    if target.exists():
        try:
            previous = json.loads(target.read_text())
        except (OSError, json.JSONDecodeError):
            previous = {}
        if previous.get("start") == owner[1] and previous.get("command") == owner[2]:
            if previous.get("ambiguous") or previous.get("sid") != sid:
                record = {"ambiguous": True, "start": owner[1], "command": owner[2]}
    payload = json.dumps(record)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(payload + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        current = (pathlib.Path(f"/proc/{owner[0]}") / "stat").read_text()
        if current[current.rfind(")") + 2:].split()[19] != owner[1]:
            sys.exit(0)
        os.replace(temp, target)
    finally:
        if temp.exists():
            temp.unlink()
finally:
    if "directory_fd" in locals():
        os.close(directory_fd)
    os.umask(old_umask)
PY
exit 0
