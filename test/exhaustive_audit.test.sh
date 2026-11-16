#!/usr/bin/env bash
# test/exhaustive_audit.test.sh — fleet allowlist, by-repo shards, claim
# complete vs release, coverage-status mode split.

SKILL="$REPO_ROOT/skills/exhaustive-audit/scripts"

make_fake_fleet() {
  local root
  root="$(make_sandbox)"
  node -e 'const fs=require("node:fs"), path=require("node:path"); for(const name of require(process.argv[1]).DEFAULT_FLEET_REPOS) fs.mkdirSync(path.join(process.argv[2],name),{recursive:true});' "$SKILL/lib/fleet-scope.js" "$root"
  mkdir -p "$root/agency/app" "$root/revealui/src" "$root/archive/cold" \
    "$root/tmp" "$root/scripts" "$root/.jv/docs" "$root/wt-skip/x" \
    "$root/docs/walk" "$root/revmind/notes"
  printf 'agency\n' >"$root/agency/app/App.tsx"
  printf 'revealui\nline2\n' >"$root/revealui/src/index.ts"
  printf 'should-not-inventory\n' >"$root/archive/cold/DUMP.md"
  printf 'tmp\n' >"$root/tmp/scratch.txt"
  printf 'leftover\n' >"$root/scripts/one.sh"
  printf 'plan\n' >"$root/.jv/docs/TRACKER.md"
  printf 'wt\n' >"$root/wt-skip/x/n.txt"
  printf 'fleet-doc\n' >"$root/docs/walk/note.md"
  printf 'not-md\n' >"$root/docs/walk/note.txt"
  printf 'mind\n' >"$root/revmind/notes/README.md"
  printf 'code\n' >"$root/revmind/notes/main.ts"
  printf '%s\n' "$root"
}

test_fleet_skips_archive_tmp_scripts() {
  local fleet out
  fleet="$(make_fake_fleet)"
  out="$(make_sandbox)/manifest.jsonl"
  node "$SKILL/manifest-build.js" --root "$fleet" --fleet --exclude-defaults --out "$out" >/dev/null
  if grep -q '"archive/' "$out"; then
    fail "fleet manifest excludes archive" "archive path present"
    return
  fi
  if grep -q '"tmp/' "$out"; then
    fail "fleet manifest excludes tmp" "tmp path present"
    return
  fi
  if grep -q '"scripts/' "$out"; then
    fail "fleet manifest excludes fleet-root scripts" "scripts path present"
    return
  fi
  if ! grep -q '"agency/app/App.tsx"' "$out"; then
    fail "fleet manifest includes agency" "missing agency path"
    return
  fi
  if ! grep -q '"\.jv/docs/TRACKER.md"' "$out" && ! grep -q '".jv/docs/TRACKER.md"' "$out"; then
    fail "fleet manifest includes .jv" "missing .jv path"
    return
  fi
  if ! grep -q '"docs/walk/note.md"' "$out" || ! grep -q '"revmind/notes/README.md"' "$out"; then
    fail "fleet manifest includes root docs and revmind" "missing default fleet paths"
    return
  fi
  pass "fleet manifest excludes archive/tmp/scripts and includes products"
}

test_md_truth_manifest_is_markdown_only() {
  local fleet run
  fleet="$(make_fake_fleet)"
  run="$(make_sandbox)/run"
  node "$SKILL/open-run.js" --root "$fleet" --fleet --slug md --out "$run" --mode md-truth >/dev/null
  for expected in '"docs/walk/note.md"' '"revmind/notes/README.md"'; do
    if ! grep -q "$expected" "$run/manifest.jsonl"; then
      fail "md-truth manifest includes $expected" "expected markdown path is missing"
      return
    fi
  done
  for excluded in '"docs/walk/note.txt"' '"agency/app/App.tsx"' '"revmind/notes/main.ts"'; do
    if grep -q "$excluded" "$run/manifest.jsonl"; then
      fail "md-truth manifest excludes $excluded" "non-markdown path was inventoried"
      return
    fi
  done
  pass "md-truth manifest inventories markdown only across default fleet scope"
}

test_open_run_retains_exact_source_after_worktree_drift() {
  local root run snapshot
  root="$(make_sandbox)"
  run="$(make_sandbox)/run"
  mkdir -p "$root/src"
  printf 'original source\n' >"$root/src/changed.ts"
  node "$SKILL/open-run.js" --root "$root" --slug drift --out "$run" >/dev/null
  snapshot="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const row = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
    if (!row.snapshot) process.exit(2);
    process.stdout.write(path.resolve(path.dirname(process.argv[1]), row.snapshot));
  ' "$run/manifest.jsonl")"
  printf 'changed later\n' >"$root/src/changed.ts"
  assert_eq "original source" "$(cat "$snapshot")" "open-run preserves exact manifest content after source drift"
  local snapshot_mode
  snapshot_mode="$(stat -c %a "$snapshot")"
  assert_eq "600" "$snapshot_mode" "manifest source snapshots are private"
  local hash_match
  hash_match="$(node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const row = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
    const actual = crypto.createHash("sha256").update(fs.readFileSync(process.argv[2])).digest("hex");
    process.stdout.write(String(actual === row.sha256));
  ' "$run/manifest.jsonl" "$snapshot")"
  assert_eq "true" "$hash_match" "snapshot SHA-256 matches its manifest row"
}

