---
type: repo-doc-index
repo: revskills
updated: 2026-09-24
---

# RevSkills — Documentation Index

Curated [Agent Skills](https://agentskills.io) for equal adapters (Claude Code, Grok, Cursor, OpenCode, VS Code). The current count and pack classification are in the [generated skill inventory](./SKILL_INVENTORY.md) (pre-1.0).

## This repo's masters

- [`MASTER_PLAN.md`](./MASTER_PLAN.md) — authoritative plan for RevSkills
- [`MASTER_SPEC.md`](./MASTER_SPEC.md) — skill format, distribution, harness map
- [`AUTO_RECOVERY.md`](./AUTO_RECOVERY.md) — recovery launchers (Claude adapter + multi-harness notes)
- [`SKILL_INVENTORY.md`](./SKILL_INVENTORY.md) — generated skill count, pack, compatibility, and executable assets
- [`HOOK_BUNDLES.md`](./HOOK_BUNDLES.md) — rebuild and verify the two standalone Grok hook entrypoints copied by RevKit

## Fleet coordination

Part of [RevealFleet](https://github.com/RevealUIStudio). Cross-fleet coordination, planning, and lane tracking live in the private agent hub, not in this public repo.

Agent loops have three planes (product runtime, operator laptop, Studio daemon). `rfloop` is operator-only. See [`MASTER_SPEC.md`](./MASTER_SPEC.md).
