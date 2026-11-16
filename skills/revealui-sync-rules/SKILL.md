---
name: revealui-sync-rules
description: Verify agent rules distribution topology across RevealUI repos (revcon profiles, materialized copies). Prefer control-layer / revcon entrypoints; Claude hook path is one adapter. Read-only; never mutates without asking.
license: MIT
compatibility: RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked.
allowed-tools: Bash
metadata:
  pack: studio
  author: RevealUI Studio
  version: "0.3.2"
  website: https://revealui.com
---

Run the topology check and report results.

## Report-only entry point

```bash
if [ -x "$REVEALFLEET_ROOT/revcon/status.sh" ]; then
  bash "$REVEALFLEET_ROOT/revcon/status.sh" --verify
else
  echo "SKIP: revcon status checker is absent"
fi
```

Preserve the checker exit status and report its failures. Do not run an adapter
`sync-rules` hook as a fallback: a hook may materialize files. For a single
copy-mode repo, the narrower verifier requires an explicit target:
`bash "$REVEALFLEET_ROOT/revskills/scripts/verify-copy-lockstep.sh" --target "$repo"`.

How to interpret output (two sanctioned distribution modes):

- `<repo>: materialized` — git-tracked copies + `.claude/.revcon-manifest.json`; `status.sh --verify` checks current topology and copy drift.
- `BROKEN SYMLINK` / `FOREIGN TARGET` (exit 1) — fix on revcon side; report and ask before touching.
- `VENDORED COPY` (warn) — regular file shadows profile rule without manifest; present options and ask.

Do **not** auto-fix. Report, then ask for direction.

Historical note: independent dual-copy diffs against the coordination hub were retired 2026-07-16.
