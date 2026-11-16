#!/usr/bin/env bash
# Unit tests for scripts/lib/session-state.sh (GAP-469).
# Avoid subshells so pass/fail counters in harness.sh stay accurate.

# shellcheck source=scripts/lib/session-state.sh
_ss_load() {
  # Pin required: session-state fail-closes without REVEALFLEET_ROOT.
  if [ -z "${REVEALFLEET_ROOT:-}" ]; then
    export REVEALFLEET_ROOT="$REPO_ROOT"
  fi
  # shellcheck disable=SC1091
  . "$REPO_ROOT/scripts/lib/session-state.sh"
}

_ss_clear_session_env() {
  unset AGENT_SESSION_ID REVEALUI_SESSION_ID CLAUDE_CODE_SESSION_ID GROK_SESSION_ID
  unset CODEX_THREAD_ID CODEX_SESSION_ID
  unset REVEALUI_IDENTITY AGENT_ROLE CLAUDE_AGENT_ROLE GROK_ACTIVE_SESSIONS
}

test_ss_codex_native_identity_precedes_peer_discovery() {
  _ss_load
  _ss_clear_session_env
  local tmp
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export GROK_ACTIVE_SESSIONS="$tmp/active.json"
  mkdir -p "$tmp/coord/snapshots"
  printf '[{"session_id":"peer-grok","pid":999999999,"cwd":"%s"}]\n' "$PWD" > "$tmp/active.json"
  printf '# own\n' > "$tmp/coord/snapshots/codex-thread.md"
  printf '# peer\n' > "$tmp/coord/snapshots/peer-grok.md"
  export CODEX_THREAD_ID="codex-thread" CODEX_SESSION_ID="codex-process"
  assert_eq "codex-thread" "$(ss_session_id)" "Codex thread is the native continuity identity"
  assert_eq "$tmp/coord/snapshots/codex-thread.md" "$(ss_snapshot_path)" "Codex resolves its own snapshot despite sole peer cwd"
  unset CODEX_THREAD_ID
  assert_eq "codex-process" "$(ss_session_id)" "Codex session alias works without thread alias"
  _ss_clear_session_env
  unset REVEALUI_COORD_ROOT
}

test_ss_invalid_load_id_never_queries_daemon() {
  (
    _ss_load
    _ss_clear_session_env
    local tmp sid got
    local failures_before="$TEST_FAIL"
    tmp="$(make_sandbox)"
    export REVEALUI_COORD_ROOT="$tmp/coord"
    ss_daemon_alive() { return 0; }
    ss_daemon_snapshot_get() { printf '%s\n' "$1" >> "$tmp/queried"; return 1; }
    for sid in '../../foreign' '..' '/absolute' $'line\nbreak' '-option'; do
      got="$(ss_snapshot_load_path "$sid")"
      assert_eq '' "$got" 'unsafe load id has no snapshot'
    done
    assert_exit 'unsafe load ids never query daemon' 1 -- test -e "$tmp/queried"
    (( TEST_FAIL == failures_before ))
  )
  assert_eq 0 "$?" 'daemon identity boundary rejects unsafe ids'
}

test_ss_cwd_alone_never_identifies_a_session() {
  _ss_load
  _ss_clear_session_env
  local tmp
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export GROK_ACTIVE_SESSIONS="$tmp/active.json"
  printf '[{"session_id":"peer-grok","pid":999999999,"cwd":"%s"}]\n' "$PWD" > "$tmp/active.json"
  assert_exit "same cwd is not session identity" 1 -- ss_session_id
  _ss_clear_session_env
  unset REVEALUI_COORD_ROOT
}

test_ss_ambiguous_grok_pid_does_not_choose_registry_order() {
  _ss_load
  _ss_clear_session_env
  local tmp
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export GROK_ACTIVE_SESSIONS="$tmp/active.json"
  printf '[{"session_id":"first","pid":%s},{"session_id":"second","pid":%s}]\n' "$$" "$$" > "$tmp/active.json"
  assert_exit "conflicting identities for one process fail closed" 1 -- ss_session_id
  _ss_clear_session_env
  unset REVEALUI_COORD_ROOT
}