test_manifest_builder_does_not_inventory_its_own_snapshot_store() {
  local root manifest rows
  root="$(make_sandbox)"
  manifest="$root/manifest.jsonl"
  mkdir -p "$root/src"
  printf 'source\n' >"$root/src/one.ts"
  node "$SKILL/manifest-build.js" --root "$root" --out "$manifest" >/dev/null
  node "$SKILL/manifest-build.js" --root "$root" --out "$manifest" >/dev/null
  rows="$(wc -l <"$manifest" | tr -d ' ')"
  assert_eq "1" "$rows" "manifest rerun excludes its own output and source snapshots"
}

test_manifest_builder_refuses_corrupted_snapshot() {
  local root manifest snapshot rc
  root="$(make_sandbox)"
  manifest="$(make_sandbox)/manifest.jsonl"
  printf 'source\n' >"$root/one.ts"
  node "$SKILL/manifest-build.js" --root "$root" --out "$manifest" >/dev/null
  snapshot="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const row = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
    process.stdout.write(path.resolve(path.dirname(process.argv[1]), row.snapshot));
  ' "$manifest")"
  printf 'corrupt\n' >"$snapshot"
  rc=0
  node "$SKILL/manifest-build.js" --root "$root" --out "$manifest" >/dev/null 2>&1 || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    pass "manifest builder refuses a corrupted existing snapshot"
  else
    fail "manifest builder refuses a corrupted existing snapshot" "corrupted snapshot was accepted"
  fi
}

test_manifest_builder_refuses_snapshot_symlink() {
  local root manifest snapshot replacement rc
  root="$(make_sandbox)"
  manifest="$(make_sandbox)/manifest.jsonl"
  printf 'source\n' >"$root/one.ts"
  node "$SKILL/manifest-build.js" --root "$root" --out "$manifest" >/dev/null
  snapshot="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const row = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
    process.stdout.write(path.resolve(path.dirname(process.argv[1]), row.snapshot));
  ' "$manifest")"
  replacement="$root/replacement"
  printf 'source\n' >"$replacement"
  rm "$snapshot"
  ln -s "$replacement" "$snapshot"
  rc=0
  node "$SKILL/manifest-build.js" --root "$root" --out "$manifest" >/dev/null 2>&1 || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    pass "manifest builder refuses a linked existing snapshot"
  else
    fail "manifest builder refuses a linked existing snapshot" "linked snapshot was accepted"
  fi
}

test_include_archive_opts_in() {
  local fleet out
  fleet="$(make_fake_fleet)"
  out="$(make_sandbox)/manifest.jsonl"
  node "$SKILL/manifest-build.js" --root "$fleet" --fleet --include-archive --exclude-defaults --out "$out" >/dev/null
  if grep -q '"archive/cold/DUMP.md"' "$out"; then
    pass "include-archive inventories archive"
  else
    fail "include-archive inventories archive" "archive path missing"
  fi
}

test_by_repo_shards_do_not_mix() {
  local fleet man shards
  fleet="$(make_fake_fleet)"
  man="$(make_sandbox)/manifest.jsonl"
  shards="$(make_sandbox)/shards.json"
  node "$SKILL/manifest-build.js" --root "$fleet" --fleet --exclude-defaults --out "$man"
  node "$SKILL/shard-plan.js" --manifest "$man" --out "$shards" --by-repo --target-lines 8000 >/dev/null
  local mixed
  mixed="$(node -e '
    const p=require(process.argv[1]);
    let mixed=0;
    for (const s of p.shards) {
      const repos=new Set(s.paths.map(x=>x.split("/")[0]));
      if (repos.size>1) mixed++;
    }
    process.stdout.write(String(mixed));
  ' "$shards")"
  assert_eq "0" "$mixed" "by-repo shards never mix repos"
}

test_claim_complete_vs_release() {
  local fleet run
  fleet="$(make_fake_fleet)"
  run="$(make_sandbox)/run"
  node "$SKILL/open-run.js" --root "$fleet" --fleet --slug t --out "$run" --mode code >/dev/null
  local shard
  shard="$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.shards[0].id);' "$run/shards.json")"
  node "$SKILL/claim-shard.js" --run "$run" --shard "$shard" --agent a1 >/dev/null
  node "$SKILL/claim-shard.js" --run "$run" --shard "$shard" --complete --agent a1 >/dev/null
  local status
  status="$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.shards[0].status);' "$run/shards.json")"
  assert_eq "done" "$status" "complete marks shard done"
  local claim_rc
  claim_rc=0
  node "$SKILL/claim-shard.js" --run "$run" --shard "$shard" --agent a2 >/dev/null 2>&1 || claim_rc=$?
  if [[ "$claim_rc" -ne 0 ]]; then
    pass "cannot reclaim a done shard"
  else
    fail "cannot reclaim a done shard" "claim of done shard succeeded"
  fi
  local rel_rc
  rel_rc=0
  node "$SKILL/claim-shard.js" --run "$run" --shard "$shard" --release >/dev/null 2>&1 || rel_rc=$?
  if [[ "$rel_rc" -ne 0 ]]; then
    pass "release does not reopen a done shard"
  else
    fail "release does not reopen a done shard" "release of done succeeded"
  fi
}

