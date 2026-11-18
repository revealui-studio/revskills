#!/usr/bin/env bash
# Public tests use only fabricated rule data, kept outside the candidate tree.
test_client_leak_flags_bare_name_in_changelog() {
  local sandbox config
  sandbox="$(make_sandbox)"
  config="$(make_sandbox)/rules.json"
  printf '%s\n' '[{"id":"rule-001","literal":"FictionalClientCanary"}]' > "$config"
  chmod 600 "$config"
  printf '%s\n' 'FictionalClientCanary notes' > "$sandbox/CHANGELOG.md"
  assert_exit "CHANGELOG is not excluded from the client scan" 1 \
    -- bash "$REPO_ROOT/scripts/check-client-leaks.sh" --rules "$config" "$sandbox"
  assert_contains "only the opaque rule identifier is emitted" '"rule":"rule-001"' "$LAST_OUTPUT"
}