test_ss_unsafe_session_ids_cannot_read_or_write_snapshots() {
  _ss_load
  _ss_clear_session_env
  local tmp sid
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export GROK_ACTIVE_SESSIONS="$tmp/missing.json"
  mkdir -p "$tmp/coord/snapshots"
  printf '# foreign\n' > "$tmp/foreign.md"
  for sid in '../../foreign' '..' '/absolute' $'line\nbreak' '-option'; do
    export AGENT_SESSION_ID="$sid"
    assert_exit "unsafe native session id rejected" 1 -- ss_session_id
    assert_exit "unsafe explicit snapshot read id rejected" 1 -- ss_snapshot_path "$sid"
    assert_exit "unsafe explicit snapshot write id rejected" 1 -- ss_snapshot_write_path "$sid"
  done
  assert_eq '# foreign' "$(cat "$tmp/foreign.md")" "foreign snapshot unchanged"
  _ss_clear_session_env
  unset REVEALUI_COORD_ROOT
}

test_ss_concurrent_adapters_resolve_only_their_snapshots() {
  _ss_load
  _ss_clear_session_env
  local tmp codex_pid grok_pid
  tmp="$(make_sandbox)"
  mkdir -p "$tmp/coord/snapshots"
  printf '# codex\n' > "$tmp/coord/snapshots/parallel-codex.md"
  printf '# grok\n' > "$tmp/coord/snapshots/parallel-grok.md"
  env REVEALUI_COORD_ROOT="$tmp/coord" CODEX_THREAD_ID="parallel-codex" GROK_ACTIVE_SESSIONS="$tmp/none.json" \
    bash -c '. "$1"; ss_snapshot_path' _ "$REPO_ROOT/scripts/lib/session-state.sh" > "$tmp/codex-result" &
  codex_pid=$!
  env REVEALUI_COORD_ROOT="$tmp/coord" GROK_SESSION_ID="parallel-grok" GROK_ACTIVE_SESSIONS="$tmp/none.json" \
    bash -c '. "$1"; ss_snapshot_path' _ "$REPO_ROOT/scripts/lib/session-state.sh" > "$tmp/grok-result" &
  grok_pid=$!
  if wait "$codex_pid" && wait "$grok_pid"; then
    pass "concurrent adapter resolvers succeed"
  else
    fail "concurrent adapter resolvers failed"
  fi
  assert_eq "$tmp/coord/snapshots/parallel-codex.md" "$(cat "$tmp/codex-result")" "concurrent Codex selects its own snapshot"
  assert_eq "$tmp/coord/snapshots/parallel-grok.md" "$(cat "$tmp/grok-result")" "concurrent Grok selects its own snapshot"
  assert_eq '# grok' "$(cat "$tmp/coord/snapshots/parallel-grok.md")" "peer snapshot not consumed or changed"
  _ss_clear_session_env
}

test_ss_home_hijack_does_not_become_fleet_root() {
  local tmp evil
  tmp="$(make_sandbox)"
  evil="$tmp/evil"
  mkdir -p "$evil/revealfleet"
  assert_exit "unset pin + HOME hijack does not source" 1 -- \
    env -u REVEALFLEET_ROOT HOME="$evil" \
    bash -c '. "$1"' _ "$REPO_ROOT/scripts/lib/session-state.sh"
  assert_contains "fail-closed names the pin" "REVEALFLEET_ROOT is unset" "$LAST_OUTPUT"
}

test_ss_revealfleet_root_pin_wins() {
  local tmp
  tmp="$(make_sandbox)/fleet"
  mkdir -p "$tmp"
  export REVEALFLEET_ROOT="$tmp"
  # shellcheck disable=SC1091
  . "$REPO_ROOT/scripts/lib/session-state.sh"
  assert_eq "$tmp" "$REVEALFLEET_ROOT" "explicit REVEALFLEET_ROOT is the fleet root"
  unset REVEALFLEET_ROOT
}


test_ss_session_id_prefers_agent_session_id() {
  _ss_load
  _ss_clear_session_env
  export AGENT_SESSION_ID="agent-first"
  export REVEALUI_SESSION_ID="revealui-second"
  export CLAUDE_CODE_SESSION_ID="claude-third"
  assert_eq "agent-first" "$(ss_session_id)" "AGENT_SESSION_ID wins over aliases"
  _ss_clear_session_env
}