test_md_truth_self_test() {
  assert_exit "md-truth-check --self-test still passes" 0 \
    -- node "$SKILL/md-truth-check.js" --self-test
}

test_open_run_refuses_home_default() {
  local home fleet
  home="$(make_sandbox)"
  fleet="$(make_sandbox)"
  mkdir -p "$fleet/docs"
  printf 'x\n' >"$fleet/docs/a.md"
  assert_exit "open-run refuses HOME archive fallback" 1 \
    -- env -u AUDIT_RUN_ROOT -u REVEALFLEET_ARCHIVE -u REVEALFLEET_ROOT HOME="$home" \
      node "$SKILL/open-run.js" --root "$fleet" --slug hi
  assert_contains "home fallback names the pin" 'Never default to $HOME/revealfleet' "$LAST_OUTPUT"
  if [[ -d "$home/revealfleet" ]]; then
    fail "open-run created a HOME/revealfleet archive"
  else
    pass "open-run did not create HOME/revealfleet"
  fi
}

test_open_run_uses_revealfleet_root() {
  local root fleet day run
  root="$(make_sandbox)"
  fleet="$(make_sandbox)"
  mkdir -p "$fleet/docs"
  printf 'x\n' >"$fleet/docs/a.md"
  day="$(date -u +%Y-%m-%d)"
  assert_exit "open-run archives under REVEALFLEET_ROOT" 0 \
    -- env -u AUDIT_RUN_ROOT -u REVEALFLEET_ARCHIVE HOME="$(make_sandbox)" REVEALFLEET_ROOT="$root" \
      node "$SKILL/open-run.js" --root "$fleet" --slug hi
  run="$root/archive/cold/audits/${day}-hi"
  if [[ -f "$run/AUDIT-RUN.yml" ]]; then
    pass "run landed under REVEALFLEET_ROOT/archive/cold/audits"
  else
    fail "missing $run/AUDIT-RUN.yml" "$LAST_OUTPUT"
  fi
}

test_open_run_rejects_slug_escape() {
  local fleet archive
  fleet="$(make_sandbox)"
  archive="$(make_sandbox)"
  mkdir -p "$fleet/docs"
  printf 'x\n' >"$fleet/docs/a.md"
  assert_exit "open-run rejects a slug that leaves the archive" 1 \
    -- env AUDIT_RUN_ROOT="$archive" \
      node "$SKILL/open-run.js" --root "$fleet" --slug 'x/../../tmp'
  if find "$archive" -mindepth 1 -print | grep -q .; then
    fail "rejected slug still wrote under the archive"
  else
    pass "rejected slug wrote nothing"
  fi
}

test_md_truth_coverage_refuses_home_default() {
  local home
  home="$(make_sandbox)"
  assert_exit "md-truth coverage refuses HOME archive" 1 \
    -- env -u REVEALFLEET_ARCHIVE -u REVEALFLEET_ROOT HOME="$home" \
      node "$SKILL/md-truth-check.js" --coverage --run planted
  assert_contains "coverage refusal names HOME" 'Never default to $HOME/revealfleet' "$LAST_OUTPUT"
  if [[ -d "$home/revealfleet" ]]; then
    fail "md-truth created HOME/revealfleet"
  else
    pass "md-truth did not create HOME/revealfleet"
  fi
}

test_claim_refresh_requires_exact_agent() {
  local fleet run
  fleet="$(make_sandbox)"
  mkdir -p "$fleet/docs"
  printf 'x\n' >"$fleet/docs/a.md"
  run="$(make_sandbox)/run"
  node "$SKILL/open-run.js" --root "$fleet" --slug hi --out "$run" >/dev/null
  node "$SKILL/claim-shard.js" --run "$run" --shard shard-000 --agent grok-audit-shard-000 >/dev/null
  node -e '
    const fs = require("fs");
    const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const shard = plan.shards.find((row) => row.id === "shard-000");
    shard.status = "open";
    delete shard.claimedBy;
    fs.writeFileSync(process.argv[1], JSON.stringify(plan, null, 2) + "\n");
  ' "$run/shards.json"
  assert_exit "shorter agent id cannot refresh a longer claim" 2 \
    -- node "$SKILL/claim-shard.js" --run "$run" --shard shard-000 --agent grok
  if grep -q '^agent: grok-audit-shard-000$' "$run/claims/shard-000.yml"; then
    pass "original claim file kept"
  else
    fail "original claim file was overwritten"
  fi
}


# Supersedes legacy unhashed/auto-verified expectations with adversarial tests
# against real snapshot-backed manifests and explicit review receipts.
test_audit_integrity_adversarial() {
  assert_exit "all twelve audit integrity regressions" 0 \
    -- node "$REPO_ROOT/test/audit-integrity.test.cjs"
}