test_ss_session_id_falls_through_aliases() {
  _ss_load
  _ss_clear_session_env
  export REVEALUI_SESSION_ID="only-revealui"
  assert_eq "only-revealui" "$(ss_session_id)" "REVEALUI_SESSION_ID when AGENT unset"
  unset REVEALUI_SESSION_ID
  export CLAUDE_CODE_SESSION_ID="claude-only"
  assert_eq "claude-only" "$(ss_session_id)" "CLAUDE_CODE_SESSION_ID last alias"
  _ss_clear_session_env
}

test_ss_session_id_empty_without_env() {
  _ss_load
  _ss_clear_session_env
  local tmp
  tmp="$(make_sandbox)"
  # Isolate from live Grok active_sessions + any real PID stamps
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export GROK_ACTIVE_SESSIONS="$tmp/no-such-active-sessions.json"
  ss_ensure_coord_dirs
  if ss_session_id >/dev/null 2>&1; then
    fail "ss_session_id should fail when isolated from env/stamps/active_sessions"
  else
    pass "ss_session_id fails closed when isolated"
  fi
  unset REVEALUI_COORD_ROOT GROK_ACTIVE_SESSIONS
}

test_ss_identity_ignores_global_tmp_cache() {
  _ss_load
  _ss_clear_session_env
  local planted
  planted="$(mktemp /tmp/revealui-session-zz.XXXXXX.id)"
  printf '%s\n' '$(echo PWNED)' >"$planted"
  touch -d '2026-10-09 00:00:00' "$planted" 2>/dev/null || true
  assert_eq "stagehand" "$(ss_identity)" "global /tmp cache cannot identify this session"
  rm -f "$planted"
  _ss_clear_session_env
}

test_ss_identity_prefers_neutral() {
  _ss_load
  _ss_clear_session_env
  export REVEALUI_IDENTITY="from-revealui"
  export AGENT_ROLE="from-agent-role"
  export CLAUDE_AGENT_ROLE="from-claude"
  assert_eq "from-revealui" "$(ss_identity)" "REVEALUI_IDENTITY wins"
  unset REVEALUI_IDENTITY
  assert_eq "from-agent-role" "$(ss_identity)" "AGENT_ROLE before CLAUDE_AGENT_ROLE"
  _ss_clear_session_env
}

test_ss_snapshot_write_and_resolve() {
  _ss_load
  local tmp write_path got
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export REVEALUI_COORD_LEGACY_CLAUDE="$tmp/legacy"
  export AGENT_SESSION_ID="sid-test-1"
  write_path="$(ss_snapshot_write_path)"
  assert_eq "$tmp/coord/snapshots/sid-test-1.md" "$write_path" "write path is neutral SSOT"
  printf '# snap\n' >"$write_path"
  got="$(ss_snapshot_path)"
  assert_eq "$write_path" "$got" "resolve finds neutral snapshot"
  _ss_clear_session_env
  unset REVEALUI_COORD_ROOT REVEALUI_COORD_LEGACY_CLAUDE
}

test_ss_snapshot_legacy_read_through() {
  _ss_load
  local tmp got
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export REVEALUI_COORD_LEGACY_CLAUDE="$tmp/legacy"
  export AGENT_SESSION_ID="legacy-sid"
  mkdir -p "$tmp/legacy/snapshots"
  printf '# legacy\n' >"$tmp/legacy/snapshots/legacy-sid.md"
  got="$(ss_snapshot_path)"
  assert_eq "$tmp/legacy/snapshots/legacy-sid.md" "$got" "read-through legacy Claude path"
  _ss_clear_session_env
  unset REVEALUI_COORD_ROOT REVEALUI_COORD_LEGACY_CLAUDE
}

test_ss_snapshot_symlinks_are_rejected() {
  _ss_load
  _ss_clear_session_env
  local tmp root
  tmp="$(make_sandbox)"
  root="$tmp/coord"
  export REVEALUI_COORD_ROOT="$root"
  mkdir -p "$root/snapshots"
  printf '%s\n' 'foreign' >"$tmp/foreign.md"
  ln -s "$tmp/foreign.md" "$root/snapshots/linked.md"
  assert_exit "snapshot read refuses file symlink" 1 -- ss_snapshot_path linked
  assert_exit "snapshot write refuses file symlink" 1 -- ss_snapshot_write_path linked
  assert_exit "atomic writer refuses file symlink" 1 -- \
    node "$REPO_ROOT/scripts/lib/snapshot-files.mts" path-write "$root" linked
  assert_eq 'foreign' "$(cat "$tmp/foreign.md")" "symlink target remains unchanged"
  rm "$root/snapshots/linked.md"
  mv "$root/snapshots" "$root/snapshots-real"
  ln -s "$root/snapshots-real" "$root/snapshots"
  assert_exit "snapshot directory symlink refused" 1 -- ss_snapshot_write_path linked
  rm "$root/snapshots"
  mkdir -p "$tmp/foreign-parent"
  ln -s "$tmp/foreign-parent" "$tmp/linked-parent"
  export REVEALUI_COORD_ROOT="$tmp/linked-parent/coord"
  assert_exit "ancestor symlink refused before directory creation" 1 -- ss_snapshot_write_path linked
  assert_exit "ancestor symlink leaves foreign tree untouched" 1 -- test -e "$tmp/foreign-parent/coord"
  _ss_clear_session_env
  unset REVEALUI_COORD_ROOT
}

test_ss_snapshot_atomic_private_write() {
  _ss_load
  local tmp file mode
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  file="$(printf '## Resume-From-Here\nnext\n' | node "$REPO_ROOT/scripts/lib/snapshot-files.mts" atomic-write "$REVEALUI_COORD_ROOT" private-sid)"
  assert_eq "$tmp/coord/snapshots/private-sid.md" "$file" "atomic writer returns id-bound path"
  assert_eq '## Resume-From-Here' "$(head -1 "$file")" "atomic writer preserves content"
  mode="$(stat -c '%a' "$file")"
  assert_eq 600 "$mode" "snapshot is owner-only readable"
  assert_eq 700 "$(stat -c '%a' "$tmp/coord/snapshots")" "snapshot directory is owner-only"
  assert_eq 700 "$(stat -c '%a' "$tmp/coord")" "coordination root is owner-only"
  unset REVEALUI_COORD_ROOT
}

test_ss_archive_preserves_precompaction_draft() {
  local tmp
  tmp="$(make_sandbox)"
  assert_exit "archive preserves exact draft bytes before replacement" 0 -- \
    node - "$REPO_ROOT/scripts/lib/snapshot-files.mts" "$tmp/coord" <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { archiveSnapshot, atomicPrivateWrite, safeSnapshotPath } = require(process.argv[2]);
const root = process.argv[3];
const sid = 'draft-sid';
assert.equal(archiveSnapshot(root, sid), null);
const file = safeSnapshotPath(root, sid, { create: true });
const draft = Buffer.from([0, 65, 10, 66, 255]);
fs.writeFileSync(file, draft);
const archive = archiveSnapshot(root, sid);
assert.ok(archive);
assert.deepEqual(fs.readFileSync(archive), draft);
assert.equal(fs.statSync(archive).mode & 0o777, 0o600);
assert.equal(fs.statSync(require('node:path').dirname(archive)).mode & 0o777, 0o700);
atomicPrivateWrite(root, sid, 'replacement');
assert.deepEqual(fs.readFileSync(archive), draft);
assert.equal(fs.readFileSync(file, 'utf8'), 'replacement');
JS
}

test_ss_stale_pid_stamp_is_rejected() {
  _ss_load
  _ss_clear_session_env
  local tmp
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  mkdir -p "$tmp/coord/harness-sessions/by-pid"
  printf '%s\n' '{"sid":"stale","identity":"other","start":"0","command":"bash"}' \
    >"$tmp/coord/harness-sessions/by-pid/$$"
  assert_exit "PID-reused stamp cannot resolve session" 1 -- ss_session_id
  assert_eq stagehand "$(ss_identity)" "PID-reused stamp cannot resolve identity"
  _ss_clear_session_env
  unset REVEALUI_COORD_ROOT
}

test_ss_stamp_rejects_symlink_ancestor_without_creation() {
  _ss_load
  local tmp
  tmp="$(make_sandbox)"
  mkdir -p "$tmp/outside"
  ln -s "$tmp/outside" "$tmp/linked"
  assert_exit "stamp directory helper rejects symlink ancestor" 1 -- \
    node "$REPO_ROOT/scripts/lib/snapshot-files.mts" stamp-dir "$tmp/linked/coord"
  env REVEALUI_COORD_ROOT="$tmp/linked/coord" AGENT_SESSION_ID=valid-sid \
    REVEALUI_SESSION_OWNER_PID="$$" bash "$REPO_ROOT/scripts/stamp-session-id.sh"
  assert_exit "stamp hook creates nothing through symlink ancestor" 1 -- \
    test -e "$tmp/outside/coord"
}

test_ss_shared_harness_stamp_becomes_ambiguous() {
  local tmp result
  tmp="$(make_sandbox)"
  result="$(python3 - "$REPO_ROOT" "$tmp/coord" <<'PY'
import ctypes, os, subprocess, sys

libc = ctypes.CDLL(None)
if libc.prctl(15, b"codex", 0, 0, 0) != 0:
    raise SystemExit("could not name synthetic harness process")
repo, coord = sys.argv[1:]
env = dict(os.environ)
env.update({"REVEALUI_COORD_ROOT": coord, "REVEALUI_SESSION_OWNER_PID": str(os.getpid())})
for sid in ("first-session", "second-session"):
    env["AGENT_SESSION_ID"] = sid
    subprocess.run(["bash", repo + "/scripts/stamp-session-id.sh"], env=env, check=True)
env.pop("AGENT_SESSION_ID", None)
result = subprocess.run(["bash", "-c", '. "$1"; ss_session_id', "_", repo + "/scripts/lib/session-state.sh"],
                        env=env, capture_output=True, text=True)
print("blocked" if result.returncode != 0 else result.stdout.strip())
PY
)"
  assert_eq blocked "$result" "two sessions sharing a harness process fail closed"
}

test_ss_live_harness_peers_is_numeric() {
  _ss_load
  local n
  n="$(ss_live_harness_peers)"
  if [[ "$n" =~ ^[0-9]+$ ]]; then
    pass "ss_live_harness_peers returns non-negative integer ($n)"
  else
    fail "ss_live_harness_peers not numeric: $n"
  fi
}

test_ss_coord_paths() {
  _ss_load
  local tmp
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  assert_eq "$tmp/coord" "$(ss_coord_root)" "coord root"
  assert_eq "$tmp/coord/snapshots" "$(ss_snap_dir)" "snap dir"
  assert_eq "$tmp/coord/snapshots/archive" "$(ss_snap_archive_dir)" "archive dir"
  ss_ensure_coord_dirs
  if [ -d "$tmp/coord/snapshots/archive" ]; then
    pass "ss_ensure_coord_dirs created neutral tree"
  else
    fail "ensure_coord_dirs did not create archive"
  fi
  unset REVEALUI_COORD_ROOT
}

test_ss_session_id_from_process_bound_stamp() {
  _ss_load
  _ss_clear_session_env
  local tmp result
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  ss_ensure_coord_dirs
  result="$(python3 - "$REPO_ROOT" "$tmp/coord" <<'PY'
import ctypes, os, subprocess, sys

libc = ctypes.CDLL(None)
if libc.prctl(15, b"codex", 0, 0, 0) != 0:
    raise SystemExit("could not name synthetic harness process")
repo, coord = sys.argv[1:]
env = dict(os.environ)
env.update({"REVEALUI_COORD_ROOT": coord, "REVEALUI_SESSION_OWNER_PID": str(os.getpid()),
            "AGENT_SESSION_ID": "stamp-sid-99", "REVEALUI_IDENTITY": "own-agent"})
subprocess.run(["bash", repo + "/scripts/stamp-session-id.sh"], env=env, check=True)
env.pop("AGENT_SESSION_ID", None)
env.pop("REVEALUI_IDENTITY", None)
script = '. "$1"; ss_session_id; ss_identity'
result = subprocess.run(["bash", "-c", script, "_", repo + "/scripts/lib/session-state.sh"],
                        env=env, check=True, capture_output=True, text=True)
print(result.stdout, end="")
PY
)"
  assert_eq $'stamp-sid-99\nown-agent' "$result" "one harness-bound stamp resolves its session and identity"
  _ss_clear_session_env
  unset REVEALUI_COORD_ROOT
}

test_ss_pid_only_grok_registry_is_not_identity() {
  _ss_load
  _ss_clear_session_env
  unset GROK_SESSION_ID
  local tmp fixture
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/empty-coord"
  # No stamps; fake active_sessions with our pid
  fixture="$tmp/active_sessions.json"
  printf '%s\n' "[{\"session_id\":\"from-active-json\",\"pid\":$$,\"cwd\":\"$PWD\",\"opened_at\":\"2026-08-07T00:00:00Z\"}]" >"$fixture"
  export GROK_ACTIVE_SESSIONS="$fixture"
  assert_exit "PID-only registry cannot establish session identity" 1 -- ss_session_id
  unset GROK_ACTIVE_SESSIONS REVEALUI_COORD_ROOT
  _ss_clear_session_env
}

test_ss_session_id_auto_on_live_grok() {
  _ss_load
  _ss_clear_session_env
  unset GROK_SESSION_ID REVEALUI_COORD_ROOT GROK_ACTIVE_SESSIONS
  # On a live Grok Studio session this resolves via ~/.grok/active_sessions.json.
  # Outside Grok, skip (do not fail CI).
  if [ ! -f "$HOME/.grok/active_sessions.json" ]; then
    pass "skip live grok auto-resolve (no active_sessions.json)"
    return 0
  fi
  if ss_session_id >/dev/null 2>&1; then
    pass "live Grok auto-resolve: $(ss_session_id)"
  else
    # May still fail if not running under a recorded Grok pid (e.g. bare CI)
    pass "skip live grok auto-resolve (no pid/cwd match in active_sessions)"
  fi
  _ss_clear_session_env
}

test_ss_snapshot_sections_json_parses_five() {
  _ss_load
  local tmp md json
  tmp="$(make_sandbox)"
  md="$tmp/snap.md"
  cat >"$md" <<'MD'
---
session_id: parse-sid
created: 2026-08-07T00:00:00Z
---

# Snapshot — parse test

## Resume-From-Here
next step is open the PR

## What-Shipped
revdev#363 session.snapshot

## Active-Constraints
stay off handlers

## Do-Not-Repeat
do not invent session ids

## Open-Loose-Ends
owner merge remaining
MD
  json="$(ss_snapshot_sections_json "$md")"
  assert_eq "1" "$(printf '%s' "$json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(1 if d.get("resumeFromHere")=="next step is open the PR" and "363" in d.get("whatShipped","") and d.get("doNotRepeat") else 0)')" \
    "five-section parse maps headings to camelCase keys"
}

test_ss_daemon_snapshot_write_skips_without_socket() {
  _ss_load
  local tmp md status
  tmp="$(make_sandbox)"
  export DAEMON_SOCKET="$tmp/no-such.sock"
  export REVEALUI_SOCKET="$tmp/no-such.sock"
  md="$tmp/snap.md"
  cat >"$md" <<'MD'
## Resume-From-Here
hello

## What-Shipped
none

## Active-Constraints
none

## Do-Not-Repeat
none

## Open-Loose-Ends
none
MD
  export AGENT_SESSION_ID="dual-write-skip"
  status="$(ss_daemon_snapshot_write "$md" "dual-write-skip")"
  case "$status" in
    skipped:*) pass "dual-write soft-skips when socket missing: $status" ;;
    *) fail "expected skipped status, got: $status" ;;
  esac
  unset DAEMON_SOCKET REVEALUI_SOCKET AGENT_SESSION_ID
  _ss_clear_session_env
}

test_ss_rpc_preserves_supplied_and_default_params() {
  _ss_load
  local tmp socket capture server result tries
  tmp="$(make_sandbox)"
  socket="$tmp/harness.sock"
  capture="$tmp/requests.jsonl"
  python3 - "$socket" "$capture" <<'PY' &
import json, socket, sys

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.bind(sys.argv[1])
sock.listen(4)
with open(sys.argv[2], "w", encoding="utf-8") as output:
    for _ in range(4):
        conn, _ = sock.accept()
        with conn:
            data = b""
            while b"\n" not in data:
                data += conn.recv(65536)
            request = json.loads(data.split(b"\n", 1)[0])
            output.write(json.dumps(request) + "\n")
            output.flush()
            conn.sendall((json.dumps({"jsonrpc":"2.0","id":1,"result":request["params"]}) + "\n").encode())
sock.close()
PY
  server=$!
  tries=0
  while [ ! -S "$socket" ] && [ "$tries" -lt 50 ]; do
    sleep 0.02
    tries=$((tries + 1))
  done
  export DAEMON_SOCKET="$socket"
  result="$(ss_daemon_rpc session.register '{"agentId":"one"}')"
  assert_eq '{"agentId":"one"}' "$result" "register retains supplied JSON object"
  result="$(ss_daemon_rpc session.snapshot.write '{"sessionId":"sid","sections":{"resumeFromHere":"next"}}')"
  assert_eq '{"sessionId":"sid","sections":{"resumeFromHere":"next"}}' "$result" "write retains nested JSON object"
  result="$(ss_daemon_rpc session.snapshot.get '{"sessionId":"sid"}')"
  assert_eq '{"sessionId":"sid"}' "$result" "get retains supplied JSON object"
  result="$(ss_daemon_rpc session.ping)"
  assert_eq '{}' "$result" "omitted params default to object"
  wait "$server"
  assert_eq 4 "$(wc -l <"$capture")" "fake daemon received all four valid requests"
  unset DAEMON_SOCKET
}

test_ss_daemon_snapshot_write_skips_without_file() {
  _ss_load
  local status tmp
  tmp="$(make_sandbox)"
  export DAEMON_SOCKET="$tmp/no-such.sock"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export GROK_ACTIVE_SESSIONS="$tmp/no-active.json"
  unset AGENT_SESSION_ID REVEALUI_SESSION_ID CLAUDE_CODE_SESSION_ID GROK_SESSION_ID
  status="$(ss_daemon_snapshot_write)"
  case "$status" in
    skipped:*) pass "dual-write soft-skips without file: $status" ;;
    *) fail "expected skipped, got: $status" ;;
  esac
  unset DAEMON_SOCKET REVEALUI_COORD_ROOT GROK_ACTIVE_SESSIONS
  _ss_clear_session_env
}

test_ss_snapshot_sections_to_markdown_roundtrip() {
  _ss_load
  local sid sections md json
  sid="roundtrip-sid"
  sections='{"resumeFromHere":"do the thing","whatShipped":"revskills#n","activeConstraints":"c","doNotRepeat":"d","openLooseEnds":"e"}'
  md="$(ss_snapshot_sections_to_markdown "$sid" "$sections")"
  assert_eq "1" "$(printf '%s' "$md" | grep -c '## Resume-From-Here')" "markdown has Resume-From-Here heading"
  local tmp
  tmp="$(make_sandbox)/rt.md"
  printf '%s' "$md" >"$tmp"
  json="$(ss_snapshot_sections_json "$tmp")"
  assert_eq "1" "$(printf '%s' "$json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(1 if d.get("resumeFromHere")=="do the thing" and d.get("whatShipped")=="revskills#n" else 0)')" \
    "markdown→json roundtrip preserves sections"
}

test_ss_snapshot_load_path_prefers_filesystem() {
  _ss_load
  local tmp sid path got
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export DAEMON_SOCKET="$tmp/no-such.sock"
  export REVEALUI_SOCKET="$tmp/no-such.sock"
  export GROK_ACTIVE_SESSIONS="$tmp/no-active.json"
  sid="file-prefer-sid"
  export AGENT_SESSION_ID="$sid"
  mkdir -p "$REVEALUI_COORD_ROOT/snapshots"
  path="$REVEALUI_COORD_ROOT/snapshots/$sid.md"
  cat >"$path" <<'MD'
## Resume-From-Here
from file

## What-Shipped
none

## Active-Constraints
none

## Do-Not-Repeat
none

## Open-Loose-Ends
none
MD
  got="$(ss_snapshot_load_path "$sid")"
  assert_eq "$path" "$got" "load_path returns filesystem SSOT when present"
  unset DAEMON_SOCKET REVEALUI_SOCKET REVEALUI_COORD_ROOT GROK_ACTIVE_SESSIONS AGENT_SESSION_ID
  _ss_clear_session_env
}

_ss_unset_workboard_pins() {
  unset WORKBOARD WORKBOARD_NEUTRAL WORKBOARD_ADAPTER_CLAUDE
  unset WORKBOARD_D_NEUTRAL WORKBOARD_D_LEGACY JV_REPO
}

test_ss_workboard_default_is_neutral() {
  local tmp
  tmp="$(make_sandbox)"
  _ss_unset_workboard_pins
  export REVEALFLEET_ROOT="$tmp/fleet"
  export JV_REPO="$tmp/jv"
  # shellcheck disable=SC1091
  . "$REPO_ROOT/scripts/lib/session-state.sh"
  assert_eq "$tmp/jv/.revealui/workboard.md" "$WORKBOARD" "default board is the neutral .revealui render"
  assert_eq "$tmp/jv/.revealui/workboard.d" "$WORKBOARD_D_NEUTRAL" "fragment write SSOT is .revealui/workboard.d"
  assert_eq "$tmp/jv/.claude/workboard.md" "$WORKBOARD_ADAPTER_CLAUDE" "claude board stays an adapter path"
  _ss_unset_workboard_pins
  unset REVEALFLEET_ROOT
}

test_ss_workboard_recent_prefers_neutral_over_adapter() {
  local tmp line
  tmp="$(make_sandbox)"
  _ss_unset_workboard_pins
  export REVEALFLEET_ROOT="$tmp/fleet"
  export JV_REPO="$tmp/jv"
  mkdir -p "$tmp/jv/.revealui" "$tmp/jv/.claude"
  printf '%s\n' '## Log' '- [2026-09-24 00:00] stagehand: [CHECKPOINT] neutral-board' '## Next' \
    >"$tmp/jv/.revealui/workboard.md"
  printf '%s\n' '## Log' '- [2026-09-24 00:00] stagehand: [CHECKPOINT] adapter-board' '## Next' \
    >"$tmp/jv/.claude/workboard.md"
  # shellcheck disable=SC1091
  . "$REPO_ROOT/scripts/lib/session-state.sh"
  line="$(ss_workboard_recent "" 5)"
  assert_contains "recent log reads the neutral board" "neutral-board" "$line"
  if [[ "$line" == *adapter-board* ]]; then
    fail "recent log must not prefer the Claude adapter render" "$line"
  else
    pass "recent log ignores the adapter render when the neutral board exists"
  fi
  _ss_unset_workboard_pins
  unset REVEALFLEET_ROOT
}

test_ss_workboard_recent_falls_back_to_adapter_render() {
  local tmp line
  tmp="$(make_sandbox)"
  _ss_unset_workboard_pins
  export REVEALFLEET_ROOT="$tmp/fleet"
  export JV_REPO="$tmp/jv"
  mkdir -p "$tmp/jv/.claude"
  printf '%s\n' '## Log' '- [2026-09-24 00:00] stagehand: [CHECKPOINT] adapter-only' '## Next' \
    >"$tmp/jv/.claude/workboard.md"
  # shellcheck disable=SC1091
  . "$REPO_ROOT/scripts/lib/session-state.sh"
  line="$(ss_workboard_recent "" 5)"
  assert_contains "recent log falls back to the adapter render" "adapter-only" "$line"
  _ss_unset_workboard_pins
  unset REVEALFLEET_ROOT
}

test_ss_snapshot_load_path_empty_without_file_or_daemon() {
  _ss_load
  local tmp sid got
  tmp="$(make_sandbox)"
  export REVEALUI_COORD_ROOT="$tmp/coord"
  export DAEMON_SOCKET="$tmp/no-such.sock"
  export REVEALUI_SOCKET="$tmp/no-such.sock"
  export GROK_ACTIVE_SESSIONS="$tmp/no-active.json"
  sid="missing-sid"
  export AGENT_SESSION_ID="$sid"
  mkdir -p "$REVEALUI_COORD_ROOT/snapshots"
  got="$(ss_snapshot_load_path "$sid")"
  assert_eq "" "$got" "load_path empty when no file and no daemon"
  unset DAEMON_SOCKET REVEALUI_SOCKET REVEALUI_COORD_ROOT GROK_ACTIVE_SESSIONS AGENT_SESSION_ID
  _ss_clear_session_env
}
